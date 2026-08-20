# 矩阵编辑

定位：矩阵 / cases / aligned 等 array 环境的结构编辑——右键菜单增删行列、Enter/Delete 键快捷增删。

## 涉及文件

- `app/utils/matrix.ts` — Enter/Delete 键的增删决策
- `app/editor/MathLiveAdapter.ts` — MathLive 私有模型的类型与唯一访问入口
- `app/editor/MatrixController.ts` — 矩阵上下文读取与几何命中
- `app/editor/ContextMenuController.ts` — 右键目标、菜单配置与命令执行

## 工作机制

### 内部模型读取

MathLive 的公开 API 不暴露矩阵结构，`MathLiveAdapter.internalModel` 集中读取私有模型 `mf._mathfield.model`。`MatrixController` 通过 `InternalAtom`/`InternalMatrix` 接口访问 array 原子的 `environmentName`、`rowCount`/`colCount`、`getCell(row, col)`，以及原子在模型里的父子关系（`parent`/`parentBranch`）。

`MatrixController.isMatrix` 判定 atom 是 array，且 `environmentName` 是矩阵、cases（含 `dcases`/`rcases`）或 `aligned` 环境。它们复用同一套行列定位和命令；cases 新单元格沿用通用 placeholder 恢复，`aligned` 则保持自身固定的对齐列结构。

### 光标上下文 `matrixContextAtCaret`

从光标位置向上遍历 `atom.parent`，找到所在矩阵、行列坐标，并判断整行/整列是否为空（`isEmptyMatrixCell`：cell 内只有 `first` 或 `placeholder` 原子）。

### 键决策 `matrixCommandsForKey`

`matrix.ts` 的纯函数：给定行列位置、是否在末行/末列、行/列是否为空，返回要执行的命令列表：

- **Enter**：单行 → 在末列加列；单列 → 在末行加行；否则在末行/末列分别加。
- **Delete**：仅当光标在末列且该列空时删列，在末行且该行空时删行。

`handleMatrixResizeKey` 拦截 Enter/Backspace/Delete（要求无修饰键、折叠光标或单 placeholder 选区），把上下文喂给 `matrixCommandsForKey`，有命令则 `executeMatrixCommands` 执行。

新增 `aligned` 行时会自动补成 `\placeholder{} &= \placeholder{}`，保持每一行的等号和左右编辑位。

### 右键菜单

矩阵和 cases 直接使用 MathLive 原生的行列菜单项，`aligned` 复用其中的增删行菜单项；它们与编辑器原生命令和「解包」共用同一个菜单。`ContextMenuController` 按各 cell 的实际边界定位最近的原子，空 placeholder 会保持选中。菜单项的 `pointerdown` 不再冒泡回 math-field；增删行列执行前还会恢复右键时保存的 cell 原子，避免 MathLive 的延迟命令作用到其他 cell 或根 `lines` 环境。

## 设计取舍

- **读私有 `_mathfield.model`**：公开 API 缺失，这是获得矩阵结构的唯一途径，代价是耦合 MathLive 内部实现（见边界）。
- **决策抽成纯函数 `matrixCommandsForKey`**：键盘调整可独立单测；右键操作复用 MathLive 原生命令，避免维护第二套菜单。

## 已知边界

- `internalModel` 依赖 `_mathfield.model` 私有字段，MathLive 升级可能破坏；相关类型与访问集中在 `MathLiveAdapter.ts`。
- `MAX_MATRIX_COLUMNS = 100` 限制最大列数。
