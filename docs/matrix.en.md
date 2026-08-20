# Matrix Editing

Purpose: structural editing of array environments (matrix / cases / aligned) — add/remove rows and columns via a context menu and via the Enter/Delete keys.

## Files

- `app/utils/matrix.ts` — Enter/Delete decision logic
- `app/components/EquationWorkspace.vue` — matrix model reading, context menu, command execution

## How it works

### Internal model reading

MathLive's public API doesn't expose matrix structure, so the workspace reads the private model `mf._mathfield.model` (`internalModel`). The `InternalAtom`/`InternalMatrix` interfaces expose the array atom's `environmentName`, `rowCount`/`colCount`, `getCell(row, col)`, and the atom's parent/child relationship (`parent`/`parentBranch`).

`isMatrix` checks that the atom is an array whose `environmentName` matches `/matrix\*?$/`.

### Caret context `matrixContextAtCaret`

Starting from the caret position, walk up `atom.parent` to find the enclosing matrix, its row/column, and whether the whole row/column is empty (`isEmptyMatrixCell`: the cell contains only `first` or `placeholder` atoms).

### Key decision `matrixCommandsForKey`

A pure function in `matrix.ts`: given row/column, whether it's on the last row/column, and whether the row/column is empty, return the commands to run:

- **Enter**: single row → add a column at the end; single column → add a row at the end; otherwise add at the last row/column.
- **Delete**: only remove a column when the caret is in the last, empty column; only remove a row when in the last, empty row.

`handleMatrixResizeKey` intercepts Enter/Backspace/Delete (no modifiers, collapsed caret or single-placeholder selection), feeds the context into `matrixCommandsForKey`, and runs `executeMatrixCommands` when there are commands.

### Context menu

Matrices use MathLive's native row/column menu items in the same menu as the editor's native commands and **Unwrap**. `onMfContextMenu` targets the nearest atom using each cell's actual bounds and keeps an empty placeholder selected. Menu-item `pointerdown` no longer bubbles back into the mathfield, preventing MathLive's delayed command from being retargeted to another cell or the root `lines` environment.

## Design choices

- **Reading private `_mathfield.model`**: the public API is missing; this is the only way to get matrix structure, at the cost of coupling to MathLive internals (see limits).
- **Decision logic extracted as a pure function `matrixCommandsForKey`**: keyboard resizing is independently unit-testable; context-menu actions reuse MathLive's native commands instead of maintaining a second menu.

## Known limits

- `internalModel` depends on the private `_mathfield.model` field and may break on MathLive upgrades; the related types live at the `InternalAtom`/`InternalModel` interfaces in `EquationWorkspace.vue`.
- `MAX_MATRIX_COLUMNS = 100` caps the column count.
