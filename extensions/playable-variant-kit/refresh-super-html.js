'use strict';

const path = require('path');
const { addPlayableChannels } = require('./lib/channel-variants');

function readArg(name, fallback) {
    const index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const projectRoot = path.resolve(readArg('--project', process.cwd()));
const webBuildRoot = path.resolve(projectRoot, readArg('--web-build', 'build/web-mobile'));
const creatorVersion = readArg('--creator-version', '3.8.8');
const superHtmlModule = path.join(
    projectRoot,
    'extensions',
    'super-html',
    'dist',
    'platform',
    'cocos',
    'cocos_main',
);

let CocosSuperHtml;
try {
    CocosSuperHtml = require(superHtmlModule).default;
} catch (error) {
    console.error('[variants] 找不到 super-html 扩展。请先把 super-html 安装到项目 extensions 目录。');
    process.exit(1);
}

const timeout = setTimeout(() => {
    console.error('[variants] super-html 刷新超时。');
    process.exit(1);
}, 120_000);

try {
    new CocosSuperHtml(creatorVersion, webBuildRoot, async () => {
        try {
            const outputRoot = path.resolve(webBuildRoot, '..', 'super-html');
            const generated = await addPlayableChannels(outputRoot, { projectRoot });
            console.log(`[variants] 已补充 ${generated.length} 个渠道文件。`);
            clearTimeout(timeout);
            process.exit(0);
        } catch (error) {
            clearTimeout(timeout);
            console.error(`[variants] ${error instanceof Error ? error.message : error}`);
            process.exit(1);
        }
    });
} catch (error) {
    clearTimeout(timeout);
    console.error(`[variants] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
}
