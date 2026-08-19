# 主题系统

定位：亮 / 暗 / 跟随系统三种主题，localStorage 持久化，启动时无闪屏应用。

## 涉及文件

- `app/composables/useTheme.ts` — 主题核心
- `app/plugins/theme.client.ts` — 早应用插件
- `app/assets/css/main.css` — CSS 变量定义

## 工作机制

### 状态与持久化

`useTheme.ts` 在模块层持有 `theme` ref，`readStoredTheme()` 读 localStorage（`formulaforge.theme`），只接受 `light`/`dark`/`system` 三值，无效回退 `system`。`setTheme` 校验、写 ref、`applyTheme`、再持久化（localStorage 不可用时静默降级为内存值）。

### 应用方式

`applyTheme` 把主题写到 `document.documentElement.dataset.theme`。`main.css` 用 `[data-theme="dark"]` 等选择器切换 CSS 变量（`--text`、`--panel-bg`、`--accent`…），所有组件只引用变量、不写死颜色。

### 早应用防闪屏

`theme.client.ts` 插件只做一件事：`useTheme()`（模块加载即执行 `applyTheme(theme.value)`）。因为插件在应用挂载前运行，`<html data-theme>` 在首帧前就设置好，避免默认主题一闪而过。

## 设计取舍

- **`data-theme` + CSS 变量**：主题即一套变量切换，组件零逻辑。
- **模块级 ref + 插件早执行**：与 i18n 同一套「模块级单例 + 插件预热」模式。

## 已知边界

- `system` 只是标记，实际的明暗跟随靠 `data-theme="system"` 下 CSS 的 `prefers-color-scheme` 媒体查询（见 `main.css`）。
