# Editor & Drag-and-Drop Insertion

Purpose: the core editing surface. Palette elements are dragged into the `<math-field>`, which renders live, maintains shared state, and provides a pixel-identical insertion preview.

## Files

- `app/components/EquationWorkspace.vue` — workspace (field init, event orchestration, insertion callbacks, state publishing)
- `app/editor/EditorHistory.ts` — semantic public-LaTeX + caret-position history
- `app/editor/MathLiveAdapter.ts` — small MathLive public-API compatibility helpers
- `app/editor/EditorLatex.ts` — public LaTeX normalization and string-position mapping
- `app/editor/SelectionController.ts` — caret-offset and placeholder geometry
- `app/editor/TextController.ts` — text atom queries, input/delete rebuilding, empty boxes, and font styles
- `app/editor/DragController.ts` — drag/drop events, target state, mirror field, and preview lifecycle
- `app/editor/AutocompleteController.ts` — backslash command recognition, completion, and blocked-item rejection
- `app/editor/ContextMenuController.ts` — matrix/unwrap targets, menu configuration, and command execution
- `app/components/EquationPalette.vue` — element palette (categories, search, tooltip, drag origin)
- `app/utils/drag-payload.ts` — shared drag state (`draggedElementId` + MIME type)
- `app/data/equation-elements.ts` — definitions of 200+ elements
- `app/utils/unwrap-element.ts` — LaTeX group parsing for context-menu unwrap
- `app/composables/useEquation.ts` — global state singleton
- `app/types/equation.ts` — element & category types

## How it works

### State singleton `useEquation`

`useEquation.ts` holds `ref`s at module scope (`latex`, `errors`, `canUndo`, `canRedo`, `fontSize`, `displayStyle`); `useEquation()` always returns the same instance. Every component (workspace, toolbar, export panel) shares this state instead of threading props.

The workspace feeds the equation and `EditorHistory` state back via `emit('latex-change', value, errors)` and `emit('undo-state', ...)`.

### Semantic undo / redo

MathLive's native history records `setValue()`, while Text boundary markers, empty-box phantoms, and placeholder restoration all require internal `setValue()` calls; direct `applyStyle()` does not create a native snapshot at all. The workspace therefore disables MathLive history, and `EditorHistory` records up to 1000 `public LaTeX + caret position` snapshots at the existing `publishState()` junction.

History stores only the result of `publicLatex()`. Undo/redo passes it through `loadLatex()` to rebuild markers, phantoms, and placeholders. Internal repairs never become extra undo steps, while keyboard input/deletion, palette clicks and drops, Text/Accent rebuilding, font styles, matrix resizing, source edits, file imports, and clear all share the same history. A new snapshot drops the redo branch; toolbar actions and `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`, and `Ctrl+Y` use that same stack.

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

The long left/right arrow templates provide placeholders both above and below the arrow, and the palette preview shows both slots.

The drag starts in `EquationPalette.vue`'s `onDragStart`: it writes the element id to `draggedElementId`, and `setData` on both `DRAG_ELEMENT_MIME` and `text/plain` (the plain-text channel is a fallback so elements can be dragged into external editors). The drag image is a transparent 1px canvas (`transparentDragImage`) because the workspace draws its own preview.

### Insertion preview (mirror field)

`DragController` owns the second offscreen `math-field`, current drop target, preview rAF/timer, and the `onDragOver`, `onDragLeave`, `onDrop`, and `dispose()` lifecycle:

1. it computes the target via `SelectionController.offsetFromPoint` and the placeholder hit-test API;
2. it overlays the mirror on the real field, sets `mirror.value = mf.value`, then calls `mirror.insert(...)`;
3. because MathLive renders asynchronously, it uses rAF plus a `setTimeout(32ms)` fallback before copying the mirror's `.ML__latex` DOM into a static HTML overlay.

Font-style hit-testing and Text hints query only public `TextController` functions; the controller does not inspect Text's internal atom structure. The workspace supplies only insertion, file-loading, and Vue-state callbacks.

