/**
 * 每个 Protyle 一个 InlineBreadcrumbController：
 * - 幂等 mount（同行 / 两行两种 presentation 由 mount adapter 决定）；
 * - 根节点事件代理（click / auxclick / contextmenu / wheel，AbortController 管理）；
 * - action registry（data-og-fdb-action-key → 内存 Map）；
 * - revision token 拒绝过期异步结果；
 * - 滚动位置保存与恢复；
 * - destroy 完整清理。
 */
import { CONSTANTS } from "./constants";
import { debugPush, errorPush, warnPush } from "./logger";
import { state } from "./state";
import { isNotebookDocEnabled, isValidStr } from "./utils";
import { openRefLinkAgent } from "./api";
import { buildDocumentBreadcrumbModel } from "./model";
import { renderBreadcrumbFragment, createBreadcrumbDivider } from "./render";
import { createAdjacentDocNav, clickAdjacentDocButton } from "./adjacent";
import { openHideMenu, openRelativeMenu } from "./menus";
import { addBlockBdMenuListener } from "./breadcrumbMenu";
import type { BreadcrumbModel, ControllerAction } from "./types";

/**
 * 精确获取思源原生面包屑相关节点
 * 不使用模糊的 querySelector(".protyle-breadcrumb__bar") 猜测。
 */
export function getNativeBreadcrumbParts(protyle: any) {
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

export function createInlineRoot() {
    const root = document.createElement("div");

    root.className = CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME;
    root.contentEditable = "false";
    root.setAttribute("role", "navigation");
    root.setAttribute("aria-label", state.language["documentBreadcrumb"] ?? "文档路径");

    return root;
}

/**
 * 同行模式超长省略（模拟思源原生 improveBreadcrumbAppearance）：
 * 原生逻辑是内容换行（scrollHeight > 30）时从前往后逐个给文本加
 * --ellipsis class（max-width: 112px 省略号截断）；同行模式为 nowrap
 * 永不换行，原生逻辑不会触发，这里改用横向溢出（scrollWidth > clientWidth）
 * 判断，同样逐个压缩文本，直到不再溢出；全部压缩后仍放不下则保留滚动。
 */
export function applyBreadcrumbEllipsis(bar: HTMLElement) {
    if (!bar.isConnected) {
        return;
    }
    const textElements = Array.from(bar.querySelectorAll(".protyle-breadcrumb__text"));
    if (textElements.length <= 1) {
        return;
    }
    // 先清除旧标记：容器变宽后需重新完整显示，再按当前宽度重算
    textElements.forEach((item) => {
        item.classList.remove("protyle-breadcrumb__text--ellipsis");
    });
    while (bar.scrollWidth > bar.clientWidth) {
        const target = textElements.find((item) => !item.classList.contains("protyle-breadcrumb__text--ellipsis"));
        if (!target) {
            break;
        }
        target.classList.add("protyle-breadcrumb__text--ellipsis");
    }
}

/**
 * 滚动位置捕获与恢复
 */
export function captureScrollState(element: HTMLElement) {
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);

    return {
        scrollLeft: element.scrollLeft,
        wasAtEnd: maxScrollLeft - element.scrollLeft <= 8
    };
}

