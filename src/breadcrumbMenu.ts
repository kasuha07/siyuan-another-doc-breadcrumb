/**
 * 介入原生块面包屑的“>”箭头：显示文档内标题层级菜单
 * 通过 protyle.breadcrumb.element 精确定位原生 bar（不使用模糊 querySelector）。
 * 原生每次 render 都会重写 bar 的 innerHTML，dataset 丢失后此处会重新绑定。
 */
import { Menu, openTab } from "siyuan";
import { CONSTANTS } from "./constants";
import { logPush, errorPush } from "./logger";
import { state } from "./state";
import { getDocOutline } from "./api";
import { escapeHTML, getPluginInstance, stripHTML } from "./utils";
import { guardMenuOpen, menuCloseCB, saveLastMenu } from "./menus";

/**
 * 单次 DFS 遍历 getDocOutline 响应，建立“节点 id → 直接子标题数组”索引：
 * 后续按 id 查找子标题 O(1)，替代原先每次点击对整棵标题树递归探测字段。
 *
 * 响应结构（kernel/model/outline.go OutlineInBox，v3.7.3）为顶级标题的 Path 数组，
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
    const docId = protyle.block.rootID;
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
        // 同行模式将原生块箭头移动到插件当前文档项之后；该项没有原生
        // popover 图标，交给思源 Breadcrumb 自身继续处理块层级菜单。
        if (precedingItem?.closest(`.${CONSTANTS.INLINE_BREADCRUMB_CLASS_NAME}`)) {
            return;
        }
        const afterItem = arrowElement.nextElementSibling;
        let nextNodeId = "";
        if (afterItem && (standaloneDocumentBridge || precedingItem?.classList.contains('protyle-breadcrumb__item'))) {
            nextNodeId = afterItem.dataset.nodeId;
        }
        // 提取 Node ID 和图标信息
        const nodeId = standaloneDocumentBridge ? docId : precedingItem?.dataset.nodeId;
        const iconUseElement = standaloneDocumentBridge
            ? null
            : precedingItem?.querySelector('svg.popover__block use');

        if (!nodeId || (!standaloneDocumentBridge && !iconUseElement)) {
            logPush("无法从面包屑项目中提取 node-id 或 icon。");
            return;
        }
        event.stopImmediatePropagation();
        event.stopPropagation();
        event.preventDefault();
        const iconHref = standaloneDocumentBridge
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
