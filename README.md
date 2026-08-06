## Another Doc Breadcrumb

[中文](README_zh_CN.md) | **English**

> A [SiYuan Note](https://github.com/siyuan-note/siyuan) plugin that displays the current document path information above the editor.

> **Fork notice**: This is a fork of [OpaqueGlass/syplugin-fakeDocBreadcrumb](https://github.com/OpaqueGlass/syplugin-fakeDocBreadcrumb) (forked from v1.5.1), licensed under [AGPL-3.0](LICENSE). Copyright © OpaqueGlass. Modifications © 霞葉 (kasuha07).

> Most of this document was translated by Google Translate and GPT.

### Quick Start

- Download from marketplace in Siyuan OR 1: Unzip the `package.zip` file in Release, 2: Move the folder to `{workplace}/data/plugins/`, 3: Rename the folder to the repo name;
- Just turn on the plugin; (`Marketplace`--`Downloaded`--`Plugin`--`Another Doc Breadcrumb`, click switch icon)

### Features

- Add the current document navigation path above the editor;
- Click to jump to the corresponding document, right-click to expand the sub-documents of that document;
- (Setting) The sub-document menu supports further expansion according to the hierarchy, up to 7 levels;
- (Setting) When the hierarchy exceeds 5 levels, the first 2 levels and the last 3 levels are retained by default;
- (Setting) Show previous/next document buttons on the right side of the breadcrumb;
- (Setting) Open previous/next document in the current tab (replace the current tab, disabled by default);
- (Setting) Show new document button in the menu;

#### Other explanation

- No support for Android or other mobile Device;
- You can browse the settings on the plugin settings page. Just a tip, the settings page can be scrolled up and down.
- Requires SiYuan v3.7.0+;
- With "Display the document breadcrumb on the same line as the block breadcrumb" enabled, the two breadcrumbs share one line and scroll horizontally as one continuous strip when overflowing; otherwise the document breadcrumb stays on its own line above the block breadcrumb.

## Differences from upstream

This fork diverges from upstream `syplugin-fakeDocBreadcrumb` (v1.5.1; upstream is now in maintenance mode with no new features) in the following ways:

- **Refactoring**: Rewritten in TypeScript with strict type checking; built with esbuild as a single-file bundle; `dist/` is the only plugin directory.
- **Default value changes**: "Display the document breadcrumb on the same line as the block breadcrumb" and "Show new document button in the menu" are enabled by default (disabled upstream); "Open in the split-screen area of the breadcrumb" is always on with no switch (an experimental toggle, default-on upstream).
- **Removed settings/features**:
  - "Automatically fix focus errors" (a hidden upstream setting; the fix has been stable in production, so the switch is gone);
  - "Scroll to current path when expanding menu" (a hidden upstream setting);
  - "Allow hover popup" (incomplete upstream implementation);
  - "Update immediately after rename/move" (this plugin always updates immediately; upstream defaults to off and requires manual enabling);
  - "Show in more cases", "Hide while typing", "Swap left/right click actions", and the "Scroll hint" (scroll for more settings) hint item.
- **Promoted to stable**: "Open in the split-screen area of the breadcrumb", "Extended sub-document menu levels" (up to 7), "Create document button in menu" (on by default).
- **New settings**: Previous/next button style options (text / arrow only); "Open previous/next in the current tab" (disabled by default).
- **Stability & performance**: lazy submenu loading via container-level event delegation (upstream uses one MutationObserver per item); breadcrumb collapsing via binary search (reflow O(n) → O(log n)); document structure changes batched into one refresh per 100 ms window, eliminating request bursts on bulk moves; deduplicated open-document events; batch `getDocsInfo` instead of per-level lookups; init retries (up to 5) with fallback to default settings; unified fetch error handling with null fallbacks.
- **Security**: document names and icons are escaped before being inserted into menu HTML (two XSS vectors closed).
- **Lifecycle**: full cleanup on `destroy-protyle` — no leftover nodes after unload; settings saves rebuild only what changed; styles are injected via the official `pluginsStyle` mechanism and removed automatically on unload.
- **Other**: The separator between the plugin and the native content strip in one-line mode uses CSS dots; removed the external debug protocol (`OpaqueGlassDebugV2`) dependency; three undocumented SiYuan dependencies (tab-close chain, outline API fields, encrypted-notebook `closed` semantics) verified against the v3.7.3 source and documented.

## Feedback bugs

Please go to [github repository](https://github.com/kasuha07/siyuan-another-doc-breadcrumb) to report problems.

### Reference & Thanks

| Developer/Project                                            | Description                                                  | Illustration           |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------- |
| [leolee9086](https://github.com/leolee9086) / [cc-template](https://github.com/leolee9086/cc-template) | Render template in widget; [Mulan Permissive Software License，Version 2](https://github.com/leolee9086/cc-template/blob/main/LICENSE) | Click to open the doc. |
| [zuoez02](https://github.com/zuoez02)/[siyuan-plugin-system](https://github.com/zuoez02/siyuan-plugin-system) | A plugin system for siyuan                                   |                        |
| [Hug-Zephyr](https://github.com/Hug-Zephyr)/[HZ-syplugin-fakeDocBreadcrumb](https://github.com/Hug-Zephyr/HZ-syplugin-fakeDocBreadcrumb) |        fork-repo, with some enhancements                                              |              |
| [TCOTC](https://github.com/TCOTC) |        feedback                                             | see issue #30~32             |
