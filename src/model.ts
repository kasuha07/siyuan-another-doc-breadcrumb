/**
 * 构建文档面包屑的纯数据 ViewModel
 */
import { CONSTANTS } from "./constants";
import { debugPush, logPush } from "./logger";
import { state } from "./state";
import { getAdjacentDocs } from "./adjacent";
import { getCurrentDocDetail, getDocInfo, getHPathByID, getNotebooks, listDocsByPath } from "./api";
import { getListDocsByPathAPIFilePath, isNotebookDoc, isNotebookDocEnabled, isValidStr } from "./utils";
import type { BreadcrumbEntry, BreadcrumbModel, PathObject } from "./types";

export async function buildDocumentBreadcrumbModel(protyle: any, documentId: string): Promise<BreadcrumbModel | null> {
    const docDetail = await getCurrentDocDetail(documentId, protyle);
    if (!isValidStr(docDetail)) {
        logPush("数据库中找不到当前打开的文档");
        return null;
    }

    // 获取并解析hpath与path
    const pathObjects = await parseDocPath(docDetail);
    debugPush("OBJECT", pathObjects);

    // docDetail.path / docDetail.box 来自内核 API（getCurrentDocDetail 已消除
    // 主 ws 广播与 protyle ws 更新之间的顺序竞态），不使用 protyle 上的可能旧值
    const notebookDocFlag = isNotebookDoc(docDetail.path, docDetail.box);
    const entries = await buildEntriesFromPath(pathObjects, docDetail);

    let adjacent = null;
    if (state.g_setting.showAdjacentDocButton !== CONSTANTS.ADJ_NONE) {
        adjacent = await getAdjacentDocs(pathObjects, notebookDocFlag);
    }

    return {
        documentId,
        entries,
        adjacent
    };
}

/**
 * 将路径对象数组转为 BreadcrumbEntry 列表。
 * 折叠逻辑在此阶段完成，渲染时不再根据高度逐个添加 ellipsis。
 */
export async function buildEntriesFromPath(pathObjects: PathObject[], docDetail: any): Promise<BreadcrumbEntry[]> {
    const entries: BreadcrumbEntry[] = [];
    // 折叠隐藏起始位置
    const foldStartAt = state.g_setting.showNotebook ? state.g_setting.foldedFrontShow :
        state.g_setting.foldedFrontShow + 1;
    // 折叠隐藏结束位置
    const foldEndAt = pathObjects.length - state.g_setting.foldedEndShow - 1;

    // 根层级（工作空间），不可点击
    if (state.g_setting.showRoot) {
        entries.push({
            kind: "root",
            label: state.language["root"],
            id: "",
            icon: "",
            path: "",
            box: "",
            parentId: "",
            nextId: pathObjects[0]?.box ?? "",
            subFileCount: -1,
            hasChildren: true,
        });
    }

    let countDebug = 0;
    for (let i = 0; i < pathObjects.length; i++) {
        countDebug++;
        if (countDebug > 200) {
            throw new Error(">_<出现死循环");
        }

        // 层级过深时，对中间内容加以限制
        if (pathObjects.length > 5 && i >= foldStartAt && i <= foldEndAt) {
            let hideFrom = foldStartAt;
            // 过滤笔记本，因为笔记本不可点击
            if (hideFrom <= 0) {
                if (isNotebookDocEnabled()) {
                    hideFrom = 0;
                } else {
                    hideFrom = 1;
                }
            }
            const hiddenEntries = [];
            for (let j = hideFrom; j <= foldEndAt; j++) {
                hiddenEntries.push({
                    id: pathObjects[j].id,
                    name: pathObjects[j].name
                });
            }
            debugPush(hiddenEntries);
            entries.push({
                kind: "collapsed",
                label: "···",
                id: "",
                icon: "",
                path: pathObjects[foldEndAt]?.path,
                box: pathObjects[foldEndAt]?.box,
                parentId: pathObjects[foldEndAt]?.id,
                nextId: pathObjects[foldEndAt + 1]?.id,
                subFileCount: -1,
                hiddenEntries,
                hasChildren: true,
            });
            i = foldEndAt;
            // 避免为负数，但好像没啥用
            if (i < 0) i = 0;
            continue;
        }

        // 不显示笔记本层级时跳过笔记本
        if (i === 0 && !state.g_setting.showNotebook) {
            continue;
        }

        const onePathObject = pathObjects[i];
        entries.push({
            kind: onePathObject.type === "NOTEBOOK" ? "notebook" : "document",
            label: onePathObject.name,
            id: onePathObject.id,
            icon: onePathObject.icon,
            path: onePathObject.path,
            box: onePathObject.box,
            parentId: onePathObject.id,
            nextId: pathObjects[i + 1]?.id,
            subFileCount: onePathObject.subFileCount,
            hasChildren: true,
        });
    }

    // 最后一个文档、且不含子文档时不再显示箭头
    const lastEntry = entries[entries.length - 1];
    if (lastEntry && lastEntry.kind === "document") {
        lastEntry.hasChildren = await isChildDocExist(docDetail, lastEntry.id);
    }

    return entries;
}

