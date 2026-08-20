# 编辑器与拖拽插入

定位：应用的核心编辑区。左侧面板把公式元素拖进 `<math-field>`，工作区实时渲染、维护状态，并提供一个「像素级一致的插入预览」。

## 涉及文件

- `app/components/EquationWorkspace.vue` — 工作区组件（字段初始化、拖放、预览、状态发布）
- `app/components/EquationPalette.vue` — 元素面板（分类、搜索、tooltip、拖拽起点）
- `app/utils/drag-payload.ts` — 拖拽共享状态（`draggedElementId` + MIME 类型）
- `app/data/equation-elements.ts` — 200+ 个公式元素的定义
- `app/utils/unwrap-element.ts` — 右键解包的 LaTeX 分组解析
- `app/composables/useEquation.ts` — 全局状态单例
- `app/types/equation.ts` — 元素类型与分类定义

## 工作机制

### 状态单例 `useEquation`

`useEquation.ts` 在模块层持有 `ref`（`latex` / `errors` / `canUndo` / `canRedo` / `fontSize` / `displayStyle`），`useEquation()` 每次返回同一份引用。所有组件（工作区、工具栏、导出面板）共享同一状态，避免逐层传 props。

工作区通过 `emit('latex-change', value, errors)` 和 `emit('undo-state', ...)` 把公式及语义历史状态回灌给这个单例。

### 语义 undo / redo

MathLive 的原生历史会记录 `setValue()`，但 Text 边界 marker、空盒 phantom、placeholder 恢复都需要内部 `setValue()`；直接 `applyStyle()` 又不会建立原生快照。因此工作区禁用 MathLive 历史，在 `publishState()` 汇合点记录最多 1000 个「公共 LaTeX + 光标位置」快照。

历史只保存 `publicLatex()` 的结果，undo/redo 时再通过 `loadLatex()` 重建 marker、phantom 和 placeholder。这保证内部修复不会成为额外的撤销步骤，同时覆盖键盘输入/删除、面板点击与拖放、Text/Accent 重建、字体样式、矩阵增删、源码编辑、文件导入和清空。建立新快照会丢弃 redo 分支；工具栏及 `Cmd/Ctrl+Z`、`Cmd/Ctrl+Shift+Z`、`Ctrl+Y` 共用同一历史。

### `<math-field>` 初始化

`math-field` 是 MathLive 的自定义元素，在 `app/plugins/mathlive.client.ts` 里注册。工作区的初始化走 `ensureMathfield()`：

1. `await customElements.whenDefined('math-field')`；
2. 轮询最多 20 次、每次 50ms，等 DOM 里的字段就绪（`element.canUndo` 存在）；
3. `configureMathfield()` 设置 `placeholder`、`mathVirtualKeyboardPolicy`、`defaultMode`、`maxMatrixCols` 等，并注入 placeholder 样式、accent 修正、分数规则、IME 阻断。

### 元素定义与拖拽

`equation-elements.ts` 用 `item()` 工厂生成元素。LaTeX 模板里的占位符约定：

- `#0` — 插入后成为首个选中的 placeholder；
- `#?` — 后续 placeholder；
- `#@` — 保留当前选区内容。

长左/右箭头模板同时提供箭头上方与下方两个 placeholder，元素面板预览也显示这两个空位。

拖拽起点在 `EquationPalette.vue` 的 `onDragStart`：把元素 id 写入 `draggedElementId`，同时 `setData(DRAG_ELEMENT_MIME, id)` 和 `setData('text/plain', latex)` 双通道。`text/plain` 是兜底——允许把元素拖到外部编辑器。拖拽图像被设成透明 1px canvas（`transparentDragImage`），因为工作区自己画预览。

### 插入预览（mirror 字段）

插入预览用第二个离屏 `math-field`（`ensureMirrorField`）实现：

1. `updateInsertionPreview` 用 `offsetFromPoint` 算出目标偏移；
2. `renderPreview` 把 mirror 覆盖到真实字段上方，`mirror.value = mf.value`，再 `mirror.insert(...)`；
3. MathLive 异步渲染，所以 `schedulePreviewSnapshot` 用 rAF + `setTimeout(32ms)` 双保险等它 settle，再 `snapshotPreview` 抓取 mirror 的 `.ML__latex` DOM 存为静态 HTML 覆盖显示。

