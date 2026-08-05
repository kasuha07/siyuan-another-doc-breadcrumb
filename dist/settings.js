"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingProperty = void 0;
exports.generateSettingPanel = generateSettingPanel;
exports.loadUISettings = loadUISettings;
/**
 * 设置面板构建与读取
 */
const constants_1 = require("./constants");
const logger_1 = require("./logger");
const state_1 = require("./state");
class SettingProperty {
    /**
     * 设置属性对象
     * @param {*} id 唯一定位id
     * @param {*} type 设置项类型
     * @param {*} limit 限制
     */
    constructor(id, type, limit, value = undefined) {
        var _a, _b;
        this.id = `${constants_1.CONSTANTS.PLUGIN_NAME}_${id}`;
        this.simpId = id;
        this.name = (_a = state_1.state.language[`setting_${id}_name`]) !== null && _a !== void 0 ? _a : id;
        this.desp = (_b = state_1.state.language[`setting_${id}_desp`]) !== null && _b !== void 0 ? _b : id + "_desp";
        this.type = type;
        this.limit = limit;
        if (value) {
            this.value = value;
        }
        else {
            this.value = state_1.state.g_setting[this.simpId];
        }
        if (typeof this.value === 'function') {
            this.onClick = this.value;
        }
    }
}
exports.SettingProperty = SettingProperty;
/**
 * 根据设置对象数组，使用 HTMLElement 创建设置面板
 * @param {Array<object>} settingObjectArray - 设置项对象的数组。
 * @param {object} [state.language={}] - (可选) 语言包对象，用于国际化。
 * @returns {DocumentFragment} - 包含所有设置项 DOM 元素的文档片段。
 */
