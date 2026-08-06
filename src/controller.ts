/**
 * 每个 Protyle 一个 InlineBreadcrumbController：
 * - 幂等 mount（同行 / 两行两种 presentation 由 mount adapter 决定）；
 * - 根节点事件代理（click / auxclick / contextmenu / wheel，AbortController 管理）；
 * - action registry（data-og-fdb-action-key → 内存 Map）；
 * - revision token 拒绝过期异步结果；
 * - 滚动位置保存与恢复；
 * - destroy 完整清理。
 */
import { saveLayout } from "siyuan";
import { CONSTANTS } from "./constants";
import { debugPush, errorPush, warnPush } from "./logger";
import { state } from "./state";
import { isNotebookDocEnabled, isValidStr } from "./utils";
import { openRefLinkAgent } from "./api";
import { buildDocumentBreadcrumbModel } from "./model";
import { renderBreadcrumbFragment, createBreadcrumbDivider } from "./render";
import { createAdjacentDocNav, clickAdjacentDocButton, removeAdjacentTooltip } from "./adjacent";
import { openHideMenu, openRelativeMenu } from "./menus";
import { addBlockBdMenuListener } from "./breadcrumbMenu";
import type { BreadcrumbModel, ControllerAction } from "./types";

/**
 * 精确获取思源原生面包屑相关节点
 * 不使用模糊的 querySelector(".protyle-breadcrumb__bar") 猜测。
 */
/**
 * 把面包屑所在分屏（wnd）置为活动窗口。
 *
 * 背景：openTab → openFile 的目标窗口由 `.layout__wnd--active`（活动窗口）决定
 * （app/src/editor/util.ts），而点击面包屑不会触发 setPanelFocus（思源只在
 * wysiwyg focusin / tab 点击 / dock 点击时更新活动窗口），因此默认情况下
 * openTab 可能把文档开进“最近激活”的另一个分屏，而非面包屑所在分屏。
 * 此函数按思源 setPanelFocus 的取参方式（protyle.model.element.parentElement.parentElement）
 * 定位 wnd，完整复刻思源 setPanelFocus（app/src/layout/util.ts）：
 * - 已激活早退：窗口已是活动窗口时不重复刷新 activetime、不重复保存布局，
 *   避免无谓地把本窗口 activetime 推到最新而掩盖真实激活顺序（activetime 偏差）；
 * - tab / dock / wnd 三组激活态先清后设（此前跳过 dock tab 状态 .dock__item--activefocus）；
 * - saveLayout：此前跳过，布局变更不落盘；
 * - activetime 采用与思源一致的写法与目标元素。
 */
function activateProtyleWnd(protyle: any) {
    const wndElement = protyle?.model?.element?.parentElement?.parentElement;
    if (!(wndElement instanceof HTMLElement) || wndElement.getAttribute("data-type") !== "wnd") {
        return;
    }
    if (wndElement.classList.contains("layout__wnd--active")) {
        return;
    }
    document.querySelectorAll(".layout__tab--active").forEach((element) => {
        element.classList.remove("layout__tab--active");
    });
    document.querySelectorAll(".dock__item--activefocus").forEach((element) => {
        element.classList.remove("dock__item--activefocus");
    });
    document.querySelectorAll(".layout__wnd--active").forEach((element) => {
        element.classList.remove("layout__wnd--active");
    });
    wndElement.classList.add("layout__wnd--active");
    // openFile 在多个匹配 tab 中优先选择 data-activetime 最大的，刷新本分屏
    // 当前 tab 的 activetime 保证“已打开文档”匹配时优先落回本分屏
    const focusTab = wndElement.querySelector(".layout-tab-bar .item--focus");
    if (focusTab instanceof HTMLElement) {
        focusTab.setAttribute("data-activetime", (new Date()).getTime().toString());
    }
    // 与思源 setPanelFocus 一致：窗口由非激活变为激活时保存布局（SDK 公开 API）
    saveLayout(() => {});
}

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
 *
 * 性能：scrollWidth 读取是强制同步布局（reflow），且压缩前 k 个文本后
 * 容器宽度随 k 单调非增，因此用二分查找最小压缩个数，把 reflow 次数
 * 从 O(n)（逐个压缩）降到 O(log n)；class 切换用增量指针只调整边界
 * 元素，避免每次迭代线性扫描。
 */
