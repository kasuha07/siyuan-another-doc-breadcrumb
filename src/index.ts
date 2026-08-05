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
import { Dialog, Plugin, showMessage } from "siyuan";
import { CONSTANTS, g_setting_default } from "./constants";
import { state } from "./state";
import { debugPush, errorPush, warnPush } from "./logger";
import { generateSettingPanel, loadUISettings, SettingProperty } from "./settings";
import { removeStyle, setStyle } from "./style";
import { destroyAllControllers } from "./controller";
import { eventBusHandler, handleDestroyProtyle, initRetry, mainEventBusHander, refreshAllShowingProtyles, removeMouseKeyboardListener, setMouseKeyboardListener } from "./events";
import { isMobile, isSomePluginExist } from "./utils";

/**
 * Plugin类
 */
export class FakeDocBreadcrumb extends Plugin {

    tabOpenObserver: any = null;

    onload() {
        state.g_isMobile = isMobile();
        state.language = this.i18n;
        state.g_pluginInstance = this;
        // 读取配置
        Object.assign(state.g_setting, g_setting_default);
        if (isSomePluginExist(this.app.plugins, CONSTANTS.MULTILINE_CONFLICT_PLUGINS)) {
            state.g_setting.oneLineBreadcrumb = true;
        }

        state.g_writeStorage = this.saveData;

        debugPush('FakeDocBradcrumbPluginInited');
    }

    onLayoutReady() {
        this.loadData("settings.json").then((settingCache) => {
            // 解析并载入配置
            try {
                debugPush("载入配置中", settingCache);
                let resetFlag = false;
                if (settingCache["@version"]) {
                    if (settingCache["@version"] < g_setting_default["@version"]) {
                        debugPush("配置版本过旧");
                        resetFlag = true;
                    }
                } else if (settingCache["@version"] === undefined) {
                    resetFlag = true;
                }
                if (resetFlag) {
                    settingCache["@version"] = g_setting_default["@version"];
                    if (settingCache["showAdjacentDocButton"] === true) {
                        settingCache["showAdjacentDocButton"] = CONSTANTS.ADJ_SAME_LEVEL;
                    } else if (settingCache["showAdjacentDocButton"] === false) {
                        settingCache["showAdjacentDocButton"] = CONSTANTS.ADJ_NONE;
                    }
                    this.saveData(`settings.json`, JSON.stringify(settingCache));
                }
                debugPush("载入配置", settingCache);
                Object.assign(state.g_setting, settingCache);
                this.eventBusInnerHandler();
            } catch (e) {
                warnPush("og-fdb载入配置时发生错误", e);
            }
            if (!initRetry()) {
                errorPush("初始化失败，2秒后执行一次重试");
                setTimeout(initRetry, 2000);
            }
        }, (e) => {
            warnPush("配置文件读入失败", e);
        });
    }

    onunload() {
        destroyAllControllers();
        // 清理所有模式下的插件节点与状态类，保证 DOM 完全恢复
        [].forEach.call(document.querySelectorAll(`.${CONSTANTS.CONTAINER_CLASS_NAME}, .${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}, .og-breadcrumb-oneline-divider`), (elem: HTMLElement) => {
            elem.remove();
        });
        [].forEach.call(document.querySelectorAll(`.${CONSTANTS.HOST_STATE_CLASS_NAME}`), (elem: HTMLElement) => {
            elem.classList.remove(CONSTANTS.HOST_STATE_CLASS_NAME);
        });
        (this as any).el && (this as any).el.remove();
        removeStyle();
        removeMouseKeyboardListener();
        this.offEventBusInnerHander();
    }

