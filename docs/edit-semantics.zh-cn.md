# 编辑语义：占位符 / 重音 / 删除解包

定位：让「删空一个 `\sqrt{}` 还留个可编辑的灰框」、让 accent 正确居中、让 Backspace 在 placeholder 里智能解包外层结构。这三个机制构成了公式编辑的手感。

## 涉及文件

- `app/utils/empty-group.ts` — 空组恢复 placeholder
- `app/utils/accent.ts` — accent 命令清单与识别
- `app/utils/mathfield-accent.ts` — accent 居中/宽帽修正
- `app/utils/mathfield-placeholder.ts` — placeholder 样式注入
- `app/utils/remove-empty-element.ts` — Backspace/Delete 的结构解包

## 工作机制

### 空组恢复（`restoreEmptyGroupLatex`）

用户删空一个结构（`\sqrt{}`、`\frac{}{}`、`\left(\right)`、矩阵空单元格…）后，`restoreEmptyGroupLatex` 把空组重新注入 `\placeholder{}`，让删掉内容的地方留下可编辑灰框而不是破损结构。规则链：

1. 空 `\text{}` / `\textbf{}` → 换成 phantom 哨兵（见 text-box 文档）；
2. 空 `\math**{}` → `\phantom{\text{Text}}`；
3. 命令空必选参数（`\sqrt{}`、`\hat{}`）→ `\placeholder{}`；
4. 空上/下标 `^{}` / `_{}` → `\placeholder{}`；
5. 空 `\left...\right` 分隔符 → 中间放 placeholder；
6. 剩余裸空组 `{}` → placeholder（排除 `\placeholder` 自身参数，避免嵌套）；
7. 矩阵/cases/aligned 空单元格 → 逐个填 placeholder。

它返回 `null` 表示无需改动，否则返回新字符串。工作区在 `input` 事件后经 `scheduleRestorePlaceholders`（microtask）在 MathLive 下次渲染前恢复，避免闪现破损帧。

### Placeholder 样式与命中

`\placeholder{}` 渲染成一个无稳定 class 的「▢」字形，无法外部样式化。`mathfield-placeholder.ts` 给每个 shadow root 注入一段 style，把 `▢` 字形标注成 `ml-placeholder` 类（灰底矩形），并用 MutationObserver 在每次重渲染后重新标注。`caret-in-text` 状态时选中 placeholder 则显示闪烁竖线。

几何命中走 `placeholderIndexAtPoint` / `selectPlaceholderAtPoint`：扫描 shadow root 里所有 `▢` 节点、按位置命中、再用 `moveToNextPlaceholder` 循环走到对应模型位置（处理 `\sum` 上下标这种视觉顺序 ≠ 模型顺序的结构）。

### Accent 修正（`mathfield-accent.ts`）

MathLive 渲染 accent 有几个偏差，`ensureAccentPositioning` 用一个 MutationObserver 持续修正：

- **固定宽度 accent 偏移**（`\hat`/`\bar`/`\vec`/`\tilde`…）：`centerAccentBodies` 量出 `.ML__accent-body` 与 `.ML__vlist` 的几何中心，用 `translateX` 重新居中；`\vec` 是零宽组合字符，半宽按字号的 0.26em 估算。
- **宽帽 accent**（`\widehat`/`\widetilde`）：MathLive 只给容器一半宽度导致选中窄字形。`stretchWideAccents` 在内容超过 1.06em 时把 svg 换成宽变体（`WIDE_HAT`/`WIDE_TILDE` 的 KaTeX 字形 path），并把宽度拉到内容宽、以字号的 1.9em 封顶居中。

### 删除解包（`removeElementAtPlaceholder`）

光标停在 placeholder 里按 Backspace/Delete 时，`unwrapElementAtCaret` 先把光标处 placeholder 替换成临时 marker（`\bigstar`）定位其在序列化里的位置，再还原，然后 `removeElementAtPlaceholder` 按十类规则把外层结构解包（推进真实内容、删空则整体移除）：

1. `\frac` 等分数（双参数推进）
2. `\overbrace` / `\underbrace`
3. `\log`（基/参数双槽）
4. 大运算符 `\sum`/`\int`/`\lim` 上下标
5. 普通上/下标
6. 单参数命令（排除 `\left`/`\begin` 等）
7. 函数括号 `\sin(...)` 等
8. `\sqrt[n]{}` 的可选指数
9. `\left...\right` 及成对分隔符
10. 矩阵/环境整体

每类都遵循「有真实内容则推进、全空则整结构删除」的语义。

## 设计取舍

- **临时 marker 定位**：模型 offset 与字符串 offset 在大运算符分支里不可靠映射（`\sum` 上下标序列化顺序与模型相反），用 marker 换位再定位是唯一稳定手段；`stopRecording`/`startRecording` 暂停 undo，保证来回不污染历史。
- **MutationObserver 而非定时轮询**：MathLive 重渲染时机不确定，observer 是「渲染后立即修正」的最省手段。

## 已知边界

- accent 宽帽字形 path 硬编码了 KaTeX 的 S7 宽字形，若 MathLive 换字体需同步更新。
- `\vec` 半宽 0.26em 是估算值，见 `COMBINING_ARROW_HALF_EM`。
