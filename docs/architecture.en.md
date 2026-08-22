# Architecture: EquationDocument & EditorAdaptor

Purpose: two stable boundaries between the editor and its backend (MathLive). The goal is to reduce the dependency on MathLive (without fully detaching), so FormulaForge keeps the data being edited and MathLive is just the editing-area backend.

## The two abstractions

### `EquationDocument` — the data owner

`app/editor/EquationDocument.ts` is FormulaForge's own "world state":

- **Editor LaTeX** (the canonical exchange formula), **caret bookmark** (a public-LaTeX offset), the semantic history (`EditorHistory`), and the error list.
- `commit()` records an edit and publishes the new state; `restore()` publishes without recording (undo/redo round-trips); `undo()`/`redo()` return the snapshot to restore.
- A plain TypeScript class: no Vue, no MathLive, no DOM — usable directly for multi-app embedding.

`app/composables/useEquation.ts` holds the singleton and mirrors it into Vue-reactive refs via `subscribe()`; UI components only read that reactive state. The backend (`mf.value`) is no longer the source of truth.

### `EditorAdaptor` — the editing-backend interface

`app/editor/EditorAdaptor.ts` declares everything editor features need, using only self-defined structural types (`EditorElementInfo`, `EditorSelection`, `EditorFontStyle`, `EditorSyntaxError`, `CaretBookmark`, …) and **never importing MathLive**:

- Model ops: `value` / `position` / `selection` / `insert()` / `setValue()` / `getElementInfo()` / `applyStyle()`.
- **Semantic commands** (no raw MathLive command strings): `moveToPlaceholder()` / `rejectCompletion()` / `executeMatrixCommand()` / `configureContextMenu()`.
- Semantic geometry: `offsetFromPoint()` / `placeholderIndexAtPoint()` / `selectPlaceholderAtPoint()` / `enterPlaceholder()`.
- **Editor-LaTeX exchange boundary**: `loadEditorLatex()` / `readEditorLatex()` / `readErrors()`.
- **Caret exchange**: `getCaret()` / `setCaret()` (bookmark ↔ backend model offset conversion stays in the backend).
- Offscreen insertion preview: `createMirror()` / `readPreviewHtml()`.

The interface **never exposes** the shadow root or `.ML__*` classes; the only DOM channel is `element: HTMLElement` (generic `classList` / `style` / `getBoundingClientRect` / events).

## Boundary rule

Everything MathLive-specific lives in `app/editor/backends/mathlive/`, the only directory that "knows MathLive exists":

| Module | Responsibility |
|--------|----------------|
| `MathLiveEditorAdaptor.ts` | The `EditorAdaptor` facade (model ops, semantic commands, caret/editor-LaTeX conversion) |
| `MathLiveAccentFix.ts` | Accent centering / wide-hat correction (`.ML__accent-body`, …) |
| `MathLivePlaceholderFix.ts` | Placeholder styling injection and `▢` annotation |
| `MathLiveFractionFix.ts` | Fraction-rule positioning (painted bounds + observer) |
| `MathLiveIme.ts` | Shadow-root IME blocking (reusing the generic policy in `utils/ime-block.ts`) |

`utils/ime-block.ts` is the one exception — it is a backend-agnostic IME policy shared by the host layer and the backend.

The controllers (`SelectionController` / `TextController` / `MatrixController` / `DragController` / `AutocompleteController` / `ContextMenuController`) and the workspace depend only on `EditorAdaptor`, exchanging editor LaTeX and caret bookmarks.

## Three LaTeX layers

- **`editorLatex`** (`EquationDocument.latex`): the backend-serialized canonical formula, preserving backend-specific commands (`\exponentialE`, `\longleftarrow`, …). This is FormulaForge's own formula and the undo/redo boundary.
- **`exportLatex`** (`useEquation.exportLatex` = `normalizePortableLatex(editorLatex)`): the portable formula consumed by the source panel, clipboard, `.tex` export, and MathJax preview/image/PDF export.
- **`sourceLatex`**: byte-preserving user `.tex` — **not done this round** (needs source maps/AST, conflicting with "no AST", deferred until a real `.tex` project).

## Data flow

```
EquationDocument (editorLatex + CaretBookmark + history)
      ▲ commit / restore / undo / redo
      │  readEditorLatex / readErrors / getCaret
EquationWorkspace ──► EditorAdaptor (interface) ──► backends/mathlive/* ──► <math-field>
```

- User edits → backend `input` event → workspace reads editor LaTeX + caret back through the adaptor → `document.commit()`.
- Source panel / import / clear → `adaptor.loadEditorLatex()` writes the backend → `document.commit()`.
- Drag preview → `adaptor.createMirror()` reuses the backend renderer for a pixel-identical offscreen preview.

## Multi-app embedding direction

`EditorAdaptor` is the single editing-backend contract. To embed FormulaForge's editing capability in a new host app:

1. Reuse `EquationDocument` and the controllers (they are backend-agnostic);
2. Provide a new `EditorAdaptor` implementation for the host environment (or keep `backends/mathlive/`);
3. The workspace/composition root creates the adaptor through a factory — no UI changes needed.

## Trade-offs

- **Interface, not mirror**: `EditorAdaptor` is a semantic interface, not a 1:1 rename of MathLive's API; the shadow root, `.ML__*`, and `executeCommand(string)` never cross the backend.
- **Caret as bookmark, not model offset**: the document/history stores a public-LaTeX offset; the model offset only exists inside the backend for controller surgery. `ponytail:` note: a public offset is a projection — placeholders/boundaries collapse multiple model offsets into one, so undo/redo caret may land at the nearest equivalent position.
- **`editorLatex` vs `exportLatex`**: the document no longer bakes in portable normalization; `normalizePortableLatex` moved to the consumption side, leaving room for a future `.tex` round-trip.
- **Centralized workarounds**: all "fix MathLive behavior" code lives only in `backends/mathlive/`; controllers are unaware of it.
