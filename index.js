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
const siyuan = require('siyuan');

/**
 * 全局变量
 */
const CONSTANTS = {
    RANDOM_DELAY: 300, // 插入挂件的延迟最大值，300（之后会乘以10）对应最大延迟3秒
    OBSERVER_RANDOM_DELAY: 500, // 插入链接、引用块和自定义时，在OBSERVER_RANDOM_DELAY_ADD的基础上增加延时，单位毫秒
    OBSERVER_RANDOM_DELAY_ADD: 100, // 插入链接、引用块和自定义时，延时最小值，单位毫秒
    OBSERVER_RETRY_INTERVAL: 1000, // 找不到页签时，重试间隔
    STYLE_ID: "fake-doc-breadcrumb-plugin-style",
    ICON_ALL: 2,
    ICON_NONE: 0,
    ICON_CUSTOM_ONLY: 1,
    PLUGIN_NAME: "og_fake_doc_breadcrumb",
    SAVE_TIMEOUT: 900,
    CONTAINER_CLASS_NAME: "og-fake-doc-breadcrumb-container",
    INLINE_BREADCRUMB_CLASS_NAME: "og-fdb-inline-breadcrumb",
    HOST_STATE_CLASS_NAME: "og-fdb-inline-host",
    MENU_ITEM_CLASS_NAME: "og-fake-doc-breadcrumb-menu-item-container",
    SIBLING_CONTAINER_ID: "og-fake-doc-breadcrumb-sibling-doc-container",
    INDICATOR_CLASS_NAME: "og-fake-doc-breadcrumb-doc-indicator",
    MENU_CURRENT_DOC_CLASS_NAME: "og-fdb-current-doc-in-menu",
    POP_NONE: 0,
    POP_LIMIT: 1,
    POP_ALL: 2,
    MAX_NAME_LENGTH: 15,
    MULTILINE_CONFLICT_PLUGINS: ["siyuan-plugin-toolbar-plus"],
    ADJ_NONE: "0",
    ADJ_SAME_PARENT: "1",
    ADJ_SAME_LEVEL: "2",
}
let g_initRetryInterval;
let g_initFailedMsgTimeout;
let g_TIMER_LABLE_NAME_COMPARE = "文档面包屑插件";
let g_writeStorage;
let g_pluginInstance;
let g_relativeMenu;
let g_isMobile = false;
let g_hidedBreadcrumb = false;
let g_setting = {
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
};
let g_setting_default = {
    "@version": 20260729,
    "nameMaxLength": 15,
    "docMaxNum": 128,
    "showNotebook": true,
    "typeHide": false,
    "foldedFrontShow": 2,
    "foldedEndShow": 3,
    "oneLineBreadcrumb": false,
    "timelyUpdate": true, // 及时响应更新
    "immediatelyUpdate": false, // 实时响应更新
    "allowFloatWindow": false, // 触发浮窗
    "usePluginArrow": true, // 使用挂件>箭头
    "notOnlyOpenDocs": false, // 除了打开的文档之外，不再判断load-protyle调用来源，一律执行面包屑插入，可能带来不期待的后果
    "preferOpenInCurrentSplit": true,
    "icon": 1,
    "menuKeepCurrentVisible": true,
    "menuExtendSubDocDepth": 2,
    "swapClickFunction": false,
    "showRoot": false,
    "showAdjacentDocButton": CONSTANTS.ADJ_SAME_LEVEL,
    "autoFixFocusError": false,
    "createDocBtnInMenu": false,
};
/**
 * Plugin类
 */
class FakeDocBreadcrumb extends siyuan.Plugin {

    tabOpenObserver = null;

    onload() {
        g_isMobile = isMobile();
        language = this.i18n;
        g_pluginInstance = this;
        // 读取配置
        Object.assign(g_setting, g_setting_default);
        if (isSomePluginExist(this.app.plugins, CONSTANTS.MULTILINE_CONFLICT_PLUGINS)) {
            g_setting.oneLineBreadcrumb = true;
        }

        g_writeStorage = this.saveData;

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
                Object.assign(g_setting, settingCache);
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
        [].forEach.call(document.querySelectorAll(`.${CONSTANTS.CONTAINER_CLASS_NAME}, .${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}, .og-breadcrumb-oneline-divider`), (elem) => {
            elem.remove();
        });
        [].forEach.call(document.querySelectorAll(`.${CONSTANTS.HOST_STATE_CLASS_NAME}`), (elem) => {
            elem.classList.remove(CONSTANTS.HOST_STATE_CLASS_NAME);
        });
        this.el && this.el.remove();
        removeStyle();
        removeMouseKeyboardListener();
        this.offEventBusInnerHander();
    }

