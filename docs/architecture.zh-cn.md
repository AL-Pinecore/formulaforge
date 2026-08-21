# 架构：EquationDocument 与 EditorAdaptor

定位：编辑器与编辑后端（MathLive）之间的两条稳定边界。目标是降低对 MathLive 的依赖（不完全脱离），让 FormulaForge 自己保存正在编辑的数据，而 MathLive 只是「编辑区域的 Backend」。

## 两条抽象

### `EquationDocument` — 数据拥有者

`app/editor/EquationDocument.ts` 是 FormulaForge 自己的「世界状态」：

- 公共 LaTeX（对外交换格式）、光标位置、语义历史（`EditorHistory`）、错误列表。
- `commit()` 记录一次编辑并发布新状态；`restore()` 在 undo/redo 往返时发布但不记录；`undo()`/`redo()` 返回要恢复的快照。
- 纯 TypeScript 类：无 Vue、无 MathLive、无 DOM，可直接用于「多应用植入」。

`app/composables/useEquation.ts` 持有该单例，`subscribe()` 把它镜像成 Vue 响应式 ref，UI 组件只读这份响应式状态。编辑后端（MathLive 的 `mf.value`）不再是数据源。

### `EditorAdaptor` — 编辑后端接口

`app/editor/EditorAdaptor.ts` 定义编辑器功能所用的全部能力，只依赖自建结构类型（`EditorElementInfo`、`EditorSelection`、`EditorFontStyle`、`EditorSyntaxError`…），**不 import MathLive**：

- 模型操作：`value` / `position` / `selection` / `insert()` / `setValue()` / `executeCommand()` / `getElementInfo()` / `applyStyle()`。
- 语义几何：`offsetFromPoint()` / `placeholderIndexAtPoint()` / `selectPlaceholderAtPoint()` / `enterPlaceholder()`。
- 公共 LaTeX 交换边界：`loadPublicLatex()` / `readPublicLatex()` / `readErrors()`。
- 离屏插入预览：`createMirror()` / `readPreviewHtml()`。

接口**不暴露** shadow root 与 `.ML__*` 类；唯一的 DOM 通道是 `element: HTMLElement`（通用 `classList` / `style` / `getBoundingClientRect` / 事件）。

## 边界规则

只有 `app/editor/MathLiveEditorAdaptor.ts`（以及 `plugins/mathlive.client.ts` 的元素注册、`utils/mathfield-accent.ts` / `utils/mathfield-placeholder.ts` 这两个 workaround 辅助）知道 MathLive 存在。所有 `.ML__*` 选择器、shadow root、MathLive bug 修复都集中在这一层：

| Workaround | 位置 |
|------------|------|
| 分数横线位置修正 | `MathLiveEditorAdaptor.positionFractionRules` |
| shadow-root IME 阻断 | `MathLiveEditorAdaptor.attachImeBlocker`（复用 `utils/ime-block.ts` 的通用策略） |
| placeholder 样式注入 | `utils/mathfield-placeholder.ts` |
| accent 居中 / 宽帽修正 | `utils/mathfield-accent.ts` |
| keyboard-sink 聚焦回退 | `MathLiveEditorAdaptor.focusKeyboard` |
| 离屏 mirror 预览快照 | `MathLiveEditorAdaptor.createMirror` / `readPreviewHtml` |

控制器（`SelectionController` / `TextController` / `MatrixController` / `DragController` / `AutocompleteController` / `ContextMenuController`）与工作区只依赖 `EditorAdaptor`，用公共 LaTeX 与光标 offset 作为交换数据，不接触后端私有模型。

## 数据流

```
EquationDocument (公共 LaTeX + 光标 + 历史)
      ▲ commit / restore / undo / redo
      │  readPublicLatex / readErrors
EquationWorkspace ──► EditorAdaptor (接口) ──► MathLiveEditorAdaptor ──► <math-field>
```

- 用户编辑 → 后端 `input` 事件 → 工作区经 adaptor 读回公共 LaTeX → `document.commit()`。
- 源码面板/导入/清空 → `adaptor.loadPublicLatex()` 写入后端 → `document.commit()`。
- 拖拽预览 → `adaptor.createMirror()` 复用后端渲染器做像素级一致的离屏预览。

## 多应用植入方向

`EditorAdaptor` 是唯一的编辑后端契约。新宿主应用要嵌入 FormulaForge 的编辑能力时：

1. 复用 `EquationDocument` + 各控制器（它们与后端无关）；
2. 按宿主环境提供一个新的 `EditorAdaptor` 实现（或继续用 `MathLiveEditorAdaptor`）；
3. 工作区/组合根用工厂创建对应 adaptor，UI 无需改动。

LaTeX 作为交换格式意味着「保留功能」不受影响：导出、预览、剪贴板、源码面板都消费 document 的公共 LaTeX。

## 设计取舍

- **接口而非镜像**：`EditorAdaptor` 是语义接口，不是 MathLive API 的 1:1 重命名；shadow root 与 `.ML__*` 不跨出 adaptor。
- **公共 LaTeX 作交换数据**：document 与后端之间只传公共 LaTeX 串 + 光标 offset，内部 placeholder/boundary/phantom 转换全部留在 adaptor。
- **workaround 集中**：所有「修 MathLive 行为」的代码只在 adaptor 层，控制器不感知。
