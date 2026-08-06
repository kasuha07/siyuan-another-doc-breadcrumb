/**
 * 文档面包屑插件（siyuan-another-doc-breadcrumb）
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
import { debugPush, warnPush } from "./logger";
import { generateSettingPanel, loadUISettings, SettingProperty } from "./settings";
import { removeStyle, setStyle } from "./style";
import { destroyAllControllers } from "./controller";
import { removeAdjacentTooltip } from "./adjacent";
import { eventBusHandler, handleDestroyProtyle, mainEventBusHander, refreshAllShowingProtyles, resetEventState } from "./events";
import { isMobile, isSomePluginExist, sleep } from "./utils";

/**
 * 校验 loadData 原始载荷是否为有效配置对象：
 * - 官方 loadData 在文件缺失时 resolve 空字符串 ""，异常时可能 resolve
 *   错误信封 {code,msg,data}，均不能当作配置；
 * - 仅接受“含已知设置键的纯对象”（@version 或任一设置项）；字符串先
 *   JSON.parse（失败视为无配置）；其余一律返回 null（使用默认配置，不写盘）。
 */
function normalizeSettingCache(raw: any): { [key: string]: any } | null {
    if (typeof raw === "string") {
        try {
            raw = JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const hasKnownKey = Object.keys(g_setting_default).some((key) => key in raw);
    return hasKnownKey ? raw : null;
}

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
        this.initialize();
    }

    /**
     * 布局就绪后的初始化：加载配置 → 应用配置 → 注册事件 → 注入样式。
     *
     * 失败点与重试：官方 loadData 在 HTTP 4xx / Abort / 网络异常时可能永不回调
     * （Promise 悬空），loadSettingCache 已用超时兜底 resolve null；配置加载失败
     * （超时/无效）时按固定间隔重试整个加载流程（最多 INIT_RETRY_MAX 次），
     * 而不是只重试一次。全部失败则回退默认配置继续运行；
     * 事件注册与样式注入无论配置是否加载成功都只执行一次（重复注册会导致
     * 事件总线收到双份消息）。
     */
    async initialize() {
        let settingCache: { [key: string]: any } | null = null;
        for (let attempt = 1; attempt <= CONSTANTS.INIT_RETRY_MAX; attempt++) {
            settingCache = await this.loadSettingCache();
            if (settingCache != null) {
                break;
            }
            if (attempt < CONSTANTS.INIT_RETRY_MAX) {
                warnPush(`配置加载失败（第 ${attempt}/${CONSTANTS.INIT_RETRY_MAX} 次），${CONSTANTS.INIT_RETRY_INTERVAL / 1000} 秒后重试`);
                await sleep(CONSTANTS.INIT_RETRY_INTERVAL);
            }
        }
        if (settingCache != null) {
            // 解析并载入配置（settingCache 已通过 normalizeSettingCache 校验为纯对象）
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
                this.saveData(`settings.json`, JSON.stringify(settingCache)).catch((e) => {
                    warnPush("配置迁移写盘失败", e);
                });
            }
            debugPush("载入配置", settingCache);
            Object.assign(state.g_setting, settingCache);
        } else {
            warnPush("无有效配置文件，本次使用默认配置");
        }
        // 事件注册不依赖配置加载成败：配置缺失或异常时以默认值继续运行，绝不静默死亡
        this.eventBusInnerHandler();
        removeStyle();
        setStyle();
    }

    /**
     * 带超时读取配置：官方 loadData 依赖 fetchPost 回调，异常时 Promise 可能永不
     * settle，这里加超时竞速保证必 settle；载荷经 normalizeSettingCache 校验，
     * 非有效配置一律按“无配置”处理（返回 null，由调用方使用默认配置）。
     */
    loadSettingCache(): Promise<{ [key: string]: any } | null> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                warnPush(`读取配置文件超时（${CONSTANTS.SETTING_LOAD_TIMEOUT}ms），本次使用默认配置`);
                resolve(null);
            }, CONSTANTS.SETTING_LOAD_TIMEOUT);
            this.loadData("settings.json").then((raw) => {
                clearTimeout(timer);
                resolve(normalizeSettingCache(raw));
            }, () => {
                clearTimeout(timer);
                warnPush("配置文件读入失败，本次使用默认配置");
                resolve(null);
            });
        });
    }

    onunload() {
        // 先清空插件实例引用：合并刷新定时器等延迟任务在卸载后触发时
        // 会经 main() 的存活检查直接返回，避免重新挂载已卸载的 controller
        state.g_pluginInstance = undefined;
        resetEventState();
        destroyAllControllers();
        removeAdjacentTooltip();
        // 清理所有模式下的插件节点与状态类，保证 DOM 完全恢复
        [].forEach.call(document.querySelectorAll(`.${CONSTANTS.CONTAINER_CLASS_NAME}, .${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}, .og-breadcrumb-oneline-divider, .og-fdb-doc-nav`), (elem: HTMLElement) => {
            elem.remove();
        });
        [].forEach.call(document.querySelectorAll(`.${CONSTANTS.HOST_STATE_CLASS_NAME}`), (elem: HTMLElement) => {
            elem.classList.remove(CONSTANTS.HOST_STATE_CLASS_NAME);
        });
        (this as any).el && (this as any).el.remove();
        removeStyle();
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
            new SettingProperty("docMaxNum", "NUMBER", [0, 1024]),
            new SettingProperty("nameMaxLength", "NUMBER", [0, 1024]),
            new SettingProperty("showNotebook", "SWITCH", null),
            new SettingProperty("showRoot", "SWITCH", null),
            new SettingProperty("oneLineBreadcrumb", "SWITCH", null),
            new SettingProperty("foldedFrontShow", "NUMBER", [0, 8]),
            new SettingProperty("foldedEndShow", "NUMBER", [0, 8]),
            new SettingProperty("usePluginArrow", "SWITCH", null),
            new SettingProperty("icon", "SELECT", [
                { value: 0 },
                { value: 1 },
                { value: 2 }]),
            new SettingProperty("menuExtendSubDocDepth", "NUMBER", [1, 7]),
            new SettingProperty("showAdjacentDocButton", "SELECT", [
                { value: CONSTANTS.ADJ_NONE },
                { value: CONSTANTS.ADJ_SAME_PARENT },
                { value: CONSTANTS.ADJ_SAME_LEVEL },
            ]),
            new SettingProperty("adjacentNavStyle", "SELECT", [
                { value: CONSTANTS.ADJ_SHOW_TEXT },
                { value: CONSTANTS.ADJ_ARROW_ONLY },
            ]),
            new SettingProperty("replaceAdjacentDocTab", "SWITCH", null),
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
        // ws-main 始终监听：思源在文档重命名/移动后不会重渲染面包屑（见 protyle/index.ts
        // 中 rename/moveDoc 分支），且不会触发 loaded-protyle-static，插件必须自行刷新；
        // eventBusHandler 内部已按 cmd 过滤，非目标消息直接返回，无性能开销。
        this.eventBus.on("loaded-protyle-static", mainEventBusHander);
        this.eventBus.on("switch-protyle", mainEventBusHander);
        this.eventBus.on("destroy-protyle", handleDestroyProtyle);
        this.eventBus.on("ws-main", eventBusHandler);
    }

    offEventBusInnerHander() {
        this.eventBus.off("ws-main", eventBusHandler);
        this.eventBus.off("loaded-protyle-static", mainEventBusHander);
        this.eventBus.off("switch-protyle", mainEventBusHander);
        this.eventBus.off("destroy-protyle", handleDestroyProtyle);
    }
}

export default FakeDocBreadcrumb;
