/**
 * [START] 相邻文档导航相关
 */
import { debugPush } from "./logger";
import { CONSTANTS } from "./constants";
import { state } from "./state";
import { getNodebookList, listDocsByPath, openRefLinkByAPI } from "./api";
import { trimListDocsByPathAPIReturnedDocName } from "./utils";
import type { ActionRegistrar, AdjacentResult, PathObject } from "./types";

/**
 * 仅箭头模式下的悬浮提示：复用思源全局 `.tooltip` 类
 * （fixed 定位、--b3-tooltips-* 主题变量、zoomIn 动画，主题可自定义）。
 * 不用 `.b3-tooltips` 伪元素方案：两行模式下 nav 位于 overflow-y: hidden 的
 * 滚动容器内，绝对定位伪元素会被裁剪。
 * 弹出节奏：JS 延迟 100ms 后挂载，并覆盖 CSS 的 300ms 动画延迟立即播放 zoomIn，
 * 总延迟约 250ms，快于思源原生 showTooltip（约 600ms），减少等待感。
 */
let adjacentTooltip: HTMLDivElement | null = null;
let adjacentTooltipTimer: any = null;

function getAdjacentTooltip(): HTMLDivElement {
    if (!adjacentTooltip) {
        adjacentTooltip = document.createElement("div");
        adjacentTooltip.className = "tooltip";
        adjacentTooltip.style.pointerEvents = "none";
        adjacentTooltip.style.display = "none";
        document.body.appendChild(adjacentTooltip);
    }
    return adjacentTooltip;
}

export function removeAdjacentTooltip() {
    if (adjacentTooltipTimer) {
        clearTimeout(adjacentTooltipTimer);
        adjacentTooltipTimer = null;
    }
    adjacentTooltip?.remove();
    adjacentTooltip = null;
}

function bindAdjacentTooltip(button: HTMLButtonElement, text: string) {
    button.addEventListener("mouseenter", () => {
        if (adjacentTooltipTimer) {
            clearTimeout(adjacentTooltipTimer);
        }
        adjacentTooltipTimer = setTimeout(() => {
            adjacentTooltipTimer = null;
            const tip = getAdjacentTooltip();
            tip.textContent = text;
            const rect = button.getBoundingClientRect();
            tip.style.left = `${rect.left}px`;
            tip.style.top = `${rect.bottom + 8}px`;
            tip.style.animationDelay = "0ms";
            tip.style.display = "block";
        }, 100);
    });
    button.addEventListener("mouseleave", () => {
        if (adjacentTooltipTimer) {
            clearTimeout(adjacentTooltipTimer);
            adjacentTooltipTimer = null;
        }
        if (adjacentTooltip) {
            adjacentTooltip.style.display = "none";
        }
    });
}

export function createAdjacentDocNav(adjacent: AdjacentResult, controller: ActionRegistrar) {
    const navElement = document.createElement("span");
    navElement.className = "og-fdb-doc-nav";
    navElement.appendChild(createAdjacentDocButton("previous", adjacent.previousDoc, adjacent.sameLevelPrevious, controller));
    navElement.appendChild(createAdjacentDocButton("next", adjacent.nextDoc, adjacent.sameLevelNext, controller));
    return navElement;
}

export function createAdjacentDocButton(direction: string, doc: any, isSameLevel = false, controller: ActionRegistrar) {
    const isPrevious = direction === "previous";
    const label = isPrevious ? (state.language["previous_doc"]) : (state.language["next_doc"]);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "og-fdb-doc-nav-button";
    button.setAttribute("data-og-adjacent-direction", direction);
    // 仅箭头模式：不渲染文档名称，悬浮时显示思源原生 tooltip
    const arrowOnly = state.g_setting.adjacentNavStyle === CONSTANTS.ADJ_ARROW_ONLY;
    let buttonText = label;

    if (doc?.id) {
        const docName = trimListDocsByPathAPIReturnedDocName(doc?.name ?? "");
        const trimedDocName = trimDocName(docName, state.g_setting.nameMaxLength);
        buttonText = docName;
        const actionKey = controller.registerAction({
            type: "open-adjacent",
            docId: doc.id
        });
        button.setAttribute("data-og-fdb-action-key", actionKey);
        button.setAttribute("data-doc-id", doc.id);
        const tipText = `${label}: ${docName}`;
        if (arrowOnly) {
            bindAdjacentTooltip(button, tipText);
        } else {
            button.setAttribute("title", tipText);
        }
    } else {
        button.disabled = true;
        if (arrowOnly) {
            bindAdjacentTooltip(button, label);
        } else {
            button.setAttribute("title", label);
        }
    }

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    // 仅箭头模式不使用浏览器原生 title（悬浮提示由思源 tooltip 承担）
    const buttonTitle = button.getAttribute("title");
    if (buttonTitle) {
        svg.setAttribute("title", buttonTitle);
    }
    const use = document.createElementNS(svgNS, "use");
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", isPrevious ? "#iconLeft" : "#iconRight");
    svg.appendChild(use);

    if (arrowOnly) {
        button.appendChild(svg);
    } else {
        const textSpan = document.createElement("span");
        textSpan.className = "og-fdb-doc-nav-button-text";
        textSpan.textContent = buttonText;

        if (isPrevious) {
            button.appendChild(svg);
            button.appendChild(textSpan);
        } else {
            button.appendChild(textSpan);
            button.appendChild(svg);
        }
    }
    return button;
}

export function trimDocName(name: string, maxLength: number) {
    if (name.length <= maxLength) {
        return name;
    }
    return name.substring(0, state.g_setting.nameMaxLength) + "...";
}

