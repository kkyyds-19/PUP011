'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadConfig } = require('./config');
const { loadJSZip } = require('./jszip');
const { nodeProcessEnv } = require('./node-process');

const VARIANTS = Object.freeze([
    { suffix: 'Full', mode: 'full' },
    { suffix: '1Click', mode: 'click-1' },
    { suffix: '2Click', mode: 'click-2' },
    { suffix: '3Click', mode: 'click-3' },
    { suffix: '4Click', mode: 'click-4' },
    { suffix: '5Click', mode: 'click-5' },
    { suffix: '30s', mode: 'time-30s' },
    { suffix: '120s', mode: 'time-120s' },
    { suffix: 'InstantRedirect', mode: 'instant-redirect' },
]);

const DELIVERY_ARTIFACTS = Object.freeze([
    { channel: 'adikteev', suffix: '_adikteev.zip' },
    { channel: 'applovin', suffix: '_applovin.html' },
    { channel: 'facebook', suffix: '_facebook.zip' },
    { channel: 'google_landscape', suffix: '_google_landscape.zip' },
    { channel: 'google_portrait', suffix: '_google_portrait.zip' },
    { channel: 'google_responsive', suffix: '_google_responsive.zip' },
    { channel: 'inmobi', suffix: '_inmobi.zip' },
    { channel: 'ironsource', suffix: '_ironsource.html', sourceAliases: ['_ironsource2025.html'] },
    { channel: 'liftoff', suffix: '_liftoff.zip' },
    { channel: 'mintegral', suffix: '_mintegral.zip' },
    { channel: 'moloco', suffix: '_moloco.html' },
    { channel: 'remerge', suffix: '_remerge.html' },
    { channel: 'tiktok', suffix: '_tiktok.zip' },
    { channel: 'unity', suffix: '_unity.html' },
    { channel: 'vungle', suffix: '_vungle.zip' },
]);

const CONFIG_SCRIPT_PATTERN = /<script id="playable-redirect-config">[\s\S]*?<\/script>\s*/i;

function collectFiles(root, relativeDirectory = '') {
    const directory = path.join(root, relativeDirectory);
    const files = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.DS_Store') continue;
        const relativePath = path.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) files.push(...collectFiles(root, relativePath));
        else if (entry.isFile()) files.push(relativePath);
    }

    return files;
}

function safeJson(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildNameFromPrefix(outputBuildPrefix, variantSuffix) {
    const prefix = outputBuildPrefix.replace(/_+$/, '');
    return `${prefix}_${variantSuffix}`;
}

function injectRedirectConfig(html, mode, buildName, runtimeConfig = {}) {
    const config = {
        mode,
        buildName,
        androidUrl: runtimeConfig.androidUrl || '',
        iosUrl: runtimeConfig.iosUrl || '',
    };
    // 保留两个旧全局变量，旧项目里的 PlayableRedirectController 无需改场景也能继续使用。
    const script = `<script id="playable-redirect-config">window.__PLAYABLE_VARIANT_CONFIG__=${safeJson(config)};window.__PLAYABLE_REDIRECT_MODE__=${safeJson(mode)};window.__PLAYABLE_BUILD_NAME__=${safeJson(buildName)};</script>`;
    const cleanHtml = html.replace(CONFIG_SCRIPT_PATTERN, '');
    if (/<head(?:\s[^>]*)?>/i.test(cleanHtml)) {
        return cleanHtml.replace(/<head(?:\s[^>]*)?>/i, match => `${match}\n${script}`);
    }
    if (/<!doctype[^>]*>/i.test(cleanHtml)) {
        return cleanHtml.replace(/<!doctype[^>]*>/i, match => `${match}\n${script}`);
    }
    return `${script}\n${cleanHtml}`;
}

function renamedArtifactPath(relativePath, buildName, sourceBuildPrefix = 'CRM007') {
    const sourceName = path.basename(relativePath);
    const outputName = sourceBuildPrefix && sourceName.startsWith(sourceBuildPrefix)
        ? `${buildName}${sourceName.slice(sourceBuildPrefix.length)}`
        : `${buildName}_${sourceName}`;
    return outputName;
}

function selectDeliveryArtifacts(sourceFiles, deliveryArtifacts = DELIVERY_ARTIFACTS) {
    return deliveryArtifacts.map(({ channel, suffix, sourceAliases = [] }) => {
        const normalizedSuffixes = [suffix, ...sourceAliases].map(value => value.toLowerCase());
        const matches = sourceFiles.filter(relativePath => (
            normalizedSuffixes.some(value => path.basename(relativePath).toLowerCase().endsWith(value))
        ));
        if (matches.length !== 1) {
            throw new Error(
                `Delivery channel ${channel} matched ${matches.length} source artifacts; expected exactly 1 (${suffix}).`,
            );
        }
        return matches[0];
    });
}

async function writeZipVariant(sourcePath, destinationPath, mode, buildName, context) {
    const JSZip = loadJSZip(context.projectRoot);
    const zip = await JSZip.loadAsync(fs.readFileSync(sourcePath));
    let htmlEntryCount = 0;

    for (const [entryPath, entry] of Object.entries(zip.files)) {
        if (entry.dir || !entryPath.toLowerCase().endsWith('.html')) continue;
        const html = await entry.async('string');
        zip.file(entryPath, injectRedirectConfig(html, mode, buildName, context.config));
        htmlEntryCount += 1;
    }

    if (htmlEntryCount === 0) throw new Error(`${sourcePath} 中找不到 HTML。`);

    const output = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
        platform: 'UNIX',
    });
    fs.writeFileSync(destinationPath, output);
}

