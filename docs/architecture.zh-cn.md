# 架构：EquationDocument 与 EditorAdaptor

定位：编辑器与编辑后端（MathLive）之间的两条稳定边界。目标是降低对 MathLive 的依赖（不完全脱离），让 FormulaForge 自己保存正在编辑的数据，而 MathLive 只是「编辑区域的 Backend」。

## 两条抽象

### `EquationDocument` — 数据拥有者

`app/editor/EquationDocument.ts` 是 FormulaForge 自己的「世界状态」：

- **editor LaTeX**（对外交换的规范公式）、**caret bookmark**（公共 LaTeX 偏移）、语义历史（`EditorHistory`）、错误列表。
- `commit()` 记录一次编辑并发布新状态；`restore()` 在 undo/redo 往返时发布但不记录；`undo()`/`redo()` 返回要恢复的快照。
- 纯 TypeScript 类：无 Vue、无 MathLive、无 DOM，可直接用于「多应用植入」。

`app/composables/useEquation.ts` 持有该单例，`subscribe()` 把它镜像成 Vue 响应式 ref，UI 组件只读这份响应式状态。编辑后端（MathLive 的 `mf.value`）不再是数据源。

### `EditorAdaptor` — 编辑后端接口

`app/editor/EditorAdaptor.ts` 定义编辑器功能所用的全部能力，只依赖自建结构类型（`EditorElementInfo`、`EditorSelection`、`EditorFontStyle`、`EditorSyntaxError`、`CaretBookmark`…），**不 import MathLive**：

- 模型操作：`value` / `position` / `selection` / `insert()` / `setValue()` / `getElementInfo()` / `applyStyle()`。
- **语义命令**（不再透传 MathLive command string）：`moveToPlaceholder()` / `rejectCompletion()` / `executeMatrixCommand()` / `configureContextMenu()`。
- 语义几何：`offsetFromPoint()` / `placeholderIndexAtPoint()` / `selectPlaceholderAtPoint()` / `enterPlaceholder()`。
- **editor LaTeX 交换边界**：`loadEditorLatex()` / `readEditorLatex()` / `readErrors()`。
- **caret 交换**：`getCaret()` / `setCaret()`（bookmark ↔ 后端 model offset 的转换在 backend 内完成）。
- 离屏插入预览：`createMirror()` / `readPreviewHtml()`。

接口**不暴露** shadow root 与 `.ML__*` 类；唯一的 DOM 通道是 `element: HTMLElement`（通用 `classList` / `style` / `getBoundingClientRect` / 事件）。

## 边界规则

MathLive 专属实现全部收在 `app/editor/backends/mathlive/`，这是唯一「知道 MathLive 存在」的目录：

| 模块 | 职责 |
|------|------|
| `MathLiveEditorAdaptor.ts` | `EditorAdaptor` 的门面实现（模型操作、语义命令、caret/editor-Latex 转换） |
| `MathLiveAccentFix.ts` | accent 居中 / 宽帽修正（`.ML__accent-body` 等） |
| `MathLivePlaceholderFix.ts` | placeholder 样式注入与 `▢` 标注 |
| `MathLiveFractionFix.ts` | 分数横线位置修正（painted bounds + observer） |
| `MathLiveIme.ts` | shadow-root IME 阻断（复用 `utils/ime-block.ts` 的通用策略） |

`utils/ime-block.ts` 是唯一的例外——它是与后端无关的通用 IME 策略，被宿主层和 backend 共用。

控制器（`SelectionController` / `TextController` / `MatrixController` / `DragController` / `AutocompleteController` / `ContextMenuController`）与工作区只依赖 `EditorAdaptor`，用 editor LaTeX 与 caret bookmark 作为交换数据。

## 三层 LaTeX

- **`editorLatex`**（`EquationDocument.latex`）：后端序列化的规范公式，保留后端专属命令（`\exponentialE`、`\longleftarrow`…）。这是 FormulaForge 自己的公式，也是 undo/redo 的边界。
- **`exportLatex`**（`useEquation.exportLatex` = `normalizePortableLatex(editorLatex)`）：对外便携公式，供源码面板、剪贴板、`.tex` 导出、MathJax 预览/图片/PDF 消费。
- **`sourceLatex`**：字节级保留用户原始 `.tex`，本轮**未做**（需要 source-map/AST，与「不搭 AST」冲突，留到接 `.tex` 工程时）。

## 数据流

```
EquationDocument (editorLatex + CaretBookmark + 历史)
      ▲ commit / restore / undo / redo
      │  readEditorLatex / readErrors / getCaret
EquationWorkspace ──► EditorAdaptor (接口) ──► backends/mathlive/* ──► <math-field>
```

- 用户编辑 → 后端 `input` 事件 → 工作区经 adaptor 读回 editor LaTeX + caret → `document.commit()`。
- 源码面板/导入/清空 → `adaptor.loadEditorLatex()` 写入后端 → `document.commit()`。
- 拖拽预览 → `adaptor.createMirror()` 复用后端渲染器做像素级一致的离屏预览。

## 多应用植入方向

`EditorAdaptor` 是唯一的编辑后端契约。新宿主应用要嵌入 FormulaForge 的编辑能力时：

1. 复用 `EquationDocument` + 各控制器（它们与后端无关）；
2. 按宿主环境提供一个新的 `EditorAdaptor` 实现（或继续用 `backends/mathlive/`）；
3. 工作区/组合根用工厂创建对应 adaptor，UI 无需改动。

## 设计取舍

- **接口而非镜像**：`EditorAdaptor` 是语义接口，不是 MathLive API 的 1:1 重命名；shadow root、`.ML__*`、`executeCommand(string)` 都不跨出 backend。
- **caret 用 bookmark 而非 model offset**：document/history 存公共 LaTeX 偏移，model offset 只在 backend 内用于 controller 手术；`ponytail:` 注记：公共偏移是投影，placeholder/boundary 会把多个 model offset 折到同一公共偏移，undo/redo 光标可能落在最近的等价位置。
- **editorLatex 与 exportLatex 分离**：document 不烘焙便携归一化，`normalizePortableLatex` 移到消费端，为将来 `.tex` round-trip 保留空间。
- **workaround 集中**：所有「修 MathLive 行为」的代码只在 `backends/mathlive/`，控制器不感知。
