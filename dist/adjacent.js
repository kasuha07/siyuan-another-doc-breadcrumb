"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdjacentDocNav = createAdjacentDocNav;
exports.createAdjacentDocButton = createAdjacentDocButton;
exports.trimDocName = trimDocName;
exports.getAdjacentDocs = getAdjacentDocs;
exports.getNotebookAdjacentDocs = getNotebookAdjacentDocs;
exports.getAdjacentChildDocs = getAdjacentChildDocs;
exports.getAdjacentDocsByDepth = getAdjacentDocsByDepth;
exports.findAdjacentDocIndex = findAdjacentDocIndex;
exports.clickAdjacentDocButton = clickAdjacentDocButton;
/**
 * [START] 相邻文档导航相关
 */
const logger_1 = require("./logger");
const constants_1 = require("./constants");
const state_1 = require("./state");
const api_1 = require("./api");
const utils_1 = require("./utils");
function createAdjacentDocNav(adjacent, controller) {
    const navElement = document.createElement("span");
    navElement.className = "og-fdb-doc-nav";
    navElement.appendChild(createAdjacentDocButton("previous", adjacent.previousDoc, adjacent.sameLevelPrevious, controller));
    navElement.appendChild(createAdjacentDocButton("next", adjacent.nextDoc, adjacent.sameLevelNext, controller));
    return navElement;
}
function createAdjacentDocButton(direction, doc, isSameLevel = false, controller) {
    var _a;
    const isPrevious = direction === "previous";
    const label = isPrevious ? (state_1.state.language["previous_doc"]) : (state_1.state.language["next_doc"]);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "og-fdb-doc-nav-button";
    button.setAttribute("data-og-adjacent-direction", direction);
    let buttonText = label;
    if (doc === null || doc === void 0 ? void 0 : doc.id) {
        const docName = (0, utils_1.trimListDocsByPathAPIReturnedDocName)((_a = doc === null || doc === void 0 ? void 0 : doc.name) !== null && _a !== void 0 ? _a : "");
        const trimedDocName = trimDocName(docName, state_1.state.g_setting.nameMaxLength);
        buttonText = docName;
        const actionKey = controller.registerAction({
            type: "open-adjacent",
            docId: doc.id
        });
        button.setAttribute("data-og-fdb-action-key", actionKey);
        button.setAttribute("data-doc-id", doc.id);
        button.setAttribute("title", `${label}: ${docName}`);
    }
    else {
        button.disabled = true;
        button.setAttribute("title", label);
    }
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("title", button.getAttribute("title"));
    const use = document.createElementNS(svgNS, "use");
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", isPrevious ? "#iconLeft" : "#iconRight");
    svg.appendChild(use);
    const textSpan = document.createElement("span");
    textSpan.className = "og-fdb-doc-nav-button-text";
    textSpan.textContent = buttonText;
    if (isPrevious) {
        button.appendChild(svg);
        button.appendChild(textSpan);
    }
    else {
        button.appendChild(textSpan);
        button.appendChild(svg);
    }
    return button;
}
function trimDocName(name, maxLength) {
    if (name.length <= maxLength) {
        return name;
    }
    return name.substring(0, state_1.state.g_setting.nameMaxLength) + "...";
}
async function getAdjacentDocs(pathObjects, notebookDocFlag) {
    var _a, _b, _c, _d;
    const result = {
        previousDoc: null,
        nextDoc: null,
        sameLevelPrevious: false,
        sameLevelNext: false,
    };
    // 如果是笔记本层级，且当前文档是笔记本文档，也继续
    if (!Array.isArray(pathObjects) || (pathObjects.length <= 1 && !notebookDocFlag)) {
        return result;
    }
    const currentDoc = pathObjects[pathObjects.length - 1];
    const previousDoc = pathObjects[pathObjects.length - 2];
    const currentDepth = pathObjects.length - 1;
    let sameLevelDocs = null;
    if (notebookDocFlag) {
        sameLevelDocs = await getNotebookAdjacentDocs(currentDoc.box);
    }
    else {
        sameLevelDocs = await getAdjacentChildDocs(previousDoc);
    }
    const currentIndex = findAdjacentDocIndex(sameLevelDocs, currentDoc.id);
    if (currentIndex < 0) {
        return result;
    }
    result.previousDoc = (_a = sameLevelDocs[currentIndex - 1]) !== null && _a !== void 0 ? _a : null;
    result.nextDoc = (_b = sameLevelDocs[currentIndex + 1]) !== null && _b !== void 0 ? _b : null;
    // 如果是笔记本层级，不再寻找同层级——已经到头了
    if (state_1.state.g_setting.showAdjacentDocButton === constants_1.CONSTANTS.ADJ_SAME_LEVEL
        && (!result.previousDoc || !result.nextDoc) && !notebookDocFlag) {
        (0, logger_1.debugPush)("当前文档同级没有足够的文档，尝试向上获取同层级文档");
        const cache = {};
        const sameLevelDocs = await getAdjacentDocsByDepth(pathObjects[0], currentDepth, cache);
        const currentIndex = findAdjacentDocIndex(sameLevelDocs, currentDoc.id);
        if (result.previousDoc == null && currentIndex > 0) {
            result.sameLevelPrevious = true;
            result.previousDoc = (_c = sameLevelDocs[currentIndex - 1]) !== null && _c !== void 0 ? _c : null;
        }
        if (result.nextDoc == null && currentIndex < sameLevelDocs.length - 1) {
            result.sameLevelNext = true;
            result.nextDoc = (_d = sameLevelDocs[currentIndex + 1]) !== null && _d !== void 0 ? _d : null;
        }
    }
    return result;
}
/**
 * 获取笔记本的相邻文档
 * @param {*} notebookId
 * @param {*} cache
 * @returns
 */