function generateSettingPanel(settingObjectArray) {
    var _a;
    // 使用 DocumentFragment 可以一次性将所有元素添加到 DOM，效率更高
    const fragment = document.createDocumentFragment();
    for (const oneSettingProperty of settingObjectArray) {
        // 1. 创建每个设置项的根容器
        let outterItemContainer;
        if (oneSettingProperty.type === "SWITCH") {
            outterItemContainer = document.createElement("label");
            outterItemContainer.className = "fn__flex b3-label";
        }
        else {
            outterItemContainer = document.createElement("div");
            outterItemContainer.className = "fn__flex b3-label config__item";
        }
        // 2. 创建左侧的标题和描述区域
        const infoDiv = document.createElement("div");
        infoDiv.className = "fn__flex-1";
        // 处理标题文本
        infoDiv.appendChild(document.createTextNode(oneSettingProperty.name));
        // 处理描述文本（支持 HTML）
        let despHTML = (_a = oneSettingProperty.desp) !== null && _a !== void 0 ? _a : "";
        if (oneSettingProperty.name.includes("🧪")) {
            const experimentalText = state_1.state.language["setting_experimental"] || "（实验性功能）";
            despHTML = experimentalText + despHTML;
        }
        if (despHTML) {
            const descriptionElement = document.createElement('div');
            descriptionElement.className = 'b3-label__text';
            // 替换 <code> 为带 class 的版本以应用样式
            despHTML = despHTML.replace(/<code>/g, "<code class='fn__code'>");
            descriptionElement.innerHTML = despHTML;
            infoDiv.appendChild(descriptionElement);
        }
        outterItemContainer.appendChild(infoDiv);
        // 3. 根据类型创建右侧的交互控件
        let controlElement = null;
        switch (oneSettingProperty.type) {
            case "NUMBER": {
                controlElement = document.createElement("input");
                controlElement.className = "b3-text-field fn__flex-center fn__size200";
                controlElement.type = "number";
                const [min, max] = oneSettingProperty.limit || [null, null];
                if (min !== null)
                    controlElement.min = min;
                if (max !== null)
                    controlElement.max = max;
                controlElement.value = oneSettingProperty.value;
                break;
            }
            case "SELECT": {
                controlElement = document.createElement("select");
                controlElement.className = "b3-select fn__flex-center fn__size200";
                oneSettingProperty.limit.forEach((option) => {
                    const optionElement = document.createElement("option");
                    optionElement.value = option.value;
                    let optionName = state_1.state.language[`setting_${oneSettingProperty.simpId}_option_${option.value}`] || option.value;
                    optionElement.textContent = optionName;
                    if (option.value == oneSettingProperty.value) {
                        optionElement.selected = true;
                    }
                    controlElement === null || controlElement === void 0 ? void 0 : controlElement.appendChild(optionElement);
                });
                break;
            }
            case "TEXT": {
                controlElement = document.createElement("input");
                controlElement.className = "b3-text-field fn__flex-center fn__size200";
                controlElement.type = "text";
                controlElement.value = oneSettingProperty.value;
                break;
            }
            case "SWITCH": {
                controlElement = document.createElement("input");
                controlElement.className = "b3-switch fn__flex-center";
                controlElement.type = "checkbox";
                controlElement.checked = !!oneSettingProperty.value;
                break;
            }
            case "TEXTAREA": {
                // TEXTAREA 结构特殊，控件在左侧区域的下方
                infoDiv.appendChild(document.createElement("div")).className = "fn__hr";
                controlElement = document.createElement("textarea");
                controlElement.className = "b3-text-field fn__block";
                controlElement.value = oneSettingProperty.value;
                infoDiv.appendChild(controlElement);
                controlElement = null; // 标记为 null，防止下面重复添加
                break;
            }
            case "BUTTON": { // ✨ 新增对 BUTTON 的支持
                controlElement = document.createElement("button");
                controlElement.className = "b3-button b3-button--outline fn__flex-center fn__size200";
                controlElement.type = "button";
                // 按钮文本可由 settingObject 的 `buttonText` 属性指定
                controlElement.textContent = oneSettingProperty.buttonText || "执行操作 Click to Run";
                // 可以从 settingObject 传入一个 onClick 回调函数
                (0, logger_1.logPush)("test", typeof oneSettingProperty.onClick);
                if (typeof oneSettingProperty.onClick === 'function') {
                    controlElement.addEventListener('click', oneSettingProperty.onClick);
                }
                break;
            }
            case "HINT": {
                // HINT 类型没有交互控件
                break;
            }
        }
        // 4. 如果存在交互控件，则将其添加到容器中
        if (controlElement) {
            // 为控件设置通用属性
            if (oneSettingProperty.id)
                controlElement.id = oneSettingProperty.id;
            if (oneSettingProperty.simpId)
                controlElement.name = oneSettingProperty.simpId;
            // 添加一个间隔元素
            outterItemContainer.appendChild(document.createElement("span")).className = "fn__space";
            // 将控件添加到容器
            outterItemContainer.appendChild(controlElement);
        }
        // 5. 将构建好的整个设置项添加到片段中
        fragment.appendChild(outterItemContainer);
    }
    return fragment;
}
/**
 * 由设置界面读取配置
 */
function loadUISettings(formElement) {
    let data = new FormData(formElement);
    // 扫描标准元素 input[]
    let result = {};
    for (const [key, value] of data.entries()) {
        // console.log(key, value);
        result[key] = value;
        if (value === "on") {
            result[key] = true;
        }
        else if (value === "null" || value == "false") {
            result[key] = "";
        }
    }
    let checkboxes = formElement.querySelectorAll('input[type="checkbox"]');
    for (let i = 0; i < checkboxes.length; i++) {
        let checkbox = checkboxes[i];
        // console.log(checkbox, checkbox.name, data[checkbox.name], checkbox.name);
        if (result[checkbox.name] == undefined) {
            result[checkbox.name] = false;
        }
    }
    let numbers = formElement.querySelectorAll("input[type='number']");
    // console.log(numbers);
    for (let number of numbers) {
        let numberElement = number;
        let minValue = numberElement.getAttribute("min");
        let maxValue = numberElement.getAttribute("max");
        let value = parseFloat(numberElement.value);
        if (minValue !== null && value < parseFloat(minValue)) {
            numberElement.value = minValue;
            result[numberElement.name] = parseFloat(minValue);
        }
        else if (maxValue !== null && value > parseFloat(maxValue)) {
            numberElement.value = maxValue;
            result[numberElement.name] = parseFloat(maxValue);
        }
        else {
            result[numberElement.name] = value;
        }
    }
    (0, logger_1.debugPush)("UI SETTING", result);
    return result;
}
