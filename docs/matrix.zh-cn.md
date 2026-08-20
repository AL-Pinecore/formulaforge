# 矩阵编辑

定位：矩阵 / cases / aligned 等 array 环境的结构编辑——右键菜单增删行列、Enter/Delete 键快捷增删。

## 涉及文件

- `app/utils/matrix.ts` — Enter/Delete 键的增删决策
- `app/editor/MatrixController.ts` — 公共 LaTeX 矩阵解析、上下文读取与几何命中
- `app/editor/EditorLatex.ts` — 公共 LaTeX 字符位置到 MathLive offset 的映射
- `app/editor/ContextMenuController.ts` — 右键目标、菜单配置与命令执行

## 工作机制

### 公共 LaTeX 结构读取

MathLive 的公开 API 不直接返回矩阵行列结构。`MatrixController` 因此解析公开的 `mf.value`：识别 matrix、cases（含 `dcases`/`rcases`）和 `aligned` 环境，只在最外层花括号与嵌套环境之外切分 `&` 和 `\\`，得到行列、cell 源码区间及空行/空列状态。

这些环境复用同一套行列定位和命令；cases 新单元格沿用通用 placeholder 恢复，`aligned` 则保持固定的对齐列结构。

### 光标上下文 `matrixContextAtCaret`

控制器用公共 `insert()` 在光标处临时插入唯一文本标记，读取标记后的 `mf.value` 来确定所在矩阵与 cell，然后恢复原公式和选区。空 cell 定义为去掉 `\placeholder{}` 后没有内容。

### 键决策 `matrixCommandsForKey`

`matrix.ts` 的纯函数：给定行列位置、是否在末行/末列、行/列是否为空，返回要执行的命令列表：

- **Enter**：单行 → 在末列加列；单列 → 在末行加行；否则在末行/末列分别加。
- **Delete**：仅当光标在末列且该列空时删列，在末行且该行空时删行。

`handleMatrixResizeKey` 拦截 Enter/Backspace/Delete（要求无修饰键、折叠光标或单 placeholder 选区），把上下文交给 `matrixCommandsForKey`；有命令时由 `executeMatrixCommands` 执行。

新增 `aligned` 行时会自动补成 `\placeholder{} &= \placeholder{}`，保持每一行的等号和左右编辑位。

### 右键菜单

矩阵和 cases 使用 MathLive 原生行列菜单项，`aligned` 复用增删行菜单项。`ContextMenuController` 通过公开的 `getElementInfo(offset).bounds` 定位最近 offset，空 placeholder 会保持选中；执行增删前恢复右键时保存的公共 offset。

## 设计取舍

- **解析公共 LaTeX**：避免绑定 MathLive atom 结构；解析器只覆盖编辑器实际支持的 array 环境和顶层分隔符。
- **决策抽成纯函数**：键盘调整可独立单测；右键操作复用 MathLive 原生命令。

## 已知边界

- 临时 caret 标记需要一次公开的 `insert()` / `setValue()` 往返；矩阵非常大时上下文查询是线性扫描。
- 若以后支持自定义 array 语法，需要同步扩展 `MatrixController` 的环境白名单和分隔规则。
- `MAX_MATRIX_COLUMNS = 100` 限制最大列数。
