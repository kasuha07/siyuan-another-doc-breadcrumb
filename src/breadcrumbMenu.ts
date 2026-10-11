/**
 * 原生块面包屑的“>”箭头：可选标题大纲，两行独立文档箭头补齐全部子块菜单
 * 通过 protyle.breadcrumb.element 精确定位原生 bar（不使用模糊 querySelector）。
 * 原生每次 render 都会重写 bar 的 innerHTML，dataset 丢失后此处会重新绑定。
 */
import { Menu, openTab } from "siyuan";
import { CONSTANTS } from "./constants";
import { logPush, errorPush } from "./logger";
import { state } from "./state";
import { getBlockBreadcrumbChildren, getDocOutline } from "./api";
import { decodeHtmlEntities, escapeHTML, getPluginInstance, stripHTML } from "./utils";
import { guardMenuOpen, menuCloseCB, saveLastMenu } from "./menus";
import type { LazyMenuItem } from "./types";

/**
 * 单次 DFS 遍历 getDocOutline 响应，建立“节点 id → 直接子标题数组”索引：
 * 后续按 id 查找子标题 O(1)，替代原先每次点击对整棵标题树递归探测字段。
 *
 * 响应结构（kernel/model/outline.go，v3.8.6）为顶级标题的 Path 数组，
 * 直接子标题的存放字段因节点类型而异：
 * - 顶层 Path 节点：blocks（kernel Path.Blocks，[]*Block，json:"blocks,omitempty"）；
 * - 嵌套 Block 节点（标题）：children（kernel Block.Children，[]*Block，json 恒序列化）。
 * 两字段名均未在 API 文档中声明，但思源前端自身（app/src/util/Tree.ts genHTML/
 * genBlockHTML）按同一契约解析；此处仅在建立索引时探测一次，查找与菜单构建均经
 * 索引取值，不再触碰字段。若升级后结构调整，只需修改本函数。
 */
function buildHeadingChildrenIndex(outlineData: any[]): Map<string, any[]> {
    const index = new Map<string, any[]>();
    const visit = (node: any) => {
        if (!node || typeof node.id !== "string") {
            return;
        }
        const children = node.blocks || node.children || [];
        index.set(node.id, children);
        for (const child of children) {
            visit(child);
        }
    };
    for (const item of outlineData) {
        visit(item);
    }
    return index;
}

const NATIVE_CHILDREN_MENU_PREFIX = "breadcrumb-children-";
const nativeArrowClickBypass = new WeakSet<HTMLElement>();

function openNativeArrowMenu(arrowElement: HTMLElement) {
    if (!arrowElement.isConnected) {
        return;
    }
    // 插件监听器位于原生 Breadcrumb 监听器之前；回退时重新触发一次点击，
    // 让原生监听器继续执行，同时避免本监听器再次拦截。
    nativeArrowClickBypass.add(arrowElement);
    arrowElement.click();
}

function getClosestHTMLElement(target: EventTarget | null, selector: string) {
    if (!(target instanceof Element)) {
        return null;
    }
    const element = target.closest(selector);
    return element instanceof HTMLElement ? element : null;
}

function isNativeBreadcrumbJumpEnabled() {
    return state.g_setting.nativeBreadcrumbJump === true;
}

function getNativeBreadcrumbItem(target: EventTarget | null, breadcrumbBar: HTMLElement) {
    const item = getClosestHTMLElement(target, ".protyle-breadcrumb__item");
    if (!item || !breadcrumbBar.contains(item)) {
        return null;
    }
    // 同行模式中插件当前文档项也复用了原生 class，但它仍由插件自己的
    // 文档导航处理，不能被“原生块面包屑”开关劫持。
    if (item.closest(`.${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}`)) {
        return null;
    }
    return item;
}

