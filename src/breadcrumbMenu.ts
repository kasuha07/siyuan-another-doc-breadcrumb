/**
 * 介入原生块面包屑的“>”箭头：显示文档内标题层级菜单
 * 通过 protyle.breadcrumb.element 精确定位原生 bar（不使用模糊 querySelector）。
 * 原生每次 render 都会重写 bar 的 innerHTML，dataset 丢失后此处会重新绑定。
 */
import { Menu, openTab, showMessage } from "siyuan";
import { CONSTANTS } from "./constants";
import { logPush, errorPush } from "./logger";
import { state } from "./state";
import { getDocOutline } from "./api";
import { escapeHTML, getPluginInstance, stripHTML } from "./utils";
import { checkAndCloseLastMenu, saveLastMenu } from "./menus";

export async function addBlockBdMenuListener(protyle: any) {
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
    breadcrumbBar.addEventListener('click', async (event: any) => {
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

            let menuItems: any[] = [];
            if (outlineData == null) {
                logPush("获取大纲数据失败或文档无大纲。");
                showMessage(state.language["nothingToDisplay"] + "--- fakeDocBreadcrumb");
                return;
            }
            // 根据图标类型来决定菜单内容
            if (iconHref === '#iconFile') {
                // 如果是文档图标，显示所有顶级标题
                logPush("目标是文档根节点，筛选所有顶级标题 (depth: 0)...");
                menuItems = outlineData.filter((item: any) => item.depth === 0);
            } else if (iconHref.startsWith('#iconH')) {
                // 如果是标题图标 (H1-H6)，显示其下的直接子标题
                logPush(`目标是标题节点，查找 ID: ${nodeId} 的子标题...`);
                // 递归查找指定 ID 的标题及其子项
                function findHeadingById(items: any[], targetId: string): any {
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
                showMessage(state.language["nothingToDisplay"] + "--- fakeDocBreadcrumb");
                return;
            }

            // 递归构建菜单项的函数
            function buildMenuItems(items: any[]): any[] {
                return items.map(item => {
                    const fullName = escapeHTML(stripHTML(item.name || item.content || "N/A"));
                    const trimedName = fullName.length > state.g_setting.nameMaxLength ? fullName.substring(0, state.g_setting.nameMaxLength) + "..." : fullName;
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
                                openTab({
                                    app: getPluginInstance().app,
                                    doc: {
                                        id: blocId,
                                        action: ["cb-get-focus", "cb-get-scroll"],
                                        keepCursor: true,
                                    } as any,
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
                const tempMenu = new Menu("og-fdb-relative-menu");
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
                showMessage(state.language["nothingToDisplay"] + "--- fakeDocBreadcrumb");
            }

        } catch (error) {
            errorPush("获取或处理大纲数据时出错:", error);
        }
    });
}
