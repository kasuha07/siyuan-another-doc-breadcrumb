"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inlineControllerRegistry = exports.InlineBreadcrumbController = void 0;
exports.getNativeBreadcrumbParts = getNativeBreadcrumbParts;
exports.createInlineRoot = createInlineRoot;
exports.captureScrollState = captureScrollState;
exports.restoreScrollState = restoreScrollState;
exports.destroyAllControllers = destroyAllControllers;
/**
 * 每个 Protyle 一个 InlineBreadcrumbController：
 * - 幂等 mount（同行 / 两行两种 presentation 由 mount adapter 决定）；
 * - 根节点事件代理（click / auxclick / contextmenu / wheel，AbortController 管理）；
 * - action registry（data-og-fdb-action-key → 内存 Map）；
 * - revision token 拒绝过期异步结果；
 * - 滚动位置保存与恢复；
 * - destroy 完整清理。
 */
const constants_1 = require("./constants");
const logger_1 = require("./logger");
const state_1 = require("./state");
const utils_1 = require("./utils");
const api_1 = require("./api");
const model_1 = require("./model");
const render_1 = require("./render");
const adjacent_1 = require("./adjacent");
const menus_1 = require("./menus");
const breadcrumbMenu_1 = require("./breadcrumbMenu");
/**
 * 精确获取思源原生面包屑相关节点
 * 不使用模糊的 querySelector(".protyle-breadcrumb__bar") 猜测。
 */
