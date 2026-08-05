/**
 * 思源 API 封装与打开文档相关逻辑
 */
import { Constants, openTab, showMessage } from "siyuan";

/**
 * 非空断言（!）说明：
 * - window.top!：插件运行于思源 iframe 内，window.top 必为顶层布局窗口；
 * - window.siyuan.languages!/storage!：siyuan 类型声明为可选，但思源运行时必然注入；
 * - (window as any)["OG_FDB_NO_WARNING"]：跨插件约定的全局标记，Window 类型无对应索引签名。
 */
import * as siyuan from "siyuan";
import { debugPush, errorPush, logPush, warnPush } from "./logger";
import { state } from "./state";
import { getCurrentDocIdF, getPluginInstance, isEventCtrlKey, isMobile, isValidStr, sleep } from "./utils";

export function getNotebooks() {
    let notebooks = window.top!.siyuan.notebooks;
    return notebooks;
}

export async function getNodebookList() {
    let url = "/api/notebook/lsNotebooks";
    let response = await postRequest({}, url);
    if (response.code == 0 && response.data != null && "notebooks" in response.data) {
        return response.data.notebooks;
    }
    return null;
}

export async function getCurrentDocDetail(docId: string, protyle: any) {
    let result = {
        path: protyle.path,
        hpath: await getHPathByID(docId),
        box: protyle.notebookId,
        docId: protyle.block.rootID
    }
    return result;
}

export async function getHPathByID(docId: string) {
    let url = "/api/filetree/getHPathByID";
    let data = {
        id: docId
    }
    return parseBody(request(url, data));
}

export async function listDocTree(notebook: string, path: string) {
    const url = "/api/filetree/listDocTree";
    let postBody = {
        notebook,
        path
    }
    let response = await postRequest(postBody, url);
    if (response.code == 0) {
        return response.data.tree;
    } else {
        throw new Error("listDocTree Failed: " + response.msg);
    }
}

export async function getNotebookInfo(notebookId: string) {
    let url = "/api/notebook/getNotebookInfo";
    let response = await postRequest({ notebook: notebookId }, url);
    if (response.code == 0 && response.data != null) {
        return response.data.boxInfo;
    } else {
        warnPush("请求笔记本信息时出错  ", response["msg"])
    }
    return null;
}

export async function getChildDocuments(docId: string, sqlResult: any[]) {
    let childDocs = await listDocsByPath({ path: sqlResult[0].path, notebook: sqlResult[0].box });
    if (childDocs.files.length > state.g_setting.docMaxNum && state.g_setting.docMaxNum != 0) {
        childDocs.files = childDocs.files.slice(0, state.g_setting.docMaxNum);
    }
    return childDocs.files;
}

async function postRequest(data: any, url: string) {
    let response = await fetch(url, {
        body: JSON.stringify(data),
        method: 'POST'
    }).then(function (response) {
        return response.json();
    });
    return response;
}

export async function request(url: string, data: any) {
    let resData: any = null;
    await fetch(url, {
        body: JSON.stringify(data),
        method: 'POST'
    }).then(function (response) {
        resData = response.json();
    });
    return resData;
}

export async function parseBody(response: any) {
    let r = await response;
    return r.code === 0 ? r.data : null;
}

export async function createAndOpenEmptyDocAt(box: string, path: string) {
    const newPath = (path.endsWith(".sy") ? path.substring(0, path.length - 3) + "/" : path) + window.Lute.NewNodeID() + ".sy";
    createDoc(box, newPath, window.siyuan.languages!.untitled, "", true).then((response) => {
        if (response && response.id) {
            openRefLinkByAPI({
                paramDocId: response.id,
                // 与思源官方新建文档打开行为一致：获取上下文 + 只读模式下解锁编辑
                action: [Constants.CB_GET_CONTEXT, Constants.CB_GET_OPENNEW],
            });
        }
    }).catch((err) => {
        errorPush(err);
        showMessage(`${state.language["createDocFailed"] ?? "创建文档失败"}：${err?.message ?? err}`);
    });
}

