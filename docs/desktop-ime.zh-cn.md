# 桌面集成与输入法

定位：Tauri 桌面壳的命令注册、文件对话框，以及「数学字段强制英文输入」的双层输入法处理（macOS 系统输入源切换 + JS 层 IME 事件阻断）。

## 涉及文件

- `src-tauri/src/lib.rs` — 命令注册
- `src-tauri/src/export.rs` — 文件对话框与文件命令（详见 export 文档）
- `src-tauri/src/ime.rs` — macOS 输入源切换
- `app/components/EquationWorkspace.vue` — JS 层 IME 阻断与输入源请求
- `src-tauri/tauri.conf.json` — CSP / 窗口 / bundle 配置

## 工作机制

### 命令注册（`lib.rs`）

`tauri::Builder` 注册 5 个命令：`export_equation_approved`、`save_text_file_approved`、`read_text_file_approved`（export.rs）和 `force_ascii_ime`、`restore_ime`（ime.rs）。`tauri_plugin_dialog` 提供文件对话框扩展。

### 输入法问题

数学字段只接受 ASCII（公式是英文符号），但 macOS 的非拉丁输入法（中文/日文/韩文）候选窗口由系统绘制、无法从 JS 隐藏。因此两层处理：

1. **JS 层阻断**（跨平台）：`attachImeBlocker` 在 shadow root 上捕获 `compositionstart/update/end`、`beforeinput`、`input`，凡是非 ASCII 数据一律 `preventDefault` + `stopPropagation`，把 IME 文本挡在 MathLive 模型外。`onMfKeydown` 还处理 `isComposing`/`keyCode 229` 时恢复可打印字母。
2. **系统输入源切换**（仅 macOS，`ime.rs`）：字段聚焦时 `force_ascii_ime` 调 Carbon 的 `TISCopyCurrentASCIICapableKeyboardInputSource` + `TISSelectInputSource` 切到英文输入源，blur 时 `restore_ime` 恢复。`PREVIOUS`（`Mutex<Option<usize>>`）记住原始输入源；已经切到英文则保留。非 macOS 是 no-op（WebView2 的 Chromium 已由 JS 层取消组合）。

前端 `requestEnglishIme` / `restoreImeAfterBlur` 用 `isTauriRuntime()` 守卫，只在桌面端 `invoke` 这两个命令，失败静默（JS 层仍兜底）。

### 安全与 CSP

`tauri.conf.json` 的 CSP 默认只允许 `'self'`，`connect-src` 限定 `ipc:`，脚本不走 unsafe-inline（dev 配置例外）。文件访问完全经 Rust 命令，webview 无任意路径权限。

## 设计取舍

- **双层 IME 处理**：JS 层阻断是唯一跨平台手段，但 macOS 候选窗口绕不过，故补系统输入源切换；两者互为兜底。
- **Carbon `TIS*` 用 `link(name = "Carbon")` 声明 FFI**：无需第三方 crate，直接连系统框架。

## 已知边界

- 输入源切换只在 macOS 生效，其它平台靠 JS 层。
- `ime.rs` 用裸指针 FFI + `unsafe`，指针存为 `usize` 才能 `Send`（见 `PREVIOUS`）。
