// 对比脚本：原 index.js（git HEAD）的顶层函数 vs dist 编译产物
// 归一化规则：去掉空白、去掉 TS 编译产生的模块前缀（state_1. 等）与 state. 前缀
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const orig = execSync('git show HEAD:index.js', { cwd: path.join(__dirname, '..') }).toString('utf8');

// 提取顶层函数/类：function name(、async function name(、class Name
function extractTopLevel(src) {
    const results = {};
    const re = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const name = m[1];
        if (results[name]) continue;
        // 从函数名开始找到匹配的右花括号（简单括号计数，忽略字符串）
        const start = src.indexOf('{', m.index + m[0].length - 1);
        if (start < 0) continue;
        let depth = 0, i = start;
        let inStr = null, inTpl = false, esc = false;
        for (; i < src.length; i++) {
            const c = src[i];
            if (inStr) {
                if (esc) { esc = false; continue; }
                if (c === '\\') { esc = true; continue; }
                if (c === inStr) inStr = null;
                continue;
            }
            if (inTpl) {
                if (esc) { esc = false; continue; }
                if (c === '\\') { esc = true; continue; }
                if (c === '`') inTpl = false;
                continue;
            }
            if (c === '"' || c === "'") { inStr = c; continue; }
            if (c === '`') { inTpl = true; continue; }
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) break; }
        }
        results[name] = src.slice(m.index, i + 1);
    }
    // 类（取到类的结束）
    const classRe = /(?:^|\n)\s*class\s+([A-Za-z_$][\w$]*)/g;
    while ((m = classRe.exec(src)) !== null) {
        const name = m[1];
        if (results[name]) continue;
        const start = src.indexOf('{', m.index + m[0].length - 1);
        if (start < 0) continue;
        let depth = 0, i = start;
        let inStr = null, inTpl = false, esc = false;
        for (; i < src.length; i++) {
            const c = src[i];
            if (inStr) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === inStr) inStr = null; continue; }
            if (inTpl) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === '`') inTpl = false; continue; }
            if (c === '"' || c === "'") { inStr = c; continue; }
            if (c === '`') { inTpl = true; continue; }
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) break; }
        }
        results[name] = src.slice(m.index, i + 1);
    }
    return results;
}

// 归一化：去空白、去模块前缀、去 tsc 编译机械变换
function normalize(text) {
    let t = text;
    // 去掉 TS 编译的模块别名前缀 xxx_1. 与 src 中的 state. 前缀
    t = t.replace(/\b[a-z]+_1\./g, '');
    t = t.replace(/\bstate\./g, '');
    t = t.replace(/exports\./g, '');
    // 直接去掉所有空白（字符串内空白两侧同样处理，不影响比较）
    t = t.replace(/\s+/g, '');
    // 可选链降级 var _a; 声明（去空白后无空格）
    t = t.replace(/var_[a-z](,[_a-z]+)*;/g, '');
    // (0, fn)( -> fn(  （CommonJS 互操作保护）
    t = t.replace(/\(0,([\w$]+)\)\(/g, '$1(');
    // 可选链降级 (_a=X===null||_a===void0?void0:_a.Y) -> X?.Y （迭代直到稳定）
    const optChainRe = /\(_([a-z])=([A-Za-z_$][\w$.\[\]"]*)===null\|\|_\1===void0\?void0:_\1\.([A-Za-z_$][\w$]*)\)/g;
    for (let i = 0; i < 10; i++) {
        const before = t;
        t = t.replace(optChainRe, '$2?.$3');
        if (t === before) break;
    }
    // 去掉 import/require 行与导出行
    t = t.replace(/^.*require\(.*$/gm, '');
    t = t.replace(/^.*__esModule.*$/gm, '');
    t = t.replace(/^.*exports\.[^=]*=.*$/gm, '');
    t = t.replace(/^.*module\.exports.*$/gm, '');
    t = t.replace(/^.*Object\.defineProperty.*$/gm, '');
    return t;
}

const origFns = extractTopLevel(orig);
const distDir = path.join(__dirname, '..', 'dist');
const distFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.js'));

let allDist = '';
for (const f of distFiles) {
    allDist += fs.readFileSync(path.join(distDir, f), 'utf8') + '\n';
}
const distFns = extractTopLevel(allDist);

let ok = 0, fail = 0;
for (const [name, body] of Object.entries(origFns)) {
    // 跳过明显不需要对比的
    if (name === 'FakeDocBreadcrumb' || name === 'InlineBreadcrumbController') continue; // 类单独看
    const distBody = distFns[name];
    if (!distBody) { console.log(`MISSING in dist: ${name}`); fail++; continue; }
    const a = normalize(body);
    const b = normalize(distBody);
    if (a === b) { ok++; }
    else {
        fail++;
        console.log(`DIFF: ${name}`);
        // 找第一个差异位置
        let i = 0;
        while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
        console.log(`  原版: ...${a.slice(Math.max(0, i - 40), i + 40)}...`);
        console.log(`  产物: ...${b.slice(Math.max(0, i - 40), i + 40)}...`);
    }
}
// 类方法对比
for (const cls of ['FakeDocBreadcrumb', 'InlineBreadcrumbController']) {
    const origCls = origFns[cls];
    const distCls = distFns[cls];
    if (!origCls || !distCls) { console.log(`MISSING class: ${cls}`); fail++; continue; }
    if (normalize(origCls) === normalize(distCls)) ok++;
    else {
        fail++;
        console.log(`DIFF in class: ${cls}`);
    }
}
console.log(`\n对比结果: 一致 ${ok}, 差异 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
