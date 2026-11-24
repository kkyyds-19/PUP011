'use strict';

const path = require('path');
const { buildVariants } = require('./lib/variant-builder');

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--skip-refresh') options.skipRefresh = true;
        else if (arg === '--force-refresh') options.forceRefresh = true;
        else if (arg === '--project') options.projectRoot = argv[++index];
        else if (arg === '--config') options.configPath = argv[++index];
        else if (arg === '--source') options.sourceRoot = argv[++index];
        else if (arg === '--output') options.outputRoot = argv[++index];
        else throw new Error(`未知参数：${arg}`);
    }
    options.projectRoot = path.resolve(options.projectRoot || process.cwd());
    return options;
}

async function main(argv = process.argv.slice(2)) {
    await buildVariants(parseArgs(argv));
}

if (require.main === module) {
    main().catch(error => {
        console.error(`[variants] ${error instanceof Error ? error.message : error}`);
        process.exitCode = 1;
    });
}

module.exports = { main, parseArgs };