export async function createDoc(notebookId: string, path: string, title: string, md: string, listDocTree: boolean) {
    let url = "/api/filetree/createDoc";
    let data = {
        notebook: notebookId,
        path: path,
        title: title,
        md: md,
        listDocTree: listDocTree
    }
    let response = await request(url, data);
    if (response == null) {
        // fetch 网络失败时 request 返回 null，这里抛出可读错误，避免上层静默
        throw new Error("createDoc request failed");
    }
    if (response.code == 0) {
        return response.data;
    }
    // 后端返回错误（如层级深度超限、父文档缺失等），抛出以显示给用户
    throw new Error(response.msg || "createDoc failed");
}

export async function getDocOutline(docId: string) {
    let url = "/api/outline/getDocOutline";
    let data = { "id": docId };
    let response = await request(url, data);
    if (response.code == 0) {
        return response.data;
    } else {
        return null;
    }
}

export async function getDocInfo(docId: string) {
    let url = `/api/block/getDocInfo`;
    return parseBody(request(url, { id: docId }));
}

export async function listDocsByPath({ path, notebook = undefined, sort = undefined, maxListLength = undefined, ignoreDocMaxNum = false }: any) {
    let data: any = {
        path: path,
        "ignoreMaxListHint": true
    };
    if (notebook) data["notebook"] = notebook;
    if (sort) data["sort"] = sort;
    if (maxListLength != undefined) {
        data["maxListCount"] = maxListLength;
    } else if (!ignoreDocMaxNum && state.g_setting.docMaxNum != 0) {
        data["maxListCount"] = state.g_setting.docMaxNum >= 32 ? state.g_setting.docMaxNum : 32;
    } else {
        data["maxListCount"] = 0;
    }
    let url = '/api/filetree/listDocsByPath';
    return parseBody(request(url, data));
    //文档hepath与Markdown 内容
}

export async function sqlAPI(stmt: string) {
    let data = {
        "stmt": stmt
    };
    let url = `/api/query/sql`;
    return parseBody(request(url, data));
}

export function openRefLinkAgent(event: any, paramId = "", keyParam = undefined, protyleElem = undefined, openInFocus = !state.g_setting.preferOpenInCurrentSplit) {
    openRefLinkByAPI({
        mouseEvent: event,
        paramDocId: paramId,
        keyParam: keyParam,
        preventDefault: !state.g_setting.preferOpenInCurrentSplit,
    });
}

