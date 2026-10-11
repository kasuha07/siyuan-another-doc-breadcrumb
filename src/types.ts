/**
 * 共享类型定义
 */
import type { IMenu } from "siyuan";

/** 思源 3.8.0 原生懒加载字段，补齐当前 SDK 尚未声明的最小接口。 */
export interface LazyMenuItem extends IMenu {
    loadSubmenu?: () => Promise<LazyMenuItem[]>;
}

/** listDocsByPath 与笔记本列表共有的菜单字段。 */
export interface ChildDocument {
    id: string;
    name: string;
    icon?: string;
    path?: string;
    subFileCount?: number;
}

/** getBlockBreadcrumbChildren 的分页响应。 */
export interface BlockBreadcrumbChild {
    id: string;
    type: string;
    subType?: string;
    name: string;
    hasChildren?: boolean;
}

export interface BlockBreadcrumbChildren {
    items: BlockBreadcrumbChild[];
    hasMore: boolean;
}

/** 面包屑路径项（ViewModel） */
export interface BreadcrumbEntry {
    kind: "root" | "notebook" | "document" | "collapsed";
    label: string;
    id?: string;
    icon?: string;
    box?: string;
    path?: string;
    parentId?: string;
    nextId?: string;
    subFileCount?: number;
    hiddenEntries?: Array<{ id: string; name: string }>;
    hasChildren?: boolean;
}

/** parseDocPath 产出的路径对象 */
export interface PathObject {
    name: string;
    id: string;
    icon: string;
    box: string;
    path: string;
    type: "NOTEBOOK" | "FILE";
    subFileCount: number;
}

/** 面包屑完整 ViewModel */
export interface BreadcrumbModel {
    documentId: string;
    entries: BreadcrumbEntry[];
    adjacent: AdjacentResult | null;
}

/** 相邻文档导航结果 */
export interface AdjacentResult {
    previousDoc: any;
    nextDoc: any;
    sameLevelPrevious: boolean;
    sameLevelNext: boolean;
}

/** controller 内部注册的 action（判别联合：type 决定携带的字段） */
export type ControllerAction =
    | { type: "open-document"; entry: BreadcrumbEntry }
    | { type: "open-collapsed-menu"; entry: BreadcrumbEntry }
    | { type: "open-relative-menu"; entry: BreadcrumbEntry }
    | { type: "open-adjacent"; docId: string };

/** 渲染层需要的 controller 最小接口（避免循环依赖） */
export interface ActionRegistrar {
    registerAction(payload: ControllerAction): string;
}
