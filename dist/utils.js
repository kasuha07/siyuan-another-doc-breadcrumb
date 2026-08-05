"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseVersion = exports.emojiIconHandler = void 0;
exports.isSomePluginExist = isSomePluginExist;
exports.getEmojiHtmlStr = getEmojiHtmlStr;
exports.getAllShowingDocId = getAllShowingDocId;
exports.getCurrentDocIdF = getCurrentDocIdF;
exports.decodeHtmlEntities = decodeHtmlEntities;
exports.sleep = sleep;
exports.stripHTML = stripHTML;
exports.getPluginInstance = getPluginInstance;
exports.isMacOs = isMacOs;
exports.isEventCtrlKey = isEventCtrlKey;
exports.isValidStr = isValidStr;
exports.isMobile = isMobile;
exports.isCurrentVersionLessThan = isCurrentVersionLessThan;
exports.trimListDocsByPathAPIReturnedDocName = trimListDocsByPathAPIReturnedDocName;
exports.isNotebookDocEnabled = isNotebookDocEnabled;
exports.isNotebookDoc = isNotebookDoc;
exports.getListDocsByPathAPIFilePath = getListDocsByPathAPIFilePath;
exports.styleEscape = styleEscape;
exports.escapeHTML = escapeHTML;
/**
 * 通用工具函数
 */
const constants_1 = require("./constants");
const logger_1 = require("./logger");
const state_1 = require("./state");
/*** Utils ***/
function isSomePluginExist(pluginList, checkPluginName) {
    for (const plugin of pluginList) {
        if (checkPluginName.includes(plugin.name)) {
            return true;
        }
    }
    return false;
}
/**
 * 在html中显示文档icon（菜单场景使用，返回 HTML 字符串）
 * @param {*} iconString files[x].icon
 * @param {*} hasChild
 * @param {str} textClassName 文本的span class名称
 * @param {str} picClassName 图片img class名称
 * @param {boolean} wrapText 将文本使用text包裹
 * @param {boolean} wrapBlank 即使按照设置并没有图标，也使用span包裹图标
 * @returns
 */