export async function tryToFixAllError() {
    if (!state.g_setting.autoFixFocusError) {
        showMessage(state.language["autoFixEnableFirst"] + "--- fakeDocBreadcrumb");
        return;
    }
    if (window.siyuan.dialogs.length == 1) {
        window.siyuan.dialogs[0].destroy();
    } else {
        showMessage(state.language["closeOtherDialog"] + " --- fakeDocBreadcrumb");
    }
    if ((window as any)["OG_FDB_NO_WARNING"] == true) {
        showMessage(state.language["onlyOneRunning"] + " --- fakeDocBreadcrumb");
        return;
    }
    try {
        (window as any)["OG_FDB_NO_WARNING"] = true;
        showMessage(state.language["batchFixStart"] + "--- fakeDocBreadcrumb")
        const list = window.siyuan.storage!["local-fileposition"];
        if (list) {
            for (let key in list) {
                if (list.hasOwnProperty(key)) {
                    if (list[key] && list[key]["zoomInId"] === key) {
                        openRefLinkByAPI({
                            paramDocId: key
                        });
                        await sleep(5000);
                    }
                }
            }
        }
    } catch (err) {
        errorPush(err);
    } finally {
        showMessage(state.language["batchFixEnd"] + "--- fakeDocBreadcrumb");
        (window as any)["OG_FDB_NO_WARNING"] = false;
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
 * @param action 打开文档时携带的 ProtyleAction 列表，默认 [CB_GET_SCROLL]；新建文档应传 [CB_GET_CONTEXT, CB_GET_OPENNEW] 与官方行为一致
 * @returns 
 */
export function openRefLinkByAPI({ mouseEvent, paramDocId = "", keyParam = {}, openInFocus = undefined, removeCurrentTab = undefined, autoRemoveJudgeMiliseconds = 0, preventDefault = false, action = undefined }: any) {
    let docId: string | undefined;
    if (isValidStr(paramDocId)) {
        docId = paramDocId;
    } else {
        if (mouseEvent && mouseEvent.currentTarget?.getAttribute("data-node-id")) {
            docId = mouseEvent.currentTarget?.getAttribute("data-node-id");
        } else if (mouseEvent && mouseEvent.currentTarget?.getAttribute("data-id")) {
            docId = (mouseEvent.currentTarget)?.getAttribute("data-id");
        } else if (mouseEvent && mouseEvent && mouseEvent.currentTarget?.getAttribute("data-og-doc-node-id")) {
            docId = mouseEvent.currentTarget?.getAttribute("data-og-doc-node-id");
        }
    }
    // 处理笔记本等无法跳转的情况
    if (!isValidStr(docId)) {
        debugPush("错误的id", docId)
        return;
    }
    if (isMobile()) {
        // openMobileFileById(getPluginInstance().app, docId);
        return;
    }
    logPush("Try open By id", docId);
    // 需要冒泡，否则不能在所在页签打开
    if (preventDefault) {
        mouseEvent?.preventDefault();
        mouseEvent?.stopPropagation();
    }
    debugPush("openRefLinkEventAPIF", mouseEvent);
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
    } else if (keyParam["shiftKey"]) {
        positionKey = "bottom";
    }
    if (autoRemoveJudgeMiliseconds > 0) {
        if (Date.now() - lastClickTime_openRefLinkByAPI < autoRemoveJudgeMiliseconds) {
            removeCurrentTab = true;
        }
        lastClickTime_openRefLinkByAPI = Date.now();
    }
    // 手动关闭
    const needToCloseDocId = getCurrentDocIdF(true);

    const finalParam: any = {
        app: getPluginInstance().app,
        doc: {
            id: docId,
            zoomIn: openInFocus,
            action: action ?? [Constants.CB_GET_SCROLL],
        },
        position: positionKey,
        keepCursor: isEventCtrlKey(keyParam) ? true : undefined,
        removeCurrentTab: removeCurrentTab, // 目前这个选项的行为是：true，则当前页签打开；false，则根据思源设置：新页签打开
    };
    debugPush("打开文档执行参数", finalParam);
    openTab(finalParam);
    // 后台打开页签不可移除
    if (removeCurrentTab && !isEventCtrlKey(keyParam)) {
        debugPush("插件自行移除页签");
        removeCurrentTabF(needToCloseDocId);
        removeCurrentTab = false;
    }
}

export function removeCurrentTabF(docId: string | null) {
    // 获取tabId
    if (!isValidStr(docId)) {
        docId = getCurrentDocIdF(true);
    }
    if (!isValidStr(docId)) {
        debugPush("错误的id或多个匹配id");
        return;
    }
    // v3.1.11或以上
    if (siyuan?.getAllEditor) {
        const editor = siyuan.getAllEditor();
        let protyle: any = null;
        for (let i = 0; i < editor.length; i++) {
            if (editor[i].protyle.block.rootID === docId) {
                protyle = editor[i].protyle;
                break;
            }
        }
        if (protyle) {
            if (protyle.model.headElement) {
                if (protyle.model.headElement.classList.contains("item--pin")) {
                    debugPush("Pin页面，不关闭存在页签");
                    return;
                }
            }
            //id: string, closeAll = false, animate = true, isSaveLayout = true
            debugPush("关闭存在页签", protyle?.model?.parent?.parent, protyle.model?.parent?.id);
            protyle?.model?.parent?.parent?.removeTab(protyle.model?.parent?.id, false, false);
        } else {
            debugPush("没有找到对应的protyle，不关闭存在的页签");
            return;
        }
    } else { // v3.1.10或以下
        return;
    }

}

export async function fillNotebookDocFileInfo(notebookList: any[]) {
    const promiseList = notebookList.filter(notebook => notebook.closed == false).map(async (notebook) => {
        const notebookInfo = await getNotebookInfo(notebook.id);
        if (notebookInfo != null) {
            delete notebookInfo["name"];
            Object.assign(notebook, notebookInfo)
        }
        return notebook;
    });
    const result = await Promise.all(promiseList);
    return result.filter((doc) => doc !== null);
}


