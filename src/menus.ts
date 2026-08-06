/**
 * 折叠隐藏文档菜单与相对文档菜单
 */
import { Menu } from "siyuan";
import { CONSTANTS } from "./constants";
import { state } from "./state";
import { createAndOpenEmptyDocAt, getChildDocuments, openRefLinkByAPI } from "./api";
import { errorPush } from "./logger";
import { decodeHtmlEntities, escapeHTML, getEmojiHtmlStr, isNotebookDocEnabled, trimListDocsByPathAPIReturnedDocName } from "./utils";

/**
 * 判断在 path（父文档物理路径，.sy 结尾）下新建子文档是否超过 kernel 深度限制：
 * kernel 在创建时校验 strings.Count(newPath, "/") > 7（即父路径斜杠数 >= 7）时报错；
 * 开启“允许创建更深层级文档”设置后可突破限制。
 */
export function isCreateDocDepthLimited(path: string) {
    return path.split("/").length - 1 >= 7 && !window.siyuan.config?.fileTree?.allowCreateDeeper;
}

/**
 * 非空断言（!）说明：
 * - window.siyuan.notebooks!/languages!：siyuan 类型声明为可选，但思源运行时必然注入；
 * - getAttribute(...)!：查询选择器已限定元素必带对应 data-* 属性
 *   （此处为 data-has-children="true" 且未加载的子菜单项，data-doc-id / data-path / data-box 必已写入）。
 */

/**
 * 打开折叠区域的隐藏文档菜单
 */
