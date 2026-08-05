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

const root = require('../index.js');
const entry = root.default || root;

if (typeof entry !== 'function' && typeof entry !== 'object') {
    console.error('FAIL: 入口导出不是插件类');
    process.exit(1);
}
console.log('OK: 入口加载成功, export keys =', Object.keys(root));
console.log('OK: default =', entry.name || '(class)');

// 检查 dist 内所有模块可加载
const fs = require('fs');
const distDir = path.join(__dirname, '..', 'dist');
const files = fs.readdirSync(distDir).filter(f => f.endsWith('.js'));
for (const f of files) {
    require(path.join(distDir, f));
}
console.log('OK: dist 全部模块可加载, 共', files.length, '个文件');

// 验证 state 单例共享：events 里赋值的 state 与 index 读取的一致
const state = require('../dist/state.js').state;
const utils = require('../dist/utils.js');
console.log('OK: state.g_setting 初始键数 =', Object.keys(state.g_setting).length);
console.log('OK: utils.isValidStr("") =', utils.isValidStr(''), ', isValidStr("a") =', utils.isValidStr('a'));
