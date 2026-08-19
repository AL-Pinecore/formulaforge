# LaTeX 源码面板与剪贴板

定位：右侧的 LaTeX 源码 textarea——查看/编辑源码、三种格式复制、`.tex` 导入导出。

## 涉及文件

- `app/components/LatexSource.vue` — 源码面板
- `app/utils/clipboard.ts` — 剪贴板与文本/文件下载工具

## 工作机制

### 双缓冲 `draft` / `editing`

`draft` 是 textarea 绑定值，`editing` 标记是否正在编辑。`watch(latex)` 只在 `!editing` 且值不同时同步 `draft`——避免字段变化时打断用户正在输入的内容。`onInput` 把草稿 `emit('apply', draft)` 回灌到工作区，`onBlur` 把 `draft` 重置为当前 latex（放弃草稿态）。

### 复制三种格式

工具栏/面板提供三种复制（`clipboard.ts` 的包装函数）：

- `raw` — 原始 LaTeX
- `inline` — `$...$`（`wrapInlineMath`）
- `display` — `\[...\]`（`wrapDisplayMath`）

`copyTextToClipboard` 优先 `navigator.clipboard.writeText`，失败（非安全上下文）回退到隐藏 textarea + `document.execCommand('copy')`。

### `.tex` 导入导出

- **导出**（`onSaveTex`）：Tauri 走 `save_text_file_approved`（Rust 对话框 + 原子写）；浏览器走 `downloadTextFile`（`saveBlob` 下载）。
- **导入**（`onImportTex`）：Tauri 走 `read_text_file_approved`；浏览器点隐藏 `<input type="file">`，`File.text()` 读内容，`emit('apply', contents)` 应用。

## 设计取舍

- **双缓冲而非直接 `v-model` 到 latex**：源码编辑是「批量替换」语义，直接双向绑定会在每次击键触发字段重解析、光标跳动。
- **`copyTextToClipboard` 双策略**：剪贴板 API 需要安全上下文，execCommand 兜底覆盖 Tauri/老环境。

## 已知边界

- 浏览器导入走 `File.text()`（UTF-8），不处理其它编码。
- 复制返回 `boolean`，由调用方决定 toast 成功/失败文案。