export async function getAdjacentDocs(pathObjects: PathObject[], notebookDocFlag: boolean): Promise<AdjacentResult> {
    const result: AdjacentResult = {
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
    let sameLevelDocs: any = null;
    if (notebookDocFlag) {
        sameLevelDocs = await getNotebookAdjacentDocs(currentDoc.box);
    } else {
        sameLevelDocs = await getAdjacentChildDocs(previousDoc);
    }
    const currentIndex = findAdjacentDocIndex(sameLevelDocs, currentDoc.id);
    if (currentIndex < 0) {
        return result;
    }
    result.previousDoc = sameLevelDocs[currentIndex - 1] ?? null;
    result.nextDoc = sameLevelDocs[currentIndex + 1] ?? null;
    // 如果是笔记本层级，不再寻找同层级——已经到头了
    if (state.g_setting.showAdjacentDocButton === CONSTANTS.ADJ_SAME_LEVEL
        && (!result.previousDoc || !result.nextDoc) && !notebookDocFlag
    ) {
        debugPush("当前文档同级没有足够的文档，尝试向上获取同层级文档");
        const cache: any = {};
        const sameLevelDocs = await getAdjacentDocsByDepth(pathObjects[0], currentDepth, cache);
        const currentIndex = findAdjacentDocIndex(sameLevelDocs, currentDoc.id);
        if (result.previousDoc == null && currentIndex > 0) {
            result.sameLevelPrevious = true;
            result.previousDoc = sameLevelDocs[currentIndex - 1] ?? null;
        }
        if (result.nextDoc == null && currentIndex < sameLevelDocs.length - 1) {
            result.sameLevelNext = true;
            result.nextDoc = sameLevelDocs[currentIndex + 1] ?? null;
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
export async function getNotebookAdjacentDocs(notebookId: string, cache: any = null) {
    if (!notebookId) {
        return [];
    }
    const cacheKey = `notebook-${notebookId}`;
    if (cache && cache[cacheKey]) {
        debugPush("使用传入缓存", cacheKey);
        return cache[cacheKey].data;
    }
    if (state.g_adjacentDocCache[cacheKey] && (Date.now() - state.g_adjacentDocCache[cacheKey].timestamp < 3 * 60 * 1000) && state.g_setting.immediatelyUpdate) {
        debugPush("使用笔记本文档缓存", cacheKey);
        return state.g_adjacentDocCache[cacheKey].data;
    }
    const notebookList = await getNodebookList() ?? [];
    const result = notebookList.filter((notebook: any) => notebook.closed == false);
    // 面包屑情况下不太需要详细信息，这里先不调用信息补全了
    // await fillNotebookDocFileInfo(notebookList.filter(notebook=>notebook.closed==false));
    if (cache) {
        cache[cacheKey] = {
            "data": result,
            "timestamp": Date.now(),
        };
    }
    state.g_adjacentDocCache[cacheKey] = {
        "data": result,
        "timestamp": Date.now(),
    };
    return state.g_adjacentDocCache[cacheKey].data;
}

export async function getAdjacentChildDocs(parentDoc: any, cache: any = null) {
    if (!parentDoc?.path || !parentDoc?.box) {
        return [];
    }
    const cacheKey = `${parentDoc.box}-${parentDoc.path}`;
    if (cache && cache[cacheKey]) {
        debugPush("使用传入缓存", cacheKey);
        return cache[cacheKey].data;
    }
    if (cache == null && state.g_adjacentDocCache[cacheKey] && (Date.now() - state.g_adjacentDocCache[cacheKey].timestamp < 3 * 60 * 1000) && state.g_setting.immediatelyUpdate) {
        debugPush("使用相邻文档缓存", cacheKey);
        return state.g_adjacentDocCache[cacheKey].data;
    }
    const response = await listDocsByPath({
        path: parentDoc.path,
        notebook: parentDoc.box,
        ignoreDocMaxNum: true,
    });
    const processedResponse = (response?.files ?? []).map((doc: any) => {
        doc["box"] = parentDoc.box;
        return doc;
    });
    if (cache) {
        cache[cacheKey] = {
            "data": processedResponse,
            "timestamp": Date.now(),
        };
    }
    state.g_adjacentDocCache[cacheKey] = {
        "data": processedResponse,
        "timestamp": Date.now(),
    };
    return state.g_adjacentDocCache[cacheKey].data;
}

export async function getAdjacentDocsByDepth(parentDoc: any, targetDepth: number, cache: any) {
    if (targetDepth <= 0) {
        return [];
    }
    const childDocs = await getAdjacentChildDocs(parentDoc, cache);
    if (targetDepth === 1) {
        return childDocs;
    }
    let result: any[] = [];
    for (const childDoc of childDocs) {
        if (childDoc.subFileCount === 0) {
            continue;
        }
        const subDocs = await getAdjacentDocsByDepth(childDoc, targetDepth - 1, cache);
        result = result.concat(subDocs);
    }
    return result;
}

export function findAdjacentDocIndex(docList: any[], docId: string) {
    return docList.findIndex(doc => doc.id === docId);
}
// [END] 相邻文档导航相关

export function clickAdjacentDocButton(event: any, docId: string) {
    if (!docId) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    openRefLinkByAPI({
        paramDocId: docId,
        keyParam: {
            ctrlKey: event?.ctrlKey,
            shiftKey: event?.shiftKey,
            altKey: event?.altKey,
            metaKey: event?.metaKey,
        },
    });
}
