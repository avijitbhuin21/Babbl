// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        let msg = format!("PANIC: {info}\nBACKTRACE:\n{backtrace}\n");
        let path = std::env::var("LOCALAPPDATA")
            .map(|p| std::path::PathBuf::from(p).join("Babbl\\crash.log"))
            .unwrap_or_else(|_| std::path::PathBuf::from("crash.log"));
        let _ = std::fs::write(&path, msg);
    }));

    #[cfg(target_os = "linux")]
    {
        if std::path::Path::new("/dev/dri").exists()
            && std::env::var("WAYLAND_DISPLAY").is_err()
            && std::env::var("XDG_SESSION_TYPE").unwrap_or_default() == "x11"
        {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    babbl_app_lib::run()
}
