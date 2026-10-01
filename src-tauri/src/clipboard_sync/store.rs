//! Persistent clipboard-sync state (identity, group key, known peers). Kept out of the settings
//! store on purpose: settings are logged at debug level and the group key must never be.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownPeer {
    pub device_id: String,
    pub name: String,
    pub last_seen_ms: u64,
    /// Whether clipboards are exchanged with this device (both directions).
    #[serde(default = "default_true")]
    pub clipboard: bool,
    /// Whether files are shared with this device (sending and receiving).
    #[serde(default = "default_true")]
    pub files: bool,
}

fn default_true() -> bool {
    true
}

pub const MAX_FILE_MB_LIMIT: u32 = 100;
/// Babbl's hosted relay (Railway project "babbl", service "relay").
pub const DEFAULT_RELAY_URL: &str = "https://relay-production-fea1.up.railway.app";

/// User-facing clipboard sync options.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(default)]
pub struct SyncConfig {
    pub enabled: bool,
    /// true = sync every copy automatically; false = only when the user clicks "Send".
    pub auto_send: bool,
    pub lan: bool,
    pub relay: bool,
    pub relay_url: String,
    pub tunnel: bool,
    pub sync_text: bool,
    pub sync_images: bool,
    pub sync_files: bool,
    pub max_file_mb: u32,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            auto_send: true,
            lan: true,
            relay: false,
            relay_url: DEFAULT_RELAY_URL.to_string(),
            tunnel: false,
            sync_text: true,
            sync_images: true,
            sync_files: true,
            max_file_mb: 50,
        }
    }
}

impl SyncConfig {
    /// File size limit in bytes, clamped to 1..=100 MB.
    pub fn max_file_bytes(&self) -> u64 {
        self.max_file_mb.clamp(1, MAX_FILE_MB_LIMIT) as u64 * 1024 * 1024
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncStore {
    pub device_id: String,
    pub device_name: String,
    /// Base64 group key; None until this device creates or joins a group.
    #[serde(default)]
    pub group_key: Option<String>,
    #[serde(default)]
    pub known_peers: Vec<KnownPeer>,
    /// Remote Babbl URLs (e.g. Cloudflare tunnels of other devices) to keep connected to.
    #[serde(default)]
    pub remote_urls: Vec<String>,
    #[serde(default)]
    pub config: SyncConfig,
}

impl SyncStore {
    /// Loads the store from disk, creating a fresh identity if missing or unreadable.
    pub fn load(path: &Path) -> Self {
        let mut store: SyncStore = std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let mut changed = false;
        if store.device_id.is_empty() {
            store.device_id = uuid::Uuid::new_v4().to_string();
            changed = true;
        }
        if store.device_name.trim().is_empty() {
            store.device_name = default_device_name();
            changed = true;
        }
        if changed {
            store.save(path);
        }
        store
    }

    /// Writes the store atomically (temp file + rename).
    pub fn save(&self, path: &Path) {
        let Ok(json) = serde_json::to_vec_pretty(self) else {
            return;
        };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            if std::fs::rename(&tmp, path).is_err() {
                let _ = std::fs::remove_file(&tmp);
            }
        } else {
            log::error!("[clipboard-sync] failed to write state file {:?}", path);
        }
    }

    /// Decoded group key, if this device belongs to a group.
    pub fn group_key_bytes(&self) -> Option<[u8; 32]> {
        use base64::Engine;
        let raw = base64::engine::general_purpose::STANDARD
            .decode(self.group_key.as_deref()?)
            .ok()?;
        raw.try_into().ok()
    }

    pub fn set_group_key(&mut self, key: Option<[u8; 32]>) {
        use base64::Engine;
        self.group_key = key.map(|k| base64::engine::general_purpose::STANDARD.encode(k));
    }

    /// Records (or refreshes) a peer that proved group membership.
    pub fn remember_peer(&mut self, device_id: &str, name: &str, now_ms: u64) {
        if let Some(p) = self.known_peers.iter_mut().find(|p| p.device_id == device_id) {
            p.name = name.to_string();
            p.last_seen_ms = now_ms;
        } else {
            self.known_peers.push(KnownPeer {
                device_id: device_id.to_string(),
                name: name.to_string(),
                last_seen_ms: now_ms,
                clipboard: true,
                files: true,
            });
        }
    }

    /// Whether files may be shared with `device_id` (unknown devices default to yes).
    pub fn files_allowed(&self, device_id: &str) -> bool {
        self.known_peers
            .iter()
            .find(|p| p.device_id == device_id)
            .map_or(true, |p| p.files)
    }

    /// Whether clipboards should be exchanged with `device_id` (unknown devices default to yes).
    pub fn clipboard_allowed(&self, device_id: &str) -> bool {
        self.known_peers
            .iter()
            .find(|p| p.device_id == device_id)
            .map_or(true, |p| p.clipboard)
    }
}

/// Default location of the state file inside the app data directory.
pub fn store_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("clipboard_sync.json")
}

/// Machine hostname, used as the default device name.
pub fn default_device_name() -> String {
    let name = gethostname::gethostname().to_string_lossy().trim().to_string();
    if name.is_empty() {
        "Babbl device".to_string()
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_roundtrip_keeps_identity_and_key() {
        let dir = std::env::temp_dir().join(format!("babbl-sync-test-{}", uuid::Uuid::new_v4()));
        let path = store_path(&dir);
        let mut s = SyncStore::load(&path);
        assert!(!s.device_id.is_empty());
        s.set_group_key(Some([9u8; 32]));
        s.remember_peer("p1", "Laptop", 1);
        s.save(&path);
        let loaded = SyncStore::load(&path);
        assert_eq!(loaded.device_id, s.device_id);
        assert_eq!(loaded.group_key_bytes(), Some([9u8; 32]));
        assert_eq!(loaded.known_peers.len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }
}
