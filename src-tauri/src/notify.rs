use log::error;
use once_cell::sync::OnceCell;
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter, Manager};

pub const ERROR_EVENT: &str = "babbl://error";

static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

#[derive(Serialize, Clone, Type)]
pub struct AppError {
    pub title: String,
    pub message: String,
}

/// Stores the app handle so panics and background threads can surface errors to the UI.
pub fn init(app: &AppHandle) {
    let _ = APP_HANDLE.set(app.clone());
}

/// Logs an error and emits it to the main window and overlay so the user sees a pop-up.
pub fn report_error(app: &AppHandle, title: &str, message: &str) {
    error!("[{}] {}", title, message);
    let payload = AppError {
        title: title.to_string(),
        message: message.to_string(),
    };
    if let Err(e) = app.emit(ERROR_EVENT, payload.clone()) {
        error!("Failed to emit error event to app: {}", e);
    }
    if let Some(overlay) = app.get_webview_window("recording_overlay") {
        let _ = overlay.emit(ERROR_EVENT, payload);
    }
}

/// Reports an error using the globally stored app handle; falls back to logging only.
pub fn report_error_global(title: &str, message: &str) {
    match APP_HANDLE.get() {
        Some(app) => report_error(app, title, message),
        None => error!("[{}] {}", title, message),
    }
}

/// Logs native (non-Rust) crashes such as access violations before Windows terminates the process.
#[cfg(target_os = "windows")]
fn install_native_crash_handler() {
    use windows::Win32::Foundation::EXCEPTION_ACCESS_VIOLATION;
    use windows::Win32::System::Diagnostics::Debug::{
        SetUnhandledExceptionFilter, EXCEPTION_POINTERS,
    };

    unsafe extern "system" fn filter(info: *const EXCEPTION_POINTERS) -> i32 {
        let (code, address) = unsafe {
            info.as_ref()
                .and_then(|p| p.ExceptionRecord.as_ref())
                .map(|r| (r.ExceptionCode.0 as u32, r.ExceptionAddress as usize))
                .unwrap_or((0, 0))
        };
        let name = if code == EXCEPTION_ACCESS_VIOLATION.0 as u32 {
            "access violation"
        } else {
            "native exception"
        };
        error!(
            "FATAL {}: code 0x{:08X} at 0x{:X} on thread '{}'",
            name,
            code,
            address,
            std::thread::current().name().unwrap_or("unnamed")
        );
        log::logger().flush();
        0 // EXCEPTION_CONTINUE_SEARCH: let Windows finish terminating / write WER dump
    }

    unsafe {
        SetUnhandledExceptionFilter(Some(filter));
    }
}

#[cfg(not(target_os = "windows"))]
fn install_native_crash_handler() {}

/// Installs a panic hook that writes panics to the log and surfaces them as an error pop-up.
pub fn install_panic_hook() {
    install_native_crash_handler();
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown location".to_string());
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic payload".to_string()
        };
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("unnamed");
        report_error_global(
            "Internal error",
            &format!("Panic on thread '{}' at {}: {}", thread_name, location, message),
        );
        default_hook(info);
    }));
}
