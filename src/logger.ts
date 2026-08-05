// debug push
export let g_DEBUG = 2;
export const g_NAME = "fdb";
export const g_FULLNAME = "文档面包屑";

/*
LEVEL 0 忽略所有
LEVEL 1 仅Error
LEVEL 2 Err + Warn
LEVEL 3 Err + Warn + Info
LEVEL 4 Err + Warn + Info + Log
LEVEL 5 Err + Warn + Info + Log + Debug
*/
function commonPushCheck() {
    if (window.top["OpaqueGlassDebugV2"] == undefined || window.top["OpaqueGlassDebugV2"][g_NAME] == undefined) {
        return g_DEBUG;
    }
    return window.top["OpaqueGlassDebugV2"][g_NAME];
}

export function isDebugMode() {
    return commonPushCheck() > g_DEBUG;
}

export function debugPush(str: any, ...args: any[]) {
    if (commonPushCheck() >= 5) {
        console.debug(`${g_FULLNAME}[D] ${new Date().toLocaleString()} ${str}`, ...args);
    }
}

export function infoPush(str: any, ...args: any[]) {
    if (commonPushCheck() >= 3) {
        console.info(`${g_FULLNAME}[I] ${new Date().toLocaleString()} ${str}`, ...args);
    }
}

export function logPush(str: any, ...args: any[]) {
    if (commonPushCheck() >= 4) {
        console.log(`${g_FULLNAME}[L] ${new Date().toLocaleString()} ${str}`, ...args);
    }
}

export function errorPush(str: any, ...args: any[]) {
    if (commonPushCheck() >= 1) {
        console.error(`${g_FULLNAME}[E] ${new Date().toLocaleString()} ${str}`, ...args);
        console.trace(args[0] ?? undefined);
    }
}

export function warnPush(str: any, ...args: any[]) {
    if (commonPushCheck() >= 2) {
        console.warn(`${g_FULLNAME}[W] ${new Date().toLocaleString()} ${str}`, ...args);
    }
}