async function isChildDocExist(docDetail: any, id: any) {
    const sqlResponse = await listDocsByPath({
        path: docDetail.path,
        notebook: docDetail.box,
        maxListLength: 3
    });
    if (sqlResponse && sqlResponse.files.length > 0) {
        return true;
    }
    return false;
}

export async function parseDocPath(docDetail: any): Promise<PathObject[]> {
    // getListDocsByPathAPIFilePath 仅当入参 fullPath 为 null 时才返回 null；docDetail.path 由 API 返回必然存在
    let docPath = getListDocsByPathAPIFilePath(docDetail.path, docDetail.box)!;
    let pathArray = docPath.substring(0, docPath.length - 3).split("/");
    // 处理并发意外；hpath 仍可能为 null（内核返回异常），降级用 id 路径兜底，避免整条构建链中断
    let hpath = docDetail.hpath ?? await getHPathByID(docDetail.docId);
    let hpathArray = isValidStr(hpath) ? hpath.split("/") : pathArray;
    let resultArray: PathObject[] = [];
    let notebooks = getNotebooks() ?? [];
    // 笔记本列表缺失当前 box（内核数据异常）时降级：以 box id 兜底，保证路径可渲染
    let box: any = null;
    for (let notebook of notebooks) {
        if (notebook.id == docDetail.box) {
            box = notebook;
            break;
        }
    }
    if (!box) {
        box = { "id": docDetail.box, "name": docDetail.box, "icon": "" };
    }
    let temp: PathObject = {
        "name": box.name,
        "id": box.id,
        "icon": box.icon,
        "box": box.id,
        "path": "/",
        "type": "NOTEBOOK",
        "subFileCount": -1,
    }
    resultArray.push(temp);
    // 获取图标
    let icons = [""]
    let subFileCounts = [-1]
    if (state.g_setting.icon != CONSTANTS.ICON_NONE) {
        let promiseList = [];
        for (let i = 1; i < pathArray.length; i++) {
            promiseList.push(getDocInfo(pathArray[i]));
        }
        let iconResult = await Promise.all(promiseList);
        for (let i of iconResult) {
            // getDocInfo 可能返回 null（内核异常），逐项降级，单项失败不中断构建链
            icons.push(i?.icon ?? "");
            subFileCounts.push(i?.subFileCount ?? -1);
        }
    }
    let temp_path = "";
    for (let i = 1; i < pathArray.length; i++) {
        let temp: PathObject = {
            "name": hpathArray[i] ?? pathArray[i],
            "id": pathArray[i],
            "icon": "",
            "path": `${temp_path}/${pathArray[i]}.sy`,
            "box": box.id,
            "type": "FILE",
            "subFileCount": -1
        }
        if (state.g_setting.icon != CONSTANTS.ICON_NONE) {
            temp["icon"] = icons[i];
            temp["subFileCount"] = subFileCounts[i]
        }
        temp_path += "/" + pathArray[i];
        resultArray.push(temp);
    }
    return resultArray;
}