    openSetting() {// 创建dialog
        const settingDialog = new siyuan.Dialog({
            "title": language["setting_panel_title"],
            "content": `
            <div class="b3-dialog__content" style="flex: 1;">
                <div id="${CONSTANTS.PLUGIN_NAME}-form-content" style="overflow: auto;"></div>
            </div>
            <div class="b3-dialog__action" id="${CONSTANTS.PLUGIN_NAME}-form-action" style="max-height: 40px">
                <button class="b3-button b3-button--cancel">${language["button_cancel"]}</button><div class="fn__space"></div>
                <button class="b3-button b3-button--text">${language["button_save"]}</button>
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
                    siyuan.showMessage(`${language["conflict_plugin_oneline_breadcrumb"]}<br/> ——[${this.name}]`, 13000);
                }
                this.saveData(`settings.json`, JSON.stringify(uiSettings));
                Object.assign(g_setting, uiSettings);
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
        settingDialog.element.querySelector(`#${CONSTANTS.PLUGIN_NAME}-form-content`).appendChild(hello);
    }

    /**
     * 在这里启用eventBus事件监听，但请务必在offEventBusInnerHandler中设置对应的关闭
     */
    eventBusInnerHandler() {
        this.eventBus.on("loaded-protyle-static", mainEventBusHander);
        this.eventBus.on("switch-protyle", mainEventBusHander);
        this.eventBus.on("destroy-protyle", handleDestroyProtyle);
        if (g_setting.immediatelyUpdate) {
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



// debug push
let g_DEBUG = 2;
const g_NAME = "fdb";
const g_FULLNAME = "文档面包屑";

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

function isDebugMode() {
    return commonPushCheck() > g_DEBUG;
}

function debugPush(str, ...args) {
    if (commonPushCheck() >= 5) {
        console.debug(`${g_FULLNAME}[D] ${new Date().toLocaleString()} ${str}`, ...args);
    }
}

function infoPush(str, ...args) {
    if (commonPushCheck() >= 3) {
        console.info(`${g_FULLNAME}[I] ${new Date().toLocaleString()} ${str}`, ...args);
    }
}

function logPush(str, ...args) {
    if (commonPushCheck() >= 4) {
        console.log(`${g_FULLNAME}[L] ${new Date().toLocaleString()} ${str}`, ...args);
    }
}

function errorPush(str, ...args) {
    if (commonPushCheck() >= 1) {
        console.error(`${g_FULLNAME}[E] ${new Date().toLocaleString()} ${str}`, ...args);
        console.trace(args[0] ?? undefined);
    }
}

function warnPush(str, ...args) {
    if (commonPushCheck() >= 2) {
        console.warn(`${g_FULLNAME}[W] ${new Date().toLocaleString()} ${str}`, ...args);
    }
}

class SettingProperty {
    id;
    simpId;
    name;
    desp;
    type;
    limit;
    value;
    onClick;
    /**
     * 设置属性对象
     * @param {*} id 唯一定位id
     * @param {*} type 设置项类型
     * @param {*} limit 限制
     */
    constructor(id, type, limit, value = undefined) {
        this.id = `${CONSTANTS.PLUGIN_NAME}_${id}`;
        this.simpId = id;
        this.name = language[`setting_${id}_name`] ?? id;
        this.desp = language[`setting_${id}_desp`] ?? id + "_desp";
        this.type = type;
        this.limit = limit;
        if (value) {
            this.value = value;
        } else {
            this.value = g_setting[this.simpId];
        }
        if (typeof this.value === 'function') {
            this.onClick = this.value;
        }
    }
}

function initRetry() {
    let successFlag = false;
    try {
        removeStyle();
        removeMouseKeyboardListener();
        setStyle();
        setMouseKeyboardListener();
        successFlag = true;
        clearTimeout(g_initFailedMsgTimeout);
    } catch (e) {
        errorPush("文档面包屑插件初始化失败", e);
    }
    if (successFlag) {
        clearInterval(g_initRetryInterval);
        logPush("文档面包屑插件初始化成功");
        return true;
    }
    return false;
}

async function mainEventBusHander(detail) {
    // 相关判断方式参考： https://github.com/siyuan-note/siyuan/issues/9458#issuecomment-1773776115
    detail = detail.detail;
    const protyle = detail.protyle;
    // 部分情况下，进入文档会停留在默认的聚焦，这里先运行了看看情况
    if (protyle.model == null && !g_setting.notOnlyOpenDocs /* || protyle.block.showAll */) {
        infoPush("插件内嵌Protyle、浮窗~~或聚焦~~。停止操作。", protyle);
        return;
    }
    debugPush("正确Protyle", protyle);
    await main(protyle);
}

function handleDestroyProtyle(detail) {
    const protyle = detail?.detail?.protyle;
    if (!protyle) {
        return;
    }
    inlineControllerRegistry.destroy(protyle);
}

async function eventBusHandler(detail) {
    // console.log(detail);
    const cmdType = ["moveDoc", "rename", "removeDoc", "filetreeSortChanged"];
    if (cmdType.indexOf(detail.detail.cmd) != -1) {
        try {
            debugPush("检查刷新中（由重命名、移动或删除触发）");

            const allEditor = siyuan.getAllEditor();
            const ids = getAllShowingDocId();
            if (ids != null && ids.length > 0) {
                for (let editor of allEditor) {
                    if (ids.includes(editor.protyle.block.rootID)) {
                        debugPush("由重命名、移动或删除触发");
                        await main(editor.protyle);
                    }
                }
            }
            g_adjacentDocCache = {};
        } catch (err) {
            errorPush(err);
        }
    }
}

/**
 * 插件主流程入口
 * 每个 Protyle 由 registry 保证只存在一个 controller；
 * 异步竞态由 controller 内部的 revision token 处理。
 */
async function main(eventProtyle) {
    if (g_isMobile) {
        debugPush("插件停止支持移动端");
        return;
    }
    const protyle = eventProtyle;
    if (!protyle?.element) {
        return;
    }
    const controller = inlineControllerRegistry.ensure(protyle);
    if (!controller) {
        debugPush("当前 Protyle 无法挂载文档面包屑");
        return;
    }
    await controller.refresh();
}

/**
 * 设置保存后，为所有正在显示的文档重新挂载并刷新
 */
function refreshAllShowingProtyles() {
    try {
        const allEditor = siyuan.getAllEditor?.() ?? [];
        for (const editor of allEditor) {
            const protyle = editor?.protyle;
            if (protyle?.element && protyle?.block?.rootID) {
                main(protyle);
            }
        }
    } catch (err) {
        warnPush(err);
    }
}

/**
 * 精确获取思源原生面包屑相关节点
 * 不使用模糊的 querySelector(".protyle-breadcrumb__bar") 猜测。
 */
function getNativeBreadcrumbParts(protyle) {
    const nativeBar = protyle?.breadcrumb?.element;

    if (!(nativeBar instanceof HTMLElement)) {
        return null;
    }

    if (!nativeBar.classList.contains("protyle-breadcrumb__bar")) {
        return null;
    }

    const host = nativeBar.parentElement;

    if (!(host instanceof HTMLElement) || !host.classList.contains("protyle-breadcrumb")) {
        return null;
    }

    // 确认原生 bar 仍是 host 的直接子节点
    if (nativeBar.parentElement !== host) {
        return null;
    }

    const space = host.querySelector(":scope > .protyle-breadcrumb__space");

    if (!(space instanceof HTMLElement)) {
        return null;
    }

    return {
        nativeBar,
        host,
        space
    };
}

function createInlineRoot() {
    const root = document.createElement("div");

    root.className = CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME;
    root.contentEditable = "false";
    root.setAttribute("role", "navigation");
    root.setAttribute("aria-label", language["documentBreadcrumb"] ?? "文档路径");

    return root;
}

/**
 * 滚动位置捕获与恢复
 */
function captureScrollState(element) {
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);

    return {
        scrollLeft: element.scrollLeft,
        wasAtEnd: maxScrollLeft - element.scrollLeft <= 8
    };
}

function restoreScrollState(element, state, forceEnd) {
    requestAnimationFrame(() => {
        if (!element.isConnected) {
            return;
        }
        const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);

        if (forceEnd || state.wasAtEnd) {
            element.scrollLeft = maxScrollLeft;
            return;
        }

        element.scrollLeft = Math.min(state.scrollLeft, maxScrollLeft);
    });
}

/**
 * 每个 Protyle 一个 InlineBreadcrumbController：
 * - 幂等 mount（同行 / 两行两种 presentation 由 mount adapter 决定）；
 * - 根节点事件代理（click / auxclick / contextmenu / wheel，AbortController 管理）；
 * - action registry（data-og-fdb-action-key → 内存 Map）；
 * - revision token 拒绝过期异步结果；
 * - 滚动位置保存与恢复；
 * - destroy 完整清理。
 */
class InlineBreadcrumbController {
    revision = 0;
    documentId = "";
    lastRenderedDocId = "";
    lastModel = null;
    contentObserver = null;
    root = null;
    wrapper = null;
    host = null;
    nativeBar = null;
    parts = null;

    constructor(protyle) {
        this.protyle = protyle;
        this.abortController = new AbortController();
        this.actions = new Map();
        this.actionSequence = 0;

        this.handleClick = this.handleClick.bind(this);
        this.handleAuxClick = this.handleAuxClick.bind(this);
        this.handleContextMenu = this.handleContextMenu.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
    }

    /**
     * 幂等挂载。返回是否挂载成功。
     */
    mount() {
        // 清理旧版残留与异常重复节点（必须全量删除）
        this.protyle.element.querySelectorAll(
            `:scope > .${CONSTANTS.CONTAINER_CLASS_NAME},` +
            ":scope > .og-breadcrumb-oneline-divider"
        ).forEach((element) => element.remove());

        const parts = getNativeBreadcrumbParts(this.protyle);
        if (!parts) {
            return false;
        }
        this.parts = parts;

        parts.host.querySelectorAll(
            `:scope > .${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME},` +
            `:scope > .${CONSTANTS.CONTAINER_CLASS_NAME},` +
            ":scope > .og-breadcrumb-oneline-divider"
        ).forEach((element) => element.remove());

        const isCardPage = this.protyle.element.classList.contains("card__block");
        if (g_setting.oneLineBreadcrumb && !isCardPage) {
            // 同行模式：插件内容容器是原生 bar 的第一个 flex 子项，
            // bar 成为唯一滚动容器，形成连续内容带；
            // 思源 render 重写 innerHTML 时由 MutationObserver 恢复。
            this.host = parts.host;
            this.nativeBar = parts.nativeBar;
            this.host.classList.add(CONSTANTS.HOST_STATE_CLASS_NAME);
            parts.nativeBar.querySelectorAll(`:scope > .${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}`)
                .forEach((element) => element.remove());
            this.root = createInlineRoot();
            parts.nativeBar.insertBefore(this.root, parts.nativeBar.firstElementChild);
            this.startContentRestore();
        } else {
            // 两行模式：插件容器是原生 host 前一个独立 .protyle-breadcrumb
            this.wrapper = document.createElement("div");
            this.wrapper.className = `${CONSTANTS.CONTAINER_CLASS_NAME} protyle-breadcrumb`;
            this.root = createInlineRoot();
            this.wrapper.appendChild(this.root);
            parts.host.before(this.wrapper);
        }

        this.bindEvents();
        return true;
    }

    bindEvents() {
        const signal = this.abortController.signal;

        // 同行模式：事件代理绑定在原生 bar 上（bar 元素不被 innerHTML 重写）；
        // 两行模式：绑定在插件根节点（滚动容器）上。
        const eventTarget = this.nativeBar ?? this.root;

        eventTarget.addEventListener("click", this.handleClick, { signal });
        eventTarget.addEventListener("auxclick", this.handleAuxClick, { signal });
        eventTarget.addEventListener("contextmenu", this.handleContextMenu, { signal });

        if (!this.nativeBar) {
            // 两行模式：插件根节点自身滚动，处理滚轮；
            // 同行模式：整体滚动由思源 mousewheel 处理，无需插件监听
            this.root.addEventListener("wheel", this.handleWheel, { signal, passive: false });
        }
    }

    /**
     * 思源每次异步渲染块面包屑都会执行 `this.element.innerHTML = html`，
     * 这会清除插件插入 bar 内的内容容器。
     * MutationObserver 只用于内容恢复，不参与布局计算。
     */
    startContentRestore() {
        this.contentObserver = new MutationObserver(() => {
            this.restoreInlineRoot();
        });
        this.contentObserver.observe(this.nativeBar, { childList: true });
    }

    /**
     * 把插件内容容器恢复到原生 bar 头部，并保持“当前块”的可视位置。
     * 恢复插入本身会再次触发 observer，contains 检查保证不重复插入。
     */
    restoreInlineRoot() {
        if (!this.nativeBar || !this.nativeBar.isConnected) {
            return;
        }
        if (this.nativeBar.contains(this.root)) {
            return;
        }

        const oldScrollWidth = this.nativeBar.scrollWidth;
        const oldScrollLeft = this.nativeBar.scrollLeft;

        this.actions.clear();
        this.root = createInlineRoot();
        if (this.lastModel) {
            this.root.appendChild(renderBreadcrumbFragment(this.lastModel.entries, this));
            if (this.lastModel.adjacent) {
                this.root.appendChild(createAdjacentDocNav(this.lastModel.adjacent, this));
            }
        }
        this.nativeBar.insertBefore(this.root, this.nativeBar.firstElementChild);

        // 内容带前段重新插入插件内容后，把滚动位置向后推相应宽度，
        // 保持用户当前看到的块位置不变
        const widthDelta = this.nativeBar.scrollWidth - oldScrollWidth;
        if (widthDelta > 0) {
            this.nativeBar.scrollLeft = oldScrollLeft + widthDelta;
        }
    }

    registerAction(payload) {
        const key = String(++this.actionSequence);
        this.actions.set(key, payload);
        return key;
    }

    getActionTarget(event) {
        if (!(event.target instanceof Element)) {
            return null;
        }

        const target = event.target.closest("[data-og-fdb-action-key]");

        if (!target || !this.root.contains(target)) {
            return null;
        }

        return target;
    }

    handleClick(event) {
        // 事件代理绑定在原生 bar 上（同行模式），bar 内包含原生块面包屑：
        // 只有命中插件 action 时才阻止冒泡，避免拦截原生 item 的 zoomOut。
        const target = this.getActionTarget(event);
        if (!target) {
            return;
        }

        event.stopPropagation();

        if (event.button !== 0) {
            return;
        }

        const action = this.actions.get(target.dataset.ogFdbActionKey);
        if (!action) {
            return;
        }

        event.preventDefault();

        if (action.type === "open-document" && g_setting.swapClickFunction) {
            // 交换左右键功能：左键显示下层文档菜单
            this.dispatchAction({ type: "open-relative-menu", entry: action.entry }, target, event);
            return;
        }

        this.dispatchAction(action, target, event);
    }

    handleAuxClick(event) {
        const target = this.getActionTarget(event);
        if (!target) {
            return;
        }

        event.stopPropagation();

        // 只处理右键
        if (event.button !== 2) {
            return;
        }

        const action = this.actions.get(target.dataset.ogFdbActionKey);
        if (!action || action.type !== "open-document") {
            return;
        }

        event.preventDefault();

        if (g_setting.swapClickFunction) {
            // 交换左右键功能：右键打开文档
            this.dispatchAction(action, target, event);
        } else {
            // 默认：右键显示下层文档菜单
            this.dispatchAction({ type: "open-relative-menu", entry: action.entry }, target, event);
        }
    }

    handleContextMenu(event) {
        const target = this.getActionTarget(event);
        if (!target) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
    }

    handleWheel(event) {
        // 仅两行模式使用：插件根节点是独立滚动容器；
        // 同行模式整体滚动由思源 mousewheel 处理，不绑定本监听。
        const scroller = this.root;

        if (!scroller || scroller.scrollWidth <= scroller.clientWidth) {
            return;
        }

        const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
            ? event.deltaX
            : event.deltaY;

        if (delta === 0) {
            return;
        }

        const before = scroller.scrollLeft;
        scroller.scrollLeft += delta;

        // 到达滚动边缘时不拦截，让外部滚动继续工作
        if (scroller.scrollLeft !== before) {
            event.preventDefault();
        }
    }

    dispatchAction(action, target, event) {
        switch (action.type) {
            case "open-document": {
                const entry = action.entry;
                if (entry.kind === "notebook" && !isNotebookDocEnabled()) {
                    return;
                }
                if (entry.kind === "root") {
                    return;
                }
                openRefLinkAgent(event, entry.id);
                break;
            }
            case "open-collapsed-menu": {
                openHideMenu({
                    anchorElement: target,
                    hiddenEntries: action.entry.hiddenEntries
                }, event);
                break;
            }
            case "open-relative-menu": {
                openRelativeMenu({
                    protyle: this.protyle,
                    anchorElement: target,
                    parentId: action.entry.id,
                    nextId: action.entry.nextId,
                    path: action.entry.path,
                    box: action.entry.box,
                    kind: action.entry.kind
                }, event);
                break;
            }
            case "open-adjacent": {
                clickAdjacentDocButton(event, action.docId);
                break;
            }
        }
    }

    /**
     * 开始一次异步刷新，返回 ticket；commit 前必须用 canCommit 校验。
     */
    beginUpdate(documentId) {
        this.documentId = documentId;
        this.revision += 1;

        return {
            revision: this.revision,
            documentId
        };
    }

    canCommit(ticket) {
        return !!this.root &&
            this.root.isConnected &&
            ticket.revision === this.revision &&
            ticket.documentId === this.documentId &&
            ticket.documentId === this.protyle.block.rootID;
    }

    async refresh() {
        const documentId = this.protyle.block.rootID;
        if (!isValidStr(documentId)) {
            return;
        }

        const ticket = this.beginUpdate(documentId);

        try {
            const model = await buildDocumentBreadcrumbModel(this.protyle, documentId);

            if (!model || !this.canCommit(ticket)) {
                return;
            }

            this.render(model);
        } catch (err) {
            warnPush(err);
            errorPush(err);
        } finally {
            // 原生块面包屑箭头的大纲菜单绑定（原生 render 后 dataset 丢失，需重复绑定）
            try {
                addBlockBdMenuListener(this.protyle);
            } catch (err) {
                warnPush(err);
            }
        }
    }

    render(model) {
        this.lastModel = model;

        // 同行模式：整体滚动容器是原生 bar；两行模式：插件根节点
        const scroller = this.nativeBar ?? this.root;
        const scrollState = captureScrollState(scroller);
        const forceEnd = this.lastRenderedDocId !== model.documentId;
        this.lastRenderedDocId = model.documentId;

        // 同行模式：原生 render 可能已清掉插件容器，确保 root 在位
        if (this.nativeBar && !this.nativeBar.contains(this.root)) {
            this.root = createInlineRoot();
            this.nativeBar.insertBefore(this.root, this.nativeBar.firstElementChild);
        }

        this.root.textContent = "";
        this.actions.clear();

        this.root.appendChild(renderBreadcrumbFragment(model.entries, this));

        if (model.adjacent) {
            this.root.appendChild(createAdjacentDocNav(model.adjacent, this));
        }

        // 首次渲染或文档切换：滚到最右端；同文档刷新：保留原位置
        restoreScrollState(scroller, scrollState, forceEnd);
    }

    destroy() {
        this.revision += 1;
        this.contentObserver?.disconnect();
        this.abortController.abort();
        this.actions.clear();

        this.root?.remove();
        this.wrapper?.remove();

        if (this.host?.isConnected) {
            this.host.classList.remove(CONSTANTS.HOST_STATE_CLASS_NAME);
        }

        this.root = null;
        this.wrapper = null;
        this.host = null;
        this.nativeBar = null;
        this.parts = null;
    }
}

/**
 * controller registry：WeakMap 用于查找，Set 用于遍历清理
 */
let controllerByProtyle = new WeakMap();
const activeControllers = new Set();

const inlineControllerRegistry = {
    ensure(protyle) {
        const existed = controllerByProtyle.get(protyle);
        if (existed && (existed.root?.isConnected || existed.wrapper?.isConnected)) {
            return existed;
        }
        if (existed) {
            controllerByProtyle.delete(protyle);
            activeControllers.delete(existed);
        }

        const controller = new InlineBreadcrumbController(protyle);
        if (!controller.mount()) {
            controller.destroy();
            return null;
        }

        controllerByProtyle.set(protyle, controller);
        activeControllers.add(controller);
        return controller;
    },
    destroy(protyle) {
        const controller = controllerByProtyle.get(protyle);
        if (controller) {
            controller.destroy();
            controllerByProtyle.delete(protyle);
            activeControllers.delete(controller);
        }
    },
    destroyAll() {
        for (const controller of activeControllers) {
            controller.destroy();
        }
        activeControllers.clear();
        controllerByProtyle = new WeakMap();
    }
};

function destroyAllControllers() {
    inlineControllerRegistry.destroyAll();
}

/**
 * 构建文档面包屑的纯数据 ViewModel
 */
async function buildDocumentBreadcrumbModel(protyle, documentId) {
    const docDetail = await getCurrentDocDetail(documentId, protyle);
    if (!isValidStr(docDetail)) {
        logPush("数据库中找不到当前打开的文档");
        return null;
    }

    // 获取并解析hpath与path
    const pathObjects = await parseDocPath(docDetail);
    debugPush("OBJECT", pathObjects);

    const notebookDocFlag = isNotebookDoc(protyle.path, protyle.notebookId);
    const entries = await buildEntriesFromPath(pathObjects, protyle);

    let adjacent = null;
    if (g_setting.showAdjacentDocButton !== CONSTANTS.ADJ_NONE) {
        adjacent = await getAdjacentDocs(pathObjects, notebookDocFlag);
    }

    return {
        documentId,
        entries,
        adjacent
    };
}

/**
 * 将路径对象数组转为 BreadcrumbEntry 列表。
 * 折叠逻辑在此阶段完成，渲染时不再根据高度逐个添加 ellipsis。
 *
 * @typedef {Object} BreadcrumbEntry
 * @property {"root"|"notebook"|"document"|"collapsed"} kind
 * @property {string} label
 * @property {string=} id
 * @property {string=} icon
 * @property {string=} box
 * @property {string=} path
 * @property {string=} parentId
 * @property {string=} nextId
 * @property {number=} subFileCount
 * @property {Array<{id: string, name: string}>=} hiddenEntries
 * @property {boolean=} hasChildren
 */
async function buildEntriesFromPath(pathObjects, protyle) {
    const entries = [];
    // 折叠隐藏起始位置
    const foldStartAt = g_setting.showNotebook ? g_setting.foldedFrontShow :
        g_setting.foldedFrontShow + 1;
    // 折叠隐藏结束位置
    const foldEndAt = pathObjects.length - g_setting.foldedEndShow - 1;

    // 根层级（工作空间），不可点击
    if (g_setting.showRoot) {
        entries.push({
            kind: "root",
            label: language["root"],
            id: "",
            icon: "",
            path: "",
            box: "",
            parentId: "",
            nextId: pathObjects[0]?.box ?? "",
            subFileCount: -1,
            hasChildren: true,
        });
    }

    let countDebug = 0;
    for (let i = 0; i < pathObjects.length; i++) {
        countDebug++;
        if (countDebug > 200) {
            throw new Error(">_<出现死循环");
        }

        // 层级过深时，对中间内容加以限制
        if (pathObjects.length > 5 && i >= foldStartAt && i <= foldEndAt) {
            let hideFrom = foldStartAt;
            // 过滤笔记本，因为笔记本不可点击
            if (hideFrom <= 0) {
                if (isNotebookDocEnabled()) {
                    hideFrom = 0;
                } else {
                    hideFrom = 1;
                }
            }
            const hiddenEntries = [];
            for (let j = hideFrom; j <= foldEndAt; j++) {
                hiddenEntries.push({
                    id: pathObjects[j].id,
                    name: pathObjects[j].name
                });
            }
            debugPush(hiddenEntries);
            entries.push({
                kind: "collapsed",
                label: "···",
                id: "",
                icon: "",
                path: pathObjects[foldEndAt]?.path,
                box: pathObjects[foldEndAt]?.box,
                parentId: pathObjects[foldEndAt]?.id,
                nextId: pathObjects[foldEndAt + 1]?.id,
                subFileCount: -1,
                hiddenEntries,
                hasChildren: true,
            });
            i = foldEndAt;
            // 避免为负数，但好像没啥用
            if (i < 0) i = 0;
            continue;
        }

        // 不显示笔记本层级时跳过笔记本
        if (i === 0 && !g_setting.showNotebook) {
            continue;
        }

        const onePathObject = pathObjects[i];
        entries.push({
            kind: onePathObject.type === "NOTEBOOK" ? "notebook" : "document",
            label: onePathObject.name,
            id: onePathObject.id,
            icon: onePathObject.icon,
            path: onePathObject.path,
            box: onePathObject.box,
            parentId: onePathObject.id,
            nextId: pathObjects[i + 1]?.id,
            subFileCount: onePathObject.subFileCount,
            hasChildren: true,
        });
    }

    // 最后一个文档、且不含子文档时不再显示箭头
    const lastEntry = entries[entries.length - 1];
    if (lastEntry && lastEntry.kind === "document") {
        lastEntry.hasChildren = await isChildDocExist(protyle, lastEntry.id);
    }

    return entries;
}

async function isChildDocExist(protyle, id) {
    const sqlResponse = await listDocsByPath({
        path: protyle.path,
        notebook: protyle.notebookId,
        maxListLength: 3
    });
    if (sqlResponse && sqlResponse.files.length > 0) {
        return true;
    }
    return false;
}

async function parseDocPath(docDetail) {
    let docPath = getListDocsByPathAPIFilePath(docDetail.path, docDetail.box);
    let pathArray = docPath.substring(0, docPath.length - 3).split("/");
    // 处理并发意外
    let hpath = docDetail.hpath ?? await getHPathByID(docDetail.docId);
    let hpathArray = hpath.split("/");
    let resultArray = [];
    let notebooks = getNotebooks();
    let box;
    for (let notebook of notebooks) {
        if (notebook.id == docDetail.box) {
            box = notebook;
            break;
        }
    }
    let temp = {
        "name": box.name,
        "id": box.id,
        "icon": box.icon,
        "box": box.id,
        "path": "/",
        "type": "NOTEBOOK",
        "subFileCount": -1,
    }
    resultArray.push(temp);
    // 获取图标
    let icons = [""]
    let subFileCounts = [-1]
    if (g_setting.icon != CONSTANTS.ICON_NONE) {
        let promiseList = [];
        for (let i = 1; i < pathArray.length; i++) {
            promiseList.push(getDocInfo(pathArray[i]));
        }
        let iconResult = await Promise.all(promiseList);
        for (let i of iconResult) {
            icons.push(i.icon);
            subFileCounts.push(i.subFileCount);
        }
    }
    let temp_path = "";
    for (let i = 1; i < pathArray.length; i++) {
        let temp = {
            "name": hpathArray[i],
            "id": pathArray[i],
            "icon": "",
            "path": `${temp_path}/${pathArray[i]}.sy`,
            "box": box.id,
            "type": "FILE",
            "subFileCount": -1
        }
        if (g_setting.icon != CONSTANTS.ICON_NONE) {
            temp["icon"] = icons[i];
            temp["subFileCount"] = subFileCounts[i]
        }
        temp_path += "/" + pathArray[i];
        resultArray.push(temp);
    }
    return resultArray;
}

/**
 * 渲染层：ViewModel → DOM
 */
function renderBreadcrumbFragment(entries, controller) {
    const fragment = document.createDocumentFragment();

    entries.forEach((entry, index) => {
        const item = createBreadcrumbItem(entry, controller);
        fragment.appendChild(item);

        if (entry.hasChildren || index < entries.length - 1) {
            fragment.appendChild(createBreadcrumbArrow(entry, controller));
        }
    });

    return fragment;
}

function createBreadcrumbItem(entry, controller) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "protyle-breadcrumb__item og-fdb-inline__item";
    button.dataset.ogFdbKind = entry.kind;
    if (entry.kind === "notebook" && !isNotebookDocEnabled()) {
        button.classList.add("og-fdb-item--disabled");
    }

    const actionKey = controller.registerAction({
        type: entry.kind === "collapsed" ? "open-collapsed-menu" : "open-document",
        entry
    });
    button.dataset.ogFdbActionKey = actionKey;
    button.title = entry.label;

    if (entry.kind !== "collapsed") {
        const icon = createBreadcrumbIcon(entry.icon, entry.subFileCount !== 0);
        if (icon) {
            button.appendChild(icon);
        }
    }

    const text = document.createElement("span");
    text.className = "protyle-breadcrumb__text";
    text.textContent = entry.label;
    button.appendChild(text);

    return button;
}

function createBreadcrumbArrow(entry, controller) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "og-fdb-inline__arrow";
    button.setAttribute("aria-label", language["arrow_menu"] ?? "展开子文档菜单");

    const actionKey = controller.registerAction({
        type: "open-relative-menu",
        entry
    });
    button.dataset.ogFdbActionKey = actionKey;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    const use = document.createElementNS(svgNS, "use");
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#iconRight");
    svg.appendChild(use);
    button.appendChild(svg);

    return button;
}

/**
 * 使用 DOM API 创建面包屑图标（不再拼接 HTML 字符串）
 * @param {string} iconString 文档图标字段
 * @param {boolean} hasChild 是否有子文档（决定默认图标）
 * @returns {HTMLElement|null}
 */
function createBreadcrumbIcon(iconString, hasChild) {
    if (g_setting.icon == CONSTANTS.ICON_NONE) return null;
    const textClassName = "og-fdb-bread-emojitext";
    const picClassName = "og-fdb-bread-emojipic";

    // 无emoji的处理
    if (iconString == undefined || iconString == null || iconString == "") {
        if (g_setting.icon == CONSTANTS.ICON_ALL) {
            const localImages = window.siyuan.storage?.["local-images"];
            const localIcon = hasChild ? localImages?.folder : localImages?.file;
            if (localIcon) {
                return createBreadcrumbIcon(localIcon, hasChild);
            }
            const span = document.createElement("span");
            span.className = textClassName;
            span.textContent = hasChild ? "📑" : "📄";
            return span;
        }
        // ICON_CUSTOM_ONLY：无自定义图标时输出空白占位
        const span = document.createElement("span");
        span.className = textClassName;
        return span;
    }

    // emoji地址判断逻辑为出现.，但请注意之后的补全
    if (iconString.startsWith("api/icon/getDynamicIcon")) {
        const img = document.createElement("img");
        img.className = picClassName;
        img.src = `/${iconString}`;
        return img;
    }

    if (iconString.indexOf(".") != -1) {
        const img = document.createElement("img");
        img.className = picClassName;
        img.src = `/emojis/${iconString}`;
        return img;
    }

    const span = document.createElement("span");
    span.className = textClassName;
    span.textContent = emojiIconHandler(iconString, hasChild);
    return span;
}

// [START] 相邻文档导航相关
function createAdjacentDocNav(adjacent, controller) {
    const navElement = document.createElement("span");
    navElement.className = "og-fdb-doc-nav";
    navElement.appendChild(createAdjacentDocButton("previous", adjacent.previousDoc, adjacent.sameLevelPrevious, controller));
    navElement.appendChild(createAdjacentDocButton("next", adjacent.nextDoc, adjacent.sameLevelNext, controller));
    return navElement;
}

function createAdjacentDocButton(direction, doc, isSameLevel = false, controller) {
    const isPrevious = direction === "previous";
    const label = isPrevious ? (language["previous_doc"]) : (language["next_doc"]);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "og-fdb-doc-nav-button";
    button.setAttribute("data-og-adjacent-direction", direction);
    let buttonText = label;

    if (doc?.id) {
        const docName = trimListDocsByPathAPIReturnedDocName(doc?.name ?? "");
        const trimedDocName = trimDocName(docName, g_setting.nameMaxLength);
        buttonText = docName;
        const actionKey = controller.registerAction({
            type: "open-adjacent",
            docId: doc.id
        });
        button.setAttribute("data-og-fdb-action-key", actionKey);
        button.setAttribute("data-doc-id", doc.id);
        button.setAttribute("title", `${label}: ${docName}`);
    } else {
        button.disabled = true;
        button.setAttribute("title", label);
    }

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("title", button.getAttribute("title"));
    const use = document.createElementNS(svgNS, "use");
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", isPrevious ? "#iconLeft" : "#iconRight");
    svg.appendChild(use);

    const textSpan = document.createElement("span");
    textSpan.className = "og-fdb-doc-nav-button-text";
    textSpan.textContent = buttonText;

    if (isPrevious) {
        button.appendChild(svg);
        button.appendChild(textSpan);
    } else {
        button.appendChild(textSpan);
        button.appendChild(svg);
    }
    return button;
}

function trimDocName(name, maxLength) {
    if (name.length <= maxLength) {
        return name;
    }
    return name.substring(0, g_setting.nameMaxLength) + "...";
}

async function getAdjacentDocs(pathObjects, notebookDocFlag) {
    const result = {
        previousDoc: null,
        nextDoc: null,
        sameLevelPrevious: false,
        sameLevelNext: false,
    };
    // 如果是笔记本层级，且当前文档是笔记本文档，也继续
    if (!Array.isArray(pathObjects) || (pathObjects.length <= 1 && !notebookDocFlag)) {
        return result;
    }
    const currentDoc = pathObjects[pathObjects.length - 1];
    const previousDoc = pathObjects[pathObjects.length - 2];
    const currentDepth = pathObjects.length - 1;
    let sameLevelDocs = null;
    if (notebookDocFlag) {
        sameLevelDocs = await getNotebookAdjacentDocs(currentDoc.box);
    } else {
        sameLevelDocs = await getAdjacentChildDocs(previousDoc);
    }
    const currentIndex = findAdjacentDocIndex(sameLevelDocs, currentDoc.id);
    if (currentIndex < 0) {
        return result;
    }
    result.previousDoc = sameLevelDocs[currentIndex - 1] ?? null;
    result.nextDoc = sameLevelDocs[currentIndex + 1] ?? null;
    // 如果是笔记本层级，不再寻找同层级——已经到头了
    if (g_setting.showAdjacentDocButton === CONSTANTS.ADJ_SAME_LEVEL
        && (!result.previousDoc || !result.nextDoc) && !notebookDocFlag
    ) {
        debugPush("当前文档同级没有足够的文档，尝试向上获取同层级文档");
        const cache = {};
        const sameLevelDocs = await getAdjacentDocsByDepth(pathObjects[0], currentDepth, cache);
        const currentIndex = findAdjacentDocIndex(sameLevelDocs, currentDoc.id);
        if (result.previousDoc == null && currentIndex > 0) {
            result.sameLevelPrevious = true;
            result.previousDoc = sameLevelDocs[currentIndex - 1] ?? null;
        }
        if (result.nextDoc == null && currentIndex < sameLevelDocs.length - 1) {
            result.sameLevelNext = true;
            result.nextDoc = sameLevelDocs[currentIndex + 1] ?? null;
        }
    }
    return result;
}

let g_adjacentDocCache = {};

/**
 * 获取笔记本的相邻文档
 * @param {*} notebookId 
 * @param {*} cache 
 * @returns 
 */
async function getNotebookAdjacentDocs(notebookId, cache = null) {
    if (!notebookId) {
        return [];
    }
    const cacheKey = `notebook-${notebookId}`;
    if (cache && cache[cacheKey]) {
        debugPush("使用传入缓存", cacheKey);
        return cache[cacheKey].data;
    }
    if (g_adjacentDocCache[cacheKey] && (Date.now() - g_adjacentDocCache[cacheKey].timestamp < 3 * 60 * 1000) && g_setting.immediatelyUpdate) {
        debugPush("使用笔记本文档缓存", cacheKey);
        return g_adjacentDocCache[cacheKey].data;
    }
    const notebookList = await getNodebookList() ?? [];
    const result = notebookList.filter(notebook => notebook.closed == false);
    // 面包屑情况下不太需要详细信息，这里先不调用信息补全了
    // await fillNotebookDocFileInfo(notebookList.filter(notebook=>notebook.closed==false));
    if (cache) {
        cache[cacheKey] = {
            "data": result,
            "timestamp": Date.now(),
        };
    }
    g_adjacentDocCache[cacheKey] = {
        "data": result,
        "timestamp": Date.now(),
    };
    return g_adjacentDocCache[cacheKey].data;
}

async function getAdjacentChildDocs(parentDoc, cache = null) {
    if (!parentDoc?.path || !parentDoc?.box) {
        return [];
    }
    const cacheKey = `${parentDoc.box}-${parentDoc.path}`;
    if (cache && cache[cacheKey]) {
        debugPush("使用传入缓存", cacheKey);
        return cache[cacheKey].data;
    }
    if (cache == null && g_adjacentDocCache[cacheKey] && (Date.now() - g_adjacentDocCache[cacheKey].timestamp < 3 * 60 * 1000) && g_setting.immediatelyUpdate) {
        debugPush("使用相邻文档缓存", cacheKey);
        return g_adjacentDocCache[cacheKey].data;
    }
    const response = await listDocsByPath({
        path: parentDoc.path,
        notebook: parentDoc.box,
        ignoreDocMaxNum: true,
    });
    const processedResponse = (response?.files ?? []).map(doc => {
        doc["box"] = parentDoc.box;
        return doc;
    });
    if (cache) {
        cache[cacheKey] = {
            "data": processedResponse,
            "timestamp": Date.now(),
        };
    }
    g_adjacentDocCache[cacheKey] = {
        "data": processedResponse,
        "timestamp": Date.now(),
    };
    return g_adjacentDocCache[cacheKey].data;
}

async function getAdjacentDocsByDepth(parentDoc, targetDepth, cache) {
    if (targetDepth <= 0) {
        return [];
    }
    const childDocs = await getAdjacentChildDocs(parentDoc, cache);
    if (targetDepth === 1) {
        return childDocs;
    }
    let result = [];
    for (const childDoc of childDocs) {
        if (childDoc.subFileCount === 0) {
            continue;
        }
        const subDocs = await getAdjacentDocsByDepth(childDoc, targetDepth - 1, cache);
        result = result.concat(subDocs);
    }
    return result;
}

function findAdjacentDocIndex(docList, docId) {
    return docList.findIndex(doc => doc.id === docId);
}
// [END] 相邻文档导航相关

function clickAdjacentDocButton(event, docId) {
    if (!docId) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    openRefLinkByAPI({
        paramDocId: docId,
        keyParam: {
            ctrlKey: event?.ctrlKey,
            shiftKey: event?.shiftKey,
            altKey: event?.altKey,
            metaKey: event?.metaKey,
        },
    });
}

/**
 * 打开折叠区域的隐藏文档菜单
 */
function openHideMenu({ anchorElement, hiddenEntries }, event) {
    let rect = anchorElement.getBoundingClientRect();
    event.stopPropagation();
    event.preventDefault();
    const tempMenu = new siyuan.Menu("newMenu");
    for (let i = 0; i < hiddenEntries.length; i++) {
        let id = hiddenEntries[i].id;
        let name = hiddenEntries[i].name;
        let trimedName = name.length > g_setting.nameMaxLength ?
            name.substring(0, g_setting.nameMaxLength) + "..."
            : name;
        let tempMenuItemObj = {
            iconHTML: "",
            label: `<span class="${CONSTANTS.MENU_ITEM_CLASS_NAME}" 
                data-doc-id="${id}"
                title="${name}">
                ${trimedName}
            </span>`,
            click: (htmlElement, event) => {
                let docId = htmlElement.querySelector("[data-doc-id]")?.getAttribute("data-doc-id");
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                openRefLinkByAPI({
                    paramDocId: docId,
                    keyParam: {
                        ctrlKey: event?.ctrlKey,
                        shiftKey: event?.shiftKey,
                        altKey: event?.altKey,
                        metaKey: event?.metaKey,
                    },
                });
            }
        }
        tempMenu.addItem(tempMenuItemObj);
    }

    tempMenu.open({ x: rect.left, y: rect.bottom, isLeft: false });
}

function checkAndCloseLastMenu(id) {
    if (g_relativeMenu) {
        let tempId = g_relativeMenu["id"];
        if (tempId === id && document.querySelector("#commonMenu[data-name='og-fdb-relative-menu']")) {
            g_relativeMenu["menu"]?.close();
            g_relativeMenu = null;
            return false;
        }
        g_relativeMenu["menu"]?.close();
        g_relativeMenu = null;
    }
    return true;
}
function saveLastMenu(menuObj, id) {
    g_relativeMenu = { "menu": menuObj, "id": id };
}
/**
 * 打开相关文档菜单
 * @param {Object} options
 * @param {IProtyle} options.protyle 所在 Protyle
 * @param {HTMLElement} options.anchorElement 触发元素
 * @param {string} options.parentId 父文档 id（即触发菜单的路径项自身 id）
 * @param {string} options.nextId 下一路径项 id（用于高亮当前文档）
 * @param {string} options.path 触发项文档路径
 * @param {string} options.box 触发项笔记本 id
 * @param {string} options.kind "root" | "notebook" | "document"
 * @param {Event} event 触发事件
 * @returns 
 */
async function openRelativeMenu({ protyle, anchorElement, parentId, nextId, path, box, kind }, event) {
    event.stopPropagation();
    event.preventDefault();
    event.stopImmediatePropagation();
    const maxDepth = g_setting["menuExtendSubDocDepth"];
    let id = parentId;
    let type = kind === "notebook" ? "NOTEBOOK" : (kind === "root" ? "ROOT" : "FILE");
    let rect = anchorElement.getBoundingClientRect();
    // 从路径项打开时，菜单定位到其后的箭头位置
    if (!anchorElement.classList.contains("og-fdb-inline__arrow") && anchorElement.nextElementSibling) {
        rect = anchorElement.nextElementSibling.getBoundingClientRect();
    }

    if (!checkAndCloseLastMenu(id)) {
        return;
    }

    let siblings = [];

    if (type !== "ROOT") {
        let sqlResult = [{
            path: path,
            box: box
        }];
        siblings = await getChildDocuments(id, sqlResult);
    } else {
        siblings = window.siyuan.notebooks.filter(item => item.closed == false);
    }
    if (siblings.length <= 0) return;

    const tempMenu = new siyuan.Menu("og-fdb-relative-menu");
    // 创建新文档
    // 只读模式这里也是显示创建按钮的
    if (g_setting.createDocBtnInMenu && type !== "ROOT") {
        let tempMenuItemObj = {
            icon: `iconAdd`,
            label: `<span class="${CONSTANTS.MENU_ITEM_CLASS_NAME}">${window.siyuan.languages.newFile}</span>`,
            click: (htmlElement, event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                createAndOpenEmptyDocAt(box, path);
            }
        };
        tempMenu.addItem(tempMenuItemObj);
    }
    // 本层级内容
    for (let i = 0; i < siblings.length; i++) {
        let currSibling = siblings[i];
        let docName = trimListDocsByPathAPIReturnedDocName(currSibling.name);
        let trimedName = docName.length > g_setting.nameMaxLength ?
            docName.substring(0, g_setting.nameMaxLength) + "..."
            : docName;
        let tempMenuItemObj = {
            iconHTML: getEmojiHtmlStr(currSibling.icon, currSibling.subFileCount > 0),
            label: `<span class="${CONSTANTS.MENU_ITEM_CLASS_NAME} ${nextId == currSibling.id ? CONSTANTS.MENU_CURRENT_DOC_CLASS_NAME : ""}" 
                data-doc-id="${currSibling.id}"
                title="${docName}">
                ${trimedName}
            </span>`,
            accelerator: nextId == currSibling.id ? "<-" : undefined,
            current: nextId == currSibling.id
        };

        if (currSibling.icon && currSibling.icon !== "" && currSibling.icon.indexOf(".") === -1) {
            tempMenuItemObj["icon"] = `icon-${currSibling.icon}`;
        }

        // 对于带有子层级的文档，另外处理，主要是一些参数
        if ((currSibling.subFileCount > 0 || type === "ROOT") && maxDepth > 1) {
            tempMenuItemObj.type = "submenu";
            tempMenuItemObj.submenu = [
                {
                    label: language["loading"],
                    disabled: true
                }
            ];

            tempMenuItemObj.label = `<span class="${CONSTANTS.MENU_ITEM_CLASS_NAME} ${nextId == currSibling.id ? CONSTANTS.MENU_CURRENT_DOC_CLASS_NAME : ""}" 
                data-doc-id="${currSibling.id}"
                data-has-children="true"
                data-path="${currSibling.path || '/'}"
                data-box="${type !== "ROOT" ? box : currSibling["id"]}"
                data-loaded="false"
                title="${docName}">
                ${trimedName}
            </span>`;
        }
        if (type !== "ROOT" || isNotebookDocEnabled()) {
            tempMenuItemObj.click = (htmlElement, event) => {
                let docId = htmlElement.querySelector("[data-doc-id]")?.getAttribute("data-doc-id");
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                openRefLinkByAPI({
                    paramDocId: docId,
                    keyParam: {
                        ctrlKey: event?.ctrlKey,
                        shiftKey: event?.shiftKey,
                        altKey: event?.altKey,
                        metaKey: event?.metaKey,
                    },
                });
                g_relativeMenu["menu"]?.close();
                g_relativeMenu = null;
            };
        }
        tempMenu.addItem(tempMenuItemObj);
    }
    // 菜单展示位置调整，仅针对首层级
    if (siblings.length * 30 > (window.innerHeight - rect.bottom) * 0.7) {
        tempMenu.open({ x: rect.right, y: rect.top, isLeft: false });
    } else {
        tempMenu.open({ x: rect.left, y: rect.bottom, isLeft: false });
    }
    setTimeout(() => {
        if (g_setting.menuKeepCurrentVisible) {
            tempMenu.element.querySelector('.b3-menu__item--selected')?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest'
            });
        }

        // 懒加载
        if (g_setting.menuExtendSubDocDepth > 1) {
            addLazyLoadEventListeners(tempMenu.element, maxDepth, protyle.element);
        }
    }, 3);
    saveLastMenu(tempMenu, id);
}

