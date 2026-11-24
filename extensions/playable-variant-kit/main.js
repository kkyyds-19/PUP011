'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { nodeProcessEnv } = require('./lib/node-process');
const { loadConfig } = require('./lib/config');
const { ensureWebBuild } = require('./lib/web-build');
const { VARIANTS } = require('./lib/variant-builder');

let packaging = false;

function projectRoot() {
    if (globalThis.Editor?.Project?.path) return path.resolve(globalThis.Editor.Project.path);
    return process.cwd();
}

function copyDirectory(source, destination) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name);
        const destinationPath = path.join(destination, entry.name);
        if (entry.isDirectory()) copyDirectory(sourcePath, destinationPath);
        else if (entry.isFile()) fs.copyFileSync(sourcePath, destinationPath);
    }
}

async function refreshAssetDatabase() {
    if (!globalThis.Editor?.Message?.request) return;
    try {
        await globalThis.Editor.Message.request(
            'asset-db',
            'refresh-asset',
            'db://assets',
        );
    } catch (error) {
        console.warn('[Playable Variant Kit] 资源已复制，请在资源管理器中手动刷新。', error);
    }
}

function runPackager(root) {
    const cliPath = path.join(__dirname, 'cli.js');
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliPath, '--project', root, '--force-refresh'], {
            cwd: root,
            // Cocos 中的 execPath 是 Creator/Electron；Node 模式可避免再次打开编辑器。
            env: nodeProcessEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout.on('data', chunk => {
            for (const line of chunk.toString().split(/\r?\n/)) {
                if (line) console.log(line);
            }
        });
        child.stderr.on('data', chunk => {
            for (const line of chunk.toString().split(/\r?\n/)) {
                if (line) console.error(line);
            }
        });
        child.once('error', reject);
        child.once('exit', code => {
            if (code === 0) resolve();
            else reject(new Error(`版本导出失败，退出码 ${code ?? 'unknown'}。`));
        });
    });
}

exports.methods = {
    async installRuntime() {
        const root = projectRoot();
        const destination = path.join(root, 'assets', 'PlayableVariantKit');
        copyDirectory(path.join(__dirname, 'runtime'), destination);

        const configPath = path.join(root, 'playable-variant-kit.config.json');
        if (!fs.existsSync(configPath)) {
            fs.copyFileSync(path.join(__dirname, 'config.example.json'), configPath);
        }

        await refreshAssetDatabase();
        console.log('[Playable Variant Kit] 安装完成：请把 assets/PlayableVariantKit/PlayableVariantKit.prefab 放入启动场景。运行时自动跨场景保留计数和状态；其他场景无需重复放置，也可放置以绑定 CTA 或独立预览，多个组件会共享同一会话。');
    },

    async packageVariants() {
        if (packaging) {
            console.warn('[Playable Variant Kit] 正在构建或导出，请勿重复点击。');
            return;
        }
        packaging = true;
        try {
            const root = projectRoot();
            const config = loadConfig(root);
            console.log('[Playable Variant Kit] 正在检查项目内容和 Web Mobile 构建……');
            await ensureWebBuild({ projectRoot: root, config, editor: globalThis.Editor });
            // Automatic builds must always feed the new web output into super-html.
            await runPackager(root);
            console.log(`[Playable Variant Kit] ${VARIANTS.length} 个版本已导出。`);
        } catch (error) {
            console.error(`[Playable Variant Kit] ${error instanceof Error ? error.message : error}`);
            throw error;
        } finally {
            packaging = false;
        }
    },
};

exports.load = function load() {};
exports.unload = function unload() {};
