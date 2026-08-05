/**
 * 静态样式（仅支持 v3.7.0+，不再动态判断版本生成 CSS）
 * 布局完全交给 Flexbox：两个面包屑均为可独立横向滚动的 flex 项。
 */
import { CONSTANTS } from "./constants";

export function setStyle() {
    const head = document.getElementsByTagName('head')[0];
    const style = document.createElement('style');
    style.setAttribute("id", CONSTANTS.STYLE_ID);

    style.innerHTML = `
/* ===== 同行模式：连续内容带 ===== */
/* 原生 bar 是唯一滚动容器，也是 host 的 flex 项：
 * 有剩余空间时保持内容自然宽度；空间不足时按 max-content 基准压缩。 */
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar {
    flex-grow: 0;
    flex-shrink: 1;
    flex-basis: max-content;

    /* 允许缩小到自身内容宽度以下，超出的内容改为内部滚动 */
    min-inline-size: 0;

    /* v3.7+ 原生面包屑父容器为 42px，内容高度 30px */
    align-self: center;
    block-size: 30px;
    min-block-size: 30px;

    box-sizing: border-box;

    flex-wrap: nowrap !important;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
}
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar::-webkit-scrollbar {
    display: none;
}

/* 插件内容容器：bar 内连续内容带的第一段（不参与压缩） */
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar
    > .og-fdb-inline-breadcrumb {
    flex: 0 0 auto;
    align-self: center;
    block-size: 30px;
    min-block-size: 30px;

    box-sizing: border-box;

    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    white-space: nowrap;
    user-select: none;

    /* 滚动由原生 bar 统一承担 */
    overflow: visible;

    /* 与原生内容带的分隔由 JS 渲染为内容带末尾的装饰箭头
     * .og-fdb-inline__divider，不再使用边框竖线 */
    margin-inline-end: 6px;
}

/* 内容带内所有直接子项不得继续压缩（插件容器、原生路径项） */
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar
    > * {
    flex-shrink: 0;
}

/* 同行模式超长省略：空间不足时由 JS 逐个给文本加 --ellipsis，
 * 恢复思源原生省略机制（原生规则 max-width: 112px 省略号截断），
 * 不再覆盖为 none；省略后仍放不下时保留横向滚动。 */
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar
    .protyle-breadcrumb__text--ellipsis {
    max-inline-size: 112px;
}

/* 不修改 .protyle-breadcrumb__space，只禁止其右侧按钮被压缩 */
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__space
    ~ button {
    flex: 0 0 auto;
}

/* ===== 插件滚动区（通用） ===== */
.og-fdb-inline-breadcrumb {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;

    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-inline: contain;
    touch-action: pan-x;

    white-space: nowrap;
    scrollbar-width: none;
    user-select: none;

    box-sizing: border-box;
}
.og-fdb-inline-breadcrumb::-webkit-scrollbar {
    display: none;
}
.og-fdb-inline-breadcrumb > * {
    flex-shrink: 0;
}
.og-fdb-inline-breadcrumb .protyle-breadcrumb__text {
    margin-left: 0px;
    max-inline-size: none;
    overflow: visible;
    text-overflow: clip;
}

/* 插件文本的省略态：覆盖上一条的 no-ellipsis 属性，与原生 112px 规则一致 */
.og-fdb-inline-breadcrumb .protyle-breadcrumb__text.protyle-breadcrumb__text--ellipsis {
    max-inline-size: 112px;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* 两行模式容器 */
.og-fake-doc-breadcrumb-container.protyle-breadcrumb {
    padding-bottom: 0px;
}
.og-fake-doc-breadcrumb-container.protyle-breadcrumb
    > .og-fdb-inline-breadcrumb {
    flex: 1 1 auto;
    min-inline-size: 0;
    align-self: center;
    block-size: 30px;
    min-block-size: 30px;
}

/* ===== 路径项与箭头 ===== */
.og-fdb-inline__item,
.og-fdb-inline__arrow {
    font: inherit;
}

.og-fdb-item--disabled {
    cursor: default;
}

.og-fdb-inline__arrow {
    align-items: center;
    align-self: center;
    background: transparent;
    border: 0;
    border-radius: var(--b3-border-radius);
    color: var(--b3-theme-on-surface-light);
    cursor: pointer;
    display: inline-flex;
    flex: 0 0 auto;
    height: 24px;
    justify-content: center;
    margin: 3px 0;
    padding: 0 2px;
}
.og-fdb-inline__arrow > svg {
    height: 14px;
    width: 14px;
}

/* 内容带与原生内容带之间的装饰分隔箭头（同行模式，无交互） */
.og-fdb-inline__divider {
    align-items: center;
    align-self: center;
    color: var(--b3-theme-on-surface-light);
    display: inline-flex;
    flex: 0 0 auto;
    height: 24px;
    justify-content: center;
    margin: 3px 0;
    padding: 0 2px;
    pointer-events: none;
    user-select: none;
}
.og-fdb-inline__divider > svg {
    height: 14px;
    width: 14px;
}
.og-fdb-inline__arrow:hover {
    color: var(--b3-menu-highlight-color, var(--b3-theme-on-background));
    background-color: var(--b3-menu-highlight-background, var(--b3-list-hover));
}

/* ===== 图标 ===== */
.og-fdb-menu-emojitext, .og-fdb-menu-emojipic {
    align-self: center;
    height: 14px;
    width: 14px;
    line-height: 14px;
    margin-right: 8px;
    flex-shrink: 0;
}

.og-fdb-bread-emojitext, .og-fdb-bread-emojipic {
    align-self: center;
    height: 14px;
    width: 14px;
    line-height: 14px;
    margin-right: 8px;
    flex-shrink: 0;
}

.b3-menu__item img.og-fdb-menu-emojipic {
    width: 16px;
    height: 16px;
}

/* ===== 输入时隐藏 ===== */
.og-hide-breadcrumb {
    opacity: 0;
    transition: 1s;
}

/* ===== 相邻文档导航 ===== */
.og-fdb-doc-nav {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: 4px;
    flex-shrink: 0;
}

.og-fdb-doc-nav-button {
    align-items: center;
    background: transparent;
    border: none;
    border-radius: var(--b3-border-radius);
    color: var(--b3-theme-on-surface-light);
    cursor: pointer;
    display: inline-flex;
    gap: 4px;
    height: 24px;
    line-height: 24px;
    justify-content: center;
    max-width: min(180px, 12em, 22vw);
    min-width: 0;
    padding: 0 6px;
}

.og-fdb-doc-nav-button svg {
    flex-shrink: 0;
    height: 12px;
    width: 12px;
}

.og-fdb-doc-nav-button-text {
    display: inline-block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.og-fdb-doc-nav-button:not(:disabled):hover {
    color: var(--b3-menu-highlight-color, var(--b3-theme-on-background));
    background-color: var(--b3-menu-highlight-background, var(--b3-list-hover));
}
.og-fdb-doc-nav-button:disabled {
    cursor: not-allowed;
    opacity: 0.35;
}

/* ===== 移动端样式 ===== */
.og-fdb-mobile-btn-class {
    max-width: 60%;
    overflow: auto;
    display: flex;
}

.og-fdb-mobile-btn-path {
    max-width: 6em;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* ===== 覆盖 savor 主题样式 ===== */
.protyle-breadcrumb.og-fdb-inline-host
    > .og-fdb-inline-breadcrumb
    .protyle-breadcrumb__item:first-child::before,
.og-fake-doc-breadcrumb-container.protyle-breadcrumb
    > .og-fdb-inline-breadcrumb
    .protyle-breadcrumb__item:first-child::before {
    content: "";
    margin-right: 0px;
}

/* ===== 同行模式：原生首项图标恢复“首项”样式 =====
 * 插件内容带插入为 bar 的第一个子元素后，原生第一项不再是 :first-child，
 * savor 等主题会按“非首项”规则给它套上背景色块（含 active 态）。
 * 这里把紧随插件内容带的原生第一项图标恢复为思源默认 16px 无背景样式。 */
.protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar
    > .og-fdb-inline-breadcrumb
    + .protyle-breadcrumb__item
    > svg.popover__block {
    height: 16px;
    width: 16px;
    padding: 0;
    background-color: transparent !important;
    color: var(--b3-theme-on-surface);
}

/* Savor 主题：复刻其“首项”规则（📄 emoji + 透明占位 svg），
 * 保持与关闭同行模式时一致。官方集市版（royc01/notion-theme）
 * 第一项图标实际是 ::before 上的 📄，svg 仅作透明占位。 */
html[data-light-theme="Savor"] .protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar
    > .og-fdb-inline-breadcrumb
    + .protyle-breadcrumb__item::before,
html[data-dark-theme="Savor"] .protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar
    > .og-fdb-inline-breadcrumb
    + .protyle-breadcrumb__item::before {
    content: "📄";
    margin-right: -14px;
    font-size: 12px;
}
html[data-light-theme="Savor"] .protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar
    > .og-fdb-inline-breadcrumb
    + .protyle-breadcrumb__item
    > svg.popover__block,
html[data-dark-theme="Savor"] .protyle-breadcrumb.og-fdb-inline-host
    > .protyle-breadcrumb__bar
    > .og-fdb-inline-breadcrumb
    + .protyle-breadcrumb__item
    > svg.popover__block {
    color: transparent;
    background-color: transparent !important;
}
    `;
    head.appendChild(style);
}

export function removeStyle() {
    document.getElementById(CONSTANTS.STYLE_ID)?.remove();
}
