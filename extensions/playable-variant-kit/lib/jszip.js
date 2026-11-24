'use strict';

const path = require('path');

function loadJSZip(projectRoot = process.cwd()) {
    const candidates = [
        path.join(projectRoot, 'node_modules', 'jszip'),
        path.join(projectRoot, 'extensions', 'super-html', 'node_modules', 'jszip'),
    ];

    for (const candidate of candidates) {
        try {
            return require(candidate);
        } catch (error) {
            if (error?.code !== 'MODULE_NOT_FOUND') throw error;
        }
    }

    throw new Error(
        '找不到 jszip。请安装 super-html 扩展，或在项目根目录执行 npm install -D jszip。',
    );
}

module.exports = { loadJSZip };
