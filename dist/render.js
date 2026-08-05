"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderBreadcrumbFragment = renderBreadcrumbFragment;
exports.createBreadcrumbItem = createBreadcrumbItem;
exports.createBreadcrumbArrow = createBreadcrumbArrow;
exports.createBreadcrumbIcon = createBreadcrumbIcon;
/**
 * 渲染层：ViewModel → DOM
 */
const constants_1 = require("./constants");
const state_1 = require("./state");
const utils_1 = require("./utils");
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
    if (entry.kind === "notebook" && !(0, utils_1.isNotebookDocEnabled)()) {
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
    var _a;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "og-fdb-inline__arrow";
    button.setAttribute("aria-label", (_a = state_1.state.language["arrow_menu"]) !== null && _a !== void 0 ? _a : "展开子文档菜单");
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
    var _a;
    if (state_1.state.g_setting.icon == constants_1.CONSTANTS.ICON_NONE)
        return null;
    const textClassName = "og-fdb-bread-emojitext";
    const picClassName = "og-fdb-bread-emojipic";
    // 无emoji的处理
    if (iconString == undefined || iconString == null || iconString == "") {
        if (state_1.state.g_setting.icon == constants_1.CONSTANTS.ICON_ALL) {
            const localImages = (_a = window.siyuan.storage) === null || _a === void 0 ? void 0 : _a["local-images"];
            const localIcon = hasChild ? localImages === null || localImages === void 0 ? void 0 : localImages.folder : localImages === null || localImages === void 0 ? void 0 : localImages.file;
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
    span.textContent = (0, utils_1.emojiIconHandler)(iconString, hasChild);
    return span;
}
