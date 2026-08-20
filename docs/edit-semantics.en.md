# Edit Semantics: Placeholders / Accents / Structural Unwrap

Purpose: three mechanisms that give the editor its feel — restoring a placeholder when a `\sqrt{}` is emptied, centering accents correctly, and intelligently unwrapping the enclosing structure when Backspace is pressed inside a placeholder.

## Files

- `app/utils/empty-group.ts` — empty-group placeholder restoration
- `app/utils/accent.ts` — accent command list and detection
- `app/utils/mathfield-accent.ts` — accent centering / wide-hat correction
- `app/utils/mathfield-placeholder.ts` — placeholder styling injection
- `app/utils/remove-empty-element.ts` — Backspace/Delete structural unwrap

## How it works

### Empty-group restoration (`restoreEmptyGroupLatex`)

After the user empties a structure (`\sqrt{}`, `\frac{}{}`, `\left(\right)`, an empty matrix cell, …), `restoreEmptyGroupLatex` re-injects `\placeholder{}` so the emptied spot leaves an editable gray box instead of a broken structure. The rule chain:

1. empty `\text{}` / `\textbf{}` → phantom sentinel (see the text-box doc);
2. empty `\math**{}` → `\phantom{\text{Text}}`;
3. empty mandatory command argument (`\sqrt{}`, `\hat{}`) → `\placeholder{}`;
4. empty super/subscript `^{}` / `_{}` → `\placeholder{}`;
5. empty `\left...\right` delimiters → placeholder between them;
6. remaining bare empty groups `{}` → placeholder (excluding `\placeholder`'s own argument, to avoid nesting);
7. empty matrix/cases/aligned cells → filled one by one.

It returns `null` when no change is needed. The workspace runs it after `input` via `scheduleRestorePlaceholders` (a microtask) before MathLive's next render, avoiding a broken frame.

### Placeholder styling & hit-testing

`\placeholder{}` renders as a "▢" glyph with no stable class, so it can't be styled externally. `mathfield-placeholder.ts` injects a stylesheet into each shadow root, annotates the `▢` glyphs with the `ml-placeholder` class (a gray rect), and re-annotates after every render via a MutationObserver. When the caret is in text mode a selected placeholder shows a blinking vertical bar.

Geometry hit-testing lives in `placeholderIndexAtPoint` / `selectPlaceholderAtPoint`: scan all `▢` nodes in the shadow root, match by position, then walk to the right model position with `moveToNextPlaceholder` (handling structures like `\sum` sub/superscripts where visual order differs from model order).

### Accent correction (`mathfield-accent.ts`)

MathLive renders accents with several offsets; `ensureAccentPositioning` corrects them continuously via a MutationObserver:

- **Fixed-width accents** (`\hat`/`\bar`/`\vec`/`\tilde`…): `centerAccentBodies` measures the geometric center of `.ML__accent-body` vs `.ML__vlist` and re-centers with `translateX`; `\vec` is a zero-width combining character whose half-width is estimated as 0.26em of the font size.
- **Wide accents** (`\widehat`/`\widetilde`): MathLive sizes the container to half the content, selecting the narrow glyph. `stretchWideAccents` swaps in the wide variant (KaTeX glyph paths `WIDE_HAT`/`WIDE_TILDE`) once the content exceeds 1.06em, then stretches the width to the content, capped at 1.9em and centered.

### Structural unwrap (`removeElementAtPlaceholder`)

When Backspace/Delete is pressed with the caret in a placeholder, `unwrapElementAtCaret` briefly replaces the placeholder with a marker (`\bigstar`) to locate it in the serialized string, restores the value, then `removeElementAtPlaceholder` unwraps the enclosing structure according to eleven rules (promoting real content, removing the whole structure when empty):

1. `\frac` and friends (two-argument promotion)
2. `\overbrace` / `\underbrace`
3. `\log` (base / argument slots)
4. labels above/below long arrows (remove only the selected empty placeholder, keeping the other label and the arrow)
5. large operators `\sum`/`\int`/`\lim` scripts
6. plain super/subscripts
7. single-argument commands (excluding `\left`/`\begin` etc.)
8. function parens `\sin(...)` etc.
9. the optional index of `\sqrt[n]{}`
10. `\left...\right` and paired delimiters
11. matrices / environments

Each rule follows "promote real content, remove the whole structure when empty".

## Design choices

- **Temporary marker for locating**: model offsets don't map reliably to string offsets inside operator branches (`\sum` serializes its scripts in reverse model order); marker round-trip is the only stable way. Workspace history records public LaTeX only, so the marker round-trip never enters undo.
- **MutationObserver over polling**: MathLive's re-render timing is unknown; an observer is the cheapest "correct immediately after render".

## Known limits

- The wide-accent glyph paths hardcode KaTeX's S7 wide variants; they must be updated if MathLive swaps fonts.
- The `\vec` half-width 0.26em is an estimate — see `COMBINING_ARROW_HALF_EM`.
