# Architecture: EquationDocument & EditorAdaptor

Purpose: two stable boundaries between the editor and its backend (MathLive). The goal is to reduce the dependency on MathLive (without fully detaching), so FormulaForge keeps the data being edited and MathLive is just the editing-area backend.

## The two abstractions

### `EquationDocument` — the data owner

`app/editor/EquationDocument.ts` is FormulaForge's own "world state":

- Public LaTeX (the exchange format), caret position, the semantic history (`EditorHistory`), and the error list.
- `commit()` records an edit and publishes the new state; `restore()` publishes without recording (undo/redo round-trips); `undo()`/`redo()` return the snapshot to restore.
- A plain TypeScript class: no Vue, no MathLive, no DOM — usable directly for multi-app embedding.

`app/composables/useEquation.ts` holds the singleton and mirrors it into Vue-reactive refs via `subscribe()`; UI components only read that reactive state. The backend (`mf.value`) is no longer the source of truth.

### `EditorAdaptor` — the editing-backend interface

`app/editor/EditorAdaptor.ts` declares everything editor features need, using only self-defined structural types (`EditorElementInfo`, `EditorSelection`, `EditorFontStyle`, `EditorSyntaxError`, …) and **never importing MathLive**:

- Model ops: `value` / `position` / `selection` / `insert()` / `setValue()` / `executeCommand()` / `getElementInfo()` / `applyStyle()`.
- Semantic geometry: `offsetFromPoint()` / `placeholderIndexAtPoint()` / `selectPlaceholderAtPoint()` / `enterPlaceholder()`.
- Public-LaTeX exchange boundary: `loadPublicLatex()` / `readPublicLatex()` / `readErrors()`.
- Offscreen insertion preview: `createMirror()` / `readPreviewHtml()`.

The interface **never exposes** the shadow root or `.ML__*` classes; the only DOM channel is `element: HTMLElement` (generic `classList` / `style` / `getBoundingClientRect` / events).

## Boundary rule

Only `app/editor/MathLiveEditorAdaptor.ts` (plus `plugins/mathlive.client.ts` for element registration, and the two workaround helpers `utils/mathfield-accent.ts` / `utils/mathfield-placeholder.ts`) knows MathLive exists. Every `.ML__*` selector, shadow-root access, and MathLive bug fix lives in that layer:

| Workaround | Location |
|------------|----------|
| Fraction-rule positioning | `MathLiveEditorAdaptor.positionFractionRules` |
| Shadow-root IME blocking | `MathLiveEditorAdaptor.attachImeBlocker` (reusing the generic policy in `utils/ime-block.ts`) |
| Placeholder styling injection | `utils/mathfield-placeholder.ts` |
| Accent centering / wide-hat correction | `utils/mathfield-accent.ts` |
| Keyboard-sink focus fallback | `MathLiveEditorAdaptor.focusKeyboard` |
| Offscreen mirror preview snapshot | `MathLiveEditorAdaptor.createMirror` / `readPreviewHtml` |

The controllers (`SelectionController` / `TextController` / `MatrixController` / `DragController` / `AutocompleteController` / `ContextMenuController`) and the workspace depend only on `EditorAdaptor`, exchanging public LaTeX and caret offsets without touching the backend's private model.

## Data flow

```
EquationDocument (public LaTeX + caret + history)
      ▲ commit / restore / undo / redo
      │  readPublicLatex / readErrors
EquationWorkspace ──► EditorAdaptor (interface) ──► MathLiveEditorAdaptor ──► <math-field>
```

- User edits → backend `input` event → workspace reads public LaTeX back through the adaptor → `document.commit()`.
- Source panel / import / clear → `adaptor.loadPublicLatex()` writes the backend → `document.commit()`.
- Drag preview → `adaptor.createMirror()` reuses the backend renderer for a pixel-identical offscreen preview.

## Multi-app embedding direction

`EditorAdaptor` is the single editing-backend contract. To embed FormulaForge's editing capability in a new host app:

1. Reuse `EquationDocument` and the controllers (they are backend-agnostic);
2. Provide a new `EditorAdaptor` implementation for the host environment (or keep `MathLiveEditorAdaptor`);
3. The workspace/composition root creates the adaptor through a factory — no UI changes needed.

Because LaTeX is the exchange format, existing features are preserved: export, preview, clipboard, and the source panel all consume the document's public LaTeX.

## Trade-offs

- **Interface, not mirror**: `EditorAdaptor` is a semantic interface, not a 1:1 rename of MathLive's API; the shadow root and `.ML__*` never cross the adaptor.
- **Public LaTeX as exchange data**: only public LaTeX strings + caret offsets cross the document/backend boundary; internal placeholder/boundary/phantom conversion stays in the adaptor.
- **Centralized workarounds**: all "fix MathLive behavior" code lives only in the adaptor layer; controllers are unaware of it.
