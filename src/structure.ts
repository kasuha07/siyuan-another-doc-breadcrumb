/**
 * ws-main 文档结构变更的影响范围：
 * 把各 cmd 的推送载荷（kernel/model/file.go、push_reload.go、api/notebook.go，v3.8.6）
 * 统一归一为“某笔记本下某目录的子文档列表发生变化”，据此只刷新受影响的
 * 编辑器、只失效对应的相邻文档列表缓存，而非每次全量刷新与清空。
 */
import { CONSTANTS } from "./constants";
import { state } from "./state";
import { isNotebookDoc } from "./utils";
import type { BreadcrumbModel } from "./types";

/** 子文档列表发生变化的目录：dir 为不带 .sy 的目录路径，笔记本根为 "/" */
export interface StructureScope {
    box: string;
    dir: string;
}

export interface StructureChange {
    scopes: StructureScope[];
    /** 载荷不足以定位范围（如 removeDoc 只有 id）时整体失效 */
    global: boolean;
}

const STRUCTURE_CMDS = ["create", "moveDoc", "rename", "removeDoc", "filetreeSortChanged", "renamenotebook"];

/** "/a/b/c.sy" → "/a/b/c" */
function stripSy(p: string) {
    return p.endsWith(".sy") ? p.substring(0, p.length - 3) : p;
}

/** 文档路径所在目录："/a/b/c.sy" → "/a/b"，"/c.sy" → "/" */
function getParentDir(p: string) {
    const docDir = stripSy(p);
    const index = docDir.lastIndexOf("/");
    return index <= 0 ? "/" : docDir.substring(0, index);
}

function isValidPath(p: any): p is string {
    return typeof p === "string" && p.startsWith("/");
}

/**
 * 解析 ws-main 消息；非结构变更返回 null。
 * - create：{ box: Box 对象, path }；
 * - rename：{ box, id, path, title }；
 * - moveDoc：{ fromNotebook, fromPath, toNotebook, toPath, newPath }，涉及新旧两个目录；
 * - removeDoc：{ ids }，无路径，整体失效（低频操作）；
 * - filetreeSortChanged：{ notebook, parentPath }（parentPath 已是目录）；
 * - renamenotebook：{ box, name }，笔记本根目录。
 */
export function parseStructureChange(cmd: string, data: any): StructureChange | null {
    if (!STRUCTURE_CMDS.includes(cmd)) {
        return null;
    }
    const scopes: StructureScope[] = [];
    const add = (box: any, dir: string) => {
        if (typeof box === "string" && box !== "") {
            scopes.push({ box, dir });
        }
    };
    switch (cmd) {
        case "create":
            if (isValidPath(data?.path)) {
                add(data.box?.id ?? data.box, getParentDir(data.path));
            }
            break;
        case "rename":
            if (isValidPath(data?.path)) {
                add(data.box, getParentDir(data.path));
            }
            break;
        case "moveDoc":
            if (isValidPath(data?.fromPath)) {
                add(data.fromNotebook, getParentDir(data.fromPath));
            }
            if (isValidPath(data?.newPath)) {
                add(data.toNotebook, getParentDir(data.newPath));
            }
            break;
        case "filetreeSortChanged":
            if (isValidPath(data?.parentPath)) {
                add(data.notebook, stripSy(data.parentPath));
            }
            break;
        case "renamenotebook":
            add(data?.box, "/");
            break;
    }
    return { scopes, global: scopes.length === 0 };
}

/**
 * 当前文档路径的全部前缀目录："/a/b/c.sy" → ["/", "/a", "/a/b", "/a/b/c"]。
 * 某目录的子文档列表变化只可能影响以这些目录为前缀的面包屑：
 * 祖先改名/移动（名称）、祖先或自身增减子文档（图标与箭头）、同级增减（相邻导航）。
 */
function getPathDirs(p: string) {
    const dirs = ["/"];
    const parts = stripSy(p).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
        current += "/" + part;
        dirs.push(current);
    }
    return dirs;
}

export function isModelAffected(model: BreadcrumbModel | null, change: StructureChange) {
    if (!model || change.global || !isValidPath(model.path) || !model.box) {
        return true;
    }
    // 笔记本文档的相邻列表是全部笔记本，任何笔记本的变化都可能影响
    if (isNotebookDoc(model.path, model.box)) {
        return true;
    }
    const sameLevel = state.g_setting.showAdjacentDocButton === CONSTANTS.ADJ_SAME_LEVEL;
    const dirs = getPathDirs(model.path);
    return change.scopes.some(scope => scope.box === model.box
        // 同层级深度模式会跨父目录查找相邻文档，同笔记本内任何变化都可能影响
        && (sameLevel || dirs.includes(scope.dir)));
}

/** 目录对应的 listDocsByPath 路径（相邻文档缓存键的一部分，见 adjacent.getAdjacentChildDocs） */
function getListPath(dir: string) {
    return dir === "/" ? "/" : dir + ".sy";
}

/**
 * 只失效受影响的相邻文档列表：
 * - 变化目录自身的子文档列表；
 * - 其上一级列表：目录对应文档的 subFileCount 随之变化，同层级查找依赖它剪枝；
 * - 笔记本根变化时一并失效笔记本列表（笔记本文档模式的相邻列表）。
 */
export function invalidateAdjacentDocCache(change: StructureChange) {
    if (change.global) {
        state.g_adjacentDocCache = {};
        return;
    }
    for (const { box, dir } of change.scopes) {
        delete state.g_adjacentDocCache[`${box}-${getListPath(dir)}`];
        if (dir !== "/") {
            delete state.g_adjacentDocCache[`${box}-${getListPath(getParentDir(dir + ".sy"))}`];
        } else {
            delete state.g_adjacentDocCache[`notebook-${box}`];
        }
    }
}
