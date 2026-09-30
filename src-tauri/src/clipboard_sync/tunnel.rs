//! Cloudflare quick tunnel: exposes the local sync server at a public https://*.trycloudflare.com URL.

use super::engine::{Inner, ServiceStatus};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};

const RELEASE_BASE: &str = "https://github.com/cloudflare/cloudflared/releases/latest/download/";

// kill_on_drop doesn't run when the process exits abruptly, so the PID is kept for explicit cleanup.
static CHILD_PID: std::sync::Mutex<Option<u32>> = std::sync::Mutex::new(None);

/// Kills the running cloudflared process, if any.
pub fn kill_process(inner: &Inner) {
    let Some(pid) = CHILD_PID.lock().unwrap().take() else { return };
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        c
    } else {
        let mut c = std::process::Command::new("kill");
        c.arg(pid.to_string());
        c
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let _ = cmd.stdout(Stdio::null()).stderr(Stdio::null()).status();
    *inner.tunnel_url.lock().unwrap() = None;
}

fn set_state(inner: &Inner, state: &str, detail: Option<String>) {
    *inner.tunnel.lock().unwrap() = ServiceStatus::new(state, detail);
    inner.mark_dirty();
}

/// Official release asset for this platform, and whether it is a .tgz archive.
fn asset_name() -> Option<(&'static str, bool)> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", _) => Some(("cloudflared-windows-amd64.exe", false)),
        ("macos", "aarch64") => Some(("cloudflared-darwin-arm64.tgz", true)),
        ("macos", _) => Some(("cloudflared-darwin-amd64.tgz", true)),
        ("linux", "aarch64") => Some(("cloudflared-linux-arm64", false)),
        ("linux", "arm") => Some(("cloudflared-linux-arm", false)),
        ("linux", _) => Some(("cloudflared-linux-amd64", false)),
        _ => None,
    }
}

fn binary_name() -> &'static str {
    if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    }
}

#[cfg(windows)]
fn hide_window(cmd: &mut tokio::process::Command) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_cmd: &mut tokio::process::Command) {}

async fn works(path: &std::path::Path) -> bool {
    let mut cmd = tokio::process::Command::new(path);
    cmd.arg("--version").stdout(Stdio::null()).stderr(Stdio::null());
    hide_window(&mut cmd);
    matches!(cmd.status().await, Ok(s) if s.success())
}

/// Finds cloudflared on PATH or in Babbl's data folder, downloading the official build if missing.
async fn ensure_cloudflared(inner: &Inner) -> Result<PathBuf, String> {
    let on_path = PathBuf::from(binary_name());
    if works(&on_path).await {
        return Ok(on_path);
    }
    let dir = inner.host.data_dir().join("bin");
    let local = dir.join(binary_name());
    if local.exists() && works(&local).await {
        return Ok(local);
    }

    let (asset, is_tgz) = asset_name().ok_or("Cloudflare Tunnel is not available for this platform")?;
    set_state(inner, "downloading", Some("Downloading cloudflared from Cloudflare's GitHub releases".into()));
    log::info!("[clipboard-sync] downloading {}", asset);
    let bytes = reqwest::get(format!("{}{}", RELEASE_BASE, asset))
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("cloudflared download failed: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("cloudflared download failed: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    if is_tgz {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(std::io::Cursor::new(bytes.to_vec())));
        let mut found = false;
        for entry in archive.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let is_bin = entry
                .path()
                .ok()
                .and_then(|p| p.file_name().map(|n| n == "cloudflared"))
                .unwrap_or(false);
            if is_bin {
                entry.unpack(&local).map_err(|e| e.to_string())?;
                found = true;
                break;
            }
        }
        if !found {
            return Err("cloudflared archive did not contain the binary".into());
        }
    } else {
        std::fs::write(&local, &bytes).map_err(|e| e.to_string())?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&local, std::fs::Permissions::from_mode(0o755));
    }
    if !works(&local).await {
        return Err("Downloaded cloudflared does not run on this machine".into());
    }
    Ok(local)
}

/// Extracts the quick-tunnel URL from a cloudflared log line.
fn find_tunnel_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let rest = &line[start..];
    let end = rest
        .find(|c: char| c.is_whitespace() || c == '|' || c == '"')
        .unwrap_or(rest.len());
    let url = &rest[..end];
    url.ends_with(".trycloudflare.com").then(|| url.to_string())
}

/// Runs (and restarts) the quick tunnel pointing at the local server until the task is aborted.
pub async fn run(inner: Arc<Inner>, port: u16) {
    loop {
        set_state(&inner, "starting", None);
        match run_once(&inner, port).await {
            Ok(()) => set_state(&inner, "error", Some("cloudflared stopped; restarting".into())),
            Err(e) => {
                log::warn!("[clipboard-sync] tunnel error: {}", e);
                set_state(&inner, "error", Some(e));
            }
        }
        *inner.tunnel_url.lock().unwrap() = None;
        inner.mark_dirty();
        tokio::time::sleep(Duration::from_secs(15)).await;
    }
}

async fn run_once(inner: &Arc<Inner>, port: u16) -> Result<(), String> {
    let bin = ensure_cloudflared(inner).await?;
    set_state(inner, "starting", Some("Starting Cloudflare tunnel".into()));
    let mut cmd = tokio::process::Command::new(&bin);
    cmd.args([
        "tunnel",
        "--no-autoupdate",
        "--url",
        &format!("http://127.0.0.1:{}", port),
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::piped())
    .kill_on_drop(true);
    hide_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("cannot start cloudflared: {}", e))?;
    *CHILD_PID.lock().unwrap() = child.id();
    let stderr = child.stderr.take().ok_or("cloudflared has no stderr")?;
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(url) = find_tunnel_url(&line) {
            log::info!("[clipboard-sync] tunnel is live at {}", url);
            *inner.tunnel_url.lock().unwrap() = Some(url);
            set_state(inner, "running", None);
        }
    }
    let _ = child.wait().await;
    *CHILD_PID.lock().unwrap() = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::find_tunnel_url;

    #[test]
    fn parses_quick_tunnel_url() {
        let line = "2025-01-01T00:00:00Z INF |  https://calm-river-12ab.trycloudflare.com                     |";
        assert_eq!(
            find_tunnel_url(line).as_deref(),
            Some("https://calm-river-12ab.trycloudflare.com")
        );
        assert_eq!(find_tunnel_url("INF Visit https://www.cloudflare.com/docs"), None);
    }
}
