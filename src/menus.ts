/**
 * 折叠隐藏文档菜单与相对文档菜单
 */
import { Menu } from "siyuan";
import { CONSTANTS } from "./constants";
import { state } from "./state";
import { createAndOpenEmptyDocAt, getChildDocuments, openRefLinkByAPI } from "./api";
import { errorPush } from "./logger";
import type { ChildDocument, LazyMenuItem } from "./types";
import { escapeHTML, getEmojiHtmlStr, isNotebookDocEnabled } from "./utils";

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
    const type = kind === "notebook" ? "NOTEBOOK" : (kind === "root" ? "ROOT" : "FILE");
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

    let siblings: ChildDocument[] = [];

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
    const items = buildDocumentMenuItems(siblings, { type, path, box, depth: 1, maxDepth, nextId });
    items.forEach(item => tempMenu.addItem(item));
    // 菜单展示位置调整，仅针对首层级；子层定位由原生 loadSubmenu 完成。
    if (siblings.length * 30 > (window.innerHeight - rect.bottom) * 0.7) {
        tempMenu.open({ x: rect.right, y: rect.top, isLeft: false });
    } else {
        tempMenu.open({ x: rect.left, y: rect.bottom, isLeft: false });
    }
    saveLastMenu(tempMenu, id);
    cleanupOutsideClick();
}

interface DocumentMenuContext {
    type: "ROOT" | "NOTEBOOK" | "FILE";
    path: string;
    box: string;
    depth: number;
    maxDepth: number;
    nextId?: string;
}

function closeRelativeMenu() {
    state.g_relativeMenu?.["menu"]?.close();
    state.g_relativeMenu = null;
}

/**
 * 首层和子层共用的“文档 → IMenu”构建：用显式深度替代 DOM 层数推断，
 * 加载状态、鼠标/键盘触发、加载后定位与焦点全部交给思源 3.8.0 原生菜单。
 */
function buildDocumentMenuItems(documents: ChildDocument[], context: DocumentMenuContext): LazyMenuItem[] {
    const { type, path, box, depth, maxDepth, nextId } = context;
    const items: LazyMenuItem[] = [];
    if (state.g_setting.createDocBtnInMenu && type !== "ROOT" && !isCreateDocDepthLimited(path)) {
        items.push({
            icon: "iconAdd",
            label: `<span class="${CONSTANTS.MENU_ITEM_CLASS_NAME}">${escapeHTML(window.siyuan.languages!.newFile)}</span>`,
            click: (_element, event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                closeRelativeMenu();
                createAndOpenEmptyDocAt(box, path);
            }
        });
    }
    for (const document of documents) {
        // 先截断原始名称再转义，避免把 &lt; 等实体截成半截；title 保留完整名。
        const name = document.name;
        const shortName = state.g_setting.nameMaxLength > 0 && name.length > state.g_setting.nameMaxLength
            ? name.substring(0, state.g_setting.nameMaxLength) + "..." : name;
        const current = nextId === document.id;
        const item: LazyMenuItem = {
            iconHTML: getEmojiHtmlStr(document.icon, (document.subFileCount ?? 0) > 0),
            label: `<span class="${CONSTANTS.MENU_ITEM_CLASS_NAME} ${current ? CONSTANTS.MENU_CURRENT_DOC_CLASS_NAME : ""}"
                data-doc-id="${escapeHTML(document.id)}" title="${escapeHTML(name)}">${escapeHTML(shortName)}</span>`,
            current,
        };
        if (document.icon && document.icon.indexOf(".") === -1) {
            item.icon = `icon-${escapeHTML(document.icon)}`;
        }
        if (((document.subFileCount ?? 0) > 0 || type === "ROOT") && depth < maxDepth) {
            const childBox = type === "ROOT" ? document.id : box;
            const childPath = document.path || "/";
            item.loadSubmenu = async () => {
                // 不吞掉失败：原生 catch 分支显示 emptyContent，成功空列表仍可新建。
                const children = await getChildDocuments(document.id, [{ path: childPath, box: childBox }]);
                return buildDocumentMenuItems(children, {
                    ...context, type: type === "ROOT" ? "NOTEBOOK" : "FILE",
                    path: childPath, box: childBox, depth: depth + 1,
                });
            };
        }
        // ROOT 层笔记本未启用笔记本文档时，仅能展开，不能点击打开。
        if (type !== "ROOT" || isNotebookDocEnabled()) {
            item.click = (_element, event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                openRefLinkByAPI({
                    paramDocId: document.id,
                    keyParam: {
                        ctrlKey: event.ctrlKey,
                        shiftKey: event.shiftKey,
                        altKey: event.altKey,
                        metaKey: event.metaKey,
                    },
                });
                closeRelativeMenu();
            };
        }
        items.push(item);
    }
    return items;
}
