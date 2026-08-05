"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.state = void 0;
/**
 * 共享全局状态
 * 所有模块通过 `import { state }` 读写同一对象，
 * 赋值（如 state.language = this.i18n）在各模块间同步。
 */
const constants_1 = require("./constants");
exports.state = {
    g_initRetryInterval: undefined,
    g_initFailedMsgTimeout: undefined,
    g_TIMER_LABLE_NAME_COMPARE: "文档面包屑插件",
    g_writeStorage: undefined,
    g_pluginInstance: undefined,
    g_relativeMenu: undefined,
    g_isMobile: false,
    g_hidedBreadcrumb: false,
    g_setting: {
        "nameMaxLength": null,
        "docMaxNum": null,
        "showNotebook": null,
        "typeHide": null,
        "foldedFrontShow": null,
        "foldedEndShow": null,
        "oneLineBreadcrumb": null,
        "timelyUpdate": null, // 及时响应更新
        "allowFloatWindow": null,
        "usePluginArrow": null,
        "preferOpenInCurrentSplit": null,
        "icon": null,
        "menuKeepCurrentVisible": null,
        "menuExtendSubDocDepth": null,
        "swapClickFunction": null,
        "showRoot": null,
        "showAdjacentDocButton": null,
        "createDocBtnInMenu": null,
    },
    language: constants_1.zh_CN,
    g_adjacentDocCache: {},
};
