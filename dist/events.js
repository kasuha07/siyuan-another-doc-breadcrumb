"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.initRetry = initRetry;
exports.mainEventBusHander = mainEventBusHander;
exports.handleDestroyProtyle = handleDestroyProtyle;
exports.eventBusHandler = eventBusHandler;
exports.main = main;
exports.refreshAllShowingProtyles = refreshAllShowingProtyles;
exports.setMouseKeyboardListener = setMouseKeyboardListener;
exports.hideDocBreadcrumb = hideDocBreadcrumb;
exports.showDocBreadcrumb = showDocBreadcrumb;
exports.removeMouseKeyboardListener = removeMouseKeyboardListener;
/**
 * 初始化、事件总线与鼠标键盘监听
 */
const siyuan = __importStar(require("siyuan"));
const constants_1 = require("./constants");
const logger_1 = require("./logger");
const state_1 = require("./state");
const utils_1 = require("./utils");
const style_1 = require("./style");
const controller_1 = require("./controller");
function initRetry() {
    let successFlag = false;
    try {
        (0, style_1.removeStyle)();
        removeMouseKeyboardListener();
        (0, style_1.setStyle)();
        setMouseKeyboardListener();
        successFlag = true;
        clearTimeout(state_1.state.g_initFailedMsgTimeout);
    }
    catch (e) {
        (0, logger_1.errorPush)("文档面包屑插件初始化失败", e);
    }
    if (successFlag) {
        clearInterval(state_1.state.g_initRetryInterval);
        (0, logger_1.logPush)("文档面包屑插件初始化成功");
        return true;
    }
    return false;
}
async function mainEventBusHander(detail) {
    // 相关判断方式参考： https://github.com/siyuan-note/siyuan/issues/9458#issuecomment-1773776115
    detail = detail.detail;
    const protyle = detail.protyle;
    // 部分情况下，进入文档会停留在默认的聚焦，这里先运行了看看情况
    if (protyle.model == null && !state_1.state.g_setting.notOnlyOpenDocs /* || protyle.block.showAll */) {
        (0, logger_1.infoPush)("插件内嵌Protyle、浮窗~~或聚焦~~。停止操作。", protyle);
        return;
    }
    (0, logger_1.debugPush)("正确Protyle", protyle);
    await main(protyle);
}
function handleDestroyProtyle(detail) {
    var _a;
    const protyle = (_a = detail === null || detail === void 0 ? void 0 : detail.detail) === null || _a === void 0 ? void 0 : _a.protyle;
    if (!protyle) {
        return;
    }
    controller_1.inlineControllerRegistry.destroy(protyle);
}
async function eventBusHandler(detail) {
    // console.log(detail);
    const cmdType = ["moveDoc", "rename", "removeDoc", "filetreeSortChanged"];
    if (cmdType.indexOf(detail.detail.cmd) != -1) {
        try {
            (0, logger_1.debugPush)("检查刷新中（由重命名、移动或删除触发）");
            const allEditor = siyuan.getAllEditor();
            const ids = (0, utils_1.getAllShowingDocId)();
            if (ids != null && ids.length > 0) {
                for (let editor of allEditor) {
                    if (ids.includes(editor.protyle.block.rootID)) {
                        (0, logger_1.debugPush)("由重命名、移动或删除触发");
                        await main(editor.protyle);
                    }
                }
            }
            state_1.state.g_adjacentDocCache = {};
        }
        catch (err) {
            (0, logger_1.errorPush)(err);
        }
    }
}
/**
 * 插件主流程入口
 * 每个 Protyle 由 registry 保证只存在一个 controller；
 * 异步竞态由 controller 内部的 revision token 处理。
 */
async function main(eventProtyle) {
    if (state_1.state.g_isMobile) {
        (0, logger_1.debugPush)("插件停止支持移动端");
        return;
    }
    const protyle = eventProtyle;
    if (!(protyle === null || protyle === void 0 ? void 0 : protyle.element)) {
        return;
    }
    const controller = controller_1.inlineControllerRegistry.ensure(protyle);
    if (!controller) {
        (0, logger_1.debugPush)("当前 Protyle 无法挂载文档面包屑");
        return;
    }
    await controller.refresh();
}
/**
 * 设置保存后，为所有正在显示的文档重新挂载并刷新
 */
function refreshAllShowingProtyles() {
    var _a, _b;
    var _c;
    try {
        const allEditor = (_c = (_a = siyuan.getAllEditor) === null || _a === void 0 ? void 0 : _a.call(siyuan)) !== null && _c !== void 0 ? _c : [];
        for (const editor of allEditor) {
            const protyle = editor === null || editor === void 0 ? void 0 : editor.protyle;
            if ((protyle === null || protyle === void 0 ? void 0 : protyle.element) && ((_b = protyle === null || protyle === void 0 ? void 0 : protyle.block) === null || _b === void 0 ? void 0 : _b.rootID)) {
                main(protyle);
            }
        }
    }
    catch (err) {
        (0, logger_1.warnPush)(err);
    }
}
function setMouseKeyboardListener() {
    if (state_1.state.g_setting.typeHide) {
        window.document.addEventListener("mousemove", showDocBreadcrumb);
        window.document.addEventListener("keydown", hideDocBreadcrumb, true);
    }
}
function hideDocBreadcrumb(event) {
    if (!state_1.state.g_hidedBreadcrumb) {
        if (event.ctrlKey || event.shiftKey || event.altKey)
            return;
        const fakeBreadcrumb = window.document.querySelectorAll(`.${constants_1.CONSTANTS.CONTAINER_CLASS_NAME}, .${constants_1.CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}`);
        [].forEach.call(fakeBreadcrumb, (e) => {
            e.classList.add("og-hide-breadcrumb");
        });
        state_1.state.g_hidedBreadcrumb = true;
    }
}
function showDocBreadcrumb() {
    if (state_1.state.g_hidedBreadcrumb) {
        const fakeBreadcrumb = window.document.querySelectorAll(`.${constants_1.CONSTANTS.CONTAINER_CLASS_NAME}, .${constants_1.CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}`);
        [].forEach.call(fakeBreadcrumb, (e) => {
            e.classList.remove("og-hide-breadcrumb");
        });
        state_1.state.g_hidedBreadcrumb = false;
    }
}
function removeMouseKeyboardListener() {
    window.document.removeEventListener("mousemove", showDocBreadcrumb);
    window.document.removeEventListener("keydown", hideDocBreadcrumb, true);
}