function getNativeChildrenMenuInfo(target: EventTarget | null) {
    const item = getClosestHTMLElement(target, ".b3-menu__item");
    const menu = item?.closest("#commonMenu");
    if (!(item && menu instanceof HTMLElement)) {
        return null;
    }
    const menuName = menu.getAttribute("data-name") ?? "";
    if (!menuName.startsWith(NATIVE_CHILDREN_MENU_PREFIX)) {
        return null;
    }
    return {
        item,
        parentId: menuName.substring(NATIVE_CHILDREN_MENU_PREFIX.length),
    };
}

function isNativeChildrenMenuForProtyle(menuParentId: string, protyle: any) {
    const breadcrumbBar = protyle?.breadcrumb?.element;
    if (!(breadcrumbBar instanceof HTMLElement) || !menuParentId) {
        return false;
    }
    return Array.from(breadcrumbBar.querySelectorAll<HTMLElement>(".protyle-breadcrumb__item"))
        .some(item => item.dataset.nodeId === menuParentId);
}

function findLoadedBlock(protyle: any, blockId: string) {
    const wysiwyg = protyle?.wysiwyg?.element;
    if (!(wysiwyg instanceof HTMLElement)) {
        return null;
    }
    return Array.from(wysiwyg.querySelectorAll<HTMLElement>("[data-node-id]"))
        .find(element => element.dataset.nodeId === blockId && element.clientHeight > 0) ?? null;
}

/**
 * 执行原生块面包屑的“跳转”或“聚焦”。
 *
 * 跳转优先对已加载块直接滚动，避免 openTab 在同一已打开文档中只切换页签
 * 而不重新滚动；未加载块再交给思源的 cb-get-scroll 处理。聚焦路径使用
 * cb-get-focus + cb-get-scroll，与插件原有大纲菜单行为一致。
 */
function openNativeBreadcrumbTarget(protyle: any, blockId: string, focus: boolean) {
    if (!blockId) {
        return;
    }
    if (!focus) {
        const loadedBlock = findLoadedBlock(protyle, blockId);
        if (loadedBlock) {
            loadedBlock.scrollIntoView({block: "center", inline: "nearest"});
            return;
        }
    }
    openTab({
        app: getPluginInstance().app,
        doc: {
            id: blockId,
            action: focus ? ["cb-get-focus", "cb-get-scroll"] : ["cb-get-scroll"],
        } as any,
        afterOpen: () => {
            protyle?.breadcrumb?.render?.(protyle);
        },
    });
}

function closeCommonMenu() {
    (window.siyuan?.menus?.menu as any)?.remove?.();
}

/** 原生 getIconByType 未向插件导出，仅映射块导航需要的图标。 */
function getBlockMenuIcon(type: string, subType?: string) {
    if (type === "NodeHeading") {
        return subType && /^h[1-6]$/i.test(subType) ? "icon" + subType.toUpperCase() : "iconHeadings";
    }
    if (type === "NodeList") {
        return subType === "t" ? "iconCheck" : subType === "o" ? "iconOrderedList" : "iconList";
    }
    const icons: { [type: string]: string } = {
        NodeDocument: "iconFile", NodeParagraph: "iconParagraph", NodeThematicBreak: "iconLine",
        NodeBlockquote: "iconQuote", NodeCallout: "iconCallout", NodeTabs: "iconTabs", NodeTabItem: "iconTabItem",
        NodeListItem: "iconListItem", NodeMindmapItem: "iconListItem", NodeMindmap: "iconMindmap",
        NodeCodeBlock: "iconCode", NodeYamlFrontMatter: "iconCode", NodeTable: "iconTable",
        NodeBlockQueryEmbed: "iconSQL", NodeSuperBlock: "iconSuper", NodeMathBlock: "iconMath",
        NodeHTMLBlock: "iconHTML5", NodeWidget: "iconBoth", NodeCustomBlock: "iconPlugin",
        NodeIFrame: "iconGlobe", NodeVideo: "iconVideo", NodeAudio: "iconRecord", NodeAttributeView: "iconDatabase",
    };
    return icons[type] ?? "iconParagraph";
}

