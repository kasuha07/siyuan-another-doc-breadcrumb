// 验证脚本：stub siyuan 后加载插件入口，检查 require 链与导出
'use strict';
const Module = require('module');
const path = require('path');

// stub siyuan 模块（思源运行时注入，本地 Node 无此包）
const siyuanStub = {
    Plugin: class Plugin {
        constructor() { this.eventBus = { on() {}, off() {} }; }
        loadData() { return Promise.resolve({}); }
        saveData() {}
    },
    Dialog: class Dialog {
        constructor(opts) { this.element = { querySelector() { return null; } }; }
        destroy() {}
    },
    Menu: class Menu {
        constructor(name) { this.name = name; this.element = { querySelector() { return null; } }; }
        addItem() {}
        open() {}
        close() {}
    },
    openTab() {},
    showMessage() {},
    getAllEditor() { return []; },
    Constants: { CB_GET_SCROLL: 'cb-get-scroll' },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'siyuan') return request;
    return origResolve.call(this, request, ...args);
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'siyuan') return siyuanStub;
    return origLoad.call(this, request, parent, isMain);
};

// stub 全局 DOM 对象（模块加载阶段不执行 DOM 操作，仅防御）
global.window = { top: {}, document: { querySelectorAll: () => [], getElementById: () => null } };
global.document = { getElementsByTagName: () => [], createElement: () => ({}) };

// 检查 dist 为单文件 bundle：思源内核只读取 index.js 一个文件（见 kernel/model/plugin.go loadCode），
// 前端 window.eval 执行且 requireFunc 仅支持 'siyuan'，因此不得残留其他模块文件
const fs = require('fs');
const distDir = path.join(__dirname, '..', 'dist');
const jsFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.js'));
if (jsFiles.length !== 1 || jsFiles[0] !== 'index.js') {
    console.error('FAIL: dist 应只包含 index.js 单文件 bundle, 实际 =', jsFiles);
    process.exit(1);
}
console.log('OK: dist 单文件产物 = index.js');

// 验证 bundle 内没有残留相对路径 require（思源环境无法解析）
const bundle = fs.readFileSync(path.join(distDir, 'index.js'), 'utf8');
const relativeRequires = bundle.match(/\.?require\(['"]\.\//g) || [];
if (relativeRequires.length > 0) {
    console.error('FAIL: bundle 内存在相对路径 require:', relativeRequires);
    process.exit(1);
}
console.log('OK: bundle 内无相对路径 require');

// 验证入口默认导出（dist 是唯一插件目录，直接加载构建产物；根目录无入口转发文件）
const root = require('../dist/index.js');
const entry = root.default || root;
if (typeof entry !== 'function' && typeof entry !== 'object') {
    console.error('FAIL: 入口导出不是插件类');
    process.exit(1);
}
console.log('OK: 入口导出 =', entry.name || '(class)');

// 验证样式产物：思源内核只读取插件目录 index.css 并注入 #pluginsStyle{name}
// （见 kernel/model/plugin.go loadPetals 与 app/src/plugin/loader.ts insertPluginCSS）
if (!fs.existsSync(path.join(distDir, 'index.css'))) {
    console.error('FAIL: dist 缺少 index.css（思源内核仅读取该文件注入插件样式）');
    process.exit(1);
}
console.log('OK: dist/index.css 存在');
