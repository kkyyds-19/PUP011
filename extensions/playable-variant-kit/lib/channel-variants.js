'use strict';

const fs = require('fs');
const path = require('path');
const { loadJSZip } = require('./jszip');

const MRAID_CHANNELS = [
    { name: 'remerge', format: 'html' },
    { name: 'inmobi', format: 'zip' },
    { name: 'adikteev', format: 'zip' },
];

const MRAID_ADAPTER = 'window.super_html=function(){var n=false;function e(){if(!n){n=true;super_boot_engine()}}return{download:function(n){super_log("game download");window.mraid&&typeof window.mraid.open==="function"?window.mraid.open(n):window.open(n,"_blank")},game_ready:function(){super_log("game ready");var n=window.mraid;super_check_channel(n);n&&typeof n.getState==="function"&&n.getState()==="loading"&&typeof n.addEventListener==="function"?n.addEventListener("ready",e):e()}}}();';

const CHANNEL_PATTERN = /window\.super_html_channel\s*=\s*(["'])applovin\1/;
const GOOGLE_ORIENTATION_META = '<meta name="ad.orientation" content="portrait,landscape">';

function channelFilename(sourceName, sourceChannel, targetChannel, extension) {
    const sourceExtension = path.extname(sourceName);
    let stem = path.basename(sourceName, sourceExtension);
    const suffix = `_${sourceChannel}`;
    if (stem.endsWith(suffix)) stem = stem.slice(0, -suffix.length);
    return `${stem}_${targetChannel}.${extension}`;
}

function replaceSuperHtmlAdapter(html) {
    const adapterStart = html.indexOf('window.super_html=');
    if (adapterStart < 0) throw new Error('Applovin HTML 不包含 window.super_html。');

    // super-html 5.x may minify the adapter and payload onto the same line.
    const payloadMatch = /window\.__(?:zip|res)\s*=/.exec(html.slice(adapterStart));
    if (!payloadMatch) throw new Error('Applovin HTML 不包含内嵌资源数据。');

    const adapterEnd = adapterStart + payloadMatch.index;
    return `${html.slice(0, adapterStart)}${MRAID_ADAPTER}${html.slice(adapterEnd)}`;
}

function createMraidChannelHtml(applovinHtml, channel) {
    if (!MRAID_CHANNELS.some(item => item.name === channel)) {
        throw new Error(`不支持的 MRAID 渠道：${channel}`);
    }
    if (!CHANNEL_PATTERN.test(applovinHtml)) {
        throw new Error('Applovin HTML 不包含渠道标记。');
    }

    return replaceSuperHtmlAdapter(applovinHtml).replace(
        CHANNEL_PATTERN,
        `window.super_html_channel = ${JSON.stringify(channel)}`,
    );
}

function makeGoogleResponsive(html) {
    if (/<meta\s+name=["']ad\.orientation["'][^>]*>/i.test(html)) return html;

    const sizePattern = /<meta\s+name=["']ad\.size["'][^>]*>/i;
    if (!sizePattern.test(html)) {
        throw new Error('Google HTML 不包含 ad.orientation 或 ad.size 元数据。');
    }
    return html.replace(sizePattern, GOOGLE_ORIENTATION_META);
}

async function writeHtmlZip(destinationPath, html, projectRoot) {
    const JSZip = loadJSZip(projectRoot);
    const zip = new JSZip();
    zip.file('index.html', html);
    const output = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
        platform: 'UNIX',
    });
    fs.writeFileSync(destinationPath, output);
}

async function writeGoogleResponsiveZip(sourcePath, destinationPath, projectRoot) {
    const JSZip = loadJSZip(projectRoot);
    const sourceBuffer = fs.readFileSync(sourcePath);
    const zip = await JSZip.loadAsync(sourceBuffer, { checkCRC32: true });
    const htmlEntries = Object.values(zip.files).filter(
        entry => !entry.dir && entry.name.toLowerCase().endsWith('.html'),
    );
    if (htmlEntries.length !== 1) {
        throw new Error(`${sourcePath} 必须只包含一个 HTML 文件。`);
    }

    const sourceHtml = await htmlEntries[0].async('string');
    const responsiveHtml = makeGoogleResponsive(sourceHtml);
    if (responsiveHtml === sourceHtml) {
        fs.copyFileSync(sourcePath, destinationPath);
        return;
    }

    zip.file(htmlEntries[0].name, responsiveHtml);
    const output = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
        platform: 'UNIX',
    });
    fs.writeFileSync(destinationPath, output);
}

function findFiles(directory, predicate) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile() && predicate(entry.name))
        .map(entry => path.join(directory, entry.name));
}

async function addPlayableChannels(outputRoot, options = {}) {
    const root = path.resolve(outputRoot);
    const projectRoot = path.resolve(options.projectRoot || process.cwd());
    const applovinFiles = findFiles(
        path.join(root, 'applovin'),
        name => name.toLowerCase().endsWith('.html'),
    );
    const googleFiles = findFiles(
        path.join(root, 'google'),
        name => name.toLowerCase().endsWith('_google.zip'),
    );

    if (applovinFiles.length === 0) throw new Error(`在 ${root} 中找不到 Applovin HTML。`);
    if (googleFiles.length === 0) throw new Error(`在 ${root} 中找不到基础 Google ZIP。`);

    const generated = [];
    for (const sourcePath of applovinFiles) {
        const sourceHtml = fs.readFileSync(sourcePath, 'utf8');
        for (const channel of MRAID_CHANNELS) {
            const channelRoot = path.join(root, channel.name);
            fs.mkdirSync(channelRoot, { recursive: true });
            const destinationName = channelFilename(
                path.basename(sourcePath),
                'applovin',
                channel.name,
                channel.format,
            );
            const destinationPath = path.join(channelRoot, destinationName);
            const html = createMraidChannelHtml(sourceHtml, channel.name);
            if (channel.format === 'html') fs.writeFileSync(destinationPath, html);
            else await writeHtmlZip(destinationPath, html, projectRoot);
            generated.push(destinationPath);
        }
    }

    for (const sourcePath of googleFiles) {
        const destinationName = channelFilename(
            path.basename(sourcePath),
            'google',
            'google_responsive',
            'zip',
        );
        const destinationPath = path.join(path.dirname(sourcePath), destinationName);
        await writeGoogleResponsiveZip(sourcePath, destinationPath, projectRoot);
        generated.push(destinationPath);
    }

    return generated;
}

module.exports = {
    GOOGLE_ORIENTATION_META,
    MRAID_ADAPTER,
    MRAID_CHANNELS,
    addPlayableChannels,
    channelFilename,
    createMraidChannelHtml,
    makeGoogleResponsive,
    writeGoogleResponsiveZip,
};