function getEmojiHtmlStr(iconString, hasChild, textClassName = "og-fdb-menu-emojitext", picClassName = "og-fdb-menu-emojipic", wrapText = true, wrapBlank = true) {
    if (state_1.state.g_setting.icon == constants_1.CONSTANTS.ICON_NONE)
        return ``;
    // 无emoji的处理
    if ((iconString == undefined || iconString == null || iconString == "") && state_1.state.g_setting.icon == constants_1.CONSTANTS.ICON_ALL) {
        if (window.siyuan.storage["local-images"]) {
            if (hasChild) {
                return getEmojiHtmlStr(window.siyuan.storage["local-images"].folder, hasChild, textClassName, picClassName, wrapText);
            }
            else {
                return getEmojiHtmlStr(window.siyuan.storage["local-images"].file, hasChild, textClassName, picClassName, wrapText);
            }
        }
        if (hasChild) {
            if (wrapText) {
                return `<span class="${textClassName}">📑</span>`;
            }
            else {
                return "📑";
            }
        }
        else {
            if (wrapText) {
                return `<span class="${textClassName}">📄</span>`;
            }
            else {
                return "📄";
            }
        }
    }
    if ((iconString == undefined || iconString == null || iconString == "") && state_1.state.g_setting.icon == constants_1.CONSTANTS.ICON_CUSTOM_ONLY) {
        if (wrapBlank) {
            return `<span class="${textClassName}"></span>`;
        }
        else {
            return "";
        }
    }
    let result = iconString;
    // emoji地址判断逻辑为出现.，但请注意之后的补全
    if (iconString.startsWith("api/icon/getDynamicIcon")) {
        result = `<img class="${picClassName}" src="/${iconString}"/>`;
    }
    else if (iconString.indexOf(".") != -1) {
        result = `<img class="${picClassName}" src="/emojis/${iconString}"/>`;
    }
    else {
        if (wrapText) {
            result = `<span class="${textClassName}">${(0, exports.emojiIconHandler)(iconString, hasChild)}</span>`;
        }
        else {
            result = (0, exports.emojiIconHandler)(iconString, hasChild);
        }
    }
    return result;
}
let emojiIconHandler = function (iconString, hasChild = false) {
    //确定是emojiIcon 再调用，printer自己加判断
    try {
        let result = "";
        iconString.split("-").forEach(element => {
            result += String.fromCodePoint(("0x" + element));
        });
        return result;
    }
    catch (err) {
        (0, logger_1.errorPush)("emoji处理时发生错误", iconString, err);
        return hasChild ? "📑" : "📄";
    }
};
exports.emojiIconHandler = emojiIconHandler;
function getAllShowingDocId() {
    if (isMobile()) {
        return [getCurrentDocIdF()];
    }
    else {
        const elemList = window.document.querySelectorAll("[data-type=wnd] .protyle.fn__flex-1:not(.fn__none) .protyle-background");
        const result = [].map.call(elemList, function (elem) {
            return elem.getAttribute("data-node-id");
        });
        return result;
    }
}
function getCurrentDocIdF(forceGetID = false) {
    var _a, _b, _c;
    let thisDocId = null;
    thisDocId = (_a = window.top.document.querySelector(".layout__wnd--active .protyle.fn__flex-1:not(.fn__none) .protyle-background")) === null || _a === void 0 ? void 0 : _a.getAttribute("data-node-id");
    (0, logger_1.debugPush)("thisDocId by first id", thisDocId);
    let temp = null;
    if (!thisDocId && isMobile()) {
        // UNSTABLE: 面包屑样式变动将导致此方案错误！
        try {
            temp = (_b = window.top.document.querySelector(".protyle-breadcrumb .protyle-breadcrumb__item .popover__block[data-id]")) === null || _b === void 0 ? void 0 : _b.getAttribute("data-id");
            let iconArray = window.top.document.querySelectorAll(".protyle-breadcrumb .protyle-breadcrumb__item .popover__block[data-id]");
            for (let i = 0; i < iconArray.length; i++) {
                let iconOne = iconArray[i];
                if (iconOne.children.length > 0
                    && iconOne.children[0].getAttribute("xlink:href") == "#iconFile") {
                    temp = iconOne.getAttribute("data-id");
                    break;
                }
            }
            thisDocId = temp;
        }
        catch (e) {
            console.error(e);
            temp = null;
        }
    }
    if (!thisDocId) {
        thisDocId = (_c = window.top.document.querySelector(".protyle.fn__flex-1:not(.fn__none) .protyle-background")) === null || _c === void 0 ? void 0 : _c.getAttribute("data-node-id");
        (0, logger_1.debugPush)("thisDocId by background must match,  id", thisDocId);
    }
    return thisDocId;
}
/**
 * 将常见 HTML 字符实体转为正常字符
 * @param {string} inputStr - 输入字符串
 * @returns {string} - 转换后的字符串
 */
