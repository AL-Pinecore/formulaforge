# Desktop Integration & Input Method

Purpose: the Tauri desktop shell's command registration and file dialogs, plus the two-layer input-method handling that forces English input in the math field (macOS system input-source switching + JS-layer IME event blocking).

## Files

- `src-tauri/src/lib.rs` — command registration
- `src-tauri/src/export.rs` — file dialogs and file commands (see the export doc)
- `src-tauri/src/ime.rs` — macOS input-source switching
- `app/components/EquationWorkspace.vue` — JS-layer IME blocking and input-source requests
- `src-tauri/tauri.conf.json` — CSP / window / bundle config

## How it works

### Command registration (`lib.rs`)

The `tauri::Builder` registers five commands: `export_equation_approved`, `save_text_file_approved`, `read_text_file_approved` (export.rs) and `force_ascii_ime`, `restore_ime` (ime.rs). `tauri_plugin_dialog` provides the file-dialog extension.

### The input-method problem

The math field only accepts ASCII (formulas are English symbols), but macOS's non-Latin IMEs (Chinese/Japanese/Korean) draw their candidate window at the system level and can't be hidden from JS. Hence two layers:

1. **JS-layer blocking** (cross-platform): `attachImeBlocker` captures `compositionstart/update/end`, `beforeinput`, and `input` on the shadow root, and `preventDefault` + `stopPropagation` on any non-ASCII data, keeping IME text out of MathLive's model. `onMfKeydown` also recovers printable letters during `isComposing`/`keyCode 229`.
2. **System input-source switching** (macOS only, `ime.rs`): on focus, `force_ascii_ime` calls Carbon's `TISCopyCurrentASCIICapableKeyboardInputSource` + `TISSelectInputSource` to switch to the English source; on blur, `restore_ime` restores it. `PREVIOUS` (`Mutex<Option<usize>>`) remembers the original source; if already English it is kept. Non-macOS is a no-op (WebView2's Chromium already cancels composition via the JS layer).

The frontend `requestEnglishIme` / `restoreImeAfterBlur` guard with `isTauriRuntime()` and only `invoke` these commands on desktop, failing silently (the JS layer still backstops).

### Security & CSP

`tauri.conf.json`'s CSP allows only `'self'` by default, limits `connect-src` to `ipc:`, and avoids `unsafe-inline` for scripts (the dev config is the exception). File access goes entirely through Rust commands; the webview has no arbitrary path access.

## Design choices

- **Two-layer IME handling**: JS-layer blocking is the only cross-platform option, but macOS's candidate window can't be reached, so system input-source switching is added; the two backstop each other.
- **Carbon `TIS*` via `link(name = "Carbon")` FFI**: no third-party crate; link directly against the system framework.

## Known limits

- Input-source switching only works on macOS; other platforms rely on the JS layer.
- `ime.rs` uses raw-pointer FFI + `unsafe`; pointers are stored as `usize` to be `Send` (see `PREVIOUS`).
