"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNotebooks = getNotebooks;
exports.getNodebookList = getNodebookList;
exports.getCurrentDocDetail = getCurrentDocDetail;
exports.getHPathByID = getHPathByID;
exports.listDocTree = listDocTree;
exports.getNotebookInfo = getNotebookInfo;
exports.getChildDocuments = getChildDocuments;
exports.request = request;
exports.parseBody = parseBody;
exports.createAndOpenEmptyDocAt = createAndOpenEmptyDocAt;
exports.createDoc = createDoc;
exports.getDocOutline = getDocOutline;
exports.getDocInfo = getDocInfo;
exports.listDocsByPath = listDocsByPath;
exports.sqlAPI = sqlAPI;
exports.openRefLinkAgent = openRefLinkAgent;
exports.tryToFixAllError = tryToFixAllError;
exports.openRefLinkByAPI = openRefLinkByAPI;
exports.removeCurrentTabF = removeCurrentTabF;
exports.fillNotebookDocFileInfo = fillNotebookDocFileInfo;
/**
 * 思源 API 封装与打开文档相关逻辑
 */
const siyuan_1 = require("siyuan");
const siyuan = __importStar(require("siyuan"));
const logger_1 = require("./logger");
const state_1 = require("./state");
const utils_1 = require("./utils");
function getNotebooks() {
    let notebooks = window.top.siyuan.notebooks;
    return notebooks;
}
async function getNodebookList() {
    let url = "/api/notebook/lsNotebooks";
    let response = await postRequest({}, url);
    if (response.code == 0 && response.data != null && "notebooks" in response.data) {
        return response.data.notebooks;
    }
    return null;
}
async function getCurrentDocDetail(docId, protyle) {
    let result = {
        path: protyle.path,
        hpath: await getHPathByID(docId),
        box: protyle.notebookId,
        docId: protyle.block.rootID
    };
    return result;
}
async function getHPathByID(docId) {
    let url = "/api/filetree/getHPathByID";
    let data = {
        id: docId
    };
    return parseBody(request(url, data));
}
async function listDocTree(notebook, path) {
    const url = "/api/filetree/listDocTree";
    let postBody = {
        notebook,
        path
    };
    let response = await postRequest(postBody, url);
    if (response.code == 0) {
        return response.data.tree;
    }
    else {
        throw new Error("listDocTree Failed: " + response.msg);
    }
}
async function getNotebookInfo(notebookId) {
    let url = "/api/notebook/getNotebookInfo";
    let response = await postRequest({ notebook: notebookId }, url);
    if (response.code == 0 && response.data != null) {
        return response.data.boxInfo;
    }
    else {
        (0, logger_1.warnPush)("请求笔记本信息时出错  ", response["msg"]);
    }
    return null;
}
async function getChildDocuments(docId, sqlResult) {
    let childDocs = await listDocsByPath({ path: sqlResult[0].path, notebook: sqlResult[0].box });
    if (childDocs.files.length > state_1.state.g_setting.docMaxNum && state_1.state.g_setting.docMaxNum != 0) {
        childDocs.files = childDocs.files.slice(0, state_1.state.g_setting.docMaxNum);
    }
    return childDocs.files;
}
async function postRequest(data, url) {
    let response = await fetch(url, {
        body: JSON.stringify(data),
        method: 'POST'
    }).then(function (response) {
        return response.json();
    });
    return response;
}
async function request(url, data) {
    let resData = null;
    await fetch(url, {
        body: JSON.stringify(data),
        method: 'POST'
    }).then(function (response) {
        resData = response.json();
    });
    return resData;
}
async function parseBody(response) {
    let r = await response;
    return r.code === 0 ? r.data : null;
}
async function createAndOpenEmptyDocAt(box, path) {
    const newPath = (path.endsWith(".sy") ? path.substring(0, path.length - 3) + "/" : path) + window.Lute.NewNodeID() + ".sy";
    createDoc(box, newPath, window.siyuan.languages.untitled, "", true).then((response) => {
        if (response && response.id) {
            openRefLinkByAPI({
                paramDocId: response.id,
            });
        }
    }).catch((err) => {
        (0, logger_1.errorPush)(err);
    });
}
async function createDoc(notebookId, path, title, md, listDocTree) {
    let url = "/api/filetree/createDoc";
    let data = {
        notebook: notebookId,
        path: path,
        title: title,
        md: md,
        listDocTree: listDocTree
    };
    let response = await request(url, data);
    if (response.code == 0) {
        return response.data;
    }
    else {
        return null;
    }
}
async function getDocOutline(docId) {
    let url = "/api/outline/getDocOutline";
    let data = { "id": docId };
    let response = await request(url, data);
    if (response.code == 0) {
        return response.data;
    }
    else {
        return null;
    }
}
async function getDocInfo(docId) {
    let url = `/api/block/getDocInfo`;
    return parseBody(request(url, { id: docId }));
}
async function listDocsByPath({ path, notebook = undefined, sort = undefined, maxListLength = undefined, ignoreDocMaxNum = false }) {
    let data = {
        path: path,
        "ignoreMaxListHint": true
    };
    if (notebook)
        data["notebook"] = notebook;
    if (sort)
        data["sort"] = sort;
    if (maxListLength != undefined) {
        data["maxListCount"] = maxListLength;
    }
    else if (!ignoreDocMaxNum && state_1.state.g_setting.docMaxNum != 0) {
        data["maxListCount"] = state_1.state.g_setting.docMaxNum >= 32 ? state_1.state.g_setting.docMaxNum : 32;
    }
    else {
        data["maxListCount"] = 0;
    }
    let url = '/api/filetree/listDocsByPath';
    return parseBody(request(url, data));
    //文档hepath与Markdown 内容
}
async function sqlAPI(stmt) {
    let data = {
        "stmt": stmt
    };
    let url = `/api/query/sql`;
    return parseBody(request(url, data));
}
function openRefLinkAgent(event, paramId = "", keyParam = undefined, protyleElem = undefined, openInFocus = !state_1.state.g_setting.preferOpenInCurrentSplit) {
    openRefLinkByAPI({
        mouseEvent: event,
        paramDocId: paramId,
        keyParam: keyParam,
        preventDefault: !state_1.state.g_setting.preferOpenInCurrentSplit,
    });
}
async function tryToFixAllError() {
    if (!state_1.state.g_setting.autoFixFocusError) {
        (0, siyuan_1.showMessage)(state_1.state.language["autoFixEnableFirst"] + "--- fakeDocBreadcrumb");
        return;
    }
    if (window.siyuan.dialogs.length == 1) {
        window.siyuan.dialogs[0].destroy();
    }
    else {
        (0, siyuan_1.showMessage)(state_1.state.language["closeOtherDialog"] + " --- fakeDocBreadcrumb");
    }
    if (window["OG_FDB_NO_WARNING"] == true) {
        (0, siyuan_1.showMessage)(state_1.state.language["onlyOneRunning"] + " --- fakeDocBreadcrumb");
        return;
    }
    try {
        window["OG_FDB_NO_WARNING"] = true;
        (0, siyuan_1.showMessage)(state_1.state.language["batchFixStart"] + "--- fakeDocBreadcrumb");
        const list = window.siyuan.storage["local-fileposition"];
        if (list) {
            for (let key in list) {
                if (list.hasOwnProperty(key)) {
                    if (list[key] && list[key]["zoomInId"] === key) {
                        openRefLinkByAPI({
                            paramDocId: key
                        });
                        await (0, utils_1.sleep)(5000);
                    }
                }
            }
        }
    }
    catch (err) {
        (0, logger_1.errorPush)(err);
    }
    finally {
        (0, siyuan_1.showMessage)(state_1.state.language["batchFixEnd"] + "--- fakeDocBreadcrumb");
        window["OG_FDB_NO_WARNING"] = false;
    }
}
let lastClickTime_openRefLinkByAPI = 0;
/**
 * 基于API的打开思源块/文档
 * @param mouseEvent 鼠标点击事件，如果存在，优先使用
 * @param paramDocId 如果没有指定 event，使用此参数作为文档id
 * @param keyParam 如果没有event，使用此次数指定ctrlKey后台打开、shiftKey下方打开、altKey右侧打开
 * @param openInFocus 是否以聚焦块的方式打开（此参数有变动）
 * @param removeCurrentTab 是否移除当前Tab
 * @param autoRemoveJudgeMiliseconds 自动判断是否移除当前Tab的时间间隔（0则 不自动判断）
 * @param preventDefault {boolean} 控制是否禁止默认行为以及冒泡操作；如果在菜单中，请在调用前禁止冒泡和默认行为；另外，也可充当是否在当前聚焦窗口打开的控制（false，则在面包屑所在文档打开）
 * @returns
 */
