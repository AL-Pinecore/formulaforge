# Editor & Drag-and-Drop Insertion

Purpose: the core editing surface. Palette elements are dragged into the `<math-field>`, which renders live, maintains shared state, and provides a pixel-identical insertion preview.

## Files

- `app/components/EquationWorkspace.vue` — workspace (field init, drag/drop, preview, state publishing)
- `app/components/EquationPalette.vue` — element palette (categories, search, tooltip, drag origin)
- `app/utils/drag-payload.ts` — shared drag state (`draggedElementId` + MIME type)
- `app/data/equation-elements.ts` — definitions of 200+ elements
- `app/composables/useEquation.ts` — global state singleton
- `app/types/equation.ts` — element & category types

## How it works

### State singleton `useEquation`

`useEquation.ts` holds `ref`s at module scope (`latex`, `errors`, `canUndo`, `canRedo`, `fontSize`, `displayStyle`); `useEquation()` always returns the same instance. Every component (workspace, toolbar, export panel) shares this state instead of threading props.

The workspace feeds the singleton back via `emit('latex-change', value, errors)` and `emit('undo-state', ...)`.

### `<math-field>` initialization

`math-field` is MathLive's custom element, registered in `app/plugins/mathlive.client.ts`. The workspace initializes it through `ensureMathfield()`:

1. `await customElements.whenDefined('math-field')`;
2. poll up to 20 times (50ms apart) until the field is ready (`element.canUndo` exists);
3. `configureMathfield()` sets `placeholder`, `mathVirtualKeyboardPolicy`, `defaultMode`, `maxMatrixCols`, and injects placeholder styling, accent correction, fraction rules, and the IME blocker.

### Element definition & drag

`equation-elements.ts` builds elements with the `item()` factory. Placeholder conventions in the LaTeX template:

- `#0` — becomes the first selected placeholder after insertion;
- `#?` — subsequent placeholders;
- `#@` — preserves the current selection.

The drag starts in `EquationPalette.vue`'s `onDragStart`: it writes the element id to `draggedElementId`, and `setData` on both `DRAG_ELEMENT_MIME` and `text/plain` (the plain-text channel is a fallback so elements can be dragged into external editors). The drag image is a transparent 1px canvas (`transparentDragImage`) because the workspace draws its own preview.

### Insertion preview (mirror field)

The preview uses a second offscreen `math-field` (`ensureMirrorField`):

1. `updateInsertionPreview` computes the target offset via `offsetFromPoint`;
2. `renderPreview` overlays the mirror on the real field, sets `mirror.value = mf.value`, then `mirror.insert(...)`;
3. MathLive renders async, so `schedulePreviewSnapshot` uses rAF plus a `setTimeout(32ms)` fallback, then `snapshotPreview` copies the mirror's `.ML__latex` DOM into a static HTML overlay.

The mirror shares MathLive's renderer, so the preview is pixel-identical.

### Offset computation `offsetFromPoint`

MathLive's `getOffsetFromPoint` is unreliable with sub/superscripts and groups (returns 0 for many positions). The workspace implements its own: `buildOffsetEdges` walks each offset's `getElementInfo(offset).bounds` to build an `OffsetEdge[]`, then picks the offset nearest to the click, preferring greater depth.

## Design choices

- **Dual MIME channels for drag**: custom MIME for in-app, `text/plain` for external compatibility; `onDrop` only trusts `draggedElementId` when the payload advertises the custom MIME.
- **Mirror preview over a canvas**: reuses MathLive's renderer rather than reimplementing layout.
- **`ensureMathfield` polling**: custom-element upgrade and shadow-root preparation are async; polling is the most robust wait across engines.

## Known limits

- `MAX_MATRIX_COLUMNS = 100` (`EquationWorkspace.vue`): a `ponytail:` practical ceiling; raise it only if formulas genuinely need 100+ columns.
- `offsetEdges` is cached by `mf.value + width`; any value change invalidates it.