export function applyBreadcrumbEllipsis(bar: HTMLElement) {
    if (!bar.isConnected) {
        return;
    }
    const textElements = Array.from(bar.querySelectorAll(".protyle-breadcrumb__text"));
    const count = textElements.length;
    if (count <= 1) {
        return;
    }
    // 先清除旧标记：容器变宽后需重新完整显示，再按当前宽度重算
    textElements.forEach((item) => {
        item.classList.remove("protyle-breadcrumb__text--ellipsis");
    });
    // 全部展开也不溢出：无需压缩
    if (bar.scrollWidth <= bar.clientWidth) {
        return;
    }

    // 增量调整“已压缩个数”，只增删边界元素的 class
    let applied = 0;
    const setApplied = (k: number) => {
        while (applied < k) {
            textElements[applied].classList.add("protyle-breadcrumb__text--ellipsis");
            applied += 1;
        }
        while (applied > k) {
            applied -= 1;
            textElements[applied].classList.remove("protyle-breadcrumb__text--ellipsis");
        }
    };

    // 二分查找最小的压缩个数 k，使容器不再溢出；
    // 全部压缩后仍溢出则 high 停在 count，保留滚动（与旧行为一致）
    let low = 0; // 已知溢出：全部展开
    let high = count;
    while (low + 1 < high) {
        const mid = (low + high) >> 1;
        setApplied(mid);
        if (bar.scrollWidth > bar.clientWidth) {
            low = mid;
        } else {
            high = mid;
        }
    }
    setApplied(high);
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

export function restoreScrollState(element: HTMLElement, state: any, forceEnd: boolean, isCancelled?: () => boolean) {
    requestAnimationFrame(() => {
        // isCancelled：同行模式滚动容器是原生 bar（destroy 后仍 connected），
        // 仅靠 isConnected 无法拦住 destroy 后残留写入，需显式取消标志
        if (!element.isConnected || isCancelled?.()) {
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
    /** 最近一次 render 的内容带 DOM 快照：思源重写 bar 后 MO 恢复直接复用，避免全量重建 */
    cachedRoot: HTMLElement | null = null;
    /** 最近一次 render 的模型指纹（JSON 序列化）：内容未变时跳过重复重建 */
    lastFingerprint: string | null = null;
    contentObserver: MutationObserver | null = null;
    resizeObserver: ResizeObserver | null = null;
    /** destroy 后置真：拒绝排队中的异步回调（rAF 等）继续写入 DOM */
    destroyed = false;
    /** 分屏拖拽等连续尺寸变化时，ResizeObserver 以 rAF 合并为每帧最多一次重算 */
    resizeFrame = 0;
    root: HTMLElement | null = null;
    wrapper: HTMLElement | null = null;
    host: HTMLElement | null = null;
    nativeBar: HTMLElement | null = null;
    /** 同行模式：固定于 host 右侧按钮组的相邻文档导航容器 */
    adjacentNav: HTMLElement | null = null;
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
            ":scope > .og-breadcrumb-oneline-divider," +
            ":scope > .og-fdb-doc-nav"
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
                this.scheduleBreadcrumbEllipsis();
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

    /**
     * ResizeObserver 回调在 layout 之后触发，连续拖拽分屏时每帧都会触发；
     * 这里用 rAF 合并为每帧最多一次，避免同一帧内重复的强制布局。
     */
    scheduleBreadcrumbEllipsis() {
        if (this.resizeFrame !== 0 || !this.nativeBar?.isConnected) {
            return;
        }
        this.resizeFrame = requestAnimationFrame(() => {
            this.resizeFrame = 0;
            if (this.destroyed || !this.nativeBar?.isConnected) {
                return;
            }
            applyBreadcrumbEllipsis(this.nativeBar);
        });
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
            // 同行模式：整体滚动由思源 mousewheel 处理，无需插件监听。
            // passive 与思源原生一致：不 preventDefault，不劫持页面垂直滚动
            this.root?.addEventListener("wheel", this.handleWheel, { signal, passive: true });
        }
    }

    /**
     * 同行模式：相邻文档导航固定在 host 右侧按钮组（space 之后），
     * 不随 bar 内容带滚动，也不受思源重写 bar innerHTML 的影响；
     * 两行模式：nav 固定在插件容器右侧（root 之外），同样需要单独绑定。
     */
    bindNavEvents(nav: HTMLElement) {
        const signal = this.abortController.signal;
        nav.addEventListener("click", this.handleClick, { signal });
        nav.addEventListener("auxclick", this.handleAuxClick, { signal });
        nav.addEventListener("contextmenu", this.handleContextMenu, { signal });
    }

    /**
     * 同步相邻文档导航：
     * - 同行模式：重建 host 右侧按钮组中的 nav（action registry 需随内容重建）；
     * - 两行模式：nav 固定于插件容器右侧（root 之外），不随面包屑滚动，
     *   与同行模式一致始终可见。
     */
    syncAdjacentNav() {
        const adjacent = this.lastModel?.adjacent ?? null;
        // 同行模式：host 右侧按钮组；两行模式：插件容器右侧
        const parent = this.nativeBar ? this.host : this.wrapper;
        if (!parent) {
            return;
        }
        if (!adjacent) {
            this.adjacentNav?.remove();
            this.adjacentNav = null;
            return;
        }
        let nav = this.adjacentNav;
        if (!nav || !nav.isConnected) {
            nav = document.createElement("span");
            nav.className = "og-fdb-doc-nav";
            if (this.nativeBar) {
                this.host?.insertBefore(nav, this.parts.space?.nextSibling ?? null);
            } else {
                this.wrapper?.appendChild(nav);
            }
            this.adjacentNav = nav;
            this.bindNavEvents(nav);
        }
        nav.textContent = "";
        nav.appendChild(createAdjacentDocNav(adjacent, this));
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
     *
     * 性能：插件内容只取决于文档路径（与光标位置无关），每次移块重写后
     * 产物与上次完全一致，直接复用 render 时保存的 DOM 快照，
     * 跳过按钮重建、action 重注册与相邻导航重建。
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

        if (this.cachedRoot) {
            this.root = this.cachedRoot;
            this.nativeBar.insertBefore(this.root, this.nativeBar.firstElementChild);
        } else {
            this.actions.clear();
            this.root = createInlineRoot();
            if (this.lastModel) {
                this.root.appendChild(renderBreadcrumbFragment(this.lastModel.entries, this, true));
                // 同行模式：内容带末尾追加与原生内容带之间的装饰分隔箭头
                if (this.nativeBar && this.lastModel.entries.length > 0) {
                    this.root.appendChild(createBreadcrumbDivider());
                }
            }
            this.nativeBar.insertBefore(this.root, this.nativeBar.firstElementChild);
            // 相邻导航不参与 bar 重写，但需重建以同步 action registry
            this.syncAdjacentNav();
        }

        // 同行模式：空间不足时恢复思源原生省略机制
        // （原生块面包屑每次移块都会变化，省略状态必须重算）
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

        if (!target) {
            return null;
        }

        // 相邻导航（上一篇/下一篇）在两种模式下均位于 root 之外
        // （同行：host 右侧按钮组；两行：插件容器右侧）
        if (this.root?.contains(target) || this.adjacentNav?.contains(target)) {
            return target;
        }

        return null;
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

        // 默认：右键显示下层文档菜单
        this.dispatchAction({ type: "open-relative-menu", entry: action.entry }, target, event);
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

        // 与思源原生一致采用 passive 语义（原生 breadcrumb/index.ts 绑定
        // passive: true 的 mousewheel）：只驱动本容器水平滚动，不 preventDefault，
        // 垂直滚动照常传给页面，不再劫持。
        const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
            ? event.deltaX
            : event.deltaY;

        if (delta === 0) {
            return;
        }

        // deltaMode 归一化为像素：0=像素，1=行（Firefox 默认），2=页
        const factor = event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? scroller.clientWidth
                : 1;

        scroller.scrollLeft += delta * factor;
    }

    dispatchAction(action: ControllerAction, target: Element, event: Event) {
        // 在面包屑所在分屏打开：先激活所在 wnd，openTab 才能落在正确分屏。
        // 统一在入口处理，同时覆盖：路径项点击、> 子文档菜单/折叠菜单
        // （菜单项点击走 openRefLinkByAPI，无分屏上下文，依赖此处预激活）、
        // 上一篇/下一篇按钮。
        activateProtyleWnd(this.protyle);
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
                addBlockBdMenuListener(this.protyle, this.abortController.signal);
            } catch (err) {
                warnPush(err);
            }
        }
    }

    render(model: BreadcrumbModel) {
        this.lastModel = model;

        // 内容指纹未变（典型：光标移块触发的重复刷新，模型与上次完全一致）：
        // 跳过整轮 DOM 重建与省略重算；若 root 已被思源重写清掉，
        // 由 MutationObserver 恢复路径用 cachedRoot 快照兜底。
        // 指纹需并入仅影响渲染、不进模型的设置（相邻导航显示样式、文档名
        // 最大长度、图标显示方式），否则这些设置保存后指纹不变、不会触发
        // 重建，样式要等下次真实模型变化才生效。
        const fingerprint = JSON.stringify(model)
            + "|adjNavStyle=" + state.g_setting.adjacentNavStyle
            + "|nameMaxLength=" + state.g_setting.nameMaxLength
            + "|icon=" + state.g_setting.icon;
        if (fingerprint === this.lastFingerprint) {
            return;
        }
        this.lastFingerprint = fingerprint;

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

        // 重建面包屑时旧按钮移除不会触发 mouseleave，主动移除相邻导航悬浮提示
        removeAdjacentTooltip();

        this.root.textContent = "";
        this.actions.clear();

        this.root.appendChild(renderBreadcrumbFragment(model.entries, this, !!this.nativeBar));

        // 同行模式：内容带末尾追加与原生内容带之间的装饰分隔箭头
        if (this.nativeBar && model.entries.length > 0) {
            this.root.appendChild(createBreadcrumbDivider());
        }

        // 相邻文档导航：同行模式固定在右侧按钮组，两行模式跟随 root 末尾
        this.syncAdjacentNav();

        // 同行模式：空间不足时恢复思源原生省略机制
        if (this.nativeBar) {
            applyBreadcrumbEllipsis(this.nativeBar);
        }

        // 快照内容带 DOM：思源重写 bar 后 MO 恢复直接复用
        // （内容只取决于文档路径，与光标位置无关）
        this.cachedRoot = this.root.cloneNode(true) as HTMLElement;

        // 首次渲染或文档切换：滚到最右端；同文档刷新：保留原位置
        restoreScrollState(scroller as HTMLElement, scrollState, forceEnd, () => this.destroyed);
    }

    destroy() {
        this.revision += 1;
        // 拒绝排队中的 rAF（restoreScrollState）在 destroy 后继续写入原生 bar
        this.destroyed = true;
        if (this.resizeFrame !== 0) {
            cancelAnimationFrame(this.resizeFrame);
            this.resizeFrame = 0;
        }
        this.contentObserver?.disconnect();
        this.resizeObserver?.disconnect();
        this.abortController.abort();
        this.actions.clear();

        this.root?.remove();
        this.wrapper?.remove();
        this.adjacentNav?.remove();
        this.cachedRoot = null;
        this.lastFingerprint = null;

        if (this.host?.isConnected) {
            this.host.classList.remove(CONSTANTS.HOST_STATE_CLASS_NAME);
        }

        // 原生 bar 上的大纲菜单监听器已随 abortController 移除，同步清除防重复绑定标记，
        // 否则插件重载/重新挂载后新 controller 因标记残留而不再绑定监听器
        const breadcrumbBar = this.protyle?.breadcrumb?.element;
        if (breadcrumbBar instanceof HTMLElement) {
            delete breadcrumbBar.dataset["ogFdbAddedEl"];
        }

        this.root = null;
        this.wrapper = null;
        this.host = null;
        this.nativeBar = null;
        this.adjacentNav = null;
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