export function restoreScrollState(element: HTMLElement, state: any, forceEnd: boolean) {
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

export class InlineBreadcrumbController {
    protyle: any;
    revision = 0;
    documentId = "";
    lastRenderedDocId = "";
    lastModel: BreadcrumbModel | null = null;
    contentObserver: MutationObserver | null = null;
    resizeObserver: ResizeObserver | null = null;
    root: HTMLElement | null = null;
    wrapper: HTMLElement | null = null;
    host: HTMLElement | null = null;
    nativeBar: HTMLElement | null = null;
    parts: any = null;
    abortController: AbortController;
    actions: Map<string, ControllerAction>;
    actionSequence: number;

    constructor(protyle: any) {
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
        ).forEach((element: HTMLElement) => element.remove());

        const parts = getNativeBreadcrumbParts(this.protyle);
        if (!parts) {
            return false;
        }
        this.parts = parts;

        // 泛型限定元素为 HTMLElement：插件渲染的容器均为 HTMLElement，
        // 与下方 forEach 回调参数类型保持一致（querySelectorAll 默认返回 NodeListOf<Element>）
        parts.host.querySelectorAll<HTMLElement>(
            `:scope > .${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME},` +
            `:scope > .${CONSTANTS.CONTAINER_CLASS_NAME},` +
            ":scope > .og-breadcrumb-oneline-divider"
        ).forEach((element: HTMLElement) => element.remove());

        const isCardPage = this.protyle.element.classList.contains("card__block");
        if (state.g_setting.oneLineBreadcrumb && !isCardPage) {
            // 同行模式：插件内容容器是原生 bar 的第一个 flex 子项，
            // bar 成为唯一滚动容器，形成连续内容带；
            // 思源 render 重写 innerHTML 时由 MutationObserver 恢复。
            this.host = parts.host;
            this.nativeBar = parts.nativeBar;
            this.host.classList.add(CONSTANTS.HOST_STATE_CLASS_NAME);
            parts.nativeBar.querySelectorAll<HTMLElement>(`:scope > .${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}`)
                .forEach((element: HTMLElement) => element.remove());
            this.root = createInlineRoot();
            parts.nativeBar.insertBefore(this.root, parts.nativeBar.firstElementChild);
            this.startContentRestore();
            // 容器宽度变化（窗口缩放、侧栏开关、分屏拖拽）时重算省略
            this.resizeObserver = new ResizeObserver(() => {
                if (!this.nativeBar?.isConnected) {
                    return;
                }
                applyBreadcrumbEllipsis(this.nativeBar);
            });
            this.resizeObserver.observe(this.host);
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

        if (!eventTarget) {
            return;
        }

        eventTarget.addEventListener("click", this.handleClick, { signal });
        eventTarget.addEventListener("auxclick", this.handleAuxClick, { signal });
        eventTarget.addEventListener("contextmenu", this.handleContextMenu, { signal });

        if (!this.nativeBar) {
            // 两行模式：插件根节点自身滚动，处理滚轮；
            // 同行模式：整体滚动由思源 mousewheel 处理，无需插件监听
            this.root?.addEventListener("wheel", this.handleWheel, { signal, passive: false });
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
            this.root.appendChild(renderBreadcrumbFragment(this.lastModel.entries, this));
            if (this.lastModel.adjacent) {
                this.root.appendChild(createAdjacentDocNav(this.lastModel.adjacent, this));
            }
            // 同行模式：内容带末尾追加与原生内容带之间的装饰分隔箭头
            if (this.nativeBar && this.lastModel.entries.length > 0) {
                this.root.appendChild(createBreadcrumbDivider());
            }
        }
        this.nativeBar.insertBefore(this.root, this.nativeBar.firstElementChild);

        // 同行模式：空间不足时恢复思源原生省略机制（先压缩再计算宽度补偿）
        if (this.nativeBar) {
            applyBreadcrumbEllipsis(this.nativeBar);
        }

        // 内容带前段重新插入插件内容后，把滚动位置向后推相应宽度，
        // 保持用户当前看到的块位置不变
        const widthDelta = this.nativeBar.scrollWidth - oldScrollWidth;
        if (widthDelta > 0) {
            this.nativeBar.scrollLeft = oldScrollLeft + widthDelta;
        }
    }

    registerAction(payload: ControllerAction) {
        const key = String(++this.actionSequence);
        this.actions.set(key, payload);
        return key;
    }

    getActionTarget(event: Event) {
        if (!(event.target instanceof Element)) {
            return null;
        }

        const target = event.target.closest("[data-og-fdb-action-key]");

        if (!target || !this.root?.contains(target)) {
            return null;
        }

        return target;
    }

    handleClick(event: Event) {
        // 事件代理绑定在原生 bar 上（同行模式），bar 内包含原生块面包屑：
        // 只有命中插件 action 时才阻止冒泡，避免拦截原生 item 的 zoomOut。
        const target = this.getActionTarget(event);
        if (!target) {
            return;
        }

        event.stopPropagation();

        if ((event as MouseEvent).button !== 0) {
            return;
        }

        const action = this.actions.get((target as HTMLElement).dataset.ogFdbActionKey as string);
        if (!action) {
            return;
        }

        event.preventDefault();

        if (action.type === "open-document" && state.g_setting.swapClickFunction) {
            // 交换左右键功能：左键显示下层文档菜单
            this.dispatchAction({ type: "open-relative-menu", entry: action.entry }, target, event);
            return;
        }

        this.dispatchAction(action, target, event);
    }

    handleAuxClick(event: Event) {
        const target = this.getActionTarget(event);
        if (!target) {
            return;
        }

        event.stopPropagation();

        // 只处理右键
        if ((event as MouseEvent).button !== 2) {
            return;
        }

        const action = this.actions.get((target as HTMLElement).dataset.ogFdbActionKey as string);
        if (!action || action.type !== "open-document") {
            return;
        }

        event.preventDefault();

        if (state.g_setting.swapClickFunction) {
            // 交换左右键功能：右键打开文档
            this.dispatchAction(action, target, event);
        } else {
            // 默认：右键显示下层文档菜单
            this.dispatchAction({ type: "open-relative-menu", entry: action.entry }, target, event);
        }
    }

    handleContextMenu(event: Event) {
        const target = this.getActionTarget(event);
        if (!target) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
    }

    handleWheel(event: WheelEvent) {
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

    dispatchAction(action: ControllerAction, target: Element, event: Event) {
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
                const entry = action.entry;
                openRelativeMenu({
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
                clickAdjacentDocButton(event, action.docId);
                break;
            }
        }
    }

    /**
     * 开始一次异步刷新，返回 ticket；commit 前必须用 canCommit 校验。
     */
    beginUpdate(documentId: string) {
        this.documentId = documentId;
        this.revision += 1;

        return {
            revision: this.revision,
            documentId
        };
    }

    canCommit(ticket: any) {
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

    render(model: BreadcrumbModel) {
        this.lastModel = model;

        // 同行模式：整体滚动容器是原生 bar；两行模式：插件根节点
        const scroller = this.nativeBar ?? this.root;
        const scrollState = captureScrollState(scroller as HTMLElement);
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

        this.root.appendChild(renderBreadcrumbFragment(model.entries, this));

        if (model.adjacent) {
            this.root.appendChild(createAdjacentDocNav(model.adjacent, this));
        }

        // 同行模式：内容带末尾追加与原生内容带之间的装饰分隔箭头
        if (this.nativeBar && model.entries.length > 0) {
            this.root.appendChild(createBreadcrumbDivider());
        }

        // 同行模式：空间不足时恢复思源原生省略机制
        if (this.nativeBar) {
            applyBreadcrumbEllipsis(this.nativeBar);
        }

        // 首次渲染或文档切换：滚到最右端；同文档刷新：保留原位置
        restoreScrollState(scroller as HTMLElement, scrollState, forceEnd);
    }

    destroy() {
        this.revision += 1;
        this.contentObserver?.disconnect();
        this.resizeObserver?.disconnect();
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
let controllerByProtyle = new WeakMap<any, any>();
const activeControllers = new Set<any>();

export const inlineControllerRegistry = {
    ensure(protyle: any) {
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
    destroy(protyle: any) {
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

export function destroyAllControllers() {
    inlineControllerRegistry.destroyAll();
}
