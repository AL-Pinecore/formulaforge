# Theme System

Purpose: light / dark / follow-system themes, persisted to localStorage, applied before first paint to avoid flashing.

## Files

- `app/composables/useTheme.ts` — theme core
- `app/plugins/theme.client.ts` — early-apply plugin
- `app/assets/css/main.css` — CSS variable definitions

## How it works

### State & persistence

`useTheme.ts` holds a module-level `theme` ref. `readStoredTheme()` reads localStorage (`formulaforge.theme`), accepts only `light`/`dark`/`system`, and falls back to `system`. `setTheme` validates, writes the ref, `applyTheme`s, and persists (silently degrading to the in-memory value when localStorage is unavailable).

### Application

`applyTheme` writes the theme to `document.documentElement.dataset.theme`. `main.css` switches CSS variables (`--text`, `--panel-bg`, `--accent`, …) via selectors like `[data-theme="dark"]`; all components reference variables and never hardcode colors.

### Early apply to avoid flashing

The `theme.client.ts` plugin does one thing: call `useTheme()` (whose module load runs `applyTheme(theme.value)`). Because the plugin runs before the app mounts, `<html data-theme>` is set before the first frame, avoiding a default-theme flash.

## Design choices

- **`data-theme` + CSS variables**: a theme is a variable swap; components carry zero logic.
- **Module-level ref + plugin pre-warm**: the same "module singleton + plugin pre-warm" pattern as i18n.

## Known limits

- `system` is only a marker; actual light/dark following comes from the `prefers-color-scheme` media query under `data-theme="system"` in `main.css`.
