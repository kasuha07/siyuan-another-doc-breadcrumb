/**
 * 通用工具函数
 */
import { CONSTANTS } from "./constants";
import { errorPush, debugPush } from "./logger";
import { state } from "./state";

/**
 * 非空断言（!）说明：
 * - window.top!：插件运行于思源 iframe 内，window.top 必为顶层布局窗口，不会为 null；
 * - window.siyuan.storage!/config!：siyuan 类型声明这些为可选属性，
 *   但思源内核初始化时必然注入（含移动端），断言仅消除类型收窄，不影响运行时行为。
 */

/*** Utils ***/

export function isSomePluginExist(pluginList: any, checkPluginName: string[]) {
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
 * @returns 
 */
export function getEmojiHtmlStr(iconString: any, hasChild: boolean, textClassName = "og-fdb-menu-emojitext", picClassName = "og-fdb-menu-emojipic", wrapText = true) {
    if (state.g_setting.icon == CONSTANTS.ICON_NONE) return ``;
    // 无自定义图标时显示默认图标，避免空白占位（仅自定义 / 显示全部均适用）
    if (iconString == undefined || iconString == null || iconString == "") {
        if (window.siyuan.storage!["local-images"]) {
            if (hasChild) {
                return getEmojiHtmlStr(window.siyuan.storage!["local-images"].folder, hasChild, textClassName, picClassName, wrapText);
            } else {
                return getEmojiHtmlStr(window.siyuan.storage!["local-images"].file, hasChild, textClassName, picClassName, wrapText);
            }
        }
        if (hasChild) {
            if (wrapText) {
                return `<span class="${textClassName}">📑</span>`;
            } else {
                return "📑";
            }
        } else {
            if (wrapText) {
                return `<span class="${textClassName}">📄</span>`;
            } else {
                return "📄";
            }
        }
    }
    let result: any = iconString;
    // emoji地址判断逻辑为出现.，但请注意之后的补全
    // icon 来自内核 IAL（不消毒，用户可控），拼入 HTML 前必须先转义：
    // - img src 可注入 " onerror=；
    // - emoji 分支的 hex 码点序列（如 3c-69-6d-...）可还原为任意 HTML 标签
    if (iconString.startsWith("api/icon/getDynamicIcon")) {
        result = `<img class="${picClassName}" src="/${escapeHTML(iconString)}"/>`;
    } else if (iconString.indexOf(".") != -1) {
        result = `<img class="${picClassName}" src="/emojis/${escapeHTML(iconString)}"/>`;
    } else {
        if (wrapText) {
            result = `<span class="${textClassName}">${escapeHTML(emojiIconHandler(iconString, hasChild))}</span>`;
        } else {
            result = escapeHTML(emojiIconHandler(iconString, hasChild));
        }
    }
    return result;
}
export let emojiIconHandler = function (iconString: string, hasChild = false) {
    //确定是emojiIcon 再调用，printer自己加判断
    try {
        let result = "";
        iconString.split("-").forEach(element => {
            result += String.fromCodePoint(("0x" + element) as any);
        });
        return result;
    } catch (err) {
        errorPush("emoji处理时发生错误", iconString, err);
        return hasChild ? "📑" : "📄";
    }
}

export function getAllShowingDocId() {
    if (isMobile()) {
        return [getCurrentDocIdF()];
    } else {
        const elemList = window.document.querySelectorAll("[data-type=wnd] .protyle.fn__flex-1:not(.fn__none) .protyle-background");
        const result = [].map.call(elemList, function (elem: any) {
            return elem.getAttribute("data-node-id");
        });
        return result
    }
}

export function getCurrentDocIdF(forceGetID = false) {
    let thisDocId: string | null = null;
    thisDocId = window.top!.document.querySelector(".layout__wnd--active .protyle.fn__flex-1:not(.fn__none) .protyle-background")?.getAttribute("data-node-id") ?? null;
    debugPush("thisDocId by first id", thisDocId);
    let temp: string | null = null;
    if (!thisDocId && isMobile()) {
        // UNSTABLE: 面包屑样式变动将导致此方案错误！
        try {
            temp = window.top!.document.querySelector(".protyle-breadcrumb .protyle-breadcrumb__item .popover__block[data-id]")?.getAttribute("data-id") ?? null;
            let iconArray = window.top!.document.querySelectorAll(".protyle-breadcrumb .protyle-breadcrumb__item .popover__block[data-id]");
            for (let i = 0; i < iconArray.length; i++) {
                let iconOne = iconArray[i];
                if (iconOne.children.length > 0
                    && iconOne.children[0].getAttribute("xlink:href") == "#iconFile") {
                    temp = iconOne.getAttribute("data-id");
                    break;
                }
            }
            thisDocId = temp;
        } catch (e) {
            console.error(e);
            temp = null;
        }
    }
    if (!thisDocId) {
        thisDocId = window.top!.document.querySelector(".protyle.fn__flex-1:not(.fn__none) .protyle-background")?.getAttribute("data-node-id") ?? null;
        debugPush("thisDocId by background must match,  id", thisDocId);
    }
    return thisDocId;
}

/**
 * 将常见 HTML 字符实体转为正常字符
 * @param {string} inputStr - 输入字符串
 * @returns {string} - 转换后的字符串
 */
export function decodeHtmlEntities(inputStr: string) {
    if (!inputStr) return "";

    const entitiesMap: { [key: string]: string } = {
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

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function stripHTML(input: string) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, "text/html");
    return doc.documentElement.textContent || "";
}

export function getPluginInstance() {
    return state.g_pluginInstance;
}
let cacheIsMacOs: boolean | undefined;
export function isMacOs() {
    let platform: string = window.top!.siyuan.config!.system.os ?? navigator.platform ?? "ERROR";
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

export function isEventCtrlKey(event: any) {
    if (isMacOs()) {
        return event.metaKey;
    }
    return event.ctrlKey;
}

export function isValidStr(s: any) {
    if (s == undefined || s == null || s === '') {
        return false;
    }
    return true;
}

export function isMobile() {
    return window.top!.document.getElementById("sidebar") ? true : false;
};

/**
 * 解析版本号字符串，移除除数字和点之外的所有字符，并将其分割成数字数组。
 * 例如 "v3.1.2-beta" -> [3, 1, 2]
 * @param version - 版本号字符串
 * @returns - 由版本号各部分组成的数字数组
 */
export const parseVersion = (version: string) => {
    if (!version || typeof version !== 'string') {
        return [];
    }
    return version.replace(/[^0-9.]/g, '').split('.').map(Number);
};

/**
 * 比较当前内核版本是否小于输入的版本号。
 * @param version - 要比较的版本号字符串，例如 "3.1.23" 或 "3.2.1.1"
 * @returns boolean - 如果当前版本小于输入版本，则返回 true；否则（大于或等于）返回 false。
 */
export function isCurrentVersionLessThan(version: string) {
    const parsedInputVersion = parseVersion(version);
    const parsedCurrentVersion = parseVersion(window.siyuan.config!.system.kernelVersion);
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

export function trimListDocsByPathAPIReturnedDocName(docName: string) {
    if (isCurrentVersionLessThan("3.6.5") && docName.endsWith(".sy")) {
        return decodeHtmlEntities(docName.substring(0, docName.length - 3));
    } else {
        return docName;
    }
}

// 兼容性utils
export function isNotebookDocEnabled() {
    if (window.top!.siyuan.config?.fileTree.boxDocEnabled === undefined) {
        return false;
    }
    return window.top!.siyuan.config.fileTree.boxDocEnabled;
}

export function isNotebookDoc(path: string, notebookId: string) {
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
export function getListDocsByPathAPIFilePath(fullPath: string, notbookId: string) {
    if (fullPath == null) {
        return null;
    }
    if (isNotebookDocEnabled() && isNotebookDoc(fullPath, notbookId)) {
        return "/";
    }
    return fullPath;
}

export function styleEscape(str: string) {
    return str.replace(new RegExp("<[^<]*style[^>]*>", "g"), "");
}
export function escapeHTML(str: string) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