async function getNotebookAdjacentDocs(notebookId, cache = null) {
    var _a;
    if (!notebookId) {
        return [];
    }
    const cacheKey = `notebook-${notebookId}`;
    if (cache && cache[cacheKey]) {
        (0, logger_1.debugPush)("使用传入缓存", cacheKey);
        return cache[cacheKey].data;
    }
    if (state_1.state.g_adjacentDocCache[cacheKey] && (Date.now() - state_1.state.g_adjacentDocCache[cacheKey].timestamp < 3 * 60 * 1000) && state_1.state.g_setting.immediatelyUpdate) {
        (0, logger_1.debugPush)("使用笔记本文档缓存", cacheKey);
        return state_1.state.g_adjacentDocCache[cacheKey].data;
    }
    const notebookList = (_a = await (0, api_1.getNodebookList)()) !== null && _a !== void 0 ? _a : [];
    const result = notebookList.filter(notebook => notebook.closed == false);
    // 面包屑情况下不太需要详细信息，这里先不调用信息补全了
    // await fillNotebookDocFileInfo(notebookList.filter(notebook=>notebook.closed==false));
    if (cache) {
        cache[cacheKey] = {
            "data": result,
            "timestamp": Date.now(),
        };
    }
    state_1.state.g_adjacentDocCache[cacheKey] = {
        "data": result,
        "timestamp": Date.now(),
    };
    return state_1.state.g_adjacentDocCache[cacheKey].data;
}
async function getAdjacentChildDocs(parentDoc, cache = null) {
    var _a;
    if (!(parentDoc === null || parentDoc === void 0 ? void 0 : parentDoc.path) || !(parentDoc === null || parentDoc === void 0 ? void 0 : parentDoc.box)) {
        return [];
    }
    const cacheKey = `${parentDoc.box}-${parentDoc.path}`;
    if (cache && cache[cacheKey]) {
        (0, logger_1.debugPush)("使用传入缓存", cacheKey);
        return cache[cacheKey].data;
    }
    if (cache == null && state_1.state.g_adjacentDocCache[cacheKey] && (Date.now() - state_1.state.g_adjacentDocCache[cacheKey].timestamp < 3 * 60 * 1000) && state_1.state.g_setting.immediatelyUpdate) {
        (0, logger_1.debugPush)("使用相邻文档缓存", cacheKey);
        return state_1.state.g_adjacentDocCache[cacheKey].data;
    }
    const response = await (0, api_1.listDocsByPath)({
        path: parentDoc.path,
        notebook: parentDoc.box,
        ignoreDocMaxNum: true,
    });
    const processedResponse = ((_a = response === null || response === void 0 ? void 0 : response.files) !== null && _a !== void 0 ? _a : []).map(doc => {
        doc["box"] = parentDoc.box;
        return doc;
    });
    if (cache) {
        cache[cacheKey] = {
            "data": processedResponse,
            "timestamp": Date.now(),
        };
    }
    state_1.state.g_adjacentDocCache[cacheKey] = {
        "data": processedResponse,
        "timestamp": Date.now(),
    };
    return state_1.state.g_adjacentDocCache[cacheKey].data;
}
async function getAdjacentDocsByDepth(parentDoc, targetDepth, cache) {
    if (targetDepth <= 0) {
        return [];
    }
    const childDocs = await getAdjacentChildDocs(parentDoc, cache);
    if (targetDepth === 1) {
        return childDocs;
    }
    let result = [];
    for (const childDoc of childDocs) {
        if (childDoc.subFileCount === 0) {
            continue;
        }
        const subDocs = await getAdjacentDocsByDepth(childDoc, targetDepth - 1, cache);
        result = result.concat(subDocs);
    }
    return result;
}
function findAdjacentDocIndex(docList, docId) {
    return docList.findIndex(doc => doc.id === docId);
}
// [END] 相邻文档导航相关
function clickAdjacentDocButton(event, docId) {
    if (!docId) {
        return;
    }
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