/**
 * 对带有子菜单的添加懒加载
 * @param {HTMLElement} menuElement 菜单元素
 * @param {number} maxDepth 最大深度
 * @param {HTMLElement} protyleElem protyle Elem
 * @param {number} currentDepth 层级深度
 */
function addLazyLoadEventListeners(menuElement, maxDepth, protyleElem, currentDepth = 1) {
    // 仅针对未加载的进行处理
    const menuItems = menuElement.querySelectorAll('.b3-menu__item [data-has-children="true"][data-loaded="false"]');

    menuItems.forEach(item => {
        const menuItemElement = item.closest('.b3-menu__item');
        if (!menuItemElement) return;

        // 悬停加载
        menuItemElement.addEventListener('mouseover', async function handleMouseOver(e) {
            const docId = item.getAttribute('data-doc-id');
            const path = item.getAttribute('data-path');
            const box = item.getAttribute('data-box');
            const isLoaded = item.getAttribute('data-loaded') === 'true';

            if (isLoaded || currentDepth >= maxDepth) return;

            // 避免多次处理
            item.setAttribute('data-loaded', 'true');

            const submenuContainer = menuItemElement.querySelector('.b3-menu__submenu .b3-menu__items');
            if (!submenuContainer) return;

            submenuContainer.innerHTML = '';

            // 加载子文档
            const sqlResult = [{ path, box }];
            const childDocuments = await getChildDocuments(docId, sqlResult);

            if (!childDocuments || childDocuments.length === 0) {
                submenuContainer.innerHTML = `<button class="b3-menu__item" disabled><span class="b3-menu__label">${language["no_doc"]}</span></button>`;
                return;
            }

            // 创建子文档菜单项
            // Menu Item
            const menuItemEl = document.createElement('button');
            menuItemEl.className = 'b3-menu__item';
            // icon
            const iconAddEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            iconAddEl.classList.add('b3-menu__icon');
            iconAddEl.innerHTML = `<use xlink:href="#iconAdd"></use>`;
            menuItemEl.appendChild(iconAddEl);

            // label
            const labelEl = document.createElement('span');
            labelEl.className = 'b3-menu__label';

            // title
            const docTitleEl = document.createElement('span');
            docTitleEl.className = `${CONSTANTS.MENU_ITEM_CLASS_NAME}`;
            docTitleEl.textContent = window.siyuan.languages.newFile;
            labelEl.appendChild(docTitleEl);
            menuItemEl.appendChild(labelEl);
            submenuContainer.appendChild(menuItemEl);
            menuItemEl.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                createAndOpenEmptyDocAt(box, path);
                g_relativeMenu["menu"]?.close();
                g_relativeMenu = null;
            });

            // 子文档菜单
            for (const childDoc of childDocuments) {
                const docName = trimListDocsByPathAPIReturnedDocName(childDoc.name);
                const trimedName = docName.length > g_setting.nameMaxLength ?
                    docName.substring(0, g_setting.nameMaxLength) + "..." :
                    docName;
                const hasChildren = childDoc.subFileCount > 0 && (currentDepth + 1) < maxDepth;

                // Menu Item
                const menuItemEl = document.createElement('button');
                menuItemEl.className = 'b3-menu__item';
                if (hasChildren) {
                    menuItemEl.classList.add('b3-menu__item--custom');
                }

                // Emoji
                const emojiEl = document.createElement('span');
                emojiEl.className = 'og-fdb-menu-emojitext';
                emojiEl.innerHTML = getEmojiHtmlStr(childDoc.icon, childDoc.subFileCount > 0);
                menuItemEl.appendChild(emojiEl);

                // label
                const labelEl = document.createElement('span');
                labelEl.className = 'b3-menu__label';

                // title
                const docTitleEl = document.createElement('span');
                docTitleEl.className = `${CONSTANTS.MENU_ITEM_CLASS_NAME}`;
                docTitleEl.setAttribute('data-doc-id', childDoc.id);
                docTitleEl.setAttribute('title', docName);

                if (hasChildren) {
                    docTitleEl.setAttribute('data-has-children', 'true');
                    docTitleEl.setAttribute('data-path', childDoc.path || '');
                    docTitleEl.setAttribute('data-box', box);
                    docTitleEl.setAttribute('data-loaded', 'false');
                }

                docTitleEl.textContent = decodeHtmlEntities(trimedName);
                labelEl.appendChild(docTitleEl);
                menuItemEl.appendChild(labelEl);

                // 子文档的子文档
                if (hasChildren) {
                    // > icon
                    // svg里的use，使用带namespace的才能够正确创建一个有效的use箭头
                    const svgNS = 'http://www.w3.org/2000/svg';

                    const arrowIcon = document.createElementNS(svgNS, 'svg');
                    arrowIcon.setAttribute('class', 'b3-menu__icon b3-menu__icon--small');

                    const use = document.createElementNS(svgNS, 'use');
                    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#iconRight');

                    arrowIcon.appendChild(use);
                    menuItemEl.appendChild(arrowIcon);

                    // 子文档容器
                    const submenuDiv = document.createElement('div');
                    submenuDiv.className = 'b3-menu__submenu';

                    const submenuItems = document.createElement('div');
                    submenuItems.className = 'b3-menu__items';

                    // 加载中……
                    const loadingItem = document.createElement('button');
                    loadingItem.className = 'b3-menu__item';
                    loadingItem.disabled = true;
                    loadingItem.innerHTML = '<span class="b3-menu__label">Loading...</span>';
                    submenuItems.appendChild(loadingItem);

                    submenuDiv.appendChild(submenuItems);
                    menuItemEl.appendChild(submenuDiv);
                }
                menuItemEl.addEventListener('click', (event) => {
                    const docId = docTitleEl.getAttribute('data-doc-id');
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    event.stopPropagation();
                    openRefLinkByAPI({
                        paramDocId: docId,
                        keyParam: {
                            ctrlKey: event?.ctrlKey,
                            shiftKey: event?.shiftKey,
                            altKey: event?.altKey,
                            metaKey: event?.metaKey,
                        },
                    });
                    // 手动绑定的不能触发菜单关闭，这里自行处理一下
                    g_relativeMenu["menu"]?.close();
                    g_relativeMenu = null;
                });
                submenuContainer.appendChild(menuItemEl);
            }

            // 对子Menu再度绑定
            addLazyLoadEventListeners(submenuContainer, maxDepth, protyleElem, currentDepth + 1);
        });
    });
}