export function openHideMenu({ anchorElement, hiddenEntries }: any, event: any) {
    let rect = anchorElement.getBoundingClientRect();
    event.stopPropagation();
    event.preventDefault();
    // 清理相对菜单的加载中占位：占位期间 removeCB 尚未注册，closeCB 不会触发，
    // 若不清理，相对菜单 await 完成后会凭 id 校验通过并把本菜单顶掉
    state.g_relativeMenu = null;
    // SDK Menu 构造时若 data-name 与传入 id 相同会进入 isOpen 静默失败态
    // （addItem/open 全部无效），同名菜单已打开时主动关闭，避免“再点一次菜单消失”
    // 注意：window.siyuan.menus.menu 运行时是内核内部 Menu 实例（app/src/menus/Menu.ts），
    // 只有 remove() 没有 SDK 包装类（app/src/plugin/Menu.ts）的 close()；siyuan 类型声明
    // 误标为 SDK Menu（仅有 close() 无 remove()），与运行时相反，故需断言后调用 remove()。
    // 否则二次点击抛 TypeError 菜单关不掉，且后续 new Menu("newMenu") 进入静默失败态
    // （isOpen=true，构造时 remove() 清空菜单）导致菜单凭空消失
    if (document.querySelector("#commonMenu[data-name='newMenu']")) {
        (window.siyuan.menus?.menu as any)?.remove();
        return;
    }
    const tempMenu = new Menu("newMenu");
    for (let i = 0; i < hiddenEntries.length; i++) {
        let id = hiddenEntries[i].id;
        let name = hiddenEntries[i].name;
        // 文档名来自 hPath（用户可控，可含引号/尖括号），拼入 title/文本前必须先转义
        let fullName = escapeHTML(name);
        let trimedName = state.g_setting.nameMaxLength > 0 && fullName.length > state.g_setting.nameMaxLength ?
            fullName.substring(0, state.g_setting.nameMaxLength) + "..."
            : fullName;
        let tempMenuItemObj: any = {
            iconHTML: "",
            label: `<span class="${CONSTANTS.MENU_ITEM_CLASS_NAME}" 
                data-doc-id="${id}"
                title="${fullName}">
                ${trimedName}
            </span>`,
            click: (htmlElement: any, event: any) => {
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

export function checkAndCloseLastMenu(id: string) {
    if (state.g_relativeMenu) {
        let tempId = state.g_relativeMenu["id"];
        if (tempId === id && document.querySelector("#commonMenu[data-name='og-fdb-relative-menu']")) {
            state.g_relativeMenu["menu"]?.close();
            state.g_relativeMenu = null;
            return false;
        }
        state.g_relativeMenu["menu"]?.close();
        state.g_relativeMenu = null;
    }
    return true;
}

/**
 * 子文档列表懒加载缓存（仅当前菜单生命周期内有效）：
 * 同一菜单内 hover 移开再移回不再重复请求；菜单关闭（menuCloseCB）时清空，
 * 重新打开菜单时保证数据新鲜。
 */
const submenuCache = new Map<string, any[]>();

/**
 * 菜单打开前的统一守卫：
 * - 同一菜单正在加载中（占位 menu 为 null）时忽略重复触发（连点/双击），
 *   避免“先 await 完成者打开菜单、后完成者的 checkAndCloseLastMenu 又把刚打开的菜单关闭”；
 * - 否则检查并关闭上一个打开的菜单。
 * 调用方通过返回 true 后应设置占位标记（g_relativeMenu = { menu: null, id }）。
 */
export function guardMenuOpen(id: string): boolean {
    // 同一菜单正在加载中（占位 menu 为 null），忽略重复触发
    if (state.g_relativeMenu && state.g_relativeMenu["id"] === id && state.g_relativeMenu["menu"] === null) {
        return false;
    }
    return checkAndCloseLastMenu(id);
}

/**
 * SDK Menu 构造会立即清空共享的 #commonMenu；通过 closeCB 感知菜单被关闭
 * （含被外部菜单/其他插件覆盖），同步清理 state，避免残留引用指向已清空的菜单。
 */
export function menuCloseCB() {
    state.g_relativeMenu = null;
    submenuCache.clear();
}
export function saveLastMenu(menuObj: any, id: string) {
    state.g_relativeMenu = { "menu": menuObj, "id": id };
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
export async function openRelativeMenu({ protyle, anchorElement, parentId, nextId, path, box, kind }: any, event: any) {
    event.stopPropagation();
    event.preventDefault();
    event.stopImmediatePropagation();
    const maxDepth = state.g_setting["menuExtendSubDocDepth"];
    let id = parentId;
    let type = kind === "notebook" ? "NOTEBOOK" : (kind === "root" ? "ROOT" : "FILE");
    let rect = anchorElement.getBoundingClientRect();
    // 从路径项打开时，菜单定位到其后的箭头位置
    if (!anchorElement.classList.contains("og-fdb-inline__arrow") && anchorElement.nextElementSibling) {
        rect = anchorElement.nextElementSibling.getBoundingClientRect();
    }

    if (!guardMenuOpen(id)) {
        return;
    }
    // 占位标记：getChildDocuments 为异步，期间若用户再次触发其他菜单，
    // 后打开的调用会覆盖此占位；await 结束后凭 id 比对决定是否放弃本次打开，
    // 避免多个 openRelativeMenu 并发操作共享的 #commonMenu 相互清空。
    // 加载期间点击菜单外部（如文档正文）也会取消本次打开（见下方 mousedown 捕获监听）。
    state.g_relativeMenu = { "menu": null, "id": id };

    // 加载期点击外部取消本次打开：占位期间菜单尚未渲染，closeCB 不会触发，若不加处理，
    // await 完成后菜单会凭 id 校验通过而“凭空”弹出。捕获阶段一次性监听确保任何 mousedown
    // （含菜单外点击）先于目标元素处理执行；点击仍在触发锚点内（连点重开）时不处理，
    // 保留 guardMenuOpen 的去重语义。所有出口（成功/失败/放弃）统一调用 cleanup 移除监听，避免泄漏。
    const cleanupOutsideClick = () => {
        document.removeEventListener("mousedown", onOutsideMousedown, true);
        // 仅在占位仍属于本次打开时置 null，避免误清其他菜单的占位
        if (state.g_relativeMenu && state.g_relativeMenu["id"] === id && state.g_relativeMenu["menu"] === null) {
            state.g_relativeMenu = null;
        }
    };
    const onOutsideMousedown = (event: any) => {
        if (anchorElement.contains(event.target)) {
            return;
        }
        cleanupOutsideClick();
    };
    document.addEventListener("mousedown", onOutsideMousedown, true);

    let siblings: any[] = [];

    try {
        if (type !== "ROOT") {
            let sqlResult = [{
                path: path,
                box: box
            }];
            siblings = await getChildDocuments(id, sqlResult);
        } else {
            // closed == false：排除未挂载笔记本（含锁定中的加密笔记本，语义见 api.getNodebookList 注释）
            siblings = window.siyuan.notebooks!.filter(item => item.closed == false);
        }
    } catch (err) {
        errorPush(err);
        cleanupOutsideClick();
        return;
    }
    // 加载期间已有更新的菜单被打开，放弃本次打开
    if (!state.g_relativeMenu || state.g_relativeMenu["id"] !== id) {
        cleanupOutsideClick();
        return;
    }
    if (siblings.length <= 0) {
        cleanupOutsideClick();
        return;
    }

    const tempMenu = new Menu("og-fdb-relative-menu", menuCloseCB);
    // 创建新文档
    // 只读模式这里也是显示创建按钮的
    if (state.g_setting.createDocBtnInMenu && type !== "ROOT" && !isCreateDocDepthLimited(path)) {
        let tempMenuItemObj: any = {
            icon: `iconAdd`,
            label: `<span class="${CONSTANTS.MENU_ITEM_CLASS_NAME}">${window.siyuan.languages!.newFile}</span>`,
            click: (htmlElement: any, event: any) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                // 关闭菜单并清理状态，避免创建完成后菜单残留或状态与 DOM 脱节
                state.g_relativeMenu["menu"]?.close();
                state.g_relativeMenu = null;
                createAndOpenEmptyDocAt(box, path);
            }
        };
        tempMenu.addItem(tempMenuItemObj);
    }
    // 本层级内容
    for (let i = 0; i < siblings.length; i++) {
        let currSibling = siblings[i];
        // 文档名来自内核 IAL（用户可控，可含引号/尖括号），拼入 title/文本前必须先转义
        let docName = escapeHTML(trimListDocsByPathAPIReturnedDocName(currSibling.name));
        let trimedName = state.g_setting.nameMaxLength > 0 && docName.length > state.g_setting.nameMaxLength ?
            docName.substring(0, state.g_setting.nameMaxLength) + "..."
            : docName;
        let tempMenuItemObj: any = {
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
                    label: state.language["loading"],
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
            tempMenuItemObj.click = (htmlElement: any, event: any) => {
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
                state.g_relativeMenu["menu"]?.close();
                state.g_relativeMenu = null;
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
        // 懒加载
        if (state.g_setting.menuExtendSubDocDepth > 1) {
            addLazyLoadEventListeners(tempMenu.element, maxDepth, protyle.element);
        }
    }, 3);
    saveLastMenu(tempMenu, id);
    // 菜单已成功打开，移除加载期的外部点击监听；占位已转为真实菜单，后续由 menuCloseCB 清理
    cleanupOutsideClick();
}

/**
 * 从 DOM 结构计算菜单项嵌套深度（首层=1，每遇到一层 .b3-menu__submenu 祖先 +1）。
 * 容器级 observer/事件委托会观察到后续动态创建的子菜单项，深度不能依赖闭包计数，
 * 必须实时从 DOM 计算。
 */
function getMenuItemDepth(menuItemElement: Element): number {
    let depth = 1;
    let parent = menuItemElement.parentElement;
    while (parent) {
        if (parent.classList.contains('b3-menu__submenu')) {
            depth++;
        }
        parent = parent.parentElement;
    }
    return depth;
}

/**
 * 懒加载子菜单统一入口（鼠标悬停与键盘展开 --show 类变化共用）。
 * item 为带 data-has-children="true" 的标记元素，docId/path/box 均从 data 属性读取；
 * menuItemElement 为所属 .b3-menu__item。加载成功填充 submenuContainer 并递归注册子容器监听；
 * 失败重置 data-loaded 允许移开鼠标后重试，并给出可见提示。
 */
async function loadSubmenu(item: Element, menuItemElement: Element, maxDepth: number, protyleElem: HTMLElement) {
    const docId = item.getAttribute('data-doc-id')!;
    const path = item.getAttribute('data-path')!;
    const box = item.getAttribute('data-box')!;
    const isLoaded = item.getAttribute('data-loaded') === 'true';
    const currentDepth = getMenuItemDepth(menuItemElement);

    if (isLoaded || currentDepth >= maxDepth) return;

    // 避免多次处理
    item.setAttribute('data-loaded', 'true');

    const submenuContainer = menuItemElement.querySelector('.b3-menu__submenu .b3-menu__items');
    if (!submenuContainer) return;

    submenuContainer.innerHTML = '';

    let childDocuments: any[];
    const cacheKey = `${box}|${path}`;
    const cached = submenuCache.get(cacheKey);
    if (cached) {
        childDocuments = cached;
    } else {
        try {
            // 加载子文档
            const sqlResult = [{ path, box }];
            childDocuments = await getChildDocuments(docId, sqlResult);
            submenuCache.set(cacheKey, childDocuments);
        } catch (err) {
            // 加载失败（网络/kernel 错误、文档已删除等）：重置标记允许移开鼠标后重试，并给出可见提示
            errorPush(err);
            item.setAttribute('data-loaded', 'false');
            if (menuItemElement.isConnected) {
                submenuContainer.innerHTML = `<button class="b3-menu__item" disabled><span class="b3-menu__label">${state.language["loadFailed"] ?? state.language["no_doc"]}</span></button>`;
            }
            return;
        }
    }

    // 加载期间菜单已被关闭（#commonMenu 被其他菜单复用，内容已清空），放弃填充
    if (!menuItemElement.isConnected) {
        return;
    }

    if (!childDocuments || childDocuments.length === 0) {
        submenuContainer.innerHTML = `<button class="b3-menu__item" disabled><span class="b3-menu__label">${state.language["no_doc"]}</span></button>`;
        return;
    }

    // 创建子文档菜单项（与首层级菜单一致：受“在文档菜单中显示新建文档按钮”设置项控制）
    if (state.g_setting.createDocBtnInMenu && !isCreateDocDepthLimited(path)) {
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
        docTitleEl.textContent = window.siyuan.languages!.newFile;
        labelEl.appendChild(docTitleEl);
        menuItemEl.appendChild(labelEl);
        submenuContainer.appendChild(menuItemEl);
        menuItemEl.addEventListener('click', (event: any) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
            // 先关闭菜单并清理状态，再异步创建
            state.g_relativeMenu["menu"]?.close();
            state.g_relativeMenu = null;
            createAndOpenEmptyDocAt(box, path);
        });
    }

    // 子文档菜单
    for (const childDoc of childDocuments) {
        const docName = trimListDocsByPathAPIReturnedDocName(childDoc.name);
        const trimedName = state.g_setting.nameMaxLength > 0 && docName.length > state.g_setting.nameMaxLength ?
            docName.substring(0, state.g_setting.nameMaxLength) + "..." :
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
        menuItemEl.addEventListener('click', (event: any) => {
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
            state.g_relativeMenu["menu"]?.close();
            state.g_relativeMenu = null;
        });
        submenuContainer.appendChild(menuItemEl);
    }

    // 对子Menu再度绑定（每个容器一个 observer，深度由 getMenuItemDepth 实时计算）
    addLazyLoadEventListeners(submenuContainer, maxDepth, protyleElem);

    // 内容填充完成且子菜单正处于展开状态时重新定位：原生 showSubMenu 在
    // hover 时基于“Loading...”占位（宽高为 0）定位，水平方向恒选右侧、
    // 垂直方向可能贴底，填充后尺寸已变化，需按真实尺寸重新计算
    if (menuItemElement.classList.contains('b3-menu__item--show')) {
        const subMenuElement = menuItemElement.querySelector(':scope > .b3-menu__submenu') as HTMLElement;
        if (subMenuElement) {
            window.siyuan.menus?.menu?.showSubMenu(subMenuElement);
        }
    }
}

/**
 * 对带有子菜单的添加懒加载
 * @param {HTMLElement} menuElement 菜单元素
 * @param {number} maxDepth 最大深度
 * @param {HTMLElement} protyleElem protyle Elem
 */
export function addLazyLoadEventListeners(menuElement: Element, maxDepth: number, protyleElem: HTMLElement) {
    // 仅针对未加载的进行处理；空容器不注册监听
    if (menuElement.querySelectorAll('.b3-menu__item [data-has-children="true"][data-loaded="false"]').length === 0) {
        return;
    }

    // 统一的懒加载查找入口：鼠标悬停与键盘展开（--show 类变化）共用。
    // :scope > .b3-menu__label 限定直接子级 label，避免误命中子菜单 .b3-menu__submenu 内的项
    const loadFromMenuItem = (menuItemElement: Element) => {
        const markElement = menuItemElement.querySelector(':scope > .b3-menu__label [data-has-children="true"][data-loaded="false"]');
        if (markElement) {
            loadSubmenu(markElement, menuItemElement, maxDepth, protyleElem);
        }
    };

    // 鼠标悬停触发懒加载：容器级事件委托（mouseover 冒泡），从 event.target 定位菜单项；
    // 相比每项一个监听，避免首层菜单项过多时创建大量监听器
    menuElement.addEventListener('mouseover', (event: any) => {
        const menuItemElement = event.target?.closest?.('.b3-menu__item');
        if (menuItemElement) {
            loadFromMenuItem(menuItemElement);
        }
    });

    // 键盘展开：原生 bindMenuKeydown 的 →/Enter 只添加 b3-menu__item--show 类并调用
    // showSubMenu，不派发 mouseover；每个容器一个 MutationObserver 监听 subtree 类变化
    // 以覆盖键盘路径（data-loaded 标记 + getMenuItemDepth 实时计算保证不重复加载）。
    // 相比每项一个 observer，容器级避免首层菜单项过多时创建上千个观察器。
    const showObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class' &&
                (mutation.target as HTMLElement).classList.contains('b3-menu__item--show')) {
                const menuItemElement = (mutation.target as HTMLElement).closest('.b3-menu__item');
                if (menuItemElement) {
                    loadFromMenuItem(menuItemElement);
                }
            }
        }
    });
    showObserver.observe(menuElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
}
