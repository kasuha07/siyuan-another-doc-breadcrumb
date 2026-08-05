"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeDocBreadcrumb = void 0;
/**
 * 文档面包屑插件（fakeDocBreadcrumb）
 *
 * v2.0.0 重构（仅支持思源 v3.7.0+）：
 * - 同行模式：插件内容容器 `.og-fdb-inline-breadcrumb` 作为原生
 *   `.protyle-breadcrumb__bar` 的第一个 flex 子项插入（原生内容之前），
 *   原生 bar、space、右侧按钮的 DOM 与直接父子关系保持不变。
 * - 布局：原生 bar 作为唯一横向滚动容器，插件内容容器作为 bar 的第一个
 *   flex 子项插入（原生内容之前），形成一条连续内容带整体滚动；
 *   宽度分配交给 Flexbox（`flex-basis: max-content`），不计算像素宽度。
 * - 连续内容带：思源每次异步渲染块面包屑都会重写 bar 的 innerHTML，
 *   插件用 MutationObserver（仅用于内容恢复，不用于布局）把插件内容
 *   重新插入 bar 头部，并同步调整滚动位置；事件代理绑定在 bar 元素上，
 *   不受 innerHTML 重写影响。
 * - 渲染：纯 ViewModel + DOM API（createElement / textContent /
 *   DocumentFragment），不再拼接 HTML 字符串。
 * - 事件：click / auxclick / contextmenu 事件代理绑定在原生 bar（同行）
 *   或插件根节点（两行）上，通过 `data-og-fdb-action-key` → 内存 Map 分发；
 *   插件内容上的点击才 stopPropagation，不拦截原生 item 的 zoomOut。
 * - 异步：controller 自带 revision token，拒绝过期请求结果。
 * - 生命周期：监听 loaded-protyle-static / switch-protyle / destroy-protyle。
 */
const siyuan_1 = require("siyuan");
const constants_1 = require("./constants");
const state_1 = require("./state");
const logger_1 = require("./logger");
const settings_1 = require("./settings");
const style_1 = require("./style");
const controller_1 = require("./controller");
const events_1 = require("./events");
const utils_1 = require("./utils");
/**
 * Plugin类
 */