function getNotebooks() {
    let notebooks = window.top.siyuan.notebooks;
    return notebooks;
}

async function getNodebookList() {
    let url = "/api/notebook/lsNotebooks";
    let response = await postRequest({}, url);
    if (response.code == 0 && response.data != null && "notebooks" in response.data) {
        return response.data.notebooks;
    }
    return null;
}


async function getCurrentDocDetail(docId, protyle) {
    let result = {
        path: protyle.path,
        hpath: await getHPathByID(docId),
        box: protyle.notebookId,
        docId: protyle.block.rootID
    }
    return result;
}

async function getHPathByID(docId) {
    let url = "/api/filetree/getHPathByID";
    let data = {
        id: docId
    }
    return parseBody(request(url, data));
}

async function listDocTree(notebook, path) {
    const url = "/api/filetree/listDocTree";
    let postBody = {
        notebook,
        path
    }
    let response = await postRequest(postBody, url);
    if (response.code == 0) {
        return response.data.tree;
    } else {
        throw new Error("listDocTree Failed: " + response.msg);
    }
}

async function getNotebookInfo(notebookId) {
    let url = "/api/notebook/getNotebookInfo";
    let response = await postRequest({ notebook: notebookId }, url);
    if (response.code == 0 && response.data != null) {
        return response.data.boxInfo;
    } else {
        warnPush("请求笔记本信息时出错  ", response["msg"])
    }
    return null;
}

