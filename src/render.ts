/**
 * 渲染层：ViewModel → DOM
 */
import { CONSTANTS } from "./constants";
import { state } from "./state";
import type { ActionRegistrar, BreadcrumbEntry } from "./types";
import { emojiIconHandler, isNotebookDocEnabled } from "./utils";

export function renderBreadcrumbFragment(entries: BreadcrumbEntry[], controller: ActionRegistrar) {
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

export function createBreadcrumbItem(entry: BreadcrumbEntry, controller: ActionRegistrar) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "protyle-breadcrumb__item og-fdb-inline__item";
    button.dataset.ogFdbKind = entry.kind;
    if (entry.kind === "notebook" && !isNotebookDocEnabled()) {
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

export function createBreadcrumbArrow(entry: BreadcrumbEntry, controller: ActionRegistrar) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "og-fdb-inline__arrow";
    button.setAttribute("aria-label", state.language["arrow_menu"] ?? "展开子文档菜单");

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
 * 装饰性分隔箭头（同行模式下内容带与原生内容带之间，无交互）
 */
export function createBreadcrumbDivider() {
    const span = document.createElement("span");
    span.className = "og-fdb-inline__divider";
    span.setAttribute("aria-hidden", "true");

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    const use = document.createElementNS(svgNS, "use");
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#iconRight");
    svg.appendChild(use);
    span.appendChild(svg);

    return span;
}

/**
 * 使用 DOM API 创建面包屑图标（不再拼接 HTML 字符串）
 * @param {string} iconString 文档图标字段
 * @param {boolean} hasChild 是否有子文档（决定默认图标）
 * @returns {HTMLElement|null}
 */
export function createBreadcrumbIcon(iconString: any, hasChild: boolean) {
    if (state.g_setting.icon == CONSTANTS.ICON_NONE) return null;
    const textClassName = "og-fdb-bread-emojitext";
    const picClassName = "og-fdb-bread-emojipic";

    // 无emoji的处理
    if (iconString == undefined || iconString == null || iconString == "") {
        if (state.g_setting.icon == CONSTANTS.ICON_ALL) {
            const localImages = window.siyuan.storage?.["local-images"];
            const localIcon = hasChild ? localImages?.folder : localImages?.file;
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
    span.textContent = emojiIconHandler(iconString, hasChild);
    return span;
}
