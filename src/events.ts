/**
 * 初始化、事件总线与鼠标键盘监听
 */
import * as siyuan from "siyuan";
import { debugPush, errorPush, infoPush, warnPush } from "./logger";
import { state } from "./state";
import { getAllShowingDocId } from "./utils";
import { clearDocOutlineCache } from "./api";
import { destroyAllControllers, inlineControllerRegistry } from "./controller";

/**
 * loaded-protyle-static / switch-protyle 双事件去重：
 * 打开文档时思源会先后触发两个事件（openFile 同步 emit switch-protyle，
 * 文档内容加载完成后 onGet emit loaded-protyle-static），若都执行 main 会产生
 * 双倍 API 调用。同一 protyle 在短窗口内的重复事件只处理一次；
 * 窗口期后再次触发（如文档被改名/移动后切回）由 ws-main 事件兜底。
 */
const MAIN_EVENT_DEDUP_MS = 1500;
let lastMainEventProtyle: any = null;
let lastMainEventTime = 0;

export async function mainEventBusHander(detail: any) {
    // 相关判断方式参考： https://github.com/siyuan-note/siyuan/issues/9458#issuecomment-1773776115
    detail = detail.detail;
    const protyle = detail.protyle;
    // 部分情况下，进入文档会停留在默认的聚焦，这里先运行了看看情况
    if (protyle.model == null /* || protyle.block.showAll */) {
        infoPush("插件内嵌Protyle、浮窗~~或聚焦~~。停止操作。", protyle);
        return;
    }
    const now = Date.now();
    if (lastMainEventProtyle === protyle && now - lastMainEventTime < MAIN_EVENT_DEDUP_MS) {
        debugPush("重复的加载事件（loaded-protyle-static/switch-protyle），跳过刷新");
        return;
    }
    lastMainEventProtyle = protyle;
    lastMainEventTime = now;
    debugPush("正确Protyle", protyle);
    await main(protyle);
}

export function handleDestroyProtyle(detail: any) {
    const protyle = detail?.detail?.protyle;
    if (!protyle) {
        return;
    }
    inlineControllerRegistry.destroy(protyle);
}

/**
 * ws-main 文档结构变更（moveDoc/rename/removeDoc/filetreeSortChanged）刷新合并：
 * 批量移动 N 个文档时，kernel 对每个文档（含其全部子文档）单独推送一条 moveDoc 事件
 * （见 kernel/model/file.go moveDoc），若每条事件都立即刷新所有打开的编辑器
 * （N×M 次串行完整刷新）会产生 API 洪峰。这里以短延时窗口合并：窗口内到达的
 * 多次事件共享一轮刷新，按 protyle 去重后并行执行。
 */
const STRUCT_CHANGE_REFRESH_DELAY = 100;
let pendingStructureRefresh = new Set<any>();
let structureRefreshTimer: any = null;

function flushStructureRefresh() {
    structureRefreshTimer = null;
    const protyles = Array.from(pendingStructureRefresh);
    pendingStructureRefresh.clear();
    if (protyles.length === 0) {
        return;
    }
    state.g_adjacentDocCache = {};
    // 并行刷新替代原串行 await；main 内部自带异常兜底，这里 catch 兜底防未处理拒绝
    protyles.forEach((protyle) => {
        main(protyle).catch((err) => errorPush(err));
    });
}

function scheduleStructureRefresh(protyle: any) {
    pendingStructureRefresh.add(protyle);
    if (structureRefreshTimer === null) {
        structureRefreshTimer = setTimeout(flushStructureRefresh, STRUCT_CHANGE_REFRESH_DELAY);
    }
}

/**
 * 插件卸载时重置事件去重与合并刷新的模块级状态：
 * 去重状态不清零的话，重载后旧 protyle 在窗口期内再次触发事件会被误跳过；
 * 合并刷新定时器/队列虽已被 main() 的存活检查兜底，但残留引用已无意义，一并清除。
 */
export function resetEventState() {
    lastMainEventProtyle = null;
    lastMainEventTime = 0;
    if (structureRefreshTimer !== null) {
        clearTimeout(structureRefreshTimer);
        structureRefreshTimer = null;
    }
    pendingStructureRefresh.clear();
}

export function eventBusHandler(detail: any) {
    // ws-main 为高频事件（输入时每次事务保存都会推送 savedoc），
    // 必须先做 cmd 过滤，非目标消息直接返回，避免任何开销。
    const cmd = detail?.detail?.cmd;
    if (!["moveDoc", "rename", "removeDoc", "filetreeSortChanged"].includes(cmd)) {
        return;
    }
    try {
        debugPush("检查刷新中（由重命名、移动或删除触发）");

        // 结构变更（重命名/移动）会影响大纲标题名，主动失效大纲缓存
        clearDocOutlineCache();

        const allEditor = siyuan.getAllEditor();
        const ids = getAllShowingDocId();
        if (ids != null && ids.length > 0) {
            for (let editor of allEditor) {
                if (ids.includes(editor.protyle.block.rootID)) {
                    scheduleStructureRefresh(editor.protyle);
                }
            }
        }
    } catch (err) {
        errorPush(err);
    }
}

/**
 * 插件主流程入口
 * 每个 Protyle 由 registry 保证只存在一个 controller；
 * 异步竞态由 controller 内部的 revision token 处理。
 */
export async function main(eventProtyle: any) {
    // 插件已卸载（onunload 清空实例引用）时拒绝挂载，
    // 防止合并刷新定时器等延迟任务在卸载后重新创建 controller
    if (!state.g_pluginInstance) {
        return;
    }
    if (state.g_isMobile) {
        debugPush("插件停止支持移动端");
        return;
    }
    const protyle = eventProtyle;
    if (!protyle?.element) {
        return;
    }
    const controller = inlineControllerRegistry.ensure(protyle);
    if (!controller) {
        debugPush("当前 Protyle 无法挂载文档面包屑");
        return;
    }
    await controller.refresh();
}

/**
 * 设置保存后，为所有正在显示的文档重新挂载并刷新
 */
export function refreshAllShowingProtyles() {
    try {
        const allEditor = siyuan.getAllEditor?.() ?? [];
        for (const editor of allEditor) {
            const protyle = editor?.protyle;
            if (protyle?.element && protyle?.block?.rootID) {
                main(protyle);
            }
        }
    } catch (err) {
        warnPush(err);
    }
}