function getNativeBreadcrumbParts(protyle) {
    var _a;
    const nativeBar = (_a = protyle === null || protyle === void 0 ? void 0 : protyle.breadcrumb) === null || _a === void 0 ? void 0 : _a.element;
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
    var _a;
    const root = document.createElement("div");
    root.className = constants_1.CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME;
    root.contentEditable = "false";
    root.setAttribute("role", "navigation");
    root.setAttribute("aria-label", (_a = state_1.state.language["documentBreadcrumb"]) !== null && _a !== void 0 ? _a : "文档路径");
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
class InlineBreadcrumbController {
    constructor(protyle) {
        this.revision = 0;
        this.documentId = "";
        this.lastRenderedDocId = "";
        this.lastModel = null;
        this.contentObserver = null;
        this.root = null;
        this.wrapper = null;
        this.host = null;
        this.nativeBar = null;
        this.parts = null;
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
        this.protyle.element.querySelectorAll(`:scope > .${constants_1.CONSTANTS.CONTAINER_CLASS_NAME},` +
            ":scope > .og-breadcrumb-oneline-divider").forEach((element) => element.remove());
        const parts = getNativeBreadcrumbParts(this.protyle);
        if (!parts) {
            return false;
        }
        this.parts = parts;
        parts.host.querySelectorAll(`:scope > .${constants_1.CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME},` +
            `:scope > .${constants_1.CONSTANTS.CONTAINER_CLASS_NAME},` +
            ":scope > .og-breadcrumb-oneline-divider").forEach((element) => element.remove());
        const isCardPage = this.protyle.element.classList.contains("card__block");
        if (state_1.state.g_setting.oneLineBreadcrumb && !isCardPage) {
            // 同行模式：插件内容容器是原生 bar 的第一个 flex 子项，
            // bar 成为唯一滚动容器，形成连续内容带；
            // 思源 render 重写 innerHTML 时由 MutationObserver 恢复。
            this.host = parts.host;
            this.nativeBar = parts.nativeBar;
            this.host.classList.add(constants_1.CONSTANTS.HOST_STATE_CLASS_NAME);
            parts.nativeBar.querySelectorAll(`:scope > .${constants_1.CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}`)
                .forEach((element) => element.remove());
            this.root = createInlineRoot();
            parts.nativeBar.insertBefore(this.root, parts.nativeBar.firstElementChild);
            this.startContentRestore();
        }
        else {
            // 两行模式：插件容器是原生 host 前一个独立 .protyle-breadcrumb
            this.wrapper = document.createElement("div");
            this.wrapper.className = `${constants_1.CONSTANTS.CONTAINER_CLASS_NAME} protyle-breadcrumb`;
            this.root = createInlineRoot();
            this.wrapper.appendChild(this.root);
            parts.host.before(this.wrapper);
        }
        this.bindEvents();
        return true;
    }
    bindEvents() {
        var _a;
        var _b;
        const signal = this.abortController.signal;
        // 同行模式：事件代理绑定在原生 bar 上（bar 元素不被 innerHTML 重写）；
        // 两行模式：绑定在插件根节点（滚动容器）上。
        const eventTarget = (_b = this.nativeBar) !== null && _b !== void 0 ? _b : this.root;
        if (!eventTarget) {
            return;
        }
        eventTarget.addEventListener("click", this.handleClick, { signal });
        eventTarget.addEventListener("auxclick", this.handleAuxClick, { signal });
        eventTarget.addEventListener("contextmenu", this.handleContextMenu, { signal });
        if (!this.nativeBar) {
            // 两行模式：插件根节点自身滚动，处理滚轮；
            // 同行模式：整体滚动由思源 mousewheel 处理，无需插件监听
            (_a = this.root) === null || _a === void 0 ? void 0 : _a.addEventListener("wheel", this.handleWheel, { signal, passive: false });
        }
    }
    /**
     * 思源每次异步渲染块面包屑都会执行 `this.element.innerHTML = html`，
     * 这会清除插件插入 bar 内的内容容器。
     * MutationObserver 只用于内容恢复，不参与布局计算。
     */
    startContentRestore() {
        if (!this.nativeBar) {
            return;
        }
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
            this.root.appendChild((0, render_1.renderBreadcrumbFragment)(this.lastModel.entries, this));
            if (this.lastModel.adjacent) {
                this.root.appendChild((0, adjacent_1.createAdjacentDocNav)(this.lastModel.adjacent, this));
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
        var _a;
        if (!(event.target instanceof Element)) {
            return null;
        }
        const target = event.target.closest("[data-og-fdb-action-key]");
        if (!target || !((_a = this.root) === null || _a === void 0 ? void 0 : _a.contains(target))) {
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
        if (action.type === "open-document" && state_1.state.g_setting.swapClickFunction) {
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
        if (state_1.state.g_setting.swapClickFunction) {
            // 交换左右键功能：右键打开文档
            this.dispatchAction(action, target, event);
        }
        else {
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
                if (entry.kind === "notebook" && !(0, utils_1.isNotebookDocEnabled)()) {
                    return;
                }
                if (entry.kind === "root") {
                    return;
                }
                (0, api_1.openRefLinkAgent)(event, entry.id);
                break;
            }
            case "open-collapsed-menu": {
                (0, menus_1.openHideMenu)({
                    anchorElement: target,
                    hiddenEntries: action.entry.hiddenEntries
                }, event);
                break;
            }
            case "open-relative-menu": {
                const entry = action.entry;
                (0, menus_1.openRelativeMenu)({
                    protyle: this.protyle,
                    anchorElement: target,
                    parentId: entry.id,
                    nextId: entry.nextId,
                    path: entry.path,
                    box: entry.box,
                    kind: entry.kind
                }, event);
                break;
            }
            case "open-adjacent": {
                (0, adjacent_1.clickAdjacentDocButton)(event, action.docId);
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
        if (!(0, utils_1.isValidStr)(documentId)) {
            return;
        }
        const ticket = this.beginUpdate(documentId);
        try {
            const model = await (0, model_1.buildDocumentBreadcrumbModel)(this.protyle, documentId);
            if (!model || !this.canCommit(ticket)) {
                return;
            }
            this.render(model);
        }
        catch (err) {
            (0, logger_1.warnPush)(err);
            (0, logger_1.errorPush)(err);
        }
        finally {
            // 原生块面包屑箭头的大纲菜单绑定（原生 render 后 dataset 丢失，需重复绑定）
            try {
                (0, breadcrumbMenu_1.addBlockBdMenuListener)(this.protyle);
            }
            catch (err) {
                (0, logger_1.warnPush)(err);
            }
        }
    }
    render(model) {
        var _a;
        this.lastModel = model;
        // 同行模式：整体滚动容器是原生 bar；两行模式：插件根节点
        const scroller = (_a = this.nativeBar) !== null && _a !== void 0 ? _a : this.root;
        const scrollState = captureScrollState(scroller);
        const forceEnd = this.lastRenderedDocId !== model.documentId;
        this.lastRenderedDocId = model.documentId;
        // 同行模式：原生 render 可能已清掉插件容器，确保 root 在位
        if (this.nativeBar && this.root && !this.nativeBar.contains(this.root)) {
            this.root = createInlineRoot();
            this.nativeBar.insertBefore(this.root, this.nativeBar.firstElementChild);
        }
        if (!this.root) {
            return;
        }
        this.root.textContent = "";
        this.actions.clear();
        this.root.appendChild((0, render_1.renderBreadcrumbFragment)(model.entries, this));
        if (model.adjacent) {
            this.root.appendChild((0, adjacent_1.createAdjacentDocNav)(model.adjacent, this));
        }
        // 首次渲染或文档切换：滚到最右端；同文档刷新：保留原位置
        restoreScrollState(scroller, scrollState, forceEnd);
    }
    destroy() {
        var _a, _b, _c, _d;
        this.revision += 1;
        (_a = this.contentObserver) === null || _a === void 0 ? void 0 : _a.disconnect();
        this.abortController.abort();
        this.actions.clear();
        (_b = this.root) === null || _b === void 0 ? void 0 : _b.remove();
        (_c = this.wrapper) === null || _c === void 0 ? void 0 : _c.remove();
        if ((_d = this.host) === null || _d === void 0 ? void 0 : _d.isConnected) {
            this.host.classList.remove(constants_1.CONSTANTS.HOST_STATE_CLASS_NAME);
        }
        this.root = null;
        this.wrapper = null;
        this.host = null;
        this.nativeBar = null;
        this.parts = null;
    }
}
exports.InlineBreadcrumbController = InlineBreadcrumbController;
/**
 * controller registry：WeakMap 用于查找，Set 用于遍历清理
 */
let controllerByProtyle = new WeakMap();
const activeControllers = new Set();
exports.inlineControllerRegistry = {
    ensure(protyle) {
        var _a, _b;
        const existed = controllerByProtyle.get(protyle);
        if (existed && (((_a = existed.root) === null || _a === void 0 ? void 0 : _a.isConnected) || ((_b = existed.wrapper) === null || _b === void 0 ? void 0 : _b.isConnected))) {
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
    exports.inlineControllerRegistry.destroyAll();
}