async function writeVariantFile(sourcePath, destinationPath, mode, buildName, context) {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    const extension = path.extname(sourcePath).toLowerCase();

    if (extension === '.html') {
        const html = fs.readFileSync(sourcePath, 'utf8');
        fs.writeFileSync(
            destinationPath,
            injectRedirectConfig(html, mode, buildName, context.config),
        );
        return;
    }

    if (extension === '.zip') {
        await writeZipVariant(sourcePath, destinationPath, mode, buildName, context);
        return;
    }

    fs.copyFileSync(sourcePath, destinationPath);
}

async function readArtifactHtml(filePath, projectRoot) {
    if (path.extname(filePath).toLowerCase() === '.html') {
        return [fs.readFileSync(filePath, 'utf8')];
    }
    if (path.extname(filePath).toLowerCase() !== '.zip') {
        throw new Error(`不支持的试玩广告文件类型：${filePath}`);
    }

    const JSZip = loadJSZip(projectRoot);
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath), { checkCRC32: true });
    const htmlEntries = [];
    for (const [entryPath, entry] of Object.entries(zip.files)) {
        if (entry.dir || !entryPath.toLowerCase().endsWith('.html')) continue;
        htmlEntries.push(await entry.async('string'));
    }
    return htmlEntries;
}

async function verifyGeneratedVariants(context) {
    const { config, outputRoot, projectRoot } = context;
    let verifiedCount = 0;

    for (const variant of VARIANTS) {
        const buildName = buildNameFromPrefix(config.outputBuildPrefix, variant.suffix);
        const variantRoot = path.join(outputRoot, buildName);
        const relativeArtifactPaths = collectFiles(variantRoot);
        const nestedArtifact = relativeArtifactPaths.find(relativePath => path.dirname(relativePath) !== '.');
        if (nestedArtifact) throw new Error(`${buildName} 包含嵌套文件：${nestedArtifact}`);

        const expectedNames = DELIVERY_ARTIFACTS
            .map(({ suffix }) => `${buildName}${suffix}`)
            .sort();
        const actualNames = relativeArtifactPaths.map(relativePath => path.basename(relativePath)).sort();
        if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
            throw new Error(`${buildName} 的 15 个交付文件不完整或命名不正确。`);
        }

        const expectedMode = `window.__PLAYABLE_REDIRECT_MODE__=${safeJson(variant.mode)}`;
        const expectedBuildName = `window.__PLAYABLE_BUILD_NAME__=${safeJson(buildName)}`;
        for (const relativePath of relativeArtifactPaths) {
            const artifactPath = path.join(variantRoot, relativePath);
            const htmlEntries = await readArtifactHtml(artifactPath, projectRoot);
            if (htmlEntries.length === 0) throw new Error(`${artifactPath} 中找不到 HTML。`);
            if (!htmlEntries.some(html => html.includes(expectedMode) && html.includes(expectedBuildName))) {
                throw new Error(`${artifactPath} 缺少正确的跳转版本配置。`);
            }
            verifiedCount += 1;
        }
    }

    console.log(`[variants] 已校验 ${verifiedCount} 个 HTML/ZIP 文件。`);
}

