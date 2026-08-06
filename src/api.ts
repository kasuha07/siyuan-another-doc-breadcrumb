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
    // lsNotebooks 返回全部笔记本（含已关闭的）；closed==true 表示笔记本未挂载，
    // 加密笔记本锁定（DEK 不在内存）时亦被内核强制标记为 closed
    // （kernel/model/conf.go 启动时统一标记，v3.7.3）。
    // 调用方以 filter(closed == false) 隐式排除锁定中的加密笔记本，未显式使用
    // Box.encrypted/unlocked 字段（较新版本才存在，不宜依赖）。
    let url = "/api/notebook/lsNotebooks";
    let response = await postRequest({}, url);
    if (response != null && response.code == 0 && response.data != null && "notebooks" in response.data) {
        return response.data.notebooks;
    }
    return null;
}

/**
 * 获取文档当前位置（物理路径 + 笔记本）。
 *
 * 竞态说明：protyle.path / protyle.notebookId 由 protyle 专属 ws 上的 moveDoc 消息更新，
 * 而插件刷新由主 ws 的 moveDoc 广播触发，两条独立连接到达顺序无保证——主 ws 先到时
 * 会读到旧路径，且思源不会二次刷新，导致旧路径长期显示。此处改用内核 API 获取位置：
 * moveDoc 广播在事务提交后发出，HTTP 查询必然返回新值，从根上消除顺序依赖。
 * API 失败（返回 null）时降级回退 protyle 上的值，避免渲染中断。
 */
export async function getCurrentDocDetail(docId: string, protyle: any) {
    const [pathInfo, hpath] = await Promise.all([getPathByID(docId), getHPathByID(docId)]);
    return {
        path: pathInfo?.path ?? protyle.path,
        hpath,
        box: pathInfo?.notebook ?? protyle.notebookId,
        docId: protyle.block.rootID
    }
}

/**
 * /api/filetree/getPathByID（v3.1.5+ 官方 API，与 getHPathByID 同走
 * LoadTreeByBlockID，含已解锁加密笔记本兜底）。返回 { path, notebook }，
 * 文档不存在或内核异常时返回 null，由调用方降级。
 */
export async function getPathByID(docId: string) {
    let url = "/api/filetree/getPathByID";
    let data = {
        id: docId
    }
    return parseBody(request(url, data));
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
    if (response?.code == 0) {
        return response.data.tree;
    } else {
        // response 为 null（网络/解析失败）时给出可读错误，避免解引用 null
        throw new Error("listDocTree Failed: " + (response?.msg ?? "请求失败"));
    }
}

export async function getNotebookInfo(notebookId: string) {
    let url = "/api/notebook/getNotebookInfo";
    let response = await postRequest({ notebook: notebookId }, url);
    if (response != null && response.code == 0 && response.data != null) {
        return response.data.boxInfo;
    } else {
        warnPush("请求笔记本信息时出错", response?.["msg"] ?? "请求失败")
    }
    return null;
}

export async function getChildDocuments(docId: string, sqlResult: any[]) {
    let childDocs = await listDocsByPath({ path: sqlResult[0].path, notebook: sqlResult[0].box });
    if (!childDocs) {
        // listDocsByPath 对未挂载（closed，含锁定中的加密笔记本）返回 code!=0 → null，
        // 直接返回空数组而非抛 TypeError（原实现会解引用 null 由调用方 catch，报错信息误导）；
        // 调用方（菜单懒加载）已有加载失败提示与重试逻辑，此处静默降级为“无子文档”。
        return [];
    }
    if (childDocs.files.length > state.g_setting.docMaxNum && state.g_setting.docMaxNum != 0) {
        childDocs.files = childDocs.files.slice(0, state.g_setting.docMaxNum);
    }
    return childDocs.files;
}

/**
 * 统一的 POST + JSON 解析请求层。任何失败都 warnPush 并返回 null，绝不 reject：
 * 1. fetch 网络异常（断网/内核未就绪）：捕获后返回 null，不再静默；
 * 2. 响应非 2xx 或非 JSON（内核异常时可能返回 HTML 错误页）：返回 null，
 *    不再向调用方抛 SyntaxError；
 * 3. JSON 解析失败：同上返回 null。
 * 调用方按既定协议对 null 降级（parseBody 短路、?. 兜底、显式判空）。
 */
async function fetchJSON(url: string, data: any): Promise<any | null> {
    let response: Response;
    try {
        response = await fetch(url, {
            body: JSON.stringify(data),
            method: 'POST'
        });
    } catch (err) {
        warnPush("网络请求失败", url, err);
        return null;
    }
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) {
        warnPush("API 响应异常（非 2xx 或非 JSON）", url, response.status);
        return null;
    }
    try {
        return await response.json();
    } catch (err) {
        warnPush("API 响应 JSON 解析失败", url, err);
        return null;
    }
}

