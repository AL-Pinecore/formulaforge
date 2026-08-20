# LaTeX Source Panel & Clipboard

Purpose: the LaTeX source textarea on the right — view/edit the source, copy in three formats, and import/export `.tex` files.

## Files

- `app/components/LatexSource.vue` — the source panel
- `app/utils/clipboard.ts` — clipboard and text/file download utilities

## How it works

### Portable LaTeX

The workspace's `publicLatex` converts MathLive output to mainstream notation before it leaves the editor, so the source panel, clipboard, `.tex`, preview, and exports all receive the same value:

- annotated `\longleftarrow[below]{above}` / `\longrightarrow[below]{above}` → `\xleftarrow` / `\xrightarrow`;
- MathLive ISO identifiers such as `\exponentialE`, `\imaginaryI/J`, and `\differentialD` → `\mathrm{e/i/j/d/D}`;
- `\degree` → `{}^{\circ}`.

Plain `\longleftarrow` / `\longrightarrow` commands without arguments remain unchanged. Internal editing placeholders and Text boundary markers are also removed here.

### Double buffer `draft` / `editing`

`draft` is the textarea's bound value; `editing` marks whether the user is actively editing. `watch(latex)` only syncs `draft` when `!editing` and the values differ — so field changes never clobber the user's in-progress input. `onInput` emits `apply` with the draft to feed the workspace; `onBlur` resets `draft` to the current latex (discarding the draft state).

### Three copy formats

The toolbar/panel offer three copies (wrapper functions in `clipboard.ts`):

- `raw` — plain LaTeX
- `inline` — `$...$` (`wrapInlineMath`)
- `display` — `\[...\]` (`wrapDisplayMath`)

`copyTextToClipboard` prefers `navigator.clipboard.writeText`, falling back to a hidden textarea + `document.execCommand('copy')` when that fails (non-secure contexts).

### `.tex` import/export

- **Export** (`onSaveTex`): Tauri uses `save_text_file_approved` (Rust dialog + atomic write); the browser uses `downloadTextFile` (`saveBlob`).
- **Import** (`onImportTex`): Tauri uses `read_text_file_approved`; the browser clicks a hidden `<input type="file">`, reads via `File.text()`, and `emit('apply', contents)`.

## Design choices

- **Double buffer over a direct `v-model` to latex**: source editing is a "bulk replace" semantic; a direct two-way binding would reparse the field on every keystroke and jump the caret.
- **`copyTextToClipboard` dual strategy**: the Clipboard API needs a secure context; the execCommand fallback covers Tauri/older environments.

## Known limits

- Browser import uses `File.text()` (UTF-8); no other encodings are handled.
- Copy returns a `boolean`; the caller decides the success/failure toast message.