mirror 与真实字段共用同一份 MathLive 渲染器，所以预览「像素级一致」。

空 Text 元素在 mirror 中也使用放置后的 phantom 哨兵，并复用同一个可见 hint 覆盖层；预览与落点因此共享完全相同的盒尺寸和字体。

### 偏移计算 `offsetFromPoint`

MathLive 的 `getOffsetFromPoint` 在上下标/分组下不可靠（很多位置返回 0）。工作区自己实现：`buildOffsetEdges` 遍历每个 offset 的 `getElementInfo(offset).bounds`，用每个原子的左右边缘构建 `OffsetEdge[]`，再按「距点击点最近、深度最大」选择偏移。

### 反斜杠命令输入

在 `<math-field>` 里直接输入 `\` + 命令名（例如 `\mathrm`、`\frac`、`\alpha`），MathLive 会弹出补全建议。按 `Enter` / `Tab` 完成时，工作区不采用 MathLive 原生的裸 `\command{□}` 补全，而是插入面板里对应的完整元素模板（含 `#0`/`#?` 占位符）。

- `handleKeydown` 在 `latex` 模式下拦截 `Enter`/`Tab`，走 `completeCommand`。
- 命令名从 MathLive 内部的 `latexgroup` 原子读取（`typedCommandName`）——补全进行中 `mf.value` 序列化为空串，取不到命令。
- 命令 → 元素的映射在 `equation-elements.ts` 的 `getElementByCommand`：id 与命令名一致的元素优先（`\sqrt` → 平方根而非 n 次方根）；命令被多个元素共享且没有 id 匹配的（`\left`、`\begin`）不映射，交给原生补全。
- 完成时先 `executeCommand(['complete', 'reject'])` 丢弃正在输入的命令、切回 math 模式，再复用 `insertElement` 插入——与拖拽完全一致（文本命令会得到空文本盒哨兵 + 边界 marker，其余得到占位符）。
- 规范化后仍不被项目 MathJax 配置支持的候选项，在键盘确认和鼠标点选时都会被丢弃；完整清单及判定规则见[反斜杠补全兼容性禁用表](latex-autocomplete-compatibility.zh-cn.md)。
- 两类命令特殊处理：
  - 样式切换 `\displaystyle`/`\textstyle`/`\scriptstyle`/`\scriptscriptstyle`：`completeStyleSwitch` 包裹光标后第一个元素（`firstElementRangeAfter` 算出其 caret 范围，脚本算在内），得到 `\displaystyle\sum`；后面没有内容时插入 `\displaystyle{□}` 占位符。
  - 根环境（`\displaylines` 等会 `isRoot` 替换模型根的）：直接丢弃补全，避免把输入框变成无法清空的坏环境。


### 原生右键菜单与解包

工作区直接扩展 MathLive 的 `menuItems`，因此编辑器原生命令、矩阵增删行列和项目的「解包」共用同一个右键菜单。右键按下时从指针命中的最小原子向父级查找，选中并高光最内层、源码含分组参数的命令。

「解包」去掉这一层命令，把 `{...}`、`[...]` 及上下标分组中的内容按源码顺序拼接，并过滤空 placeholder。例如 `\\sqrt{\\frac{a}{b}}` 在分数上右键会得到 `\\sqrt{ab}`。环境边界、左右定界符和 placeholder 本身不参与通用解包。

## 设计取舍

- **拖拽用双 MIME 通道**：自定义 MIME 用于应用内，`text/plain` 用于向外兼容，避免元素 id 被外部文本拖入劫持（`onDrop` 只在 payload 声明了自定义 MIME 时才信任 `draggedElementId`）。
- **预览用 mirror 而非画布**：直接复用 MathLive 渲染，避免二次实现一套排版。
- **`ensureMathfield` 轮询**：自定义元素升级和 shadow root 准备是异步的，轮询是跨引擎最稳的等待方式。
- **公共 LaTeX 作为 undo 边界**：内部 crack 只负责重建模型，不进入用户历史；所有公式改动统一经过 `publishState()`，避免逐功能维护逆操作。

## 已知边界

- `MAX_MATRIX_COLUMNS = 100`（`EquationWorkspace.vue`）：`ponytail:` 注释标记的实用上限，若公式真的需要 100+ 列再提高。
- `offsetEdges` 按 `mf.value + 宽度` 做缓存 key，值变化即失效重算。
