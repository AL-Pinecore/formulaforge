<div align="center">

<h1>
  <img src="./src-tauri/icons/icon.png" width="72" height="72" align="absmiddle">
  &nbsp;
  FormulaForge
</h1>

**English** | [中文](./README.md)

[![CI](https://img.shields.io/github/actions/workflow/status/AL-Pinecore/formulaforge/build.yml?label=CI&style=flat-square)](https://github.com/AL-Pinecore/formulaforge/actions/workflows/build.yml)
[![Version](https://img.shields.io/github/v/release/AL-Pinecore/formulaforge?style=flat-square)](https://github.com/AL-Pinecore/formulaforge/releases)
[![Downloads](https://img.shields.io/github/downloads/AL-Pinecore/formulaforge/total?style=flat-square)](https://github.com/AL-Pinecore/formulaforge/releases)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-67C8A2?style=flat-square)](https://tauri.app/)
[![Nuxt 4](https://img.shields.io/badge/Nuxt-4-00DC82?style=flat-square)](https://nuxt.com/)

A drag-and-drop LaTeX equation editor desktop app. Drag equation elements from the palette into the input box to assemble formulas in real time, then export as SVG / PNG / JPEG / WebP / PDF.

</div>

## Disclaimer
This project is completely developed by AI, aiming to test AI's ability in developing project.

Model used: ChatGPT 5.6 Sol, Deepseek V4 Pro
## Features

- **Drag-and-drop editing**: 200+ equation elements (operators, functions, fractions, roots, sums/integrals, Greek letters, logic/set symbols, arrows, scripts, matrices, and more), insertable by click or drag.
- **Live preview**: WYSIWYG rendering via MathJax, matching the export output.
- **LaTeX source**: view/edit the source, copy (raw / inline / display), and import/export `.tex` files.
- **Export**: SVG, PNG, JPEG, WebP, PDF (background color, padding, resolution, JPEG quality, display style).
- **Desktop**: built with Tauri; file dialogs and image/PDF rendering happen in Rust, with no browser sandbox limits.

> For implementation details of each feature, see the [implementation docs](docs/documentation.en.md).

## Tech Stack

- **Frontend**: Nuxt 4 + Vue 3, [MathLive](https://cortexjs.io/mathlive/) (math input), [MathJax](https://www.mathjax.org/) (SVG rendering)
- **Desktop shell**: Tauri 2 + Rust (`resvg` for images, `svg2pdf` for PDF)
- **Testing**: Vitest (unit + Nuxt component), Playwright (E2E), Rust unit tests

## Prerequisites

- Node.js ≥ 22
- Rust stable (with `rustfmt` and `clippy`, see `src-tauri/rust-toolchain.toml`)
- Platform dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev`
  - **Windows**: WebView2 + MSVC

## Getting Started

```bash
# Install dependencies (postinstall copies MathLive fonts / MathJax vendor assets into public/)
npm ci

# Browser development (Nuxt dev server)
npm run dev

# Desktop development (Tauri)
npm run tauri dev
```

## Building the Desktop App

```bash
npm run tauri build
```

Artifacts land in `src-tauri/target/release/bundle/` (macOS produces `.app` / `.dmg`, Windows `.msi` / `.exe`, Linux `.deb` / `.rpm` / `AppImage`). The build runs `npm run generate` (`NUXT_SSR=false` static generation into `dist/`) automatically.

## Testing

```bash
npm run typecheck      # TypeScript type checking
npm test               # run all frontend tests (unit + nuxt)
npm run test:unit      # unit tests
npm run test:nuxt      # Nuxt component tests
npm run test:rust      # Rust unit tests
npm run test:e2e       # Playwright E2E tests
npm run check:rust     # cargo fmt --check + clippy
```

## Project Structure

```
app/                    # Nuxt frontend
  components/           # workspace, palette, toolbar, preview components
  composables/          # useEquation, useEquationExport
  data/                 # equation element definitions
  plugins/              # mathlive registration
  types/                # type definitions
  utils/                # SVG export, clipboard, empty-group restore helpers
  app.vue               # app entry
src-tauri/              # Rust desktop shell
  src/export.rs         # export commands (dialog + resvg/svg2pdf rendering)
  src/lib.rs            # Tauri builder and command registration
  src/main.rs           # entry point
  tests/                # Rust tests and fixtures
scripts/                # copy-vendor-assets.mjs and other build scripts
test/                   # frontend tests (unit / nuxt / e2e)
public/                 # vendor assets copied by scripts (MathLive fonts, MathJax)
```

## Adding a New Language

Contributions that make FormulaForge available in more languages are very welcome! In most cases, you only need to add one locale file under `app/locales/`; no component, plugin, or language-switching changes are required. Copying `en.ts` is a good place to start.

The default export of each locale file must include this metadata:

```ts
export const mathlive = {
  // Keep the same keys as every other locale
  'menu.copy-as-typst': 'Copy as Typst',
}

export default {
  languageCode: 'zh-cn', // A unique BCP 47 language tag
  displayName: '中文',   // The native name shown in the language selector
  // The remaining UI translations…
}
```

When adding a language:

- `languageCode` is the app's real language identifier. It is automatically used as the selector option value, the `HTML lang` value, and the locale passed to third-party components. Use a unique BCP 47 tag; when MathLive supports the language, match its locale name exactly.
- `displayName` is the user-facing label. Please write it in the language itself, such as `Deutsch`, `日本語`, or `中文`.
- Keep the same UI translation keys as the other locale files and translate only their values. The existing tests will help catch missing keys.
- Each locale file must also export `export const mathlive = { ... }` to supplement or override MathLive strings. Its keys must match every other locale, so no language-specific checks are needed in components or plugins.
- Locale files are discovered automatically and added to the language selector. The filename is only for organization and is not used as the language identifier.

When you are done, run `npm run typecheck` and `npm test` to validate the locale. Thank you for contributing!

## Scripts

| Command               | Description                                                  |
|-----------------------|--------------------------------------------------------------|
| `npm run dev`         | Start the Nuxt dev server                                    |
| `npm run build`       | Build the Nuxt output                                        |
| `npm run generate`    | Static generation (`NUXT_SSR=false`, used by Tauri bundling) |
| `npm run preview`     | Preview the build output                                     |
| `npm run tauri dev`   | Desktop development mode                                     |
| `npm run tauri build` | Bundle the desktop app                                       |
| `npm run typecheck`   | TypeScript type checking                                     |
| `npm test`            | Run frontend tests                                           |
| `npm run test:e2e`    | Playwright E2E tests                                         |
| `npm run test:rust`   | Rust unit tests                                              |
| `npm run check:rust`  | Rust format check + clippy                                   |
