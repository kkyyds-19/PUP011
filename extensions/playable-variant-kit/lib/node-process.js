'use strict';

/**
 * Cocos 扩展运行在 Electron 中，此时 process.execPath 是 Cocos Creator 本身。
 * 启动脚本子进程时必须设置 ELECTRON_RUN_AS_NODE，否则会打开一个新的 Creator 窗口。
 */
function nodeProcessEnv(baseEnv = process.env, versions = process.versions) {
    const env = { ...baseEnv };
    if (versions?.electron) env.ELECTRON_RUN_AS_NODE = '1';
    return env;
}

module.exports = { nodeProcessEnv };
