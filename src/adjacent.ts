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
    if (maxLength <= 0 || name.length <= maxLength) {
        return name;
    }
    return name.substring(0, maxLength) + "...";
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
        // 定向查找：只沿祖先链向上、在命中方向的兄弟子树中下钻，替代旧实现从
        // 笔记本根 DFS 全量枚举（整棵子树每个有子文档节点一次 listDocsByPath，
        // 深度 4、每层 20 文档即约 8400 次串行请求）；两个方向子树互不相交，并行拉取
        const cache: any = {};
        const [previousDoc, nextDoc] = await Promise.all([
            result.previousDoc == null ? findAdjacentSameLevelDoc(pathObjects, "previous", cache) : Promise.resolve(null),
            result.nextDoc == null ? findAdjacentSameLevelDoc(pathObjects, "next", cache) : Promise.resolve(null),
        ]);
        if (previousDoc) {
            result.sameLevelPrevious = true;
            result.previousDoc = previousDoc;
        }
        if (nextDoc) {
            result.sameLevelNext = true;
            result.nextDoc = nextDoc;
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
    if (state.g_adjacentDocCache[cacheKey] && (Date.now() - state.g_adjacentDocCache[cacheKey].timestamp < 3 * 60 * 1000)) {
        debugPush("使用笔记本文档缓存", cacheKey);
        return state.g_adjacentDocCache[cacheKey].data;
    }
    const notebookList = await getNodebookList() ?? [];
    // closed == false：排除未挂载笔记本（含锁定中的加密笔记本，语义见 api.getNodebookList 注释）
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
    // 全局 3 分钟缓存始终优先：旧实现当传入局部 cache（递归遍历）时跳过全局
    // 缓存判断，遍历中的每个节点都真实发请求，且重复导航无法复用已取数据
    const globalCached = state.g_adjacentDocCache[cacheKey];
    if (globalCached && (Date.now() - globalCached.timestamp < 3 * 60 * 1000)) {
        debugPush("使用相邻文档缓存", cacheKey);
        return globalCached.data;
    }
    if (cache && cache[cacheKey]) {
        debugPush("使用传入缓存", cacheKey);
        return cache[cacheKey].data;
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

/**
 * 同层相邻文档兜底查找：当前文档是父目录首/尾子文档时，向上逐层检查各祖先的
 * 相邻兄弟子树，定向取最前（next）/最后（previous）的目标深度文档。
 *
 * 与旧实现（getAdjacentDocsByDepth 从笔记本根 DFS 全量枚举目标深度全部文档，
 * 每个有子文档的节点一次 listDocsByPath，深度 4、每层 20 文档约 8400 次串行
 * 请求）结果等价，但只沿祖先链向上、在命中方向的兄弟子树中下钻并提前终止，
 * 请求数从 O(整棵子树) 降为 O(深度 × 分支)。
 *
 * @param pathObjects 从笔记本根到当前文档的完整路径
 * @param direction "previous"：找当前文档之前的同层文档；"next"：找之后的
 */
async function findAdjacentSameLevelDoc(pathObjects: PathObject[], direction: "previous" | "next", cache: any) {
    const targetDepth = pathObjects.length - 1;
    // 从当前文档的父级逐层向上：仅当某一祖先没有本方向的兄弟时，同层相邻文档
    // 才可能位于更上层的兄弟子树中
    for (let i = targetDepth - 1; i >= 1; i--) {
        const parent = pathObjects[i - 1];
        const ancestor = pathObjects[i];
        const siblings = await getAdjacentChildDocs(parent, cache);
        const ancestorIndex = findAdjacentDocIndex(siblings, ancestor.id);
        if (ancestorIndex < 0) {
            // 树结构已变化（父目录下找不到该祖先），放弃继续向上
            return null;
        }
        // 候选兄弟：previous 取祖先之前的兄弟（从最近者开始），next 取之后的
        const candidates = direction === "previous"
            ? siblings.slice(0, ancestorIndex).reverse()
            : siblings.slice(ancestorIndex + 1);
        for (const sibling of candidates) {
            if (sibling.subFileCount === 0) {
                // 无子文档的节点不可能包含更深层文档
                continue;
            }
            const found = await findExtremeDocAtDepth(sibling, targetDepth - i, direction === "previous" ? "last" : "first", cache);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

/**
 * 在 node 子树中查找相对深度 remainingDepth（绝对深度 depth(node)+remainingDepth）
 * 处最前（first）/最后（last）的文档；子树深度不足返回 null。
 * 按先序遍历顺序定位，与旧实现全量枚举的顺序一致。
 */
async function findExtremeDocAtDepth(node: any, remainingDepth: number, direction: "first" | "last", cache: any): Promise<any | null> {
    if (remainingDepth <= 0) {
        return null;
    }
    const childDocs = await getAdjacentChildDocs(node, cache);
    if (remainingDepth === 1) {
        if (childDocs.length === 0) {
            return null;
        }
        return direction === "last" ? childDocs[childDocs.length - 1] : childDocs[0];
    }
    const ordered = direction === "last" ? childDocs.slice().reverse() : childDocs;
    for (const child of ordered) {
        if (child.subFileCount === 0) {
            continue;
        }
        const found = await findExtremeDocAtDepth(child, remainingDepth - 1, direction, cache);
        if (found) {
            return found;
        }
    }
    return null;
}

export function findAdjacentDocIndex(docList: any[], docId: string) {
    return docList.findIndex(doc => doc.id === docId);
}
// [END] 相邻文档导航相关

export function clickAdjacentDocButton(event: any, docId: string) {
    if (!docId) {
        return;
    }
    // 点击后页签切换、面包屑即将重建，旧按钮从 DOM 移除时不会触发 mouseleave，
    // 主动移除悬浮提示，避免 tooltip 残留在屏幕上
    removeAdjacentTooltip();
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    // 设置开启且无修饰键点击时，替换当前页签；Ctrl（后台）/Alt（右侧分屏）/Shift（下方分屏）打开时保留原页签
    const plainClick = !(event?.ctrlKey || event?.metaKey || event?.shiftKey || event?.altKey);
    openRefLinkByAPI({
        paramDocId: docId,
        removeCurrentTab: plainClick && !!state.g_setting.replaceAdjacentDocTab,
        keyParam: {
            ctrlKey: event?.ctrlKey,
            shiftKey: event?.shiftKey,
            altKey: event?.altKey,
            metaKey: event?.metaKey,
        },
    });
}
