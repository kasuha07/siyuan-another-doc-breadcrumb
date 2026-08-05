"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.g_FULLNAME = exports.g_NAME = exports.g_DEBUG = void 0;
exports.isDebugMode = isDebugMode;
exports.debugPush = debugPush;
exports.infoPush = infoPush;
exports.logPush = logPush;
exports.errorPush = errorPush;
exports.warnPush = warnPush;
// debug push
exports.g_DEBUG = 2;
exports.g_NAME = "fdb";
exports.g_FULLNAME = "文档面包屑";
/*
LEVEL 0 忽略所有
LEVEL 1 仅Error
LEVEL 2 Err + Warn
LEVEL 3 Err + Warn + Info
LEVEL 4 Err + Warn + Info + Log
LEVEL 5 Err + Warn + Info + Log + Debug
*/
function commonPushCheck() {
    if (window.top["OpaqueGlassDebugV2"] == undefined || window.top["OpaqueGlassDebugV2"][exports.g_NAME] == undefined) {
        return exports.g_DEBUG;
    }
    return window.top["OpaqueGlassDebugV2"][exports.g_NAME];
}
function isDebugMode() {
    return commonPushCheck() > exports.g_DEBUG;
}
function debugPush(str, ...args) {
    if (commonPushCheck() >= 5) {
        console.debug(`${exports.g_FULLNAME}[D] ${new Date().toLocaleString()} ${str}`, ...args);
    }
}
function infoPush(str, ...args) {
    if (commonPushCheck() >= 3) {
        console.info(`${exports.g_FULLNAME}[I] ${new Date().toLocaleString()} ${str}`, ...args);
    }
}
function logPush(str, ...args) {
    if (commonPushCheck() >= 4) {
        console.log(`${exports.g_FULLNAME}[L] ${new Date().toLocaleString()} ${str}`, ...args);
    }
}
function errorPush(str, ...args) {
    var _a;
    if (commonPushCheck() >= 1) {
        console.error(`${exports.g_FULLNAME}[E] ${new Date().toLocaleString()} ${str}`, ...args);
        console.trace((_a = args[0]) !== null && _a !== void 0 ? _a : undefined);
    }
}
function warnPush(str, ...args) {
    if (commonPushCheck() >= 2) {
        console.warn(`${exports.g_FULLNAME}[W] ${new Date().toLocaleString()} ${str}`, ...args);
    }
}
