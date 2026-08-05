/**
 * 共享全局状态
 * 所有模块通过 `import { state }` 读写同一对象，
 * 赋值（如 state.language = this.i18n）在各模块间同步。
 */
import { zh_CN } from "./constants";

export interface StateShape {
    g_initRetryInterval: any;
    g_initFailedMsgTimeout: any;
    g_TIMER_LABLE_NAME_COMPARE: string;
    g_writeStorage: any;
    g_pluginInstance: any;
    g_relativeMenu: any;
    g_isMobile: boolean;
    g_setting: { [key: string]: any };
    language: { [key: string]: string };
    g_adjacentDocCache: { [key: string]: any };
}

export const state: StateShape = {
    g_initRetryInterval: undefined,
    g_initFailedMsgTimeout: undefined,
    g_TIMER_LABLE_NAME_COMPARE: "文档面包屑插件",
    g_writeStorage: undefined,
    g_pluginInstance: undefined,
    g_relativeMenu: undefined,
    g_isMobile: false,
    g_setting: {
        "nameMaxLength": null,
        "docMaxNum": null,
        "showNotebook": null,
        "foldedFrontShow": null,
        "foldedEndShow": null,
        "oneLineBreadcrumb": null,
        "usePluginArrow": null,
        "icon": null,
        "menuKeepCurrentVisible": null,
        "menuExtendSubDocDepth": null,
        "showRoot": null,
        "showAdjacentDocButton": null,
        "createDocBtnInMenu": null,
    },
    language: zh_CN,
    g_adjacentDocCache: {},
};
