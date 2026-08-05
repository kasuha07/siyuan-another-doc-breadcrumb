"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openHideMenu = openHideMenu;
exports.checkAndCloseLastMenu = checkAndCloseLastMenu;
exports.saveLastMenu = saveLastMenu;
exports.openRelativeMenu = openRelativeMenu;
exports.addLazyLoadEventListeners = addLazyLoadEventListeners;
/**
 * 折叠隐藏文档菜单与相对文档菜单
 */
const siyuan_1 = require("siyuan");
const constants_1 = require("./constants");
const state_1 = require("./state");
const api_1 = require("./api");
const utils_1 = require("./utils");
/**
 * 打开折叠区域的隐藏文档菜单
 */
function openHideMenu({ anchorElement, hiddenEntries }, event) {
    let rect = anchorElement.getBoundingClientRect();
    event.stopPropagation();
    event.preventDefault();
    const tempMenu = new siyuan_1.Menu("newMenu");
    for (let i = 0; i < hiddenEntries.length; i++) {
        let id = hiddenEntries[i].id;
        let name = hiddenEntries[i].name;
        let trimedName = name.length > state_1.state.g_setting.nameMaxLength ?
            name.substring(0, state_1.state.g_setting.nameMaxLength) + "..."
            : name;
        let tempMenuItemObj = {
            iconHTML: "",
            label: `<span class="${constants_1.CONSTANTS.MENU_ITEM_CLASS_NAME}" 
                data-doc-id="${id}"
                title="${name}">
                ${trimedName}
            </span>`,
            click: (htmlElement, event) => {
                var _a;
                let docId = (_a = htmlElement.querySelector("[data-doc-id]")) === null || _a === void 0 ? void 0 : _a.getAttribute("data-doc-id");
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                (0, api_1.openRefLinkByAPI)({
                    paramDocId: docId,
                    keyParam: {
                        ctrlKey: event === null || event === void 0 ? void 0 : event.ctrlKey,
                        shiftKey: event === null || event === void 0 ? void 0 : event.shiftKey,
                        altKey: event === null || event === void 0 ? void 0 : event.altKey,
                        metaKey: event === null || event === void 0 ? void 0 : event.metaKey,
                    },
                });
            }
        };
        tempMenu.addItem(tempMenuItemObj);
    }
    tempMenu.open({ x: rect.left, y: rect.bottom, isLeft: false });
}
function checkAndCloseLastMenu(id) {
    var _a, _b;
    if (state_1.state.g_relativeMenu) {
        let tempId = state_1.state.g_relativeMenu["id"];
        if (tempId === id && document.querySelector("#commonMenu[data-name='og-fdb-relative-menu']")) {
            (_a = state_1.state.g_relativeMenu["menu"]) === null || _a === void 0 ? void 0 : _a.close();
            state_1.state.g_relativeMenu = null;
            return false;
        }
        (_b = state_1.state.g_relativeMenu["menu"]) === null || _b === void 0 ? void 0 : _b.close();
        state_1.state.g_relativeMenu = null;
    }
    return true;
}
function saveLastMenu(menuObj, id) {
    state_1.state.g_relativeMenu = { "menu": menuObj, "id": id };
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
    const maxDepth = state_1.state.g_setting["menuExtendSubDocDepth"];
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
        siblings = await (0, api_1.getChildDocuments)(id, sqlResult);
    }
    else {
        siblings = window.siyuan.notebooks.filter(item => item.closed == false);
    }
    if (siblings.length <= 0)
        return;
    const tempMenu = new siyuan_1.Menu("og-fdb-relative-menu");
    // 创建新文档
    // 只读模式这里也是显示创建按钮的
    if (state_1.state.g_setting.createDocBtnInMenu && type !== "ROOT") {
        let tempMenuItemObj = {
            icon: `iconAdd`,
            label: `<span class="${constants_1.CONSTANTS.MENU_ITEM_CLASS_NAME}">${window.siyuan.languages.newFile}</span>`,
            click: (htmlElement, event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                (0, api_1.createAndOpenEmptyDocAt)(box, path);
            }
        };
        tempMenu.addItem(tempMenuItemObj);
    }
    // 本层级内容
    for (let i = 0; i < siblings.length; i++) {
        let currSibling = siblings[i];
        let docName = (0, utils_1.trimListDocsByPathAPIReturnedDocName)(currSibling.name);
        let trimedName = docName.length > state_1.state.g_setting.nameMaxLength ?
            docName.substring(0, state_1.state.g_setting.nameMaxLength) + "..."
            : docName;
        let tempMenuItemObj = {
            iconHTML: (0, utils_1.getEmojiHtmlStr)(currSibling.icon, currSibling.subFileCount > 0),
            label: `<span class="${constants_1.CONSTANTS.MENU_ITEM_CLASS_NAME} ${nextId == currSibling.id ? constants_1.CONSTANTS.MENU_CURRENT_DOC_CLASS_NAME : ""}" 
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
                    label: state_1.state.language["loading"],
                    disabled: true
                }
            ];
            tempMenuItemObj.label = `<span class="${constants_1.CONSTANTS.MENU_ITEM_CLASS_NAME} ${nextId == currSibling.id ? constants_1.CONSTANTS.MENU_CURRENT_DOC_CLASS_NAME : ""}" 
                data-doc-id="${currSibling.id}"
                data-has-children="true"
                data-path="${currSibling.path || '/'}"
                data-box="${type !== "ROOT" ? box : currSibling["id"]}"
                data-loaded="false"
                title="${docName}">
                ${trimedName}
            </span>`;
        }
        if (type !== "ROOT" || (0, utils_1.isNotebookDocEnabled)()) {
            tempMenuItemObj.click = (htmlElement, event) => {
                var _a, _b;
                let docId = (_a = htmlElement.querySelector("[data-doc-id]")) === null || _a === void 0 ? void 0 : _a.getAttribute("data-doc-id");
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                (0, api_1.openRefLinkByAPI)({
                    paramDocId: docId,
                    keyParam: {
                        ctrlKey: event === null || event === void 0 ? void 0 : event.ctrlKey,
                        shiftKey: event === null || event === void 0 ? void 0 : event.shiftKey,
                        altKey: event === null || event === void 0 ? void 0 : event.altKey,
                        metaKey: event === null || event === void 0 ? void 0 : event.metaKey,
                    },
                });
                (_b = state_1.state.g_relativeMenu["menu"]) === null || _b === void 0 ? void 0 : _b.close();
                state_1.state.g_relativeMenu = null;
            };
        }
        tempMenu.addItem(tempMenuItemObj);
    }
    // 菜单展示位置调整，仅针对首层级
    if (siblings.length * 30 > (window.innerHeight - rect.bottom) * 0.7) {
        tempMenu.open({ x: rect.right, y: rect.top, isLeft: false });
    }
    else {
        tempMenu.open({ x: rect.left, y: rect.bottom, isLeft: false });
    }
    setTimeout(() => {
        var _a;
        if (state_1.state.g_setting.menuKeepCurrentVisible) {
            (_a = tempMenu.element.querySelector('.b3-menu__item--selected')) === null || _a === void 0 ? void 0 : _a.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest'
            });
        }
        // 懒加载
        if (state_1.state.g_setting.menuExtendSubDocDepth > 1) {
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
        if (!menuItemElement)
            return;
        // 悬停加载
        menuItemElement.addEventListener('mouseover', async function handleMouseOver(e) {
            const docId = item.getAttribute('data-doc-id');
            const path = item.getAttribute('data-path');
            const box = item.getAttribute('data-box');
            const isLoaded = item.getAttribute('data-loaded') === 'true';
            if (isLoaded || currentDepth >= maxDepth)
                return;
            // 避免多次处理
            item.setAttribute('data-loaded', 'true');
            const submenuContainer = menuItemElement.querySelector('.b3-menu__submenu .b3-menu__items');
            if (!submenuContainer)
                return;
            submenuContainer.innerHTML = '';
            // 加载子文档
            const sqlResult = [{ path, box }];
            const childDocuments = await (0, api_1.getChildDocuments)(docId, sqlResult);
            if (!childDocuments || childDocuments.length === 0) {
                submenuContainer.innerHTML = `<button class="b3-menu__item" disabled><span class="b3-menu__label">${state_1.state.language["no_doc"]}</span></button>`;
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
            docTitleEl.className = `${constants_1.CONSTANTS.MENU_ITEM_CLASS_NAME}`;
            docTitleEl.textContent = window.siyuan.languages.newFile;
            labelEl.appendChild(docTitleEl);
            menuItemEl.appendChild(labelEl);
            submenuContainer.appendChild(menuItemEl);
            menuItemEl.addEventListener('click', (event) => {
                var _a;
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();
                (0, api_1.createAndOpenEmptyDocAt)(box, path);
                (_a = state_1.state.g_relativeMenu["menu"]) === null || _a === void 0 ? void 0 : _a.close();
                state_1.state.g_relativeMenu = null;
            });
            // 子文档菜单
            for (const childDoc of childDocuments) {
                const docName = (0, utils_1.trimListDocsByPathAPIReturnedDocName)(childDoc.name);
                const trimedName = docName.length > state_1.state.g_setting.nameMaxLength ?
                    docName.substring(0, state_1.state.g_setting.nameMaxLength) + "..." :
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
                emojiEl.innerHTML = (0, utils_1.getEmojiHtmlStr)(childDoc.icon, childDoc.subFileCount > 0);
                menuItemEl.appendChild(emojiEl);
                // label
                const labelEl = document.createElement('span');
                labelEl.className = 'b3-menu__label';
                // title
                const docTitleEl = document.createElement('span');
                docTitleEl.className = `${constants_1.CONSTANTS.MENU_ITEM_CLASS_NAME}`;
                docTitleEl.setAttribute('data-doc-id', childDoc.id);
                docTitleEl.setAttribute('title', docName);
                if (hasChildren) {
                    docTitleEl.setAttribute('data-has-children', 'true');
                    docTitleEl.setAttribute('data-path', childDoc.path || '');
                    docTitleEl.setAttribute('data-box', box);
                    docTitleEl.setAttribute('data-loaded', 'false');
                }
                docTitleEl.textContent = (0, utils_1.decodeHtmlEntities)(trimedName);
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
                    var _a;
                    const docId = docTitleEl.getAttribute('data-doc-id');
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    event.stopPropagation();
                    (0, api_1.openRefLinkByAPI)({
                        paramDocId: docId,
                        keyParam: {
                            ctrlKey: event === null || event === void 0 ? void 0 : event.ctrlKey,
                            shiftKey: event === null || event === void 0 ? void 0 : event.shiftKey,
                            altKey: event === null || event === void 0 ? void 0 : event.altKey,
                            metaKey: event === null || event === void 0 ? void 0 : event.metaKey,
                        },
                    });
                    // 手动绑定的不能触发菜单关闭，这里自行处理一下
                    (_a = state_1.state.g_relativeMenu["menu"]) === null || _a === void 0 ? void 0 : _a.close();
                    state_1.state.g_relativeMenu = null;
                });
                submenuContainer.appendChild(menuItemEl);
            }
            // 对子Menu再度绑定
            addLazyLoadEventListeners(submenuContainer, maxDepth, protyleElem, currentDepth + 1);
        });
    });
}