function decodeHtmlEntities(inputStr) {
    if (!inputStr)
        return "";
    const entitiesMap = {
        "&lt;": "<",
        "&gt;": ">",
        "&nbsp;": " ",
        "&quot;": '"',
        "&amp;": "&",
        // "&apos;": "'",
        // "&#169;": "©"
    };
    const pattern = new RegExp(Object.keys(entitiesMap).join("|"), "g");
    return inputStr.replace(pattern, match => entitiesMap[match]);
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function stripHTML(input) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, "text/html");
    return doc.documentElement.textContent || "";
}
function getPluginInstance() {
    return state_1.state.g_pluginInstance;
}
let cacheIsMacOs;
function isMacOs() {
    var _a, _b;
    let platform = (_b = (_a = window.top.siyuan.config.system.os) !== null && _a !== void 0 ? _a : navigator.platform) !== null && _b !== void 0 ? _b : "ERROR";
    platform = platform.toUpperCase();
    let isMacOSFlag = cacheIsMacOs;
    if (cacheIsMacOs == undefined) {
        for (let platformName of ["DARWIN", "MAC", "IPAD", "IPHONE", "IOS"]) {
            if (platform.includes(platformName)) {
                isMacOSFlag = true;
                break;
            }
        }
        cacheIsMacOs = isMacOSFlag;
    }
    if (isMacOSFlag == undefined) {
        isMacOSFlag = false;
    }
    return isMacOSFlag;
}
function isEventCtrlKey(event) {
    if (isMacOs()) {
        return event.metaKey;
    }
    return event.ctrlKey;
}
function isValidStr(s) {
    if (s == undefined || s == null || s === '') {
        return false;
    }
    return true;
}
function isMobile() {
    return window.top.document.getElementById("sidebar") ? true : false;
}
;
/**
 * 解析版本号字符串，移除除数字和点之外的所有字符，并将其分割成数字数组。
 * 例如 "v3.1.2-beta" -> [3, 1, 2]
 * @param version - 版本号字符串
 * @returns - 由版本号各部分组成的数字数组
 */
const parseVersion = (version) => {
    if (!version || typeof version !== 'string') {
        return [];
    }
    return version.replace(/[^0-9.]/g, '').split('.').map(Number);
};
exports.parseVersion = parseVersion;
/**
 * 比较当前内核版本是否小于输入的版本号。
 * @param version - 要比较的版本号字符串，例如 "3.1.23" 或 "3.2.1.1"
 * @returns boolean - 如果当前版本小于输入版本，则返回 true；否则（大于或等于）返回 false。
 */
function isCurrentVersionLessThan(version) {
    const parsedInputVersion = (0, exports.parseVersion)(version);
    const parsedCurrentVersion = (0, exports.parseVersion)(window.siyuan.config.system.kernelVersion);
    const len = Math.max(parsedCurrentVersion.length, parsedInputVersion.length);
    for (let i = 0; i < len; i++) {
        const currentPart = parsedCurrentVersion[i] || 0;
        const inputPart = parsedInputVersion[i] || 0;
        if (currentPart < inputPart) {
            return true;
        }
        if (currentPart > inputPart) {
            return false;
        }
    }
    return false;
}
function trimListDocsByPathAPIReturnedDocName(docName) {
    if (isCurrentVersionLessThan("3.6.5") && docName.endsWith(".sy")) {
        return decodeHtmlEntities(docName.substring(0, docName.length - 3));
    }
    else {
        return docName;
    }
}
// 兼容性utils
function isNotebookDocEnabled() {
    var _a;
    if (((_a = window.top.siyuan.config) === null || _a === void 0 ? void 0 : _a.fileTree.boxDocEnabled) === undefined) {
        return false;
    }
    return window.top.siyuan.config.fileTree.boxDocEnabled;
}
function isNotebookDoc(path, notebookId) {
    if (!isNotebookDocEnabled()) {
        return false;
    }
    if (path == null || notebookId == null) {
        return false;
    }
    if (path.substring(1, path.length - 3) === notebookId) {
        return true;
    }
    return false;
}
/**
 * 获取用于获取子文档的文档路径
 * v3.7.3+版本，在启用笔记本文档的情况下，返回的笔记本文档路径为"/xxx.sy"，但笔记本下直接文档仍然使用"/"参数
 * @param fullPath
 * @returns
 */
function getListDocsByPathAPIFilePath(fullPath, notbookId) {
    if (fullPath == null) {
        return null;
    }
    if (isNotebookDocEnabled() && isNotebookDoc(fullPath, notbookId)) {
        return "/";
    }
    return fullPath;
}
function styleEscape(str) {
    return str.replace(new RegExp("<[^<]*style[^>]*>", "g"), "");
}
function escapeHTML(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
