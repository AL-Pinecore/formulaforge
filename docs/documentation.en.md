# FormulaForge Implementation Docs

Each doc focuses on the implementation mechanics of one feature (files involved, data flow, design choices, known limits). For an overview, environment setup, packaging, and testing, see the [README](../README.en.md).

## Table of Contents

| Doc | Covers |
|------|------|
| [Editor & Drag-and-Drop Insertion](editor.en.md) | `<math-field>` init, state singleton, drag insert, mirror preview, offset computation |
| [Text Box Editing](text-box.en.md) | zero-width boundary markers, empty-box sentinel, whole-group rebuild, font-style drag |
| [Edit Semantics](edit-semantics.en.md) | empty-group placeholder restoration, accent centering, Backspace structural unwrap |
| [Matrix Editing](matrix.en.md) | internal model reading, context menu, Enter/Delete row/column editing |
| [LaTeX Rendering & Live Preview](rendering.en.md) | MathJax loading, SVG pipeline, MathPreview debounce, MathChip scaling |
| [Multi-Format Export](export.en.md) | browser and Rust export paths, SVG validation, atomic write, concurrency guard |
| [LaTeX Source Panel & Clipboard](latex-source.en.md) | source double buffer, three copy formats, `.tex` import/export |
| [Backslash Autocomplete Compatibility Blocklist](latex-autocomplete-compatibility.en.md) | MathLive completion audit rule, disabled behavior, and full command list |
| [Internationalization (i18n)](i18n.en.md) | locale auto-discovery, `t()` fallback chain, MathLive string overrides, adding a language |
| [Theme System](theme.en.md) | `data-theme` + CSS variables, localStorage persistence, early apply |
| [Desktop Integration & Input Method](desktop-ime.en.md) | Tauri command registration, macOS input-source switching, JS-layer IME blocking |
