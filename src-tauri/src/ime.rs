// Native input-source switching so the math field never activates a non-Latin
// IME. On macOS the IME candidate window is drawn by the input method itself
// and cannot be hidden from JS, so we switch the system input source to the
// ASCII-capable (English) source while the field is focused and restore it on
// blur. No elevation/accessibility permission is required. Other platforms are
// no-ops: Windows WebView2 is Chromium and already cancels composition via the
// JS layer.

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;
    use std::sync::Mutex;

    use tauri::AppHandle;

    type TISInputSourceRef = *const c_void;
    type OSStatus = i32;

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        #[allow(non_snake_case)]
        fn TISCopyCurrentKeyboardInputSource() -> TISInputSourceRef;
        #[allow(non_snake_case)]
        fn TISCopyCurrentASCIICapableKeyboardInputSource() -> TISInputSourceRef;
        #[allow(non_snake_case)]
        fn TISSelectInputSource(input_source: TISInputSourceRef) -> OSStatus;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFEqual(cf1: TISInputSourceRef, cf2: TISInputSourceRef) -> bool;
        fn CFRelease(cf: TISInputSourceRef);
    }

    // The input source selected before we switched to ASCII, retained. Stored
    // as `usize` because raw pointers do not implement `Send`.
    static PREVIOUS: Mutex<Option<usize>> = Mutex::new(None);

    fn force_ascii() -> Result<(), String> {
        unsafe {
            let current = TISCopyCurrentKeyboardInputSource();
            if current.is_null() {
                return Err("no current input source".to_string());
            }
            let ascii = TISCopyCurrentASCIICapableKeyboardInputSource();
            if ascii.is_null() {
                CFRelease(current);
                return Err("no ASCII-capable input source".to_string());
            }
            if CFEqual(current, ascii) {
                // Already English: keep any saved source so blur can restore
                // the user's original input method.
                CFRelease(current);
                CFRelease(ascii);
                return Ok(());
            }
            let status = TISSelectInputSource(ascii);
            CFRelease(ascii);
            if status != 0 {
                CFRelease(current);
                return Err(format!("TISSelectInputSource failed: {status}"));
            }
            // Remember the first non-ASCII source so restore can bring it back.
            let mut previous = PREVIOUS.lock().unwrap();
            if previous.is_none() {
                *previous = Some(current as usize);
            } else {
                CFRelease(current);
            }
            Ok(())
        }
    }

    fn restore_previous() {
        unsafe {
            let Some(previous) = PREVIOUS.lock().unwrap().take() else {
                return;
            };
            let previous = previous as TISInputSourceRef;
            let current = TISCopyCurrentKeyboardInputSource();
            let ascii = TISCopyCurrentASCIICapableKeyboardInputSource();
            let still_ascii = !current.is_null() && !ascii.is_null() && CFEqual(current, ascii);
            if !current.is_null() {
                CFRelease(current);
            }
            if !ascii.is_null() {
                CFRelease(ascii);
            }
            if still_ascii {
                TISSelectInputSource(previous);
            }
            CFRelease(previous);
        }
    }

    pub fn force(app: AppHandle) -> Result<(), String> {
        app.run_on_main_thread(|| {
            let _ = force_ascii();
        })
        .map_err(|error| error.to_string())
    }

    pub fn restore(app: AppHandle) -> Result<(), String> {
        app.run_on_main_thread(|| {
            restore_previous();
        })
        .map_err(|error| error.to_string())
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use tauri::AppHandle;

    pub fn force(_app: AppHandle) -> Result<(), String> {
        Ok(())
    }

    pub fn restore(_app: AppHandle) -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
pub fn force_ascii_ime(app: tauri::AppHandle) -> Result<(), String> {
    imp::force(app)
}

#[tauri::command]
pub fn restore_ime(app: tauri::AppHandle) -> Result<(), String> {
    imp::restore(app)
}
