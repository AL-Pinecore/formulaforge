# LaTeX Rendering & Live Preview

Purpose: turn LaTeX into SVG. Editing uses MathLive, but export/preview/palette chips all render with MathJax, guaranteeing WYSIWYG — the export matches the preview.

## Files

- `app/utils/mathjax-loader.ts` — MathJax dynamic loading and macro config
- `app/utils/svg-export.ts` — the core LaTeX → standalone SVG pipeline
- `app/components/MathPreview.vue` — live preview in the export panel (debounced)
- `app/components/MathChip.vue` — static chips in the palette
- `app/assets/css/mathlive-fonts.css` / `scripts/copy-vendor-assets.mjs` — font assets

## How it works

### MathJax loading (`mathjax-loader.ts`)

MathJax is bundled as a vendor asset under `public/mathjax/` (copied from node_modules by `copy-vendor-assets.mjs`). `ensureMathJax` lazily loads the `tex-svg.js` script, caches `loadPromise`, and clears it on failure to allow retry.

Key config: `tex.macros = { differentialD: '\mathrm{d}' }` — MathLive serializes its ISO upright differential as `\differentialD`, which MathJax doesn't know; this maps it to the standard `\mathrm{d}`. `loader.paths.fonts = ''` makes dynamic glyph data load root-relative.

### SVG rendering (`renderEquationSvg`)

The `svg-export.ts` pipeline:

1. `applyMathstyle`: inline style is expressed via `\textstyle` instead of `display: false` — MathJax 4's SVG output line-breaks inline math at every operator, producing multiple `<svg>` elements;
2. `tex2svgPromise(..., { display: true, em: 16, ex: 8 })`;
3. inject `SVG_CSS` (red error nodes, dashed frames, …);
4. size conversion: in display mode MathJax sets `width="100%"` (no ex unit), so fall back to the viewBox (MathJax units: 1000 = 1em), divide by 1000 and scale by `EM_PIXELS`;
5. `composeStandaloneSvg` wraps it in an outer `<svg>` with `xmlns`/`viewBox`/padding/color/background.

`hasErrors` detects `[data-mml-node="merror"]` to flag LaTeX errors in the preview panel.

### Preview `MathPreview.vue`

The export panel live-previews the `latex + color + background + padding + scale` combination. It debounces with `delay` (default 200ms) and increments `renderId` to avoid races (a stale async result is dropped). The result is `stripXmlDeclaration`-ed and injected via `innerHTML`; the `merror` event drives the "formula has errors" hint.

### Palette chips `MathChip.vue`

Each palette element renders via MathLive's static `convertLatexToMarkup`, then `fitToBox` scales it to `MAX_WIDTH`/`MAX_HEIGHT`. A `ResizeObserver` re-measures when a category is expanded (recovering from `display:none`), otherwise `scrollWidth` reads 0 at mount and the scale stays stuck at 1.

## Design choices

- **Renderer split**: MathLive for editing (interactive), MathJax for output (typography). The `\differentialD` macro bridges the two.
- **`\textstyle` over inline display**: sidesteps MathJax 4's inline line-breaking, always producing a single `<svg>`.

## Known limits

- `EM_PIXELS` / `EX_PIXELS` (1em=16px, 1ex=8px) are hardcoded to match MathJax's `em`/`ex` args; changing font size requires keeping them in sync.
- Colors/backgrounds only accept `#RRGGBB` / `#RRGGBBAA` (`sanitizeColor`); other formats silently fall back.
