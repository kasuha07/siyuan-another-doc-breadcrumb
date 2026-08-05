// 构建后拷贝插件资源文件到 dist/，使 dist/ 成为完整、可直接使用的思源插件目录
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

// 根目录下需要随插件分发的文件（不存在的可选文件直接跳过）
const files = [
    'plugin.json',
    'icon.png',
    'preview.png',
    'README.md',
    'README_zh_CN.md',
    'LICENSE',
];
for (const f of files) {
    const src = path.join(root, f);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(dist, f));
    console.log(`OK: ${f}`);
}

// i18n 目录整体拷贝（思源要求 i18n/ 与 plugin.json 同目录）
const i18nSrc = path.join(root, 'i18n');
if (fs.existsSync(i18nSrc)) {
    fs.cpSync(i18nSrc, path.join(dist, 'i18n'), { recursive: true });
    console.log('OK: i18n/');
}

console.log('完成：dist/ 已是完整插件目录');
