# LaTeX 渲染与实时预览

定位：把 LaTeX 转成 SVG。编辑用 MathLive，但导出/预览/面板 chip 统一用 MathJax 渲染，保证「所见即所得、导出与预览一致」。

## 涉及文件

- `app/utils/mathjax-loader.ts` — MathJax 动态加载与宏配置
- `app/utils/svg-export.ts` — LaTeX → 独立 SVG 的核心
- `app/components/MathPreview.vue` — 导出面板里的实时预览（防抖）
- `app/components/MathChip.vue` — 面板元素的静态 chip 渲染
- `app/assets/css/mathlive-fonts.css` / `scripts/copy-vendor-assets.mjs` — 字体资源

## 工作机制

### MathJax 加载（`mathjax-loader.ts`）

MathJax 以 vendor 资源打包在 `public/mathjax/`（`copy-vendor-assets.mjs` 从 node_modules 拷贝）。`ensureMathJax` 懒加载 `tex-svg.js` 脚本，缓存 `loadPromise`，失败时清空以允许重试。

字体路径 `loader.paths.fonts = ''` 让动态字形从根路径加载。MathLive 专有命令在工作区的公共 LaTeX 边界统一转成主流写法，详见 `latex-source.zh-cn.md`。

### SVG 渲染（`renderEquationSvg`）

`svg-export.ts` 的核心流程：

1. `applyMathstyle`：inline 样式用 `\textstyle` 声明而非 `display: false`——MathJax 4 的 SVG 输出会对 inline math 在每个运算符处断行、产生多个 `<svg>`；
2. `tex2svgPromise(..., { display: true, em: 16, ex: 8 })`；
3. 注入 `SVG_CSS`（错误节点标红、虚线框等）；
4. 尺寸换算：display 模式下 MathJax 给 `width="100%"`（无 ex 单位），回退用 viewBox（MathJax 单位 1000 = 1em）除以 1000 再乘 `EM_PIXELS`；
5. `composeStandaloneSvg` 包一层带 `xmlns`/`viewBox`/内边距/颜色/背景的外层 SVG。

`hasErrors` 通过查 `[data-mml-node="merror"]` 判断公式是否有 LaTeX 错误，用于预览面板提示。

### 预览 `MathPreview.vue`

导出面板里对 `latex + 颜色 + 背景 + 内边距 + 缩放` 的组合做实时预览。用 `delay`（默认 200ms）防抖，`renderId` 递增防竞态（异步结果回来时若已发起新渲染则丢弃）。渲染结果 `stripXmlDeclaration` 后 `innerHTML` 注入，`merror` 事件驱动「公式有误」提示。

### 面板 chip `MathChip.vue`

面板里每个元素用 `convertLatexToMarkup`（MathLive 静态方法）渲染成 markup，`fitToBox` 按 `MAX_WIDTH`/`MAX_HEIGHT` 缩放，`ResizeObserver` 在分类展开（从 `display:none` 恢复）时重测——否则挂载时 `scrollWidth` 读到 0、缩放卡在 1。

## 设计取舍

- **渲染器分工**：编辑用 MathLive（交互）、输出用 MathJax（排版质量）；两者差异在共享的公共 LaTeX 边界处理，而不是塞进渲染器配置。
- **`\textstyle` 而非 inline display**：绕开 MathJax 4 的 inline 断行行为，产物始终是单个 `<svg>`。

## 已知边界

- `EM_PIXELS` / `EX_PIXELS` 常量（1em=16px、1ex=8px）写死，与 MathJax 的 `em`/`ex` 参数对应；改字号需同步。
- 颜色/背景只接受 `#RRGGBB` / `#RRGGBBAA`（`sanitizeColor`），其它格式静默回退。