The mirror shares MathLive's renderer, so the preview is pixel-identical.

Empty Text elements also use the post-drop phantom sentinel in the mirror and reuse the same visible hint overlay, so preview and placed states share identical box dimensions and fonts.

### Offset computation `offsetFromPoint`

MathLive's `getOffsetFromPoint` is unreliable with sub/superscripts and groups (returns 0 for many positions). `SelectionController.buildOffsetEdges` walks each offset's `getElementInfo(offset).bounds` to build an `OffsetEdge[]`, then picks the offset nearest to the click, preferring greater depth.

### Backslash command input

Typing `\` + a command name directly in the `<math-field>` (e.g. `\mathrm`, `\frac`, `\alpha`) opens MathLive's completion popover. On `Enter` / `Tab`, instead of MathLive's bare `\command{□}` completion, the workspace inserts the matching palette element's full template (with `#0`/`#?` placeholders).

- `handleKeydown` intercepts `Enter`/`Tab` while in `latex` mode, routing to `AutocompleteController.completeCommand`.
- `AutocompleteController.trackKeydown` maintains a local command buffer after the backslash; completion does not depend on the temporarily empty serialized `mf.value` or inspect MathLive atoms.
- Command → element mapping lives in `equation-elements.ts`'s `getElementByCommand`: elements whose id equals the command name win (`\sqrt` → square root, not the n-th root); commands shared by several elements with no id match (`\left`, `\begin`) stay unmapped and fall through to native completion.
- On completion it first runs `executeCommand(['complete', 'reject'])` to discard the in-progress command and switch back to math mode, then reuses `insertElement` — identical to drag-and-drop (text commands get the empty text-box sentinel + boundary markers, everything else gets placeholders).
- Candidates that remain unsupported by the project's MathJax configuration after normalization are discarded for both keyboard confirmation and popover clicks; see the [backslash autocomplete compatibility blocklist](latex-autocomplete-compatibility.en.md) for the rule and full list.
- Two command classes get special handling:
  - Style switches `\displaystyle`/`\textstyle`/`\scriptstyle`/`\scriptscriptstyle`: `completeStyleSwitch` wraps the first element after the caret (`firstElementRangeAfter` computes its caret range, scripts included), yielding `\displaystyle\sum`; with nothing following it inserts a `\displaystyle{□}` placeholder.
  - Root environments (like `\displaylines`, whose `isRoot` atom would replace the model root): the completion is discarded so the field can't be left in an un-clearable broken state.

### Native context menu and unwrap

`ContextMenuController` extends MathLive's `menuItems`, so native editor commands, matrix row/column actions, and the project's **Unwrap** action share one context menu. It caches matrix/unwrap targets using only public `getElementInfo()`, `getOffsetFromPoint()`, `getValue()`, and LaTeX source matching.

**Unwrap** removes that command layer, filters empty placeholders, and concatenates the contents of `{...}`, `[...]`, and grouped scripts in source order. For example, right-clicking the fraction in `\sqrt{\frac{a}{b}}` produces `\sqrt{ab}`. Environment boundaries, left/right delimiters, and placeholder commands themselves are excluded from generic unwrap.

## Design choices

- **Dual MIME channels for drag**: custom MIME for in-app, `text/plain` for external compatibility; `onDrop` only trusts `draggedElementId` when the payload advertises the custom MIME.
- **Mirror preview over a canvas**: reuses MathLive's renderer rather than reimplementing layout.
- **`ensureMathfield` polling**: custom-element upgrade and shadow-root preparation are async; polling is the most robust wait across engines.
- **Public LaTeX as the undo boundary**: internal cracks only rebuild the model and never enter user history; every equation mutation converges at `publishState()` instead of maintaining inverse commands feature by feature.

## Known limits

- `MAX_MATRIX_COLUMNS = 100` (`EquationWorkspace.vue`): a `ponytail:` practical ceiling; raise it only if formulas genuinely need 100+ columns.
- Each math-field's `offsetEdges` is cached in a `WeakMap` by `mf.value + width`; any value change invalidates it.
