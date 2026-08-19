# 矩阵编辑

定位：矩阵 / cases / aligned 等 array 环境的结构编辑——右键菜单增删行列、Enter/Delete 键快捷增删。

## 涉及文件

- `app/utils/matrix.ts` — Enter/Delete 键的增删决策
- `app/components/EquationWorkspace.vue` — 矩阵模型读取、右键菜单、命令执行
- `app/components/ContextMenu.vue` — 通用右键菜单组件

## 工作机制

### 内部模型读取

MathLive 的公开 API 不暴露矩阵结构，工作区直接读私有模型 `mf._mathfield.model`（`internalModel`）。通过 `InternalAtom`/`InternalMatrix` 接口访问 array 原子的 `environmentName`、`rowCount`/`colCount`、`getCell(row, col)`，以及原子在模型里的父子关系（`parent`/`parentBranch`）。

`isMatrix` 判定 atom 是 array 且 `environmentName` 匹配 `/matrix\*?$/`。

### 光标上下文 `matrixContextAtCaret`

从光标位置向上遍历 `atom.parent`，找到所在矩阵、行列坐标，并判断整行/整列是否为空（`isEmptyMatrixCell`：cell 内只有 `first` 或 `placeholder` 原子）。

### 键决策 `matrixCommandsForKey`

`matrix.ts` 的纯函数：给定行列位置、是否在末行/末列、行/列是否为空，返回要执行的命令列表：

- **Enter**：单行 → 在末列加列；单列 → 在末行加行；否则在末行/末列分别加。
- **Delete**：仅当光标在末列且该列空时删列，在末行且该行空时删行。

`handleMatrixResizeKey` 拦截 Enter/Backspace/Delete（要求无修饰键、折叠光标或单 placeholder 选区），把上下文喂给 `matrixCommandsForKey`，有命令则 `executeMatrixCommands` 执行。

### 右键菜单

`onMfContextMenu`：先用 `getOffsetFromPoint` 定位，若不在矩阵内则用 `matrixAtPoint` 找最近矩阵、把光标挪到其末尾。菜单项由 `matrixMenuItems` computed 生成——非 cell 命中只有「加行/加列」，cell 命中额外有「前后插入行列 / 删行 / 删列」（删列受 `minColumns` 限制，删行受 `rows <= 1` 限制）。

## 设计取舍

- **读私有 `_mathfield.model`**：公开 API 缺失，这是获得矩阵结构的唯一途径，代价是耦合 MathLive 内部实现（见边界）。
- **决策抽成纯函数 `matrixCommandsForKey`**：可独立单测，键盘/菜单共用同一份逻辑。

## 已知边界

- `internalModel` 依赖 `_mathfield.model` 私有字段，MathLive 升级可能破坏；相关类型集中在 `EquationWorkspace.vue` 的 `InternalAtom`/`InternalModel` 接口处。
- `MAX_MATRIX_COLUMNS = 100` 限制最大列数。
