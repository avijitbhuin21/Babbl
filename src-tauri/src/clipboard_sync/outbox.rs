//! Watched "Send to …" folders inside storage: files dropped there are shared automatically,
//! then moved to `storage/Sent`.

use super::engine::{sanitize_file_name, unique_path, Inner};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

pub const EVERYONE_DIR: &str = "Send to everyone";
pub const RECEIVED_DIR: &str = "Received";
pub const SENT_DIR: &str = "Sent";
const RETRY_AFTER: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct OutboxState {
    /// Last observed (size, mtime); a file is sent once it looks the same on two scans.
    seen: HashMap<PathBuf, (u64, Option<SystemTime>)>,
    busy: HashSet<PathBuf>,
    retry_at: HashMap<PathBuf, Instant>,
}

/// Every outbox folder and the device it targets (None = all connected devices).
pub fn outbox_dirs(inner: &Inner) -> Vec<(PathBuf, Option<String>)> {
    let root = inner.storage_dir();
    let peers = inner.store.lock().unwrap().known_peers.clone();
    let mut out = vec![(root.join(EVERYONE_DIR), None)];
    let mut used = HashSet::new();
    used.insert(EVERYONE_DIR.to_lowercase());
    for p in peers {
        let mut name = format!("Send to {}", sanitize_file_name(&p.name));
        if !used.insert(name.to_lowercase()) {
            let short: String = p.device_id.chars().take(6).collect();
            name = format!("{} ({})", name, short);
            used.insert(name.to_lowercase());
        }
        out.push((root.join(name), Some(p.device_id)));
    }
    out
}

/// Outbox folder for one device, or the "everyone" folder.
pub fn outbox_dir_for(inner: &Inner, device_id: Option<&str>) -> Option<PathBuf> {
    outbox_dirs(inner)
        .into_iter()
        .find(|(_, id)| id.as_deref() == device_id)
        .map(|(dir, _)| dir)
}

/// Creates the storage layout (Received, Sent and one outbox per paired device).
pub fn ensure_layout(inner: &Inner) {
    let root = inner.storage_dir();
    let _ = std::fs::create_dir_all(root.join(RECEIVED_DIR));
    let _ = std::fs::create_dir_all(root.join(SENT_DIR));
    for (dir, _) in outbox_dirs(inner) {
        let _ = std::fs::create_dir_all(dir);
    }
}

fn is_ignored(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    name.starts_with('.')
        || name.starts_with("~$")
        || name == "desktop.ini"
        || name == "thumbs.db"
        || [".tmp", ".crdownload", ".part", ".partial", ".download", ".babblpart"]
            .iter()
            .any(|ext| name.ends_with(ext))
}

/// One pass over the outbox folders; sends files that stopped changing to their devices.
pub fn scan(inner: &Arc<Inner>) {
    if inner.group_key().is_none() || !inner.config().enabled {
        return;
    }
    ensure_layout(inner);
    let sent_dir = inner.storage_dir().join(SENT_DIR);
    let mut present = HashSet::new();

    for (dir, target) in outbox_dirs(inner) {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_file() || is_ignored(&path) {
                continue;
            }
            present.insert(path.clone());
            let sig = (meta.len(), meta.modified().ok());
            {
                let mut st = inner.outbox.lock().unwrap();
                if st.busy.contains(&path) {
                    continue;
                }
                if st.retry_at.get(&path).is_some_and(|t| Instant::now() < *t) {
                    continue;
                }
                if st.seen.insert(path.clone(), sig) != Some(sig) {
                    continue;
                }
            }
            let recipients = match &target {
                Some(id) if inner.is_peer_connected(id) => vec![id.clone()],
                Some(_) => continue,
                None => inner.connected_peer_ids(),
            };
            if recipients.is_empty() {
                continue;
            }
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let staged = unique_path(&sent_dir, &name, &mut HashSet::new());
            // Moving first proves the file is no longer being written (Windows refuses to move
            // open files) and keeps later edits from racing the upload.
            if std::fs::rename(&path, &staged).is_err() {
                continue;
            }
            {
                let mut st = inner.outbox.lock().unwrap();
                st.seen.remove(&path);
                st.retry_at.remove(&path);
                st.busy.insert(path.clone());
            }
            let inner = inner.clone();
            tokio::spawn(async move {
                let result = match inner.prepare_share(vec![staged.clone()], recipients) {
                    Ok(share) => inner.run_share(share).await,
                    Err(e) => Err(e),
                };
                let mut st = inner.outbox.lock().unwrap();
                st.busy.remove(&path);
                if let Err(e) = result {
                    log::warn!("[clipboard-sync] outbox file {:?} not sent: {}", path, e);
                    if !path.exists() && std::fs::rename(&staged, &path).is_ok() {
                        st.retry_at.insert(path.clone(), Instant::now() + RETRY_AFTER);
                    }
                }
            });
        }
    }
    let mut st = inner.outbox.lock().unwrap();
    st.seen.retain(|p, _| present.contains(p));
    st.retry_at.retain(|p, _| present.contains(p));
}