function openRefLinkByAPI({ mouseEvent, paramDocId = "", keyParam = {}, openInFocus = undefined, removeCurrentTab = undefined, autoRemoveJudgeMiliseconds = 0, preventDefault = false }) {
    var _a, _b, _c, _d, _e, _f;
    let docId;
    if ((0, utils_1.isValidStr)(paramDocId)) {
        docId = paramDocId;
    }
    else {
        if (mouseEvent && ((_a = mouseEvent.currentTarget) === null || _a === void 0 ? void 0 : _a.getAttribute("data-node-id"))) {
            docId = (_b = mouseEvent.currentTarget) === null || _b === void 0 ? void 0 : _b.getAttribute("data-node-id");
        }
        else if (mouseEvent && ((_c = mouseEvent.currentTarget) === null || _c === void 0 ? void 0 : _c.getAttribute("data-id"))) {
            docId = (_d = (mouseEvent.currentTarget)) === null || _d === void 0 ? void 0 : _d.getAttribute("data-id");
        }
        else if (mouseEvent && mouseEvent && ((_e = mouseEvent.currentTarget) === null || _e === void 0 ? void 0 : _e.getAttribute("data-og-doc-node-id"))) {
            docId = (_f = mouseEvent.currentTarget) === null || _f === void 0 ? void 0 : _f.getAttribute("data-og-doc-node-id");
        }
    }
    // 处理笔记本等无法跳转的情况
    if (!(0, utils_1.isValidStr)(docId)) {
        (0, logger_1.debugPush)("错误的id", docId);
        return;
    }
    if ((0, utils_1.isMobile)()) {
        // openMobileFileById(getPluginInstance().app, docId);
        return;
    }
    (0, logger_1.logPush)("Try open By id", docId);
    // 需要冒泡，否则不能在所在页签打开
    if (preventDefault) {
        mouseEvent === null || mouseEvent === void 0 ? void 0 : mouseEvent.preventDefault();
        mouseEvent === null || mouseEvent === void 0 ? void 0 : mouseEvent.stopPropagation();
    }
    (0, logger_1.debugPush)("openRefLinkEventAPIF", mouseEvent);
    if (mouseEvent) {
        keyParam = {};
        keyParam["ctrlKey"] = mouseEvent.ctrlKey;
        keyParam["shiftKey"] = mouseEvent.shiftKey;
        keyParam["altKey"] = mouseEvent.altKey;
        keyParam["metaKey"] = mouseEvent.metaKey;
    }
    let positionKey = undefined;
    if (keyParam["altKey"]) {
        positionKey = "right";
    }
    else if (keyParam["shiftKey"]) {
        positionKey = "bottom";
    }
    if (autoRemoveJudgeMiliseconds > 0) {
        if (Date.now() - lastClickTime_openRefLinkByAPI < autoRemoveJudgeMiliseconds) {
            removeCurrentTab = true;
        }
        lastClickTime_openRefLinkByAPI = Date.now();
    }
    // 手动关闭
    const needToCloseDocId = (0, utils_1.getCurrentDocIdF)(true);
    const finalParam = {
        app: (0, utils_1.getPluginInstance)().app,
        doc: {
            id: docId,
            zoomIn: openInFocus,
            action: [siyuan_1.Constants.CB_GET_SCROLL],
        },
        position: positionKey,
        keepCursor: (0, utils_1.isEventCtrlKey)(keyParam) ? true : undefined,
        removeCurrentTab: removeCurrentTab, // 目前这个选项的行为是：true，则当前页签打开；false，则根据思源设置：新页签打开
    };
    (0, logger_1.debugPush)("打开文档执行参数", finalParam);
    (0, siyuan_1.openTab)(finalParam);
    // 后台打开页签不可移除
    if (removeCurrentTab && !(0, utils_1.isEventCtrlKey)(keyParam)) {
        (0, logger_1.debugPush)("插件自行移除页签");
        removeCurrentTabF(needToCloseDocId);
        removeCurrentTab = false;
    }
}
function removeCurrentTabF(docId) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    // 获取tabId
    if (!(0, utils_1.isValidStr)(docId)) {
        docId = (0, utils_1.getCurrentDocIdF)(true);
    }
    if (!(0, utils_1.isValidStr)(docId)) {
        (0, logger_1.debugPush)("错误的id或多个匹配id");
        return;
    }
    // v3.1.11或以上
    if (siyuan === null || siyuan === void 0 ? void 0 : siyuan.getAllEditor) {
        const editor = siyuan.getAllEditor();
        let protyle = null;
        for (let i = 0; i < editor.length; i++) {
            if (editor[i].protyle.block.rootID === docId) {
                protyle = editor[i].protyle;
                break;
            }
        }
        if (protyle) {
            if (protyle.model.headElement) {
                if (protyle.model.headElement.classList.contains("item--pin")) {
                    (0, logger_1.debugPush)("Pin页面，不关闭存在页签");
                    return;
                }
            }
            //id: string, closeAll = false, animate = true, isSaveLayout = true
            (0, logger_1.debugPush)("关闭存在页签", (_b = (_a = protyle === null || protyle === void 0 ? void 0 : protyle.model) === null || _a === void 0 ? void 0 : _a.parent) === null || _b === void 0 ? void 0 : _b.parent, (_d = (_c = protyle.model) === null || _c === void 0 ? void 0 : _c.parent) === null || _d === void 0 ? void 0 : _d.id);
            (_g = (_f = (_e = protyle === null || protyle === void 0 ? void 0 : protyle.model) === null || _e === void 0 ? void 0 : _e.parent) === null || _f === void 0 ? void 0 : _f.parent) === null || _g === void 0 ? void 0 : _g.removeTab((_j = (_h = protyle.model) === null || _h === void 0 ? void 0 : _h.parent) === null || _j === void 0 ? void 0 : _j.id, false, false);
        }
        else {
            (0, logger_1.debugPush)("没有找到对应的protyle，不关闭存在的页签");
            return;
        }
    }
    else { // v3.1.10或以下
        return;
    }
}
async function fillNotebookDocFileInfo(notebookList) {
    const promiseList = notebookList.filter(notebook => notebook.closed == false).map(async (notebook) => {
        const notebookInfo = await getNotebookInfo(notebook.id);
        if (notebookInfo != null) {
            delete notebookInfo["name"];
            Object.assign(notebook, notebookInfo);
        }
        return notebook;
    });
    const result = await Promise.all(promiseList);
    return result.filter((doc) => doc !== null);
}
