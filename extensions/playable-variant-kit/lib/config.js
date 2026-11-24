'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'playable-variant-kit.config.json';
const DEFAULT_CONFIG = Object.freeze({
    webBuildRoot: 'build/web-mobile',
    sourceRoot: 'build/super-html',
    outputRoot: 'build/playable-variants',
    outputBuildPrefix: 'PLAYABLE_',
    creatorVersion: '3.8.8',
    refreshSuperHtml: true,
    androidUrl: '',
    iosUrl: '',
});

function assertRelativeProjectPath(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${field} 必须是非空的项目相对路径。`);
    }
    if (path.isAbsolute(value)) throw new Error(`${field} 必须使用项目相对路径。`);
    const normalized = path.normalize(value);
    if (normalized === '.') throw new Error(`${field} 不能指向项目根目录。`);
    if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
        throw new Error(`${field} 不能指向项目目录之外。`);
    }
    return normalized;
}

function assertStoreUrl(value, platform) {
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`${platform} 商店链接无效：${value || '(empty)'}`);
    }
    if (parsed.protocol !== 'https:') throw new Error(`${platform} 商店链接必须使用 HTTPS。`);
    return parsed.toString();
}

function loadConfig(projectRoot, explicitPath) {
    const configPath = path.resolve(projectRoot, explicitPath || CONFIG_FILENAME);
    if (!fs.existsSync(configPath)) {
        throw new Error(
            `缺少 ${path.relative(projectRoot, configPath)}。请先执行“安装或更新场景组件”，或复制 config.example.json。`,
        );
    }

    let userConfig;
    try {
        userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        throw new Error(`无法读取 ${configPath}: ${error instanceof Error ? error.message : error}`);
    }

    const config = { ...DEFAULT_CONFIG, ...userConfig };
    config.webBuildRoot = assertRelativeProjectPath(config.webBuildRoot, 'webBuildRoot');
    config.sourceRoot = assertRelativeProjectPath(config.sourceRoot, 'sourceRoot');
    config.outputRoot = assertRelativeProjectPath(config.outputRoot, 'outputRoot');
    if (typeof config.outputBuildPrefix !== 'string' || !config.outputBuildPrefix.trim()) {
        throw new Error('outputBuildPrefix 不能为空。');
    }
    config.outputBuildPrefix = config.outputBuildPrefix.trim();
    if (/[\\/]/.test(config.outputBuildPrefix)) {
        throw new Error('outputBuildPrefix 不能包含路径分隔符。');
    }
    if (!config.outputBuildPrefix.replace(/_+$/, '')) {
        throw new Error('outputBuildPrefix 不能只包含下划线。');
    }
    config.androidUrl = assertStoreUrl(config.androidUrl, 'Android');
    config.iosUrl = assertStoreUrl(config.iosUrl, 'iOS');
    config.configPath = configPath;
    return config;
}

module.exports = {
    CONFIG_FILENAME,
    DEFAULT_CONFIG,
    loadConfig,
};
