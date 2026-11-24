'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE_VERSION = 1;
// Creator 3.8 builder/@types/protected/options.d.ts: add-task(..., true)
// returns BuildExitCode, not TaskAddResult (whose SUCCESS is 1).
const BUILD_SUCCESS = 36;
const INPUT_PATHS = [
    'assets', 'settings', 'extensions', 'build-templates',
    'package.json', 'package-lock.json', 'tsconfig.json', 'import-map.json',
];
const IGNORED_NAMES = new Set(['.DS_Store', '.git', 'node_modules']);

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
            .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

async function fingerprintPaths(root, relativePaths) {
    const hash = crypto.createHash('sha256');
    async function visit(relativePath, ancestors = new Set()) {
        const absolutePath = path.join(root, relativePath);
        let stat;
        try {
            stat = await fs.promises.stat(absolutePath);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            hash.update(stableJson(['missing', relativePath]));
            return;
        }
        if (stat.isDirectory()) {
            const realPath = await fs.promises.realpath(absolutePath);
            if (ancestors.has(realPath)) throw new Error(`检测到循环目录链接：${relativePath}`);
            const parents = new Set([...ancestors, realPath]);
            hash.update(stableJson(['directory', relativePath]));
            const names = (await fs.promises.readdir(absolutePath)).sort();
            for (const name of names) {
                if (!IGNORED_NAMES.has(name)) await visit(path.join(relativePath, name), parents);
            }
        } else if (stat.isFile()) {
            const fileHash = crypto.createHash('sha256');
            for await (const chunk of fs.createReadStream(absolutePath)) fileHash.update(chunk);
            hash.update(stableJson(['file', relativePath, fileHash.digest('hex')]));
        }
    }
    for (const relativePath of relativePaths) await visit(relativePath);
    return hash.digest('hex');
}

function taskOutputRoot(projectRoot, options) {
    if (!options?.buildPath || !options.outputName) return null;
    const buildPath = options.buildPath.startsWith('project://')
        ? path.resolve(projectRoot, options.buildPath.slice('project://'.length))
        : path.resolve(projectRoot, options.buildPath);
    return path.join(buildPath, options.outputName);
}

function selectBuildTask(tasks, projectRoot, webBuildRoot) {
    const target = path.resolve(projectRoot, webBuildRoot);
    const task = tasks.find(item => item.type === 'build'
        && item.options?.platform === 'web-mobile'
        && taskOutputRoot(projectRoot, item.options) === target);
    if (!task) {
        throw new Error(`找不到输出到 ${webBuildRoot} 的 Web Mobile 构建任务。请先在“构建发布”中配置该任务并保存。`);
    }
    if (!task.options.scenes?.length || !task.options.startScene) {
        throw new Error('Web Mobile 构建任务缺少场景或启动场景，请先在“构建发布”中配置。');
    }
    return task;
}

function buildOptionsFromTask(task) {
    const options = JSON.parse(JSON.stringify(task.options));
    // These fields describe an earlier run, not the game being built.
    for (const key of ['id', 'taskId', 'logDest', '__version__', 'nextStages']) delete options[key];
    return options;
}

async function sourceFingerprint(projectRoot, options, creatorVersion) {
    const files = await fingerprintPaths(projectRoot, INPUT_PATHS);
    return crypto.createHash('sha256').update(stableJson({ files, options, creatorVersion })).digest('hex');
}

async function readState(statePath) {
    try {
        return JSON.parse(await fs.promises.readFile(statePath, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
        throw error;
    }
}

async function ensureWebBuild({ projectRoot, config, editor, log = console.log }) {
    const request = (...args) => editor.Message.request(...args);
    const info = await request('builder', 'query-tasks-info', { type: 'build', sortType: 'buildTime' });
    const tasks = info.list || Object.values(info.queue || {});
    if (tasks.some(task => task.state === 'processing' || task.state === 'waiting')) {
        throw new Error('编辑器中已有构建任务正在运行或排队，请等待完成后再导出。');
    }
    const task = selectBuildTask(tasks, projectRoot, config.webBuildRoot);
    const options = buildOptionsFromTask(task);
    const creatorVersion = editor.App?.version || config.creatorVersion;

    if (await request('scene', 'query-dirty')) {
        log('[Playable Variant Kit] 正在保存当前场景……');
        await request('scene', 'save-scene');
        if (await request('scene', 'query-dirty')) throw new Error('场景尚未保存，已停止导出。');
    }
    // External edits must be imported before taking the snapshot and compiling.
    await request('asset-db', 'refresh-asset', 'db://assets');

    const webBuildRoot = path.resolve(projectRoot, config.webBuildRoot);
    const statePath = path.join(projectRoot, 'temp', 'playable-variant-kit', 'web-build-state.json');
    const sourceHash = await sourceFingerprint(projectRoot, options, creatorVersion);
    const previous = await readState(statePath);
    const hasOutput = fs.existsSync(path.join(webBuildRoot, 'index.html'));
    if (hasOutput && previous?.version === STATE_VERSION
        && previous.webBuildRoot === webBuildRoot && previous.sourceHash === sourceHash
        && previous.outputHash === await fingerprintPaths(webBuildRoot, ['.'])) {
        log('[Playable Variant Kit] 代码、资源和构建配置未变化，复用当前 Web Mobile 构建。');
        return { rebuilt: false };
    }

    log('[Playable Variant Kit] 检测到内容变化或缺少有效构建记录，正在构建 Web Mobile……');
    // Invalidate BEFORE starting: a failed build may already have overwritten files.
    await fs.promises.rm(statePath, { force: true });
    const code = await request('builder', 'add-task', options, true);
    if (code !== BUILD_SUCCESS) {
        throw new Error(`Web Mobile 构建失败或被取消（返回码 ${code}），已停止导出。请查看 Cocos 构建日志。`);
    }
    if (!fs.existsSync(path.join(webBuildRoot, 'index.html'))) {
        throw new Error(`构建未生成 ${config.webBuildRoot}/index.html，已停止导出。`);
    }
    if (sourceHash !== await sourceFingerprint(projectRoot, options, creatorVersion)) {
        throw new Error('构建期间项目内容发生了变化，已停止导出。请等待编辑或资源导入完成后重新点击导出。');
    }
    const state = {
        version: STATE_VERSION,
        webBuildRoot,
        sourceHash,
        outputHash: await fingerprintPaths(webBuildRoot, ['.']),
        builtAt: new Date().toISOString(),
    };
    await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.tmp`;
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
    await fs.promises.rename(temporaryPath, statePath);
    log('[Playable Variant Kit] Web Mobile 构建成功，继续导出全部版本。');
    return { rebuilt: true };
}

module.exports = { ensureWebBuild, fingerprintPaths, selectBuildTask, buildOptionsFromTask };
