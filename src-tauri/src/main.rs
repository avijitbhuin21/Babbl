// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "windows")]
    {
        // On Windows with hybrid/dual GPUs (e.g. Intel Arc + NVIDIA RTX), WebView2's DirectComposition
        // GPU presentation swapchain can fail to present, resulting in a blank white window.
        // Disabling GPU hardware acceleration for WebView2 resolves this issue reliably across all drivers.
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        if !existing.contains("--disable-gpu") {
            let flag = if existing.is_empty() {
                "--disable-gpu --disable-gpu-compositing".to_string()
            } else {
                format!("{} --disable-gpu --disable-gpu-compositing", existing)
            };
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", flag);
        }
    }

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
