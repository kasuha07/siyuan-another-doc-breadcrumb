/**
 * 全局常量与默认配置
 */
export const CONSTANTS = {
    RANDOM_DELAY: 300, // 插入挂件的延迟最大值，300（之后会乘以10）对应最大延迟3秒
    OBSERVER_RANDOM_DELAY: 500, // 插入链接、引用块和自定义时，在OBSERVER_RANDOM_DELAY_ADD的基础上增加延时，单位毫秒
    OBSERVER_RANDOM_DELAY_ADD: 100, // 插入链接、引用块和自定义时，延时最小值，单位毫秒
    OBSERVER_RETRY_INTERVAL: 1000, // 找不到页签时，重试间隔
    STYLE_ID: "fake-doc-breadcrumb-plugin-style",
    ICON_ALL: 2,
    ICON_NONE: 0,
    ICON_CUSTOM_ONLY: 1,
    PLUGIN_NAME: "og_fake_doc_breadcrumb",
    SAVE_TIMEOUT: 900,
    CONTAINER_CLASS_NAME: "og-fake-doc-breadcrumb-container",
    INLINE_BREADCRUMB_CLASS_NAME: "og-fdb-inline-breadcrumb",
    HOST_STATE_CLASS_NAME: "og-fdb-inline-host",
    MENU_ITEM_CLASS_NAME: "og-fake-doc-breadcrumb-menu-item-container",
    SIBLING_CONTAINER_ID: "og-fake-doc-breadcrumb-sibling-doc-container",
    INDICATOR_CLASS_NAME: "og-fake-doc-breadcrumb-doc-indicator",
    MENU_CURRENT_DOC_CLASS_NAME: "og-fdb-current-doc-in-menu",
    POP_NONE: 0,
    POP_LIMIT: 1,
    POP_ALL: 2,
    MAX_NAME_LENGTH: 15,
    MULTILINE_CONFLICT_PLUGINS: ["siyuan-plugin-toolbar-plus"],
    ADJ_NONE: "0",
    ADJ_SAME_PARENT: "1",
    ADJ_SAME_LEVEL: "2",
    ADJ_SHOW_TEXT: "0",
    ADJ_ARROW_ONLY: "1",
}

export const g_setting_default = {
    "@version": 20260805,
    "nameMaxLength": 15,
    "docMaxNum": 128,
    "showNotebook": true,
    "foldedFrontShow": 2,
    "foldedEndShow": 3,
    "oneLineBreadcrumb": false,
    "timelyUpdate": true, // 及时响应更新
    "immediatelyUpdate": false, // 实时响应更新
    "allowFloatWindow": false, // 触发浮窗
    "usePluginArrow": true, // 使用挂件>箭头
    "icon": 1,
    "menuKeepCurrentVisible": true,
    "menuExtendSubDocDepth": 2,
    "showRoot": false,
    "showAdjacentDocButton": CONSTANTS.ADJ_SAME_LEVEL,
    "adjacentNavStyle": CONSTANTS.ADJ_SHOW_TEXT,
    "autoFixFocusError": false,
    "createDocBtnInMenu": true,
};

/**
 * 默认语言包（onload 后会被插件 i18n 覆盖）
 */
export let zh_CN: { [key: string]: string } = {
    "setting_nameMaxLength_name": "文档名最大长度",
    "setting_nameMaxLength_desp": "文档名超出的部分将被删除。设置为0则不限制。",
    "setting_docMaxNum_name": "文档最大数量",
    "setting_docMaxNum_desp": "当子文档或同级文档超过该值时，后续文档将不再显示。设置为0则不限制。",
    "setting_showAdjacentDocButton_name": "显示上一篇/下一篇按钮",
    "setting_showAdjacentDocButton_desp": "在文档面包屑右侧显示上一篇文档和下一篇文档按钮；按文件树顺序在同一层级深度的文档之间跳转。",
    "createDocFailed": "创建文档失败",
    "previous_doc": "上一篇文档",
    "next_doc": "下一篇文档",
    "error_initFailed": "文档面包屑插件初始化失败，如果可以，请向开发者反馈此问题",
    "setting_panel_title": "文档面包屑插件设置",
    "documentBreadcrumb": "文档路径",
    "arrow_menu": "展开子文档菜单",
}