async function getChildDocuments(docId, sqlResult) {
    let childDocs = await listDocsByPath({ path: sqlResult[0].path, notebook: sqlResult[0].box });
    if (childDocs.files.length > g_setting.docMaxNum && g_setting.docMaxNum != 0) {
        childDocs.files = childDocs.files.slice(0, g_setting.docMaxNum);
    }
    return childDocs.files;
}

function setMouseKeyboardListener() {
    if (g_setting.typeHide) {
        window.document.addEventListener("mousemove", showDocBreadcrumb);
        window.document.addEventListener("keydown", hideDocBreadcrumb, true);
    }
}

function hideDocBreadcrumb(event) {
    if (!g_hidedBreadcrumb) {
        if (event.ctrlKey || event.shiftKey || event.altKey) return;
        const fakeBreadcrumb = window.document.querySelectorAll(`.${CONSTANTS.CONTAINER_CLASS_NAME}, .${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}`);
        [].forEach.call(fakeBreadcrumb, (e) => {
            e.classList.add("og-hide-breadcrumb");
        });
        g_hidedBreadcrumb = true;
    }
}

function showDocBreadcrumb() {
    if (g_hidedBreadcrumb) {
        const fakeBreadcrumb = window.document.querySelectorAll(`.${CONSTANTS.CONTAINER_CLASS_NAME}, .${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}`);
        [].forEach.call(fakeBreadcrumb, (e) => {
            e.classList.remove("og-hide-breadcrumb");
        });
        g_hidedBreadcrumb = false;
    }
}

