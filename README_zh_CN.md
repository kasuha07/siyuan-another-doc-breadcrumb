## 另一个文档面包屑（siyuan-another-doc-breadcrumb）

**中文** | [English](README.md)

> 在编辑器上方显示当前文档路径信息的[思源笔记](https://github.com/siyuan-note/siyuan)插件。

> **分叉声明**：本插件是 [OpaqueGlass/syplugin-fakeDocBreadcrumb](https://github.com/OpaqueGlass/syplugin-fakeDocBreadcrumb) 的分叉，采用 [AGPL-3.0](LICENSE) 许可证。版权归 OpaqueGlass 所有，修改部分版权归霞葉（kasuha）。

> 当前版本：v1.0.5
> - 分家自 syplugin-fakeDocBreadcrumb v1.5.1，更名另起炉灶；
> - 页签关闭走公开 API、菜单懒加载容器级监听、批量请求合并降级、设置校验与迁移保留、样式迁移官方 pluginsStyle 机制；
>
> 详见[更新日志](CHANGELOG.md)

### 快速开始

- 从 Release 解压 `package.zip`，将文件夹移动到 `工作空间/data/plugins/`，并将文件夹重命名为 `siyuan-another-doc-breadcrumb`;
- 开启插件即可；

### 功能说明

- 在编辑器顶部添加当前文档导航路径；
- 点击跳转到对应文档，右键点击展开该文档的下层文档；
- （设置项）下层文档菜单支持继续按照层级展开，最多支持7层级；
- （设置项）层级超出5时，默认保留前2层级、后3层级；
- （设置项）在面包屑右侧显示上一篇下一篇按钮；
- （设置项）点击上一篇/下一篇时在当前位置打开（替换当前页签，默认关闭）；
- （设置项）在菜单中显示新建文档按钮；

### 兼容性说明

本插件：
- 不支持在移动端显示，请使用其他插件，如层级导航插件中的面包屑；
- 启用“与块面包屑在同一行显示”后，文档面包屑与块面包屑显示在同一行，超长时作为一条连续内容带整体横向滚动；未启用时仍显示在块面包屑上方（占用一行）；
- 如果主题将面包屑中文档间的分隔符显示为“/”，可能无法点击显示子文档选择菜单，需要在设置项中启用“覆盖主题面包屑分隔符“>”样式”；

插件依赖若干思源未在 API 文档中声明的内部结构（页签关闭链 `protyle.model.parent.parent.removeTab`、大纲接口返回的 `blocks`/`children` 字段、加密笔记本 `closed` 字段语义），已对照思源 v3.7.3 源码验证；升级思源后若出现相邻导航/菜单异常，请反馈日志以定位。

## 与上游的差异

本插件与上游 `syplugin-fakeDocBreadcrumb`（v1.5.1，上游已进入维护阶段，停止功能新增）的主要差异：

- **重构**：改用 TypeScript 编写并开启 strict 类型检查；esbuild 单文件 bundle 构建；`dist/` 作为唯一插件目录；
- **默认值调整**：“与块面包屑在同一行显示”与“在菜单中显示新建文档按钮”默认开启（上游默认关闭）；“在面包屑所在分屏区打开文档”固定生效、不再提供开关（上游为默认开启的实验性开关）；
- **移除的设置项/功能**：
  - 自动修复聚焦错误（上游隐藏设置，修复已上线稳定运行半年，不再需要开关）；
  - 展开菜单时滚动到当前路径（上游隐藏设置）；
  - 允许悬停显示浮窗（上游该功能实现不完整）；
  - 文档重命名/移动后立即更新（本插件固定为总是即时更新，上游默认关闭需手动开启）；
  - 在更多情况下显示、输入时隐藏、交换左右键点击、设置页“上下滑动查看更多”提示项；
- **转正的功能**：在面包屑所在分屏区打开文档、下层文档菜单扩展层级（最多 7 层级）、菜单中新建文档按钮（默认开启）；
- **新增设置项**：上一篇/下一篇按钮显示样式（文字/仅箭头）；上一篇/下一篇替换当前页签（默认关闭）；
- **稳定性与性能**：子菜单懒加载由每项一个 MutationObserver 改为容器级事件委托；面包屑省略由逐个压缩改为二分查找，reflow 从 O(n) 降到 O(log n)；文档结构变更按 100ms 窗口合并刷新，批量移动不再产生请求洪峰；打开文档双事件去重；文档路径改批量 getDocsInfo 一次读盘；初始化失败自动重试（最多 5 次）并回退默认配置；请求层统一错误处理与空值兜底；
- **安全**：文档名、图标拼入菜单 HTML 前转义，封堵两处 XSS；
- **生命周期**：监听 destroy-protyle 完整清理，卸载无残留节点；设置保存按需重建；样式经思源官方 pluginsStyle 机制注入，卸载时官方自动移除；
- **其他**：同行模式插件与原生内容带间分隔符改为 CSS 圆点并对称间距；移除对 OpaqueGlass 外部调试协议（`OpaqueGlassDebugV2`）的依赖；已对照思源 v3.7.3 源码验证并文档化三处未公开依赖（页签关闭链、大纲接口字段、加密笔记本 closed 语义）。

## 反馈bug

请前往[github仓库](https://github.com/kasuha07/siyuan-another-doc-breadcrumb)反馈问题。

### 参考&感谢

| 开发者/项目                                                  | 描述                                                         | 说明         |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------ |
| [leolee9086](https://github.com/leolee9086) / [cc-template](https://github.com/leolee9086/cc-template) | 使用挂件渲染模板；[木兰宽松许可证， 第2版](https://github.com/leolee9086/cc-template/blob/main/LICENSE) | 点击打开文档 |
| [zuoez02](https://github.com/zuoez02)/[siyuan-plugin-system](https://github.com/zuoez02/siyuan-plugin-system) | 插件系统（社区版）                                                     |              |
| [Hug-Zephyr](https://github.com/Hug-Zephyr)/[HZ-syplugin-fakeDocBreadcrumb](https://github.com/Hug-Zephyr/HZ-syplugin-fakeDocBreadcrumb) |        这是一个fork-repo，进行了亿些优化                                               | 右键菜单调整，菜单超长调整             |
| [TCOTC](https://github.com/TCOTC) |        反馈和问题定位                                             | 详见issue #30~32             |
