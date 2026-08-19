# 多格式导出

定位：把渲染好的 SVG 导出为 SVG / PNG / JPEG / WebP / PDF。桌面端（Tauri）在 Rust 侧完成文件对话框与栅格/PDF 渲染，浏览器端走 Web API，两条路径共享同一份渲染输入。

## 涉及文件

- `app/composables/useEquationExport.ts` — 导出编排与运行时判断
- `app/utils/browser-export.ts` — 浏览器侧栅格/PDF 编码
- `app/utils/export-payload.ts` — 导出参数组装与 clamp
- `app/types/export.ts` — 格式/设置类型与默认值
- `src-tauri/src/export.rs` — Rust 侧导出命令
- `app/components/ExportPanel.vue` — 导出设置 UI

## 工作机制

### 数据流

```
ExportPanel(设置) → effectiveExportSettings(clamp) → renderEquationSvg(SVG)
   ├─ Tauri：invoke('export_equation_approved', { format, svg, jpegQuality })
   └─ 浏览器：svg → (canvas 栅格 | jsPDF+svg2pdf PDF) → saveBlob 下载
```

`isTauriRuntime()` 判断 `window.isTauri` 或 `__TAURI_INTERNALS__`。桌面端把 SVG 交给 Rust（打开保存对话框 + 渲染），浏览器端用 `downloadBlob`（`saveBlob`）触发下载。

### 参数 clamp（`effectiveExportSettings`）

padding `[0,200]` 默认 8、scale `[1,3]` 默认 1、jpegQuality `[10,100]` 默认 90；非有限值回退默认。JPEG 无背景时强制 `#ffffff`（JPEG 不支持透明）。

### 浏览器侧（`browser-export.ts`）

- `svgToRasterBlob`：SVG → `Blob`/`Image` → canvas `drawImage` → `toBlob`；`MAX_DIMENSION = 16384` 与 Rust 侧守卫一致，避免耗尽 canvas 内存。
- `svgToPdfBlob`：`jspdf` + `svg2pdf.js`。svg2pdf 读 `getComputedStyle`，对脱离文档的节点不可靠，所以先把 SVG 挂到 off-screen `<div>` 再转。

### Rust 侧（`export.rs`）

命令 `export_equation_approved`：解析格式 → `validate_svg` 安全校验 → `save_file` 对话框 → `normalize_extension` 补扩展名 → `spawn_blocking` 里渲染写入。

- **SVG 校验**（`validate_svg`）：大小上限 4MB、拒绝 `<script>`、事件处理器属性、`href` 外链。
- **栅格**（`svg_to_raster`）：`resvg` 解析（`image_href_resolver` 只允许 data: URL，禁止本地文件）；`tiny_skia` 输出预乘 alpha，逐像素 `demultiply` 成 straight RGBA 再交给 `image` 编码；JPEG 用 `composite_over_white` 铺白底。
- **PDF**（`svg_to_pdf`）：`svg2pdf` 的 `usvg` 解析 + 同样 deny-all resolver。
- **原子写**（`write_atomic`）：先写 `.<name>.tmp<pid>-<seq>` 再 `rename`，避免半写文件。
- **并发守卫**（`ExportGuard` + `MAX_CONCURRENT_EXPORTS=2`）：限制同时进行的 CPU 密集导出。

### 文本文件导出/导入

`save_text_file_approved` / `read_text_file_approved` 复用同一套对话框 + 原子写机制（`.tex` 导入导出），由 `LatexSource.vue` 调用（见 latex-source 文档）。

## 设计取舍

- **文件对话框在 Rust 侧**：webview 永远不接触路径，也不被授予任意路径权限——对话框结果只回传保存路径字符串。
- **双路径共享渲染输入**：无论哪条路径，输入都是同一份 `renderEquationSvg` 产物，保证预览 = 导出。
- **尺寸/像素守卫前后端一致**：`MAX_DIMENSION`（16384）与 `MAX_PIXELS`（4096×4096）在浏览器与 Rust 各有一份，阻止荒谬输入耗尽内存。

## 已知边界

- 浏览器侧 PNG/WebP 无像素上限（仅 `MAX_DIMENSION`），Rust 侧额外有 `MAX_PIXELS`。
- `ExportGuard` 的并发上限 `2` 偏保守（前端 `exporting` 已串行化 UI），属信任边界防护。
