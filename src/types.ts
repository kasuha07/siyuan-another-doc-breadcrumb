/**
 * 共享类型定义
 */

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

/** controller 内部注册的 action */
export interface ControllerAction {
    type: string;
    entry?: BreadcrumbEntry;
    docId?: string;
}

/** 渲染层需要的 controller 最小接口（避免循环依赖） */
export interface ActionRegistrar {
    registerAction(payload: ControllerAction): string;
}