    openSetting() {// 创建dialog
        const settingDialog = new Dialog({
            "title": state.language["setting_panel_title"],
            "content": `
            <div class="b3-dialog__content" style="flex: 1;">
                <div id="${CONSTANTS.PLUGIN_NAME}-form-content" style="overflow: auto;"></div>
            </div>
            <div class="b3-dialog__action" id="${CONSTANTS.PLUGIN_NAME}-form-action" style="max-height: 40px">
                <button class="b3-button b3-button--cancel">${state.language["button_cancel"]}</button><div class="fn__space"></div>
                <button class="b3-button b3-button--text">${state.language["button_save"]}</button>
            </div>
            `,
            "width": isMobile() ? "92vw" : "1040px",
            "height": isMobile() ? "70vh" : "80vh",
        });
        debugPush("dialog", settingDialog);
        const actionButtons = settingDialog.element.querySelectorAll(`#${CONSTANTS.PLUGIN_NAME}-form-action button`);
        actionButtons[0].addEventListener("click", () => { settingDialog.destroy() }),
            actionButtons[1].addEventListener("click", () => {
                debugPush('SAVING');
                let uiSettings = loadUISettings(settingForm);
                if (isSomePluginExist(this.app.plugins, CONSTANTS.MULTILINE_CONFLICT_PLUGINS) && uiSettings.oneLineBreadcrumb == false) {
                    showMessage(`${state.language["conflict_plugin_oneline_breadcrumb"]}<br/> ——[${this.name}]`, 13000);
                }
                this.saveData(`settings.json`, JSON.stringify(uiSettings));
                Object.assign(state.g_setting, uiSettings);
                removeStyle();
                setStyle();
                removeMouseKeyboardListener();
                setMouseKeyboardListener();
                // 销毁全部 presentation，以新设置重新挂载
                destroyAllControllers();
                refreshAllShowingProtyles();
                debugPush("SAVED");
                settingDialog.destroy();
            });
        // 绑定dialog和移除操作

        // 生成配置页面
        const hello = document.createElement('div');
        const settingForm = document.createElement("form");
        settingForm.setAttribute("name", CONSTANTS.PLUGIN_NAME);
        settingForm.appendChild(generateSettingPanel([
            new SettingProperty("RESERVE_HINT", "HINT", null),
            new SettingProperty("docMaxNum", "NUMBER", [0, 1024]),
            new SettingProperty("nameMaxLength", "NUMBER", [0, 1024]),
            new SettingProperty("showNotebook", "SWITCH", null),
            new SettingProperty("showRoot", "SWITCH", null),
            new SettingProperty("typeHide", "SWITCH", null),
            new SettingProperty("oneLineBreadcrumb", "SWITCH", null),
            new SettingProperty("foldedFrontShow", "NUMBER", [0, 8]),
            new SettingProperty("foldedEndShow", "NUMBER", [0, 8]),
            new SettingProperty("allowFloatWindow", "SWITCH", null),
            new SettingProperty("usePluginArrow", "SWITCH", null),
            new SettingProperty("notOnlyOpenDocs", "SWITCH", null),
            new SettingProperty("preferOpenInCurrentSplit", "SWITCH", null),
            new SettingProperty("icon", "SELECT", [
                { value: 0 },
                { value: 1 },
                { value: 2 }]),
            new SettingProperty("immediatelyUpdate", "SWITCH", null),
            new SettingProperty("menuExtendSubDocDepth", "NUMBER", [1, 7]),
            new SettingProperty("swapClickFunction", "SWITCH", null),
            new SettingProperty("showAdjacentDocButton", "SELECT", [
                { value: CONSTANTS.ADJ_NONE },
                { value: CONSTANTS.ADJ_SAME_PARENT },
                { value: CONSTANTS.ADJ_SAME_LEVEL },
            ]),
            new SettingProperty("createDocBtnInMenu", "SWITCH", null),
        ]));

        hello.appendChild(settingForm);
        // 设置表单容器由下方 createElement 创建并挂入 element，查询结果必然存在
        settingDialog.element.querySelector(`#${CONSTANTS.PLUGIN_NAME}-form-content`)!.appendChild(hello);
    }

    /**
     * 在这里启用eventBus事件监听，但请务必在offEventBusInnerHandler中设置对应的关闭
     */
    eventBusInnerHandler() {
        this.eventBus.on("loaded-protyle-static", mainEventBusHander);
        this.eventBus.on("switch-protyle", mainEventBusHander);
        this.eventBus.on("destroy-protyle", handleDestroyProtyle);
        if (state.g_setting.immediatelyUpdate) {
            this.eventBus.on("ws-main", eventBusHandler);
        }
    }

    offEventBusInnerHander() {
        this.eventBus.off("ws-main", eventBusHandler);
        this.eventBus.off("loaded-protyle-static", mainEventBusHander);
        this.eventBus.off("switch-protyle", mainEventBusHander);
        this.eventBus.off("destroy-protyle", handleDestroyProtyle);
    }
}

export default FakeDocBreadcrumb;
