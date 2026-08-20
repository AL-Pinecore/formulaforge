# Matrix Editing

Purpose: structural editing of array environments (matrix / cases / aligned) through context-menu and Enter/Delete row/column actions.

## Files

- `app/utils/matrix.ts` — Enter/Delete decision logic
- `app/editor/MatrixController.ts` — public-LaTeX parsing, context lookup, and geometry hit-testing
- `app/editor/EditorLatex.ts` — public LaTeX string positions to MathLive offsets
- `app/editor/ContextMenuController.ts` — context targets, menu configuration, and command execution

## How it works

### Public LaTeX structure

MathLive's public API does not return matrix rows and columns directly. `MatrixController` parses public `mf.value` instead: it recognizes matrix, cases (including `dcases`/`rcases`), and `aligned`, and splits `&` and `\\` only outside braces and nested environments. The result contains rows, columns, cell source ranges, and empty row/column state.

These environments reuse the same targeting and commands; cases cells use generic placeholder restoration, while aligned equations keep their fixed alignment-column structure.

### Caret context `matrixContextAtCaret`

The controller temporarily inserts a unique text marker at the caret through public `insert()`, reads the marked `mf.value` to identify the matrix and cell, then restores the original formula and selection. A cell is empty when removing `\placeholder{}` leaves no content.

### Key decision `matrixCommandsForKey`

The pure `matrixCommandsForKey` function receives the row/column location and empty state:

- **Enter**: a single row adds a column; a single column adds a row; otherwise the last row/column grows independently.
- **Delete**: removes only a last column or row that is empty.

`handleMatrixResizeKey` intercepts Enter/Backspace/Delete for a collapsed caret or one selected placeholder and delegates the returned commands to `executeMatrixCommands`.

A new `aligned` row is completed as `\placeholder{} &= \placeholder{}` to preserve the equals sign and both editable slots.

### Context menu

Matrices and cases use MathLive's native row/column items, while `aligned` reuses row insertion/deletion. `ContextMenuController` finds the nearest public offset through `getElementInfo(offset).bounds`, keeps an empty placeholder selected, and restores the saved public offset before running a delayed menu command.

## Design choices

- **Parse public LaTeX**: avoids coupling to MathLive atom layouts; the parser covers only the array environments and top-level delimiters the editor supports.
- **Pure decision function**: keyboard resizing is unit-testable; context actions reuse MathLive's native commands.

## Known limits

- The temporary caret marker performs one public `insert()` / `setValue()` round trip; context lookup is linear for very large matrices.
- Supporting custom array syntax requires extending `MatrixController`'s environment allowlist and delimiter rules.
- `MAX_MATRIX_COLUMNS = 100` caps the column count.