class FakeDocBreadcrumb extends siyuan_1.Plugin {
    constructor() {
        super(...arguments);
        this.tabOpenObserver = null;
    }
    onload() {
        state_1.state.g_isMobile = (0, utils_1.isMobile)();
        state_1.state.language = this.i18n;
        state_1.state.g_pluginInstance = this;
        // 读取配置
        Object.assign(state_1.state.g_setting, constants_1.g_setting_default);
        if ((0, utils_1.isSomePluginExist)(this.app.plugins, constants_1.CONSTANTS.MULTILINE_CONFLICT_PLUGINS)) {
            state_1.state.g_setting.oneLineBreadcrumb = true;
        }
        state_1.state.g_writeStorage = this.saveData;
        (0, logger_1.debugPush)('FakeDocBradcrumbPluginInited');
    }
    onLayoutReady() {
        this.loadData("settings.json").then((settingCache) => {
            // 解析并载入配置
            try {
                (0, logger_1.debugPush)("载入配置中", settingCache);
                let resetFlag = false;
                if (settingCache["@version"]) {
                    if (settingCache["@version"] < constants_1.g_setting_default["@version"]) {
                        (0, logger_1.debugPush)("配置版本过旧");
                        resetFlag = true;
                    }
                }
                else if (settingCache["@version"] === undefined) {
                    resetFlag = true;
                }
                if (resetFlag) {
                    settingCache["@version"] = constants_1.g_setting_default["@version"];
                    if (settingCache["showAdjacentDocButton"] === true) {
                        settingCache["showAdjacentDocButton"] = constants_1.CONSTANTS.ADJ_SAME_LEVEL;
                    }
                    else if (settingCache["showAdjacentDocButton"] === false) {
                        settingCache["showAdjacentDocButton"] = constants_1.CONSTANTS.ADJ_NONE;
                    }
                    this.saveData(`settings.json`, JSON.stringify(settingCache));
                }
                (0, logger_1.debugPush)("载入配置", settingCache);
                Object.assign(state_1.state.g_setting, settingCache);
                this.eventBusInnerHandler();
            }
            catch (e) {
                (0, logger_1.warnPush)("og-fdb载入配置时发生错误", e);
            }
            if (!(0, events_1.initRetry)()) {
                (0, logger_1.errorPush)("初始化失败，2秒后执行一次重试");
                setTimeout(events_1.initRetry, 2000);
            }
        }, (e) => {
            (0, logger_1.warnPush)("配置文件读入失败", e);
        });
    }
    onunload() {
        (0, controller_1.destroyAllControllers)();
        // 清理所有模式下的插件节点与状态类，保证 DOM 完全恢复
        [].forEach.call(document.querySelectorAll(`.${constants_1.CONSTANTS.CONTAINER_CLASS_NAME}, .${constants_1.CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}, .og-breadcrumb-oneline-divider`), (elem) => {
            elem.remove();
        });
        [].forEach.call(document.querySelectorAll(`.${constants_1.CONSTANTS.HOST_STATE_CLASS_NAME}`), (elem) => {
            elem.classList.remove(constants_1.CONSTANTS.HOST_STATE_CLASS_NAME);
        });
        this.el && this.el.remove();
        (0, style_1.removeStyle)();
        (0, events_1.removeMouseKeyboardListener)();
        this.offEventBusInnerHander();
    }
    openSetting() {
        const settingDialog = new siyuan_1.Dialog({
            "title": state_1.state.language["setting_panel_title"],
            "content": `
            <div class="b3-dialog__content" style="flex: 1;">
                <div id="${constants_1.CONSTANTS.PLUGIN_NAME}-form-content" style="overflow: auto;"></div>
            </div>
            <div class="b3-dialog__action" id="${constants_1.CONSTANTS.PLUGIN_NAME}-form-action" style="max-height: 40px">
                <button class="b3-button b3-button--cancel">${state_1.state.language["button_cancel"]}</button><div class="fn__space"></div>
                <button class="b3-button b3-button--text">${state_1.state.language["button_save"]}</button>
            </div>
            `,
            "width": (0, utils_1.isMobile)() ? "92vw" : "1040px",
            "height": (0, utils_1.isMobile)() ? "70vh" : "80vh",
        });
        (0, logger_1.debugPush)("dialog", settingDialog);
        const actionButtons = settingDialog.element.querySelectorAll(`#${constants_1.CONSTANTS.PLUGIN_NAME}-form-action button`);
        actionButtons[0].addEventListener("click", () => { settingDialog.destroy(); }),
            actionButtons[1].addEventListener("click", () => {
                (0, logger_1.debugPush)('SAVING');
                let uiSettings = (0, settings_1.loadUISettings)(settingForm);
                if ((0, utils_1.isSomePluginExist)(this.app.plugins, constants_1.CONSTANTS.MULTILINE_CONFLICT_PLUGINS) && uiSettings.oneLineBreadcrumb == false) {
                    (0, siyuan_1.showMessage)(`${state_1.state.language["conflict_plugin_oneline_breadcrumb"]}<br/> ——[${this.name}]`, 13000);
                }
                this.saveData(`settings.json`, JSON.stringify(uiSettings));
                Object.assign(state_1.state.g_setting, uiSettings);
                (0, style_1.removeStyle)();
                (0, style_1.setStyle)();
                (0, events_1.removeMouseKeyboardListener)();
                (0, events_1.setMouseKeyboardListener)();
                // 销毁全部 presentation，以新设置重新挂载
                (0, controller_1.destroyAllControllers)();
                (0, events_1.refreshAllShowingProtyles)();
                (0, logger_1.debugPush)("SAVED");
                settingDialog.destroy();
            });
        // 绑定dialog和移除操作
        // 生成配置页面
        const hello = document.createElement('div');
        const settingForm = document.createElement("form");
        settingForm.setAttribute("name", constants_1.CONSTANTS.PLUGIN_NAME);
        settingForm.appendChild((0, settings_1.generateSettingPanel)([
            new settings_1.SettingProperty("RESERVE_HINT", "HINT", null),
            new settings_1.SettingProperty("docMaxNum", "NUMBER", [0, 1024]),
            new settings_1.SettingProperty("nameMaxLength", "NUMBER", [0, 1024]),
            new settings_1.SettingProperty("showNotebook", "SWITCH", null),
            new settings_1.SettingProperty("showRoot", "SWITCH", null),
            new settings_1.SettingProperty("typeHide", "SWITCH", null),
            new settings_1.SettingProperty("oneLineBreadcrumb", "SWITCH", null),
            new settings_1.SettingProperty("foldedFrontShow", "NUMBER", [0, 8]),
            new settings_1.SettingProperty("foldedEndShow", "NUMBER", [0, 8]),
            new settings_1.SettingProperty("allowFloatWindow", "SWITCH", null),
            new settings_1.SettingProperty("usePluginArrow", "SWITCH", null),
            new settings_1.SettingProperty("notOnlyOpenDocs", "SWITCH", null),
            new settings_1.SettingProperty("preferOpenInCurrentSplit", "SWITCH", null),
            new settings_1.SettingProperty("icon", "SELECT", [
                { value: 0 },
                { value: 1 },
                { value: 2 }
            ]),
            new settings_1.SettingProperty("immediatelyUpdate", "SWITCH", null),
            new settings_1.SettingProperty("menuExtendSubDocDepth", "NUMBER", [1, 7]),
            new settings_1.SettingProperty("swapClickFunction", "SWITCH", null),
            new settings_1.SettingProperty("showAdjacentDocButton", "SELECT", [
                { value: constants_1.CONSTANTS.ADJ_NONE },
                { value: constants_1.CONSTANTS.ADJ_SAME_PARENT },
                { value: constants_1.CONSTANTS.ADJ_SAME_LEVEL },
            ]),
            new settings_1.SettingProperty("createDocBtnInMenu", "SWITCH", null),
        ]));
        hello.appendChild(settingForm);
        settingDialog.element.querySelector(`#${constants_1.CONSTANTS.PLUGIN_NAME}-form-content`).appendChild(hello);
    }
    /**
     * 在这里启用eventBus事件监听，但请务必在offEventBusInnerHandler中设置对应的关闭
     */
    eventBusInnerHandler() {
        this.eventBus.on("loaded-protyle-static", events_1.mainEventBusHander);
        this.eventBus.on("switch-protyle", events_1.mainEventBusHander);
        this.eventBus.on("destroy-protyle", events_1.handleDestroyProtyle);
        if (state_1.state.g_setting.immediatelyUpdate) {
            this.eventBus.on("ws-main", events_1.eventBusHandler);
        }
    }
    offEventBusInnerHander() {
        this.eventBus.off("ws-main", events_1.eventBusHandler);
        this.eventBus.off("loaded-protyle-static", events_1.mainEventBusHander);
        this.eventBus.off("switch-protyle", events_1.mainEventBusHander);
        this.eventBus.off("destroy-protyle", events_1.handleDestroyProtyle);
    }
}
exports.FakeDocBreadcrumb = FakeDocBreadcrumb;
module.exports = {
    default: FakeDocBreadcrumb,
};
