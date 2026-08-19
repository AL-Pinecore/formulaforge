# Multi-Format Export

Purpose: export the rendered SVG as SVG / PNG / JPEG / WebP / PDF. The desktop build (Tauri) does file dialogs and raster/PDF rendering in Rust; the browser build uses Web APIs. Both paths share the same rendered input.

## Files

- `app/composables/useEquationExport.ts` — export orchestration and runtime detection
- `app/utils/browser-export.ts` — browser-side raster/PDF encoding
- `app/utils/export-payload.ts` — payload assembly and clamping
- `app/types/export.ts` — format/settings types and defaults
- `src-tauri/src/export.rs` — Rust-side export commands
- `app/components/ExportPanel.vue` — export settings UI

## How it works

### Data flow

```
ExportPanel(settings) → effectiveExportSettings(clamp) → renderEquationSvg(SVG)
   ├─ Tauri: invoke('export_equation_approved', { format, svg, jpegQuality })
   └─ Browser: svg → (canvas raster | jsPDF+svg2pdf PDF) → saveBlob download
```

`isTauriRuntime()` checks `window.isTauri` or `__TAURI_INTERNALS__`. On desktop the SVG is handed to Rust (open save dialog + render); in the browser it's downloaded via `downloadBlob` (`saveBlob`).

### Parameter clamping (`effectiveExportSettings`)

padding `[0,200]` default 8, scale `[1,3]` default 1, jpegQuality `[10,100]` default 90; non-finite values fall back to defaults. JPEG with no background is forced to `#ffffff` (JPEG has no transparency).

### Browser side (`browser-export.ts`)

- `svgToRasterBlob`: SVG → `Blob`/`Image` → canvas `drawImage` → `toBlob`; `MAX_DIMENSION = 16384` matches the Rust guard to avoid exhausting canvas memory.
- `svgToPdfBlob`: `jspdf` + `svg2pdf.js`. svg2pdf reads `getComputedStyle`, which is unreliable for detached nodes, so the SVG is attached to an off-screen `<div>` first.

### Rust side (`export.rs`)

Command `export_equation_approved`: parse format → `validate_svg` → `save_file` dialog → `normalize_extension` → `spawn_blocking` render + write.

- **SVG validation** (`validate_svg`): 4MB size cap, rejects `<script>`, event-handler attributes, and external `href` links.
- **Raster** (`svg_to_raster`): `resvg` parsing (the `image_href_resolver` only allows data: URLs, denying local files); `tiny_skia` outputs premultiplied alpha, which is demultiplied per-pixel to straight RGBA before `image` encoding; JPEG composites over white via `composite_over_white`.
- **PDF** (`svg_to_pdf`): `svg2pdf`'s `usvg` parsing with the same deny-all resolver.
- **Atomic write** (`write_atomic`): write `.<name>.tmp<pid>-<seq>` then `rename`, avoiding half-written files.
- **Concurrency guard** (`ExportGuard` + `MAX_CONCURRENT_EXPORTS=2`): limits simultaneous CPU-heavy exports.

### Text file export/import

`save_text_file_approved` / `read_text_file_approved` reuse the same dialog + atomic-write mechanism (`.tex` import/export), called by `LatexSource.vue` (see the latex-source doc).

## Design choices

- **File dialogs in Rust**: the webview never touches a path and is never granted arbitrary path access — the dialog result only returns the saved path string.
- **Shared rendered input across paths**: both paths consume the same `renderEquationSvg` output, guaranteeing preview == export.
- **Consistent size/pixel guards**: `MAX_DIMENSION` (16384) and `MAX_PIXELS` (4096×4096) exist in both browser and Rust to stop absurd inputs from exhausting memory.

## Known limits

- The browser PNG/WebP path has no pixel cap (only `MAX_DIMENSION`); Rust additionally enforces `MAX_PIXELS`.
- `ExportGuard`'s concurrency limit `2` is conservative (the frontend `exporting` flag already serializes the UI); it's a trust-boundary guard.
