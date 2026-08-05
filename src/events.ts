/**
 * 初始化、事件总线与鼠标键盘监听
 */
import * as siyuan from "siyuan";
import { CONSTANTS } from "./constants";
import { debugPush, errorPush, infoPush, logPush, warnPush } from "./logger";
import { state } from "./state";
import { getAllShowingDocId } from "./utils";
import { removeStyle, setStyle } from "./style";
import { destroyAllControllers, inlineControllerRegistry } from "./controller";

export function initRetry() {
    let successFlag = false;
    try {
        removeStyle();
        setStyle();
        successFlag = true;
        clearTimeout(state.g_initFailedMsgTimeout);
    } catch (e) {
        errorPush("文档面包屑插件初始化失败", e);
    }
    if (successFlag) {
        clearInterval(state.g_initRetryInterval);
        logPush("文档面包屑插件初始化成功");
        return true;
    }
    return false;
}

export async function mainEventBusHander(detail: any) {
    // 相关判断方式参考： https://github.com/siyuan-note/siyuan/issues/9458#issuecomment-1773776115
    detail = detail.detail;
    const protyle = detail.protyle;
    // 部分情况下，进入文档会停留在默认的聚焦，这里先运行了看看情况
    if (protyle.model == null /* || protyle.block.showAll */) {
        infoPush("插件内嵌Protyle、浮窗~~或聚焦~~。停止操作。", protyle);
        return;
    }
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

export async function eventBusHandler(detail: any) {
    // ws-main 为高频事件（输入时每次事务保存都会推送 savedoc），
    // 必须先做 cmd 过滤，非目标消息直接返回，避免任何开销。
    const cmd = detail?.detail?.cmd;
    if (!["moveDoc", "rename", "removeDoc", "filetreeSortChanged"].includes(cmd)) {
        return;
    }
    try {
        debugPush("检查刷新中（由重命名、移动或删除触发）");

        const allEditor = siyuan.getAllEditor();
        const ids = getAllShowingDocId();
        if (ids != null && ids.length > 0) {
            for (let editor of allEditor) {
                if (ids.includes(editor.protyle.block.rootID)) {
                    debugPush("由重命名、移动或删除触发");
                    await main(editor.protyle);
                }
            }
        }
        state.g_adjacentDocCache = {};
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