function removeMouseKeyboardListener() {
    window.document.removeEventListener("mousemove", showDocBreadcrumb);
    window.document.removeEventListener("keydown", hideDocBreadcrumb, true);
}

/**
 * 静态样式（仅支持 v3.7.0+，不再动态判断版本生成 CSS）
 * 布局完全交给 Flexbox：两个面包屑均为可独立横向滚动的 flex 项。
 */
function setStyle() {
    const head = document.getElementsByTagName('head')[0];
    const style = document.createElement('style');
    style.setAttribute("id", CONSTANTS.STYLE_ID);

    style.innerHTML = `
/* ===== 同行模式：连续内容带 ===== */
/* 原生 bar 是唯一滚动容器，也是 host 的 flex 项：
 * 有剩余空间时保持内容自然宽度；空间不足时按 max-content 基准压缩。 */
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar {
    flex-grow: 0;
    flex-shrink: 1;
    flex-basis: max-content;

    /* 允许缩小到自身内容宽度以下，超出的内容改为内部滚动 */
    min-inline-size: 0;

    /* v3.7+ 原生面包屑父容器为 42px，内容高度 30px */
    align-self: center;
    block-size: 30px;
    min-block-size: 30px;

    box-sizing: border-box;

    flex-wrap: nowrap !important;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
}
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar::-webkit-scrollbar {
    display: none;
}

/* 插件内容容器：bar 内连续内容带的第一段（不参与压缩） */
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar
    > .og-fdb-inline-breadcrumb {
    flex: 0 0 auto;
    align-self: center;
    block-size: 30px;
    min-block-size: 30px;

    box-sizing: border-box;

    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    white-space: nowrap;
    user-select: none;

    /* 滚动由原生 bar 统一承担 */
    overflow: visible;

    /* 使用边框代替单独的 divider DOM */
    border-inline-end: 1px solid var(--b3-theme-on-surface-light);
    margin-inline-end: 6px;
    padding-inline-end: 6px;
}

/* 内容带内所有直接子项不得继续压缩（插件容器、原生路径项） */
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar
    > * {
    flex-shrink: 0;
}

/* 兼容原生 bar 已被加上 ellipsis class 的情况 */
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar
    .protyle-breadcrumb__text--ellipsis {
    max-inline-size: none;
}

/* 不修改 .protyle-breadcrumb__space，只禁止其右侧按钮被压缩 */
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__space
    ~ button {
    flex: 0 0 auto;
}

/* ===== 插件滚动区（通用） ===== */
.og-fdb-inline-breadcrumb {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;

    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-inline: contain;
    touch-action: pan-x;

    white-space: nowrap;
    scrollbar-width: none;
    user-select: none;

    box-sizing: border-box;
}
.og-fdb-inline-breadcrumb::-webkit-scrollbar {
    display: none;
}
.og-fdb-inline-breadcrumb > * {
    flex-shrink: 0;
}
.og-fdb-inline-breadcrumb .protyle-breadcrumb__text {
    margin-left: 0px;
    max-inline-size: none;
    overflow: visible;
    text-overflow: clip;
}

/* 两行模式容器 */
.og-fake-doc-breadcrumb-container.protyle-breadcrumb {
    padding-bottom: 0px;
}
.og-fake-doc-breadcrumb-container.protyle-breadcrumb
    > .og-fdb-inline-breadcrumb {
    flex: 1 1 auto;
    min-inline-size: 0;
    align-self: center;
    block-size: 30px;
    min-block-size: 30px;
}

/* ===== 路径项与箭头 ===== */
.og-fdb-inline__item,
.og-fdb-inline__arrow {
    font: inherit;
}

.og-fdb-item--disabled {
    cursor: default;
}

.og-fdb-inline__arrow {
    align-items: center;
    align-self: center;
    background: transparent;
    border: 0;
    border-radius: var(--b3-border-radius);
    color: var(--b3-theme-on-surface-light);
    cursor: pointer;
    display: inline-flex;
    flex: 0 0 auto;
    height: 24px;
    justify-content: center;
    margin: 3px 0;
    padding: 0 2px;
}
.og-fdb-inline__arrow > svg {
    height: 14px;
    width: 14px;
}
.og-fdb-inline__arrow:hover {
    color: var(--b3-menu-highlight-color, var(--b3-theme-on-background));
    background-color: var(--b3-menu-highlight-background, var(--b3-list-hover));
}

/* ===== 图标 ===== */
.og-fdb-menu-emojitext, .og-fdb-menu-emojipic {
    align-self: center;
    height: 14px;
    width: 14px;
    line-height: 14px;
    margin-right: 8px;
    flex-shrink: 0;
}

.og-fdb-bread-emojitext, .og-fdb-bread-emojipic {
    align-self: center;
    height: 14px;
    width: 14px;
    line-height: 14px;
    margin-right: 8px;
    flex-shrink: 0;
}

.b3-menu__item img.og-fdb-menu-emojipic {
    width: 16px;
    height: 16px;
}

/* ===== 输入时隐藏 ===== */
.og-hide-breadcrumb {
    opacity: 0;
    transition: 1s;
}

/* ===== 相邻文档导航 ===== */
.og-fdb-doc-nav {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: 4px;
    flex-shrink: 0;
}

.og-fdb-doc-nav-button {
    align-items: center;
    background: transparent;
    border: none;
    border-radius: var(--b3-border-radius);
    color: var(--b3-theme-on-surface-light);
    cursor: pointer;
    display: inline-flex;
    gap: 4px;
    height: 24px;
    line-height: 24px;
    justify-content: center;
    max-width: min(180px, 12em, 22vw);
    min-width: 0;
    padding: 0 6px;
}

.og-fdb-doc-nav-button svg {
    flex-shrink: 0;
    height: 12px;
    width: 12px;
}

.og-fdb-doc-nav-button-text {
    display: inline-block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.og-fdb-doc-nav-button:not(:disabled):hover {
    color: var(--b3-menu-highlight-color, var(--b3-theme-on-background));
    background-color: var(--b3-menu-highlight-background, var(--b3-list-hover));
}
.og-fdb-doc-nav-button:disabled {
    cursor: not-allowed;
    opacity: 0.35;
}

/* ===== 移动端样式 ===== */
.og-fdb-mobile-btn-class {
    max-width: 60%;
    overflow: auto;
    display: flex;
}

.og-fdb-mobile-btn-path {
    max-width: 6em;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* ===== 覆盖 savor 主题样式 ===== */
.protyle-breadcrumb.og-fdb-inline-host
    > .og-fdb-inline-breadcrumb
    .protyle-breadcrumb__item:first-child::before,
.og-fake-doc-breadcrumb-container.protyle-breadcrumb
    > .og-fdb-inline-breadcrumb
    .protyle-breadcrumb__item:first-child::before {
    content: "";
    margin-right: 0px;
}
    `;
    head.appendChild(style);
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


function removeStyle() {
    document.getElementById(CONSTANTS.STYLE_ID)?.remove();
}

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
    if (g_setting.icon == CONSTANTS.ICON_NONE) return ``;
    // 无emoji的处理
    if ((iconString == undefined || iconString == null || iconString == "") && g_setting.icon == CONSTANTS.ICON_ALL) {
        if (window.siyuan.storage["local-images"]) {
            if (hasChild) {
                return getEmojiHtmlStr(window.siyuan.storage["local-images"].folder, hasChild, textClassName, picClassName, wrapText);
            } else {
                return getEmojiHtmlStr(window.siyuan.storage["local-images"].file, hasChild, textClassName, picClassName, wrapText);
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
    if ((iconString == undefined || iconString == null || iconString == "") && g_setting.icon == CONSTANTS.ICON_CUSTOM_ONLY) {
        if (wrapBlank) {
            return `<span class="${textClassName}"></span>`;
        } else {
            return "";
        }
    }
    let result = iconString;
    // emoji地址判断逻辑为出现.，但请注意之后的补全
    if (iconString.startsWith("api/icon/getDynamicIcon")) {
        result = `<img class="${picClassName}" src="/${iconString}"/>`;
    } else if (iconString.indexOf(".") != -1) {
        result = `<img class="${picClassName}" src="/emojis/${iconString}"/>`;
    } else {
        if (wrapText) {
            result = `<span class="${textClassName}">${emojiIconHandler(iconString, hasChild)}</span>`;
        } else {
            result = emojiIconHandler(iconString, hasChild);
        }
    }
    return result;
}
let emojiIconHandler = function (iconString, hasChild = false) {
    //确定是emojiIcon 再调用，printer自己加判断
    try {
        let result = "";
        iconString.split("-").forEach(element => {
            result += String.fromCodePoint("0x" + element);
        });
        return result;
    } catch (err) {
        errorPush("emoji处理时发生错误", iconString, err);
        return hasChild ? "📑" : "📄";
    }
}

function getAllShowingDocId() {
    if (isMobile()) {
        return [getCurrentDocIdF()];
    } else {
        const elemList = window.document.querySelectorAll("[data-type=wnd] .protyle.fn__flex-1:not(.fn__none) .protyle-background");
        const result = [].map.call(elemList, function (elem) {
            return elem.getAttribute("data-node-id");
        });
        return result
    }
}

function getCurrentDocIdF() {
    let thisDocId = null;
    thisDocId = window.top.document.querySelector(".layout__wnd--active .protyle.fn__flex-1:not(.fn__none) .protyle-background")?.getAttribute("data-node-id");
    debugPush("thisDocId by first id", thisDocId);
    let temp = null;
    if (!thisDocId && isMobile()) {
        // UNSTABLE: 面包屑样式变动将导致此方案错误！
        try {
            temp = window.top.document.querySelector(".protyle-breadcrumb .protyle-breadcrumb__item .popover__block[data-id]")?.getAttribute("data-id");
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
        } catch (e) {
            console.error(e);
            temp = null;
        }
    }
    if (!thisDocId) {
        thisDocId = window.top.document.querySelector(".protyle.fn__flex-1:not(.fn__none) .protyle-background")?.getAttribute("data-node-id");
        debugPush("thisDocId by background must match,  id", thisDocId);
    }
    return thisDocId;
}
async function request(url, data) {
    let resData = null;
    await fetch(url, {
        body: JSON.stringify(data),
        method: 'POST'
    }).then(function (response) {
        resData = response.json();
    });
    return resData;
}

async function parseBody(response) {
    let r = await response;
    return r.code === 0 ? r.data : null;
}

async function createAndOpenEmptyDocAt(box, path) {
    const newPath = (path.endsWith(".sy") ? path.substring(0, path.length - 3) + "/" : path) + window.Lute.NewNodeID() + ".sy";
    createDoc(box, newPath, window.siyuan.languages.untitled, "", true).then((response) => {
        if (response && response.id) {
            openRefLinkByAPI({
                paramDocId: response.id,
            });
        }
    }).catch((err) => {
        errorPush(err);
    });
}

async function createDoc(notebookId, path, title, md, listDocTree) {
    let url = "/api/filetree/createDoc";
    let data = {
        notebook: notebookId,
        path: path,
        title: title,
        md: md,
        listDocTree: listDocTree
    }
    let response = await request(url, data);
    if (response.code == 0) {
        return response.data;
    } else {
        return null;
    }
}

async function getDocOutline(docId) {
    let url = "/api/outline/getDocOutline";
    let data = { "id": docId };
    let response = await request(url, data);
    if (response.code == 0) {
        return response.data;
    } else {
        return null;
    }
}

async function getDocInfo(docId) {
    let url = `/api/block/getDocInfo`;
    return parseBody(request(url, { id: docId }));
}

async function listDocsByPath({ path, notebook = undefined, sort = undefined, maxListLength = undefined, ignoreDocMaxNum = false }) {
    let data = {
        path: path,
        "ignoreMaxListHint": true
    };
    if (notebook) data["notebook"] = notebook;
    if (sort) data["sort"] = sort;
    if (maxListLength != undefined) {
        data["maxListCount"] = maxListLength;
    } else if (!ignoreDocMaxNum && g_setting.docMaxNum != 0) {
        data["maxListCount"] = g_setting.docMaxNum >= 32 ? g_setting.docMaxNum : 32;
    } else {
        data["maxListCount"] = 0;
    }
    let url = '/api/filetree/listDocsByPath';
    return parseBody(request(url, data));
    //文档hepath与Markdown 内容
}

async function sqlAPI(stmt) {
    let data = {
        "stmt": stmt
    };
    let url = `/api/query/sql`;
    return parseBody(request(url, data));
}

/**
 * 将常见 HTML 字符实体转为正常字符
 * @param {string} inputStr - 输入字符串
 * @returns {string} - 转换后的字符串
 */
function decodeHtmlEntities(inputStr) {
    if (!inputStr) return "";

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

function openRefLinkAgent(event, paramId = "", keyParam = undefined, protyleElem = undefined, openInFocus = !g_setting.preferOpenInCurrentSplit) {
    openRefLinkByAPI({
        mouseEvent: event,
        paramDocId: paramId,
        keyParam: keyParam,
        preventDefault: !g_setting.preferOpenInCurrentSplit,
    });
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function tryToFixAllError() {
    if (!g_setting.autoFixFocusError) {
        siyuan.showMessage(language["autoFixEnableFirst"] + "--- fakeDocBreadcrumb");
        return;
    }
    if (window.siyuan.dialogs.length == 1) {
        window.siyuan.dialogs[0].destroy();
    } else {
        siyuan.showMessage(language["closeOtherDialog"] + " --- fakeDocBreadcrumb");
    }
    if (window["OG_FDB_NO_WARNING"] == true) {
        siyuan.showMessage(language["onlyOneRunning"] + " --- fakeDocBreadcrumb");
        return;
    }
    try {
        window["OG_FDB_NO_WARNING"] = true;
        siyuan.showMessage(language["batchFixStart"] + "--- fakeDocBreadcrumb")
        const list = window.siyuan.storage["local-fileposition"];
        if (list) {
            for (let key in list) {
                if (list.hasOwnProperty(key)) {
                    if (list[key] && list[key]["zoomInId"] === key) {
                        openRefLinkByAPI({
                            paramDocId: key
                        });
                        await sleep(5000);
                    }
                }
            }
        }
    } catch (err) {
        errorPush(err);
    } finally {
        siyuan.showMessage(language["batchFixEnd"] + "--- fakeDocBreadcrumb")
        window["OG_FDB_NO_WARNING"] = false;
    }

}

function stripHTML(input) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, "text/html");
    return doc.documentElement.textContent || "";
}

/**
 * 介入原生块面包屑的“>”箭头：显示文档内标题层级菜单
 * 通过 protyle.breadcrumb.element 精确定位原生 bar（不使用模糊 querySelector）。
 * 原生每次 render 都会重写 bar 的 innerHTML，dataset 丢失后此处会重新绑定。
 */
async function addBlockBdMenuListener(protyle) {
    // 限制范围，避免影响插件插入的面包屑
    const breadcrumbBar = protyle?.breadcrumb?.element;
    if (!(breadcrumbBar instanceof HTMLElement)) {
        return;
    }
    if (breadcrumbBar.dataset["ogFdbAddedEl"]) {
        return;
    }
    breadcrumbBar.dataset["ogFdbAddedEl"] = "true";
    const docId = protyle.block.rootID;
    breadcrumbBar.addEventListener('click', async (event) => {
        // 使用 .closest() 判断点击的是否是箭头或其内部元素
        const arrowElement = event.target.closest('.protyle-breadcrumb__arrow');
        if (!arrowElement) {
            return;
        }
        // 获取箭头左侧的面包屑项目
        const precedingItem = arrowElement.previousElementSibling;
        if (!precedingItem || !precedingItem.classList.contains('protyle-breadcrumb__item')) {
            logPush("未找到箭头左侧的面包屑项目。");
            return;
        }
        const afterItem = arrowElement.nextElementSibling;
        let nextNodeId = "";
        if (afterItem && precedingItem.classList.contains('protyle-breadcrumb__item')) {
            nextNodeId = afterItem.dataset.nodeId;
        }
        // 提取 Node ID 和图标信息
        const nodeId = precedingItem.dataset.nodeId;
        const iconUseElement = precedingItem.querySelector('svg.popover__block use');

        if (!nodeId || !iconUseElement) {
            logPush("无法从面包屑项目中提取 node-id 或 icon。");
            return;
        }
        event.stopImmediatePropagation();
        event.stopPropagation();
        event.preventDefault();
        const iconHref = iconUseElement.getAttributeNS('http://www.w3.org/1999/xlink', 'href');

        logPush(`点击了 ID: ${nodeId} (${iconHref}) 旁边的箭头`);
        const menuId = "bid_" + nodeId;
        if (!checkAndCloseLastMenu(menuId)) {
            return;
        }
        try {
            // 获取文档大纲
            const outlineData = await getDocOutline(docId);

            let menuItems = [];
            if (outlineData == null) {
                logPush("获取大纲数据失败或文档无大纲。");
                siyuan.showMessage(language["nothingToDisplay"] + "--- fakeDocBreadcrumb");
                return;
            }
            // 根据图标类型来决定菜单内容
            if (iconHref === '#iconFile') {
                // 如果是文档图标，显示所有顶级标题
                logPush("目标是文档根节点，筛选所有顶级标题 (depth: 0)...");
                menuItems = outlineData.filter(item => item.depth === 0);
            } else if (iconHref.startsWith('#iconH')) {
                // 如果是标题图标 (H1-H6)，显示其下的直接子标题
                logPush(`目标是标题节点，查找 ID: ${nodeId} 的子标题...`);
                // 递归查找指定 ID 的标题及其子项
                function findHeadingById(items, targetId) {
                    for (const item of items) {
                        if (item.id === targetId) {
                            return item;
                        }
                        // 顶层标题
                        if (item.blocks && item.blocks.length > 0) {
                            const found = findHeadingById(item.blocks, targetId);
                            if (found) return found;
                        }
                        // 深层标题
                        if (item.children && item.children.length > 0) {
                            const found = findHeadingById(item.children, targetId);
                            if (found) return found;
                        }
                    }
                    return null;
                }

                const parentHeading = findHeadingById(outlineData, nodeId);
                if (parentHeading) {
                    // 优先使用 blocks，如果没有则使用 children
                    menuItems = parentHeading.blocks || parentHeading.children || [];
                } else {
                    logPush(`标题 ${nodeId} 没有找到或没有子标题。`);
                }
            } else {
                logPush(`点击了非文档或标题图标 (${iconHref}) 旁的箭头，不作处理。`);
                siyuan.showMessage(language["nothingToDisplay"] + "--- fakeDocBreadcrumb");
                return;
            }

            // 递归构建菜单项的函数
            function buildMenuItems(items) {
                return items.map(item => {
                    const fullName = escapeHTML(stripHTML(item.name || item.content || "N/A"));
                    const trimedName = fullName.length > g_setting.nameMaxLength ? fullName.substring(0, g_setting.nameMaxLength) + "..." : fullName;
                    const menuItem = {
                        id: item.id,
                        label: `<span class="${CONSTANTS.MENU_ITEM_CLASS_NAME}" 
                            data-og-block-node-id="${item.id}" title="${fullName}">
                            ${trimedName}
                        </span>`,
                        current: nextNodeId === item.id,
                        icon: "icon" + item.subType.toUpperCase(),
                        click: (htmlElement, event) => {
                            const blocId = htmlElement.querySelector(".og-fake-doc-breadcrumb-menu-item-container")?.getAttribute("data-og-block-node-id");
                            event.preventDefault();
                            event.stopImmediatePropagation();
                            event.stopPropagation();
                            if (blocId) {
                                siyuan.openTab({
                                    app: getPluginInstance().app,
                                    doc: {
                                        id: blocId,
                                        action: ["cb-get-focus", "cb-get-scroll"],
                                        keepCursor: true,
                                    },
                                    afterOpen: () => {
                                        // 更新breadcrumb
                                        protyle?.breadcrumb?.render(protyle);
                                    }
                                });
                            }
                        }
                    };

                    const childItems = item.blocks || item.children;
                    if (childItems && childItems.length > 0) {
                        menuItem.type = "submenu";
                        menuItem.submenu = buildMenuItems(childItems);
                    }

                    return menuItem;
                });
            }

            // 打开菜单
            let rect = arrowElement.getBoundingClientRect();
            if (menuItems.length > 0) {
                const tempMenu = new siyuan.Menu("og-fdb-relative-menu");
                const menuItemsToAdd = buildMenuItems(menuItems);

                menuItemsToAdd.forEach(menuItem => {
                    tempMenu.addItem(menuItem);
                });

                // 菜单展示位置调整
                if (menuItems.length * 30 > (window.innerHeight - rect.bottom) * 0.7) {
                    tempMenu.open({ x: rect.right, y: rect.top, isLeft: false });
                } else {
                    tempMenu.open({ x: rect.left, y: rect.bottom, isLeft: false });
                }

                saveLastMenu(tempMenu, menuId);
            } else {
                logPush("没有可供显示的菜单项。");
                siyuan.showMessage(language["nothingToDisplay"] + "--- fakeDocBreadcrumb");
            }

        } catch (error) {
            errorPush("获取或处理大纲数据时出错:", error);
        }
    });
}



function getPluginInstance() {
    return g_pluginInstance;
}
let cacheIsMacOs;
function isMacOs() {
    let platform = window.top.siyuan.config.system.os ?? navigator.platform ?? "ERROR";
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

let lastClickTime_openRefLinkByAPI = 0;
/**
 * 基于API的打开思源块/文档
 * @param mouseEvent 鼠标点击事件，如果存在，优先使用
 * @param paramDocId 如果没有指定 event，使用此参数作为文档id
 * @param keyParam 如果没有event，使用此次数指定ctrlKey后台打开、shiftKey下方打开、altKey右侧打开
 * @param openInFocus 是否以聚焦块的方式打开（此参数有变动）
 * @param removeCurrentTab 是否移除当前Tab
 * @param autoRemoveJudgeMiliseconds 自动判断是否移除当前Tab的时间间隔（0则 不自动判断）
 * @param preventDefault {boolean} 控制是否禁止默认行为以及冒泡操作；如果在菜单中，请在调用前禁止冒泡和默认行为；另外，也可充当是否在当前聚焦窗口打开的控制（false，则在面包屑所在文档打开）
 * @returns 
 */
function openRefLinkByAPI({ mouseEvent, paramDocId = "", keyParam = {}, openInFocus = undefined, removeCurrentTab = undefined, autoRemoveJudgeMiliseconds = 0, preventDefault = false }) {
    let docId;
    if (isValidStr(paramDocId)) {
        docId = paramDocId;
    } else {
        if (mouseEvent && mouseEvent.currentTarget?.getAttribute("data-node-id")) {
            docId = mouseEvent.currentTarget?.getAttribute("data-node-id");
        } else if (mouseEvent && mouseEvent.currentTarget?.getAttribute("data-id")) {
            docId = (mouseEvent.currentTarget)?.getAttribute("data-id");
        } else if (mouseEvent && mouseEvent && mouseEvent.currentTarget?.getAttribute("data-og-doc-node-id")) {
            docId = mouseEvent.currentTarget?.getAttribute("data-og-doc-node-id");
        }
    }
    // 处理笔记本等无法跳转的情况
    if (!isValidStr(docId)) {
        debugPush("错误的id", docId)
        return;
    }
    if (isMobile()) {
        // openMobileFileById(getPluginInstance().app, docId);
        return;
    }
    logPush("Try open By id", docId);
    // 需要冒泡，否则不能在所在页签打开
    if (preventDefault) {
        mouseEvent?.preventDefault();
        mouseEvent?.stopPropagation();
    }
    debugPush("openRefLinkEventAPIF", mouseEvent);
    if (mouseEvent) {
        keyParam = {};
        keyParam["ctrlKey"] = mouseEvent.ctrlKey;
        keyParam["shiftKey"] = mouseEvent.shiftKey;
        keyParam["altKey"] = mouseEvent.altKey;
        keyParam["metaKey"] = mouseEvent.metaKey;
    }
    let positionKey = undefined;
    if (keyParam["altKey"]) {
        positionKey = "right";
    } else if (keyParam["shiftKey"]) {
        positionKey = "bottom";
    }
    if (autoRemoveJudgeMiliseconds > 0) {
        if (Date.now() - lastClickTime_openRefLinkByAPI < autoRemoveJudgeMiliseconds) {
            removeCurrentTab = true;
        }
        lastClickTime_openRefLinkByAPI = Date.now();
    }
    // 手动关闭
    const needToCloseDocId = getCurrentDocIdF(true);

    const finalParam = {
        app: getPluginInstance().app,
        doc: {
            id: docId,
            zoomIn: openInFocus,
            action: [siyuan.Constants.CB_GET_SCROLL],
        },
        position: positionKey,
        keepCursor: isEventCtrlKey(keyParam) ? true : undefined,
        removeCurrentTab: removeCurrentTab, // 目前这个选项的行为是：true，则当前页签打开；false，则根据思源设置：新页签打开
    };
    debugPush("打开文档执行参数", finalParam);
    siyuan.openTab(finalParam);
    // 后台打开页签不可移除
    if (removeCurrentTab && !isEventCtrlKey(keyParam)) {
        debugPush("插件自行移除页签");
        removeCurrentTabF(needToCloseDocId);
        removeCurrentTab = false;
    }
}

function removeCurrentTabF(docId) {
    // 获取tabId
    if (!isValidStr(docId)) {
        docId = getCurrentDocIdF(true);
    }
    if (!isValidStr(docId)) {
        debugPush("错误的id或多个匹配id");
        return;
    }
    // v3.1.11或以上
    if (siyuan?.getAllEditor) {
        const editor = siyuan.getAllEditor();
        let protyle = null;
        for (let i = 0; i < editor.length; i++) {
            if (editor[i].protyle.block.rootID === docId) {
                protyle = editor[i].protyle;
                break;
            }
        }
        if (protyle) {
            if (protyle.model.headElement) {
                if (protyle.model.headElement.classList.contains("item--pin")) {
                    debugPush("Pin页面，不关闭存在页签");
                    return;
                }
            }
            //id: string, closeAll = false, animate = true, isSaveLayout = true
            debugPush("关闭存在页签", protyle?.model?.parent?.parent, protyle.model?.parent?.id);
            protyle?.model?.parent?.parent?.removeTab(protyle.model?.parent?.id, false, false);
        } else {
            debugPush("没有找到对应的protyle，不关闭存在的页签");
            return;
        }
    } else { // v3.1.10或以下
        return;
    }

}

function isValidStr(s) {
    if (s == undefined || s == null || s === '') {
        return false;
    }
    return true;
}

let zh_CN = {
    "setting_nameMaxLength_name": "文档名最大长度",
    "setting_nameMaxLength_desp": "文档名超出的部分将被删除。设置为0则不限制。",
    "setting_docMaxNum_name": "文档最大数量",
    "setting_docMaxNum_desp": "当子文档或同级文档超过该值时，后续文档将不再显示。设置为0则不限制。",
    "setting_showAdjacentDocButton_name": "显示上一篇/下一篇按钮",
    "setting_showAdjacentDocButton_desp": "在文档面包屑右侧显示上一篇文档和下一篇文档按钮；按文件树顺序在同一层级深度的文档之间跳转。",
    "previous_doc": "上一篇文档",
    "next_doc": "下一篇文档",
    "error_initFailed": "文档面包屑插件初始化失败，如果可以，请向开发者反馈此问题",
    "setting_panel_title": "文档面包屑插件设置",
    "documentBreadcrumb": "文档路径",
    "arrow_menu": "展开子文档菜单",
}

let language = zh_CN;
/**
 * 根据设置对象数组，使用 HTMLElement 创建设置面板
 * @param {Array<object>} settingObjectArray - 设置项对象的数组。
 * @param {object} [language={}] - (可选) 语言包对象，用于国际化。
 * @returns {DocumentFragment} - 包含所有设置项 DOM 元素的文档片段。
 */
function generateSettingPanel(settingObjectArray) {
    // 使用 DocumentFragment 可以一次性将所有元素添加到 DOM，效率更高
    const fragment = document.createDocumentFragment();

    for (const oneSettingProperty of settingObjectArray) {
        // 1. 创建每个设置项的根容器
        let outterItemContainer;
        if (oneSettingProperty.type === "SWITCH") {
            outterItemContainer = document.createElement("label");
            outterItemContainer.className = "fn__flex b3-label";
        } else {
            outterItemContainer = document.createElement("div");
            outterItemContainer.className = "fn__flex b3-label config__item";
        }

        // 2. 创建左侧的标题和描述区域
        const infoDiv = document.createElement("div");
        infoDiv.className = "fn__flex-1";

        // 处理标题文本
        infoDiv.appendChild(document.createTextNode(oneSettingProperty.name));

        // 处理描述文本（支持 HTML）
        let despHTML = oneSettingProperty.desp ?? "";
        if (oneSettingProperty.name.includes("🧪")) {
            const experimentalText = language["setting_experimental"] || "（实验性功能）";
            despHTML = experimentalText + despHTML;
        }

        if (despHTML) {
            const descriptionElement = document.createElement('div');
            descriptionElement.className = 'b3-label__text';
            // 替换 <code> 为带 class 的版本以应用样式
            despHTML = despHTML.replace(/<code>/g, "<code class='fn__code'>");
            descriptionElement.innerHTML = despHTML;
            infoDiv.appendChild(descriptionElement);
        }

        outterItemContainer.appendChild(infoDiv);

        // 3. 根据类型创建右侧的交互控件
        let controlElement = null;

        switch (oneSettingProperty.type) {
            case "NUMBER": {
                controlElement = document.createElement("input");
                controlElement.className = "b3-text-field fn__flex-center fn__size200";
                controlElement.type = "number";
                const [min, max] = oneSettingProperty.limit || [null, null];
                if (min !== null) controlElement.min = min;
                if (max !== null) controlElement.max = max;
                controlElement.value = oneSettingProperty.value;
                break;
            }
            case "SELECT": {
                controlElement = document.createElement("select");
                controlElement.className = "b3-select fn__flex-center fn__size200";

                oneSettingProperty.limit.forEach(option => {
                    const optionElement = document.createElement("option");
                    optionElement.value = option.value;
                    let optionName = language[`setting_${oneSettingProperty.simpId}_option_${option.value}`] || option.value;
                    optionElement.textContent = optionName;
                    if (option.value == oneSettingProperty.value) {
                        optionElement.selected = true;
                    }
                    controlElement.appendChild(optionElement);
                });
                break;
            }
            case "TEXT": {
                controlElement = document.createElement("input");
                controlElement.className = "b3-text-field fn__flex-center fn__size200";
                controlElement.type = "text";
                controlElement.value = oneSettingProperty.value;
                break;
            }
            case "SWITCH": {
                controlElement = document.createElement("input");
                controlElement.className = "b3-switch fn__flex-center";
                controlElement.type = "checkbox";
                controlElement.checked = !!oneSettingProperty.value;
                break;
            }
            case "TEXTAREA": {
                // TEXTAREA 结构特殊，控件在左侧区域的下方
                infoDiv.appendChild(document.createElement("div")).className = "fn__hr";
                controlElement = document.createElement("textarea");
                controlElement.className = "b3-text-field fn__block";
                controlElement.value = oneSettingProperty.value;
                infoDiv.appendChild(controlElement);
                controlElement = null; // 标记为 null，防止下面重复添加
                break;
            }
            case "BUTTON": { // ✨ 新增对 BUTTON 的支持
                controlElement = document.createElement("button");
                controlElement.className = "b3-button b3-button--outline fn__flex-center fn__size200";
                controlElement.type = "button";
                // 按钮文本可由 settingObject 的 `buttonText` 属性指定
                controlElement.textContent = oneSettingProperty.buttonText || "执行操作 Click to Run";
                // 可以从 settingObject 传入一个 onClick 回调函数
                logPush("test", typeof oneSettingProperty.onClick)
                if (typeof oneSettingProperty.onClick === 'function') {
                    controlElement.addEventListener('click', oneSettingProperty.onClick);
                }
                break;
            }
            case "HINT": {
                // HINT 类型没有交互控件
                break;
            }
        }

        // 4. 如果存在交互控件，则将其添加到容器中
        if (controlElement) {
            // 为控件设置通用属性
            if (oneSettingProperty.id) controlElement.id = oneSettingProperty.id;
            if (oneSettingProperty.simpId) controlElement.name = oneSettingProperty.simpId;

            // 添加一个间隔元素
            outterItemContainer.appendChild(document.createElement("span")).className = "fn__space";
            // 将控件添加到容器
            outterItemContainer.appendChild(controlElement);
        }

        // 5. 将构建好的整个设置项添加到片段中
        fragment.appendChild(outterItemContainer);
    }

    return fragment;
}

/**
 * 由设置界面读取配置
 */
function loadUISettings(formElement) {
    let data = new FormData(formElement);
    // 扫描标准元素 input[]
    let result = {};
    for (const [key, value] of data.entries()) {
        // console.log(key, value);
        result[key] = value;
        if (value === "on") {
            result[key] = true;
        } else if (value === "null" || value == "false") {
            result[key] = "";
        }
    }
    let checkboxes = formElement.querySelectorAll('input[type="checkbox"]');
    for (let i = 0; i < checkboxes.length; i++) {
        let checkbox = checkboxes[i];
        // console.log(checkbox, checkbox.name, data[checkbox.name], checkbox.name);
        if (result[checkbox.name] == undefined) {
            result[checkbox.name] = false;
        }
    }

    let numbers = formElement.querySelectorAll("input[type='number']");
    // console.log(numbers);
    for (let number of numbers) {
        let minValue = number.getAttribute("min");
        let maxValue = number.getAttribute("max");
        let value = parseFloat(number.value);

        if (minValue !== null && value < parseFloat(minValue)) {
            number.value = minValue;
            result[number.name] = parseFloat(minValue);
        } else if (maxValue !== null && value > parseFloat(maxValue)) {
            number.value = maxValue;
            result[number.name] = parseFloat(maxValue);
        } else {
            result[number.name] = value;
        }
    }

    debugPush("UI SETTING", result);
    return result;
}

function isMobile() {
    return window.top.document.getElementById("sidebar") ? true : false;
};

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

/**
 * 比较当前内核版本是否小于输入的版本号。
 * @param version - 要比较的版本号字符串，例如 "3.1.23" 或 "3.2.1.1"
 * @returns boolean - 如果当前版本小于输入版本，则返回 true；否则（大于或等于）返回 false。
 */
function isCurrentVersionLessThan(version) {
    const parsedInputVersion = parseVersion(version);
    const parsedCurrentVersion = parseVersion(window.siyuan.config.system.kernelVersion);
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
    } else {
        return docName;
    }
}

// 兼容性utils
function isNotebookDocEnabled() {
    if (window.top.siyuan.config?.fileTree.boxDocEnabled === undefined) {
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

async function fillNotebookDocFileInfo(notebookList) {
    const promiseList = notebookList.filter(notebook => notebook.closed == false).map(async (notebook) => {
        const notebookInfo = await getNotebookInfo(notebook.id);
        if (notebookInfo != null) {
            delete notebookInfo["name"];
            Object.assign(notebook, notebookInfo)
        }
        return notebook;
    });
    const result = await Promise.all(promiseList);
    return result.filter((doc) => doc !== null);
}


module.exports = {
    default: FakeDocBreadcrumb,
};