/** 包含 bar 中的当前路径，以及当前块在已加载编辑器 DOM 中的祖先。 */
function getCurrentBlockPathIDs(protyle: any, breadcrumbBar: HTMLElement, rootID: string) {
    const ids = new Set<string>([rootID]);
    breadcrumbBar.querySelectorAll<HTMLElement>(".protyle-breadcrumb__item[data-node-id]").forEach(item => {
        ids.add(item.dataset.nodeId!);
    });
    const currentID = protyle.breadcrumb?.id;
    const wysiwyg = protyle.wysiwyg?.element as HTMLElement | undefined;
    let block = currentID && wysiwyg
        ? Array.from(wysiwyg.querySelectorAll<HTMLElement>("[data-node-id]")).find(item => item.dataset.nodeId === currentID)
        : undefined;
    while (block && wysiwyg?.contains(block)) {
        ids.add(block.dataset.nodeId!);
        block = block.parentElement?.closest<HTMLElement>("[data-node-id]") ?? undefined;
    }
    return ids;
}

/**
 * 两行模式移除了原生文档首项，独立箭头无法由原生 click 识别。
 * 用同一子块接口与原生 loadSubmenu 补齐导航，不恢复重复文档项。
 */
async function openStandaloneDocumentChildrenMenu(protyle: any, arrow: HTMLElement, breadcrumbBar: HTMLElement, signal: AbortSignal) {
    const rootID = protyle.block.rootID;
    if (signal.aborted || !arrow.isConnected || !rootID) {
        return;
    }
    const menuId = "bid_" + rootID;
    if (!guardMenuOpen(menuId)) {
        return;
    }
    // 用对象身份区分同一文档菜单的两次打开，防止旧请求覆盖后来同名菜单。
    let owner = { menu: null as Menu | null, id: menuId };
    state.g_relativeMenu = owner;
    const isActive = () => !signal.aborted && arrow.isConnected
        && protyle.block.rootID === rootID && state.g_relativeMenu === owner;
    const cleanup = () => {
        breadcrumbBar.ownerDocument.removeEventListener("mousedown", onOutsideMousedown, true);
        signal.removeEventListener("abort", cleanup);
        if (state.g_relativeMenu === owner && owner.menu === null) {
            state.g_relativeMenu = null;
        }
    };
    const onOutsideMousedown = (event: MouseEvent) => {
        if (!(event.target instanceof Node) || !arrow.contains(event.target)) {
            cleanup();
        }
    };
    breadcrumbBar.ownerDocument.addEventListener("mousedown", onOutsideMousedown, { capture: true, signal });
    signal.addEventListener("abort", cleanup, { once: true });
    const currentPathIDs = getCurrentBlockPathIDs(protyle, breadcrumbBar, rootID);
    const excludeTypes = protyle.element?.classList.contains("card__block") ? ["NodeTextMark-mark"] : [];
    const rect = arrow.getBoundingClientRect();
    const position = { x: rect.left, y: rect.bottom, isLeft: false };
    let menu: Menu;

    const buildItems = async (id: string, offset = 0): Promise<LazyMenuItem[]> => {
        if (!isActive()) {
            return [];
        }
        const data = await getBlockBreadcrumbChildren({ id, offset, limit: 64, excludeTypes, notebook: protyle.notebookId });
        if (!isActive()) {
            return [];
        }
        const items: LazyMenuItem[] = data.items.map(item => {
            const menuItem: LazyMenuItem = {
                id: item.id,
                icon: getBlockMenuIcon(item.type, item.subType),
                // 内核已对 name 做实体转义；先解码再转义，既不双重转义，也不信任 HTML。
                label: escapeHTML(decodeHtmlEntities(item.name)),
                current: currentPathIDs.has(item.id),
                click: () => {
                    if (isActive()) {
                        openNativeBreadcrumbTarget(protyle, item.id, !isNativeBreadcrumbJumpEnabled());
                    }
                },
            };
            if (item.hasChildren) {
                menuItem.loadSubmenu = () => buildItems(item.id);
            }
            return menuItem;
        });
        if (data.hasMore && data.items.length > 0) {
            items.push({
                icon: "iconMore",
                label: escapeHTML(window.siyuan.languages!.loadMore),
                click: element => {
                    if (!isActive() || !element.isConnected || element.hasAttribute("disabled")) {
                        return true;
                    }
                    element.setAttribute("disabled", "disabled");
                    buildItems(id, offset + data.items.length).then(nextItems => {
                        if (!isActive() || !element.isConnected) {
                            return;
                        }
                        // SDK addItem 返回原生 MenuItem 元素：创建后移到当前层的
                        // “加载更多”前，兼容首层与懒加载子层，无需手工拼 DOM。
                        let firstNext: HTMLElement | undefined;
                        nextItems.forEach(item => {
                            const nextElement = menu.addItem(item);
                            firstNext ??= nextElement;
                            element.before(nextElement);
                        });
                        const moveCurrent = element.classList.contains("b3-menu__item--current");
                        const submenu = element.closest<HTMLElement>(".b3-menu__submenu");
                        element.remove();
                        if (moveCurrent && firstNext) {
                            firstNext.classList.add("b3-menu__item--current");
                            firstNext.scrollIntoView({ block: "nearest" });
                        }
                        // 使用 SDK 公开接口按新增内容重算所在层的位置。
                        if (submenu) {
                            menu.showSubMenu(submenu);
                        } else {
                            menu.open(position);
                        }
                    }).catch(error => {
                        errorPush("加载更多子块失败", error);
                        if (isActive() && element.isConnected) {
                            element.removeAttribute("disabled");
                        }
                    });
                    // 必须同步返回 true，异步回调会被原生按“关闭菜单”处理。
                    return true;
                },
            });
        }
        return items;
    };

    try {
        const items = await buildItems(rootID);
        if (!isActive() || items.length === 0) {
            return;
        }
        menu = new Menu("og-fdb-relative-menu", menuCloseCB);
        items.forEach(item => menu.addItem(item));
        menu.open(position);
        saveLastMenu(menu, menuId);
        owner = state.g_relativeMenu;
    } catch (error) {
        errorPush("获取子块面包屑菜单失败", error);
    } finally {
        cleanup();
    }
}

