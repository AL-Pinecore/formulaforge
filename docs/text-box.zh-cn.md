# Text 文本框编辑

定位：`\text{...}` 及字体样式命令（`\textbf`、`\mathbf`、`\bm` 等）的编辑机制。这是整个项目里最绕的部分——MathLive 会折叠单字符文本命令、拖拽元素会掉进文本里，所以需要一套零宽边界 marker + 空盒哨兵 + 整组重建。

## 涉及文件

- `app/utils/text-boundary.ts` — 边界 marker、空盒哨兵、命令集合、序列化管线
- `app/utils/font-styles.ts` — 字体样式拖放到 text box 上的映射
- `app/components/EquationWorkspace.vue` — text 原子读取、删除/输入重建

## 工作机制

### 零宽边界 marker

`TEXT_BOUNDARY_LATEX = \mkern0mu` 是加在每个 `\text{...}` 命令两侧的不可见标记。`addTextBoundaries()` 在序列化时插入，`stripTextBoundaries()` 在导出时移除。

它解决两个问题：

1. 空文本盒没有可见内容，点击命中不到 —— 空盒靠左右两个 marker 的 bounds 做 hit-test（`emptyTextGroupAtPoint` / `emptyTextHintBox`）；
2. 标记文本组的起止，让删除/输入/导航能判断「当前是否在文本组内、边界在哪」。

marker 可能被 MathLive 重排（复制左 marker、丢掉右 marker），所以 `normalizeTextModel()` 会从当前值重建 marker 布局。

### 空盒哨兵

空文本盒内部不放 placeholder（placeholder 会捕获选区、显示高亮），而放一个撑宽度的不可见内容：

- 文本模式命令：`\phantom{Text}`（`EMPTY_TEXT_INNER_LATEX`）；
- 数学字体命令：`\phantom{\text{Text}}`（`EMPTY_MATH_INNER_LATEX`），因为数学字体命令会把 `\phantom{Text}` 渲染成无边界数学字母。

`isEmptyTextLatex()` 判断序列化结果是否就是空盒哨兵；`stripEmptyTextSentinel()` 在导出公共 LaTeX 时把空盒还原成 `\text{}`，绝不暴露内部哨兵。

可见的灰色提示词由工作区覆盖层绘制。拖拽预览和放置后的空盒都从各自 math-field 中的同一 phantom 哨兵计算位置、尺寸和字体，因此两种状态不会发生基线或高度跳变。`\mathcal` / `\mathbb` 的提示词使用完整的 Unicode 数学字母，避免 TeX 字体缺少小写字形时只有首字母带样式。

### 序列化管线

`normalizePublicLatex()` 是「内部值 → 公共值」的固定管线：

```
mergeAdjacentTextCommands(stripTextBoundaries(removeOrphanedTextBoundaries(latex)))
```

- `removeOrphanedTextBoundaries`：删掉不再紧贴文本命令的孤儿 marker（删除操作可能只删掉 `\text{...}` 而留下 marker）；
- `stripTextBoundaries`：去掉成对 marker；
- `mergeAdjacentTextCommands`：把相邻同命令盒合并（`\text{a}\text{b}` → `\text{ab}`）。

模型归一化和光标前缀映射都必须走同一管线，字符串长度才可比（`publicStringOffsetToModel` 依赖这一点）。

### 删除/输入重建

MathLive 把每个文本字符序列化成独立的 `\text{<char>}` 原子，单原子文本命令会被折叠、`\text{}` 包装丢失。所以工作区拦截文本上下文里的每个可打印字符，自己重建整组：

- `textGroupFromAtom` 按「模式 + 样式」的 run key 收集连续文本原子，拼出内容和 `\text{...}` 组范围；
- `handleKeydown` 在文本组内时，取 `group.content`、插入/删除字符、`mf.insert(\<command>{<content>})` 整组替换，再用 `placeCaretInTextGroup` 把光标放回原字符后。

### 字体样式拖放

`font-styles.ts` 把 `mathrm/mathbf/mathit/mathsf/mathit/mathit` 映射成 MathLive 的 `Style` 对象（`FONT_STYLES`）。拖一个字体样式到 text box 上时，`applyFontStyle` 调 `mf.applyStyle(style, { range })`；文本模式命令有对应的 `\text**` 形式（`FONT_STYLE_TEXT_COMMANDS`），拖同样式到已用该命令的盒上会 toggle 回 `\text{...}`。

## 设计取舍

- **零宽 marker 而非 CSS 类**：序列化层面打标记，任何编辑器操作都能识别文本边界，且导出时能被干净剥离。
- **整组重建而非依赖 MathLive 原生删除**：原生删除会折叠单原子命令、光标漂移一位；重建能精确控制光标位置和命令保留（删掉最后一个字符变空盒，保留样式命令）。
- **phantom 哨兵而非 placeholder**：空盒需要「有宽度但不可选中」，placeholder 做不到。

## 已知边界

- 内容含花括号的相邻文本盒不会被 `mergeAdjacentTextCommands` 合并（正则刻意跳过带 `{...}` 的内容）。
- `\operatorname` 被 `OPAQUE_TEXT_COMMANDS` 视为不透明，整段拷贝不过手，避免破坏积分上下限等重序列化。
- 清空整个输入框不会重置 MathLive 的模型 `mode`（`math`/`text`/`latex`），光标曾在文本框内时清空会残留 `text` 模式，导致下一次输入被包进 `\text{}`。`EquationWorkspace.ensureMathMode` 在内容为空时把它重置回 `math`（只重置 `text`，不碰进行中的反斜杠命令 `latex` 模式）。
