//! Tauri commands for the Clipboard section of the UI.

use super::clip_io::IoCmd;
use super::engine::{Inner, SyncStatus};
use super::pairing::{self, JoinTarget};
use super::store::{SyncConfig, MAX_FILE_MB_LIMIT};
use std::sync::Arc;

fn engine() -> Result<Arc<Inner>, String> {
    super::engine().ok_or_else(|| "Clipboard sync is not initialized".to_string())
}

#[tauri::command]
#[specta::specta]
pub fn clipboard_sync_get_status() -> Result<SyncStatus, String> {
    Ok(engine()?.status())
}

#[tauri::command]
#[specta::specta]
pub fn clipboard_sync_set_config(mut config: SyncConfig) -> Result<SyncStatus, String> {
    let inner = engine()?;
    config.max_file_mb = config.max_file_mb.clamp(1, MAX_FILE_MB_LIMIT);
    config.relay_url = config.relay_url.trim().trim_end_matches('/').to_string();
    inner.update_store(|s| s.config = config);
    super::reconfigure(&inner);
    if let Some(app) = super::app_handle() {
        crate::utils::update_tray_menu(&app, &crate::utils::TrayIconState::Idle);
    }
    Ok(inner.status())
}

#[tauri::command]
#[specta::specta]
pub fn clipboard_sync_set_device_name(name: String) -> Result<SyncStatus, String> {
    let inner = engine()?;
    let name = name.trim().chars().take(60).collect::<String>();
    if name.is_empty() {
        return Err("Device name can't be empty".to_string());
    }
    inner.update_store(|s| s.device_name = name);
    super::reconfigure(&inner);
    Ok(inner.status())
}

#[tauri::command]
#[specta::specta]
pub fn clipboard_sync_start_pairing() -> Result<SyncStatus, String> {
    let inner = engine()?;
    pairing::start_pairing(&inner)?;
    Ok(inner.status())
}

#[tauri::command]
#[specta::specta]
pub fn clipboard_sync_stop_pairing() -> Result<SyncStatus, String> {
    let inner = engine()?;
    pairing::stop_pairing(&inner);
    Ok(inner.status())
}

/// `method`: "lan" (target = device id), "url" (target = address / tunnel URL) or "relay".
#[tauri::command]
#[specta::specta]
pub async fn clipboard_sync_join(method: String, target: String, code: String) -> Result<String, String> {
    let inner = engine()?;
    let target = match method.as_str() {
        "lan" => JoinTarget::Lan(target),
        "url" => JoinTarget::Url(target),
        "relay" => JoinTarget::Relay,
        other => return Err(format!("Unknown join method '{}'", other)),
    };
    pairing::join(&inner, target, &code).await
}

/// Leaves the group: this device gets no more clipboards until it pairs again.
#[tauri::command]
#[specta::specta]
pub fn clipboard_sync_leave_group() -> Result<SyncStatus, String> {
    let inner = engine()?;
    pairing::stop_pairing(&inner);
    inner.set_group(None);
    super::reconfigure(&inner);
    Ok(inner.status())
}

#[tauri::command]
#[specta::specta]
pub fn clipboard_sync_forget_device(device_id: String) -> Result<SyncStatus, String> {
    let inner = engine()?;
    inner.update_store(|s| s.known_peers.retain(|p| p.device_id != device_id));
    inner.mark_dirty();
    Ok(inner.status())
}

/// Adds a URL of a device that is already in our group (e.g. its new tunnel URL).
#[tauri::command]
#[specta::specta]
pub fn clipboard_sync_add_url(url: String) -> Result<SyncStatus, String> {
    let inner = engine()?;
    if inner.group_key().is_none() {
        return Err("Pair with the device first (enter its PIN)".to_string());
    }
    super::net::to_ws_url(&url, "/sync")?;
    let url = url.trim().to_string();
    inner.update_store(|s| {
        if !s.remote_urls.contains(&url) {
            s.remote_urls.push(url);
        }
    });
    super::reconfigure(&inner);
    Ok(inner.status())
}

#[tauri::command]
#[specta::specta]
pub fn clipboard_sync_remove_url(url: String) -> Result<SyncStatus, String> {
    let inner = engine()?;
    inner.update_store(|s| s.remote_urls.retain(|u| u != &url));
    super::reconfigure(&inner);
    Ok(inner.status())
}

/// Chooses whether clipboards are exchanged with one paired device (both directions).
#[tauri::command]
#[specta::specta]
pub fn clipboard_sync_set_peer_clipboard(device_id: String, enabled: bool) -> Result<SyncStatus, String> {
    let inner = engine()?;
    inner.set_peer_clipboard(&device_id, enabled);
    Ok(inner.status())
}

