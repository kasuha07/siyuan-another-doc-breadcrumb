"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDocumentBreadcrumbModel = buildDocumentBreadcrumbModel;
exports.buildEntriesFromPath = buildEntriesFromPath;
exports.parseDocPath = parseDocPath;
/**
 * 构建文档面包屑的纯数据 ViewModel
 */
const constants_1 = require("./constants");
const logger_1 = require("./logger");
const state_1 = require("./state");
const adjacent_1 = require("./adjacent");
const api_1 = require("./api");
const utils_1 = require("./utils");
async function buildDocumentBreadcrumbModel(protyle, documentId) {
    const docDetail = await (0, api_1.getCurrentDocDetail)(documentId, protyle);
    if (!(0, utils_1.isValidStr)(docDetail)) {
        (0, logger_1.logPush)("数据库中找不到当前打开的文档");
        return null;
    }
    // 获取并解析hpath与path
    const pathObjects = await parseDocPath(docDetail);
    (0, logger_1.debugPush)("OBJECT", pathObjects);
    const notebookDocFlag = (0, utils_1.isNotebookDoc)(protyle.path, protyle.notebookId);
    const entries = await buildEntriesFromPath(pathObjects, protyle);
    let adjacent = null;
    if (state_1.state.g_setting.showAdjacentDocButton !== constants_1.CONSTANTS.ADJ_NONE) {
        adjacent = await (0, adjacent_1.getAdjacentDocs)(pathObjects, notebookDocFlag);
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
async function buildEntriesFromPath(pathObjects, protyle) {
    var _a, _b, _c, _d, _e, _f;
    var _g;
    const entries = [];
    // 折叠隐藏起始位置
    const foldStartAt = state_1.state.g_setting.showNotebook ? state_1.state.g_setting.foldedFrontShow :
        state_1.state.g_setting.foldedFrontShow + 1;
    // 折叠隐藏结束位置
    const foldEndAt = pathObjects.length - state_1.state.g_setting.foldedEndShow - 1;
    // 根层级（工作空间），不可点击
    if (state_1.state.g_setting.showRoot) {
        entries.push({
            kind: "root",
            label: state_1.state.language["root"],
            id: "",
            icon: "",
            path: "",
            box: "",
            parentId: "",
            nextId: (_g = (_a = pathObjects[0]) === null || _a === void 0 ? void 0 : _a.box) !== null && _g !== void 0 ? _g : "",
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
                if ((0, utils_1.isNotebookDocEnabled)()) {
                    hideFrom = 0;
                }
                else {
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
            (0, logger_1.debugPush)(hiddenEntries);
            entries.push({
                kind: "collapsed",
                label: "···",
                id: "",
                icon: "",
                path: (_b = pathObjects[foldEndAt]) === null || _b === void 0 ? void 0 : _b.path,
                box: (_c = pathObjects[foldEndAt]) === null || _c === void 0 ? void 0 : _c.box,
                parentId: (_d = pathObjects[foldEndAt]) === null || _d === void 0 ? void 0 : _d.id,
                nextId: (_e = pathObjects[foldEndAt + 1]) === null || _e === void 0 ? void 0 : _e.id,
                subFileCount: -1,
                hiddenEntries,
                hasChildren: true,
            });
            i = foldEndAt;
            // 避免为负数，但好像没啥用
            if (i < 0)
                i = 0;
            continue;
        }
        // 不显示笔记本层级时跳过笔记本
        if (i === 0 && !state_1.state.g_setting.showNotebook) {
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
            nextId: (_f = pathObjects[i + 1]) === null || _f === void 0 ? void 0 : _f.id,
            subFileCount: onePathObject.subFileCount,
            hasChildren: true,
        });
    }
    // 最后一个文档、且不含子文档时不再显示箭头
    const lastEntry = entries[entries.length - 1];
    if (lastEntry && lastEntry.kind === "document") {
        lastEntry.hasChildren = await isChildDocExist(protyle, lastEntry.id);
    }
    return entries;
}
async function isChildDocExist(protyle, id) {
    const sqlResponse = await (0, api_1.listDocsByPath)({
        path: protyle.path,
        notebook: protyle.notebookId,
        maxListLength: 3
    });
    if (sqlResponse && sqlResponse.files.length > 0) {
        return true;
    }
    return false;
}
async function parseDocPath(docDetail) {
    var _a;
    let docPath = (0, utils_1.getListDocsByPathAPIFilePath)(docDetail.path, docDetail.box);
    let pathArray = docPath.substring(0, docPath.length - 3).split("/");
    // 处理并发意外
    let hpath = (_a = docDetail.hpath) !== null && _a !== void 0 ? _a : await (0, api_1.getHPathByID)(docDetail.docId);
    let hpathArray = hpath.split("/");
    let resultArray = [];
    let notebooks = (0, api_1.getNotebooks)();
    let box;
    for (let notebook of notebooks) {
        if (notebook.id == docDetail.box) {
            box = notebook;
            break;
        }
    }
    let temp = {
        "name": box.name,
        "id": box.id,
        "icon": box.icon,
        "box": box.id,
        "path": "/",
        "type": "NOTEBOOK",
        "subFileCount": -1,
    };
    resultArray.push(temp);
    // 获取图标
    let icons = [""];
    let subFileCounts = [-1];
    if (state_1.state.g_setting.icon != constants_1.CONSTANTS.ICON_NONE) {
        let promiseList = [];
        for (let i = 1; i < pathArray.length; i++) {
            promiseList.push((0, api_1.getDocInfo)(pathArray[i]));
        }
        let iconResult = await Promise.all(promiseList);
        for (let i of iconResult) {
            icons.push(i.icon);
            subFileCounts.push(i.subFileCount);
        }
    }
    let temp_path = "";
    for (let i = 1; i < pathArray.length; i++) {
        let temp = {
            "name": hpathArray[i],
            "id": pathArray[i],
            "icon": "",
            "path": `${temp_path}/${pathArray[i]}.sy`,
            "box": box.id,
            "type": "FILE",
            "subFileCount": -1
        };
        if (state_1.state.g_setting.icon != constants_1.CONSTANTS.ICON_NONE) {
            temp["icon"] = icons[i];
            temp["subFileCount"] = subFileCounts[i];
        }
        temp_path += "/" + pathArray[i];
        resultArray.push(temp);
    }
    return resultArray;
}