export function addBlockBdMenuListener(protyle: any, signal: AbortSignal) {
    // 限制范围，避免影响插件插入的面包屑
    const breadcrumbBar = protyle?.breadcrumb?.element;
    if (!(breadcrumbBar instanceof HTMLElement)) {
        return;
    }
    if (breadcrumbBar.dataset["ogFdbAddedEl"]) {
        return;
    }
    breadcrumbBar.dataset["ogFdbAddedEl"] = "true";
    const onNativeItemClick = (event: MouseEvent) => {
        const item = getNativeBreadcrumbItem(event.target, breadcrumbBar);
        if (!item) {
            return;
        }
        if (!isNativeBreadcrumbJumpEnabled() || event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        openNativeBreadcrumbTarget(protyle, item.dataset.nodeId ?? "", false);
    };
    const onClick = async (event: any) => {
        // 使用 .closest() 判断点击的是否是箭头或其内部元素
        const arrowElement = event.target.closest('.protyle-breadcrumb__arrow');
        if (!arrowElement) {
            return;
        }
        if (nativeArrowClickBypass.delete(arrowElement)) {
            return;
        }
        const docId = protyle.block.rootID;
        // 获取箭头左侧的面包屑项目
        const precedingItem = arrowElement.previousElementSibling;
        const standaloneDocumentBridge = !precedingItem
            && arrowElement.parentElement === breadcrumbBar
            && !!breadcrumbBar.parentElement?.previousElementSibling?.querySelector(
                `:scope > .${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}`
            );
        if (!standaloneDocumentBridge && (!precedingItem || !precedingItem.classList.contains('protyle-breadcrumb__item'))) {
            logPush("未找到箭头左侧的面包屑项目。");
            return;
        }
        // 关闭大纲时，普通箭头交还原生；独立文档箭头补齐全部子块菜单。
        if (state.g_setting.headingOutlineMenu !== true) {
            if (standaloneDocumentBridge) {
                event.stopImmediatePropagation();
                event.stopPropagation();
                event.preventDefault();
                await openStandaloneDocumentChildrenMenu(protyle, arrowElement, breadcrumbBar, signal);
            }
            return;
        }
        // 同行模式桥接箭头前的插件当前项只有 data-node-id，没有 popover 图标。
        // 开启大纲菜单时按文档处理，使文档箭头与标题箭头遵循同一个开关。
        const inlineDocumentBridge = !!precedingItem?.closest(`.${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}`)
            && precedingItem.dataset.nodeId === docId;
        const documentBridge = standaloneDocumentBridge || inlineDocumentBridge;
        // 同行文档箭头位于 root 末尾，后续原生块项是 root 的兄弟节点。
        const afterItem = inlineDocumentBridge
            ? arrowElement.parentElement?.nextElementSibling
            : arrowElement.nextElementSibling;
        let nextNodeId = "";
        if (afterItem && (standaloneDocumentBridge || precedingItem?.classList.contains('protyle-breadcrumb__item'))) {
            nextNodeId = afterItem.dataset.nodeId;
        }
        // 提取 Node ID 和图标信息
        const nodeId = documentBridge ? docId : precedingItem?.dataset.nodeId;
        const iconUseElement = documentBridge
            ? null
            : precedingItem?.querySelector('svg.popover__block use');

        if (!nodeId || (!documentBridge && !iconUseElement)) {
            logPush("无法从面包屑项目中提取 node-id 或 icon。");
            return;
        }
        event.stopImmediatePropagation();
        event.stopPropagation();
        event.preventDefault();
        const iconHref = documentBridge
            ? '#iconFile'
            : iconUseElement.getAttributeNS('http://www.w3.org/1999/xlink', 'href');

        logPush(`点击了 ID: ${nodeId} (${iconHref}) 旁边的箭头`);
        const menuId = "bid_" + nodeId;
        if (!guardMenuOpen(menuId)) {
            return;
        }
        // 占位标记：getDocOutline 为异步，期间若用户再次触发其他菜单，
        // 后打开的调用会覆盖此占位；await 结束后凭 id 比对决定是否放弃本次打开，
        // 避免与相对文档菜单并发操作共享的 #commonMenu 相互清空
        state.g_relativeMenu = { "menu": null, "id": menuId };
        try {
            // 获取文档大纲
            const outlineData = await getDocOutline(docId);
            // 加载期间已有更新的菜单被打开（或本菜单已被关闭），放弃本次打开
            if (!state.g_relativeMenu || state.g_relativeMenu["id"] !== menuId) {
                return;
            }

            let menuItems: any[] = [];
            if (outlineData == null) {
                state.g_relativeMenu = null;
                logPush("获取大纲数据失败或文档无大纲。");
                openNativeArrowMenu(arrowElement);
                return;
            }
            // 一次性建立整棵标题树的子标题索引（结构与字段契约见 buildHeadingChildrenIndex）
            const headingChildrenIndex = buildHeadingChildrenIndex(outlineData);
            // 根据图标类型来决定菜单内容
            if (iconHref === '#iconFile') {
                // 如果是文档图标，显示所有顶级标题
                logPush("目标是文档根节点，筛选所有顶级标题 (depth: 0)...");
                menuItems = outlineData.filter((item: any) => item.depth === 0);
            } else if (iconHref.startsWith('#iconH')) {
                // 如果是标题图标 (H1-H6)，显示其下的直接子标题
                logPush(`目标是标题节点，查找 ID: ${nodeId} 的子标题...`);
                // 索引查找 O(1)：get 返回子标题数组（无子标题时为空数组，未找到时 undefined）
                const childHeadings = headingChildrenIndex.get(nodeId);
                if (childHeadings) {
                    menuItems = childHeadings;
                } else {
                    logPush(`标题 ${nodeId} 没有找到或没有子标题。`);
                }
            } else {
                logPush(`点击了非文档或标题图标 (${iconHref}) 旁的箭头，不作处理。`);
                state.g_relativeMenu = null;
                openNativeArrowMenu(arrowElement);
                return;
            }

            // 递归构建菜单项的函数
            function buildMenuItems(items: any[]): any[] {
                return items.map(item => {
                    const fullName = escapeHTML(stripHTML(item.name || item.content || "N/A"));
                    const trimedName = state.g_setting.nameMaxLength > 0 && fullName.length > state.g_setting.nameMaxLength ? fullName.substring(0, state.g_setting.nameMaxLength) + "..." : fullName;
                    const menuItem: any = {
                        id: item.id,
                        label: `<span class="${CONSTANTS.MENU_ITEM_CLASS_NAME}" 
                            data-og-block-node-id="${item.id}" title="${fullName}">
                            ${trimedName}
                        </span>`,
                        current: nextNodeId === item.id,
                        icon: "icon" + item.subType.toUpperCase(),
                        click: (htmlElement: any, event: any) => {
                            const blocId = htmlElement.querySelector(".og-fake-doc-breadcrumb-menu-item-container")?.getAttribute("data-og-block-node-id");
                            event.preventDefault();
                            event.stopImmediatePropagation();
                            event.stopPropagation();
                            if (blocId) {
                                openNativeBreadcrumbTarget(
                                    protyle,
                                    blocId,
                                    !isNativeBreadcrumbJumpEnabled(),
                                );
                            }
                        }
                    };

                    const childItems = headingChildrenIndex.get(item.id) ?? [];
                    if (childItems.length > 0) {
                        menuItem.type = "submenu";
                        menuItem.submenu = buildMenuItems(childItems);
                    }

                    return menuItem;
                });
            }

            // 面包屑可能已在加载期间被重绘（原生 render 会重写 bar 的 innerHTML），
            // 箭头元素已脱离文档，放弃本次打开
            if (!arrowElement.isConnected) {
                state.g_relativeMenu = null;
                return;
            }
            // 打开菜单
            let rect = arrowElement.getBoundingClientRect();
            if (menuItems.length > 0) {
                const tempMenu = new Menu("og-fdb-relative-menu", menuCloseCB);
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
                state.g_relativeMenu = null;
                logPush("没有可供显示的菜单项。");
                openNativeArrowMenu(arrowElement);
            }

        } catch (error) {
            errorPush("获取或处理大纲数据时出错:", error);
            if (state.g_relativeMenu && state.g_relativeMenu["id"] === menuId) {
                state.g_relativeMenu = null;
                openNativeArrowMenu(arrowElement);
            }
        }
    };
    const onMenuClick = (event: MouseEvent) => {
        if (!isNativeBreadcrumbJumpEnabled()) {
            return;
        }
        const menuInfo = getNativeChildrenMenuInfo(event.target);
        if (!menuInfo || !isNativeChildrenMenuForProtyle(menuInfo.parentId, protyle)) {
            return;
        }
        // 带块 ID 的项（包括仍有子菜单的层级项）左键都改为跳转；
        // “加载更多”等没有块 ID 的功能项继续交给思源处理。
        const blockId = menuInfo.item.dataset.id;
        if (!blockId) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        closeCommonMenu();
        openNativeBreadcrumbTarget(protyle, blockId, false);
    };
    // 监听器生命周期绑定在 controller 的 AbortController 上：插件卸载或
    // controller 销毁时自动移除，避免原生 bar 上残留旧闭包（重载后仍响应点击）
    breadcrumbBar.addEventListener('click', onNativeItemClick, {capture: true, signal});
    breadcrumbBar.addEventListener('click', onClick, { signal });
    breadcrumbBar.ownerDocument.addEventListener('click', onMenuClick, {capture: true, signal});
}
