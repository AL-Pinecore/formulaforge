# Text Box Editing

Purpose: the editing mechanics of `\text{...}` and font-style commands (`\textbf`, `\mathbf`, `\bm`, …). This is the trickiest part of the project — MathLive collapses single-character text commands and drops elements into text, so it needs zero-width boundary markers, an empty-box sentinel, and whole-group rebuilding.

## Files

- `app/utils/text-boundary.ts` — boundary markers, empty-box sentinel, command sets, serialization pipeline
- `app/utils/font-styles.ts` — mapping font-style elements onto text boxes
- `app/editor/TextController.ts` — text atom queries, delete/input rebuilding, hit-testing, and font styles
- `app/components/EquationWorkspace.vue` — keyboard orchestration, history publishing, and visual overlays

## How it works

### Zero-width boundary markers

`TEXT_BOUNDARY_LATEX = \mkern0mu` is an invisible marker inserted on both sides of every `\text{...}` command by `addTextBoundaries()`, and removed on export by `stripTextBoundaries()`.

It solves two problems:

1. an empty text box has no visible content to hit-test — the empty box is hit-tested through the bounds of its two markers (`emptyTextGroupAtPoint` / `emptyTextHintBox`);
2. it delimits the text group so delete/input/navigation can tell whether the caret is inside a text group and where the boundaries are.

MathLive can rearrange the markers (duplicating the left one, dropping the right), so `normalizeTextModel()` rebuilds the marker layout from the current value.

### Empty-box sentinel

An empty text box holds no placeholder (a placeholder captures selection and shows highlight); instead it holds an invisible width-bearing content:

- text-mode commands: `\phantom{Text}` (`EMPTY_TEXT_INNER_LATEX`);
- math-font commands: `\phantom{\text{Text}}` (`EMPTY_MATH_INNER_LATEX`), because math-font commands render a bare `\phantom{Text}` as bound-less math letters.

`isEmptyTextLatex()` detects whether a serialized form is the sentinel; `stripEmptyTextSentinel()` restores empty boxes to `\text{}` in public LaTeX — the internal sentinel is never exposed.

The visible gray hint is drawn by the workspace overlay. Both the drag preview and the placed empty box derive its position, dimensions, and font from the same phantom sentinel in their respective math fields, so the baseline and height do not jump between states. `\mathcal` / `\mathbb` hints use complete Unicode mathematical alphabets to avoid styling only the first letter when a TeX font lacks lowercase glyphs.

### Serialization pipeline

`normalizePublicLatex()` is the fixed internal → public pipeline:

```
mergeAdjacentTextCommands(stripTextBoundaries(removeOrphanedTextBoundaries(latex)))
```

- `removeOrphanedTextBoundaries`: drops markers no longer adjacent to a text command (a deletion may remove only the `\text{...}` group, leaving markers behind);
- `stripTextBoundaries`: removes the paired markers;
- `mergeAdjacentTextCommands`: merges adjacent same-command boxes (`\text{a}\text{b}` → `\text{ab}`).

Model normalization and caret-prefix mapping must use the same pipeline so string lengths stay comparable (`publicStringOffsetToModel` relies on it).

### Delete/input rebuilding

MathLive serializes each text character as a separate `\text{<char>}` atom; a single-atom text command gets collapsed and the `\text{}` wrapper dropped. `TextController` therefore intercepts printable characters and deletion keys in a text context and rebuilds the whole group itself:

- `textGroupFromAtom` collects contiguous text atoms by their "mode + style" run key, joining the content and the `\text{...}` group range;
- `handleTextInput` / `handleTextDeletion` take `group.content`, insert/delete the character, replace the whole group via `mf.insert(\<command>{<content>})`, and reposition the caret with `placeCaretInTextGroup`; their `changed` / `handled` / `continue` result tells the workspace whether to publish history.

### Font-style drag

`font-styles.ts` maps `mathrm/mathbf/mathit/mathsf/mathit` to MathLive `Style` objects (`FONT_STYLES`). Dragging a style onto a text box calls `mf.applyStyle(style, { range })` in `applyFontStyle`; text-mode commands have a `\text**` equivalent (`FONT_STYLE_TEXT_COMMANDS`), so dragging the same style onto a box that already uses it toggles back to `\text{...}`.

## Design choices

- **Zero-width markers over CSS classes**: markers live in the serialization, so any editor operation can identify text boundaries, and they are cleanly stripped on export.
- **Whole-group rebuild over native delete**: native deletion collapses single-atom commands and drifts the caret; rebuilding controls the caret position and preserves the style command (deleting the last character becomes an empty box that keeps its style).
- **Phantom sentinel over a placeholder**: an empty box needs "width but not selectable", which placeholders can't provide.

## Known limits

- Adjacent text boxes whose content contains braces are not merged by `mergeAdjacentTextCommands` (the regex deliberately skips `{...}` content).
- `\operatorname` is treated as opaque via `OPAQUE_TEXT_COMMANDS` and copied through untouched, to avoid corrupting integral limits and similar re-serializations.
- Clearing the whole field does not reset MathLive's model `mode` (`math`/`text`/`latex`); a field emptied while its caret was in a text box keeps `text` mode and wraps the next input in `\text{}`. `MathLiveAdapter.ensureMathMode` resets it to `math` when the content is empty (only `text` is reset — an in-progress backslash command's `latex` mode is left alone).
