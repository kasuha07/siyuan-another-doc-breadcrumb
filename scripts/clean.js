// 清空 dist/，保证构建产物无旧文件残留（跨平台，替代 rm -rf）
'use strict';
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
fs.rmSync(dist, { recursive: true, force: true });
console.log('OK: dist/ 已清空');