async function refreshSuperHtmlArtifacts(context) {
    if (!context.config.refreshSuperHtml || context.skipRefresh) return;
    if (!fs.existsSync(context.webBuildRoot) || !fs.statSync(context.webBuildRoot).isDirectory()) {
        throw new Error(`Cocos Web Mobile 构建不存在：${context.webBuildRoot}`);
    }

    console.log('[variants] 正在从 Web Mobile 构建刷新 super-html 渠道产物……');
    const workerPath = path.resolve(__dirname, '..', 'refresh-super-html.js');
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
            workerPath,
            '--project', context.projectRoot,
            '--web-build', context.config.webBuildRoot,
            '--creator-version', context.config.creatorVersion,
        ], {
            cwd: context.projectRoot,
            // 菜单导出时当前进程是 Creator/Electron，子脚本必须以 Node 模式运行。
            env: nodeProcessEnv(),
            stdio: 'inherit',
        });
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`super-html 刷新失败：退出码 ${code ?? 'null'}${signal ? ` (${signal})` : ''}`));
        });
    });
}

async function buildVariants(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || process.cwd());
    const config = loadConfig(projectRoot, options.configPath);
    if (options.forceRefresh) config.refreshSuperHtml = true;
    if (options.sourceRoot) config.sourceRoot = options.sourceRoot;
    if (options.outputRoot) config.outputRoot = options.outputRoot;
    const sourceRoot = path.resolve(projectRoot, config.sourceRoot);
    const outputRoot = path.resolve(projectRoot, config.outputRoot);
    const webBuildRoot = path.resolve(projectRoot, config.webBuildRoot);
    const relativeOutputRoot = path.relative(projectRoot, outputRoot);
    if (
        !relativeOutputRoot
        || relativeOutputRoot === '..'
        || relativeOutputRoot.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativeOutputRoot)
    ) {
        throw new Error('outputRoot 必须位于项目目录内部，且不能是项目根目录。');
    }
    const context = {
        config,
        projectRoot,
        sourceRoot,
        outputRoot,
        webBuildRoot,
        skipRefresh: Boolean(options.skipRefresh || options.sourceRoot),
    };

    await refreshSuperHtmlArtifacts(context);
    if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
        throw new Error(`super-html 输出目录不存在：${sourceRoot}`);
    }
    if (sourceRoot === outputRoot || outputRoot.startsWith(`${sourceRoot}${path.sep}`)) {
        throw new Error('outputRoot 不能等于 sourceRoot，也不能位于 sourceRoot 内部。');
    }

    const availableSourceFiles = collectFiles(sourceRoot);
    if (availableSourceFiles.length === 0) throw new Error(`在 ${sourceRoot} 中找不到构建产物。`);
    const sourceFiles = selectDeliveryArtifacts(availableSourceFiles);

    fs.rmSync(outputRoot, { recursive: true, force: true });
    fs.mkdirSync(outputRoot, { recursive: true });

    for (const variant of VARIANTS) {
        const buildName = buildNameFromPrefix(config.outputBuildPrefix, variant.suffix);
        const variantRoot = path.join(outputRoot, buildName);

        for (let index = 0; index < sourceFiles.length; index += 1) {
            const sourcePath = path.join(sourceRoot, sourceFiles[index]);
            const destinationPath = path.join(
                variantRoot,
                `${buildName}${DELIVERY_ARTIFACTS[index].suffix}`,
            );
            await writeVariantFile(sourcePath, destinationPath, variant.mode, buildName, context);
        }

        console.log(`[variants] ${buildName}: ${sourceFiles.length} 个渠道文件`);
    }

    await verifyGeneratedVariants(context);
    console.log(`[variants] 输出目录：${outputRoot}`);
    return context;
}

module.exports = {
    DELIVERY_ARTIFACTS,
    VARIANTS,
    buildNameFromPrefix,
    buildVariants,
    collectFiles,
    injectRedirectConfig,
    renamedArtifactPath,
    selectDeliveryArtifacts,
    verifyGeneratedVariants,
};