async function postRequest(data: any, url: string) {
    return fetchJSON(url, data);
}

export async function request(url: string, data: any) {
    return fetchJSON(url, data);
}

export async function parseBody(response: any) {
    // 请求层失败已由 fetchJSON 归并为返回 null（request/postRequest 绝不 reject），
    // 这里 try/catch 仅为防御性兜底：null 直接短路，避免对 null 取 .code 抛 TypeError。
    let r: any = null;
    try {
        r = await response;
    } catch (err) {
        return null;
    }
    return r != null && r.code === 0 ? r.data : null;
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

/**
 * 大纲缓存：面包屑“>”箭头菜单点击频繁，每次全量 getDocOutline（内核重新遍历
 * 整棵文档树）代价高；同一文档短时间内重复打开菜单直接复用。
 * - TTL：文档内容编辑后大纲可能过期，短 TTL 兼顾新鲜度；
 * - 结构变更事件（moveDoc/rename/removeDoc，标题名随之变化）由
 *   events.ts 调用 clearDocOutlineCache 主动失效；
 * - 失败（null）不缓存，下次点击重试。
 */
const OUTLINE_CACHE_TTL_MS = 30 * 1000;
const outlineCache = new Map<string, { data: any; time: number }>();

export function clearDocOutlineCache() {
    outlineCache.clear();
}

export async function getDocOutline(docId: string) {
    const cached = outlineCache.get(docId);
    if (cached && Date.now() - cached.time < OUTLINE_CACHE_TTL_MS) {
        return cached.data;
    }
    let url = "/api/outline/getDocOutline";
    let data = { "id": docId };
    let response = await request(url, data);
    const outline = response?.code == 0 ? response.data : null;
    if (outline != null) {
        outlineCache.set(docId, { data: outline, time: Date.now() });
    }
    return outline;
}

export async function getDocInfo(docId: string) {
    // 未传 notebook 参数：内核先在全局 db 按 blockID 查询，未命中时隐式遍历所有
    // 已解锁加密笔记本兜底（kernel/model/tree.go loadTreeByBlockIDInBox，v3.7.3），
    // 故对已解锁加密笔记本文档也能取到 icon/subFileCount；锁定（closed）笔记本则
    // 返回 code!=0 → parseBody 为 null，由调用方逐点降级。该兜底未在 API 文档声明。
    let url = `/api/block/getDocInfo`;
    return parseBody(request(url, { id: docId }));
}

/**
 * 批量获取多个文档的 BlockInfo（/api/block/getDocsInfo，内核一次 FlushTxQueue
 * + 批量读盘，替代逐文档 getDocInfo 的重型调用）。
 * - refCount/av 必须显式传 false：本插件只需 icon/subFileCount，跳过内核 refs
 *   与属性视图查询；且内核对两参数做 `.(bool)` 断言，缺参会直接 panic；
 * - 内核按输入 id 顺序返回已找到文档的信息，不存在的文档直接跳过（数组可能
 *   变短），调用方应按 BlockInfo.id 索引而非按下标取值；
 * - 请求失败（返回 null）时由调用方整体降级。
 */
export async function getDocsInfo(ids: string[]) {
    let url = `/api/block/getDocsInfo`;
    return parseBody(request(url, { ids, refCount: false, av: false }));
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

export function openRefLinkAgent(event: any, paramId = "", keyParam = undefined, protyleElem = undefined, openInFocus = false) {
    openRefLinkByAPI({
        mouseEvent: event,
        paramDocId: paramId,
        keyParam: keyParam,
    });
}

let lastClickTime_openRefLinkByAPI = 0;
/**
 * 基于API的打开思源块/文档
 * @param mouseEvent 鼠标点击事件，如果存在，优先使用
 * @param paramDocId 如果没有指定 event，使用此参数作为文档id
 * @param keyParam 如果没有event，使用此次数指定ctrlKey后台打开、shiftKey下方打开、altKey右侧打开
 * @param openInFocus 是否以聚焦块的方式打开（此参数有变动）
 * @param removeCurrentTab 透传给思源 openTab，真实语义为“是否移除 unupdate（未初始化）占位页签”——不传（undefined）时思源默认 true（移除占位页签），显式传 false 会覆盖思源默认（保留占位页签）。与下方 afterOpen 中插件手动关闭旧页签（removeCurrentTabF）是两套独立机制
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
        removeCurrentTab: removeCurrentTab, // 透传思源 openTab：真实语义为“是否移除 unupdate（未初始化）占位页签”——
        // 不传（undefined）时思源默认 true（移除占位页签）；显式传 false 会覆盖思源默认（保留占位页签）。
        // 与下方 afterOpen 中插件手动关闭旧页签（removeCurrentTabF）是两套独立机制
    };
    // 后台打开页签不可移除。用 afterOpen 回调关闭旧页签：openTab 内部先异步
    // 获取块信息再创建新页签，若提前同步关闭旧页签，分屏仅剩一个页签时
    // 会触发思源销毁整个分屏（layout/Wnd.ts removeTabAction），破坏布局。
    // 目标文档已打开时（isDocAlreadyOpen 为 true），思源 openFile 走
    // switchEditor/getUnInitTab 分支：不创建新页签且同步调用 afterOpen，此时
    // 移除当前页签会在其所在分屏仅剩一个页签时销毁整个分屏（Wnd.ts
    // children.length===1 分支）；且该场景下思源官方本就忽略 removeCurrentTab，
    // 这里同样跳过移除，仅切换页签。
    const docAlreadyOpen = isDocAlreadyOpen(docId);
    if (removeCurrentTab && !isEventCtrlKey(keyParam)) {
        finalParam.afterOpen = () => {
            if (docAlreadyOpen) {
                debugPush("目标文档已打开（switchEditor 分支），跳过移除当前页签");
                return;
            }
            debugPush("插件自行移除页签");
            removeCurrentTabF(needToCloseDocId);
        };
    }
    debugPush("打开文档执行参数", finalParam);
    openTab(finalParam);
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
    // 基于公开 API 定位已初始化页签：siyuan.getAllTabs() 返回 Tab[]，按文档 id 匹配；
    // 未初始化页签的 model 为 null，可选链跳过。
    if (siyuan?.getAllTabs) {
        const tabs = siyuan.getAllTabs();
        // 运行时 tab.model 对编辑器页签为 Editor 实例（SDK 声明 Editor extends Model，公开 editor: Protyle 字段），
        // 其 editor.protyle 为 IProtyle，block.rootID 即文档 id（思源自身同款写法：tab.model.editor.protyle.block.rootID，
        // app/src/layout/tabUtil.ts）。类型层面 Tab.model 仅声明为 Model（无 protyle 字段），此处按公开结构最小收窄。
        const matchedTab = tabs.find(tab =>
            (tab.model as { editor?: { protyle?: { block?: { rootID?: string } } } } | null)?.editor?.protyle?.block?.rootID === docId);
        if (matchedTab) {
            if (matchedTab.headElement?.classList.contains("item--pin")) {
                debugPush("Pin页面，不关闭存在页签");
                return;
            }
            // 公开结构：Tab.parent 为所属 Wnd（页签容器），Wnd.removeTab(id, isBatchClose=false, animate=false,
            // isSaveLayout=true) 为布局公开方法（SDK 类型声明 layout/Tab.d.ts、Wnd.d.ts 可见，与思源内核 Wnd.ts 一致）。
            // 不再依赖 protyle→Tab（model.parent）的私有链。若升级后此结构失效，仅表现为“页签不关闭”的软失效；
            // 此处做存在性检查并告警，避免静默。
            if (typeof matchedTab.parent?.removeTab !== "function") {
                warnPush("移除页签链失效：tab.parent.removeTab 不可用，跳过关闭（思源可能移除了该公开结构）");
                return;
            }
            debugPush("关闭存在页签", matchedTab.parent, matchedTab.id);
            matchedTab.parent.removeTab(matchedTab.id, false, false);
        } else {
            warnPush("没有找到匹配的页签，跳过关闭（目标文档页签可能尚未初始化）");
            return;
        }
    } else { // 无 getAllTabs 的旧版本
        return;
    }

}

/**
 * 目标文档是否已打开（含未初始化页签）。
 *
 * 匹配逻辑对齐思源 openFile（app/src/editor/util.ts）：已初始化页签按
 * protyle.block.rootID 匹配；未初始化页签解析 headElement 的 data-initdata，
 * 按 rootId/blockId 二字段匹配（getUnInitTab 同款判断）。
 * 注意：docId 为文档 id 时可靠；若为文档内块 id 且该文档已打开，rootID 与
 * blockId 均不匹配会漏检（仅退回不跳过移除的旧行为，不产生新问题）。
 */
function isDocAlreadyOpen(docId: string | undefined) {
    if (!isValidStr(docId)) {
        return false;
    }
    if (siyuan?.getAllEditor) {
        const editors = siyuan.getAllEditor();
        for (const editor of editors) {
            if (editor.protyle?.block?.rootID === docId) {
                return true;
            }
        }
    }
    if (siyuan?.getAllTabs) {
        const tabs = siyuan.getAllTabs();
        for (const tab of tabs) {
            const initData = tab.headElement?.getAttribute("data-initdata");
            if (!initData) {
                continue;
            }
            try {
                const initObj = JSON.parse(initData);
                if (initObj?.instance === "Editor" && (initObj.rootId === docId || initObj.blockId === docId)) {
                    return true;
                }
            } catch (e) {
                debugPush("解析页签 data-initdata 失败", e);
            }
        }
    }
    return false;
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