/// Chooses whether files are shared with one paired device (both directions).
#[tauri::command]
#[specta::specta]
pub fn clipboard_sync_set_peer_files(device_id: String, enabled: bool) -> Result<SyncStatus, String> {
    let inner = engine()?;
    inner.set_peer_files(&device_id, enabled);
    Ok(inner.status())
}

/// Opens the native file picker; returns the chosen paths (empty when cancelled).
#[tauri::command]
#[specta::specta]
pub async fn share_pick_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tokio::task::spawn_blocking(move || app.dialog().file().blocking_pick_files())
        .await
        .map_err(|e| e.to_string())?;
    Ok(picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

/// Starts sharing files with the given devices; returns a summary once the transfer has begun.
#[tauri::command]
#[specta::specta]
pub fn share_send_files(paths: Vec<String>, device_ids: Vec<String>) -> Result<String, String> {
    let inner = engine()?;
    if !inner.config().enabled {
        return Err("Turn on device sync in the Clipboard section first".to_string());
    }
    let share = inner.prepare_share(paths.into_iter().map(std::path::PathBuf::from).collect(), device_ids)?;
    let summary = share.summary.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = inner.run_share(share).await {
            if let Some(app) = super::app_handle() {
                crate::notify::report_error(&app, "Share", &e);
            }
        }
    });
    Ok(summary)
}

/// Opens the storage folder, a device's "Send to" folder, or a received-files folder.
/// `which`: "root", "received", "sent", "outbox" (with `device_id`, or everyone when None).
#[tauri::command]
#[specta::specta]
pub fn share_open_folder(app: tauri::AppHandle, which: String, device_id: Option<String>) -> Result<(), String> {
    use super::outbox;
    use tauri_plugin_opener::OpenerExt;
    let inner = engine()?;
    outbox::ensure_layout(&inner);
    let root = inner.storage_dir();
    let path = match which.as_str() {
        "received" => root.join(outbox::RECEIVED_DIR),
        "sent" => root.join(outbox::SENT_DIR),
        "outbox" => outbox::outbox_dir_for(&inner, device_id.as_deref()).ok_or("Unknown device")?,
        _ => root,
    };
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| format!("Failed to open folder: {}", e))
}

/// Clears finished entries from the share history (only those with `device_id` when given).
#[tauri::command]
#[specta::specta]
pub fn share_clear_history(device_id: Option<String>) -> Result<SyncStatus, String> {
    let inner = engine()?;
    inner.clear_share_history(device_id.as_deref());
    Ok(inner.status())
}

fn shared_file(path: &str) -> Result<std::path::PathBuf, String> {
    let inner = engine()?;
    if !inner.is_shared_path(path) {
        return Err("That file is not part of your shared files".to_string());
    }
    let p = std::path::PathBuf::from(path);
    if !p.exists() {
        return Err("The file was moved or deleted".to_string());
    }
    Ok(p)
}

/// Opens a shared or received file with its default app.
#[tauri::command]
#[specta::specta]
pub fn share_open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let p = shared_file(&path)?;
    app.opener()
        .open_path(p.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| format!("Failed to open file: {}", e))
}

/// Shows a shared or received file selected in Explorer / Finder.
#[tauri::command]
#[specta::specta]
pub fn share_reveal_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let p = shared_file(&path)?;
    app.opener()
        .reveal_item_in_dir(p)
        .map_err(|e| format!("Failed to show file: {}", e))
}

/// Asks where to save a copy of a shared file; returns the new path, or None if cancelled.
#[tauri::command]
#[specta::specta]
pub async fn share_save_as(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let src = shared_file(&path)?;
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let picked = tokio::task::spawn_blocking(move || app.dialog().file().set_file_name(&name).blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(dest) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let (from, to) = (src.clone(), dest.clone());
    tokio::task::spawn_blocking(move || std::fs::copy(from, to))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Could not save the file: {}", e))?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

/// Sends whatever is on the clipboard right now to all connected devices.
#[tauri::command]
#[specta::specta]
pub async fn clipboard_sync_send_now() -> Result<String, String> {
    send_now().await
}

/// Shared by the command, the tray item and the shortcut.
pub async fn send_now() -> Result<String, String> {
    let inner = engine()?;
    if !inner.config().enabled {
        return Err("Clipboard sync is turned off".to_string());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    if !inner.send_io(IoCmd::ReadNow(tx)) {
        return Err("Clipboard is not available".to_string());
    }
    let clip = tokio::task::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(10)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "Timed out reading the clipboard".to_string())??;
    inner.send_local(clip).await
}
