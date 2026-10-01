//! Core sync engine: links, peers, fan-out with dedupe, incoming file transfers and status.

use super::clip_io::{now_ms, ApplyContent, IoCmd, IoConfig};
use super::crypto::{self, FrameCipher};
use super::protocol::{ClipContent, ClipMsg, FileMeta, Msg, ShareMsg, PROTOCOL_VERSION};
use super::store::{SyncConfig, SyncStore};
use bytes::Bytes;
use serde::Serialize;
use specta::Type;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Seek, SeekFrom, Write};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

/// What the engine needs from its environment (Tauri app in production, a stub in tests).
pub trait Host: Send + Sync {
    fn emit_status(&self, status: &SyncStatus);
    fn data_dir(&self) -> PathBuf;
    fn download_dir(&self) -> PathBuf;
    fn notify_error(&self, title: &str, message: &str);
    fn emit_share_received(&self, record: &ShareRecord);
}

pub struct TauriHost(pub AppHandle);

impl Host for TauriHost {
    fn emit_share_received(&self, record: &ShareRecord) {
        let _ = self.0.emit(SHARE_RECEIVED_EVENT, record);
    }

    fn emit_status(&self, status: &SyncStatus) {
        let _ = self.0.emit(STATUS_EVENT, status);
    }

    fn data_dir(&self) -> PathBuf {
        self.0
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("babbl"))
    }

    fn download_dir(&self) -> PathBuf {
        self.0
            .path()
            .download_dir()
            .unwrap_or_else(|_| self.data_dir())
    }

    fn notify_error(&self, title: &str, message: &str) {
        crate::notify::report_error(&self.0, title, message);
    }
}

pub const STATUS_EVENT: &str = "clipboard-sync-status";
pub const SHARE_RECEIVED_EVENT: &str = "share-received";
pub const LINK_QUEUE: usize = 64;
const SEEN_CAPACITY: usize = 50_000;
const STALE_TRANSFER_MS: u64 = 5 * 60 * 1000;
const SHARE_HISTORY: usize = 300;
const PART_SUFFIX: &str = ".babblpart";

pub enum Out {
    Frame(Bytes),
    Ping,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Via {
    Lan,
    Tunnel,
    Url,
    Relay,
}

pub struct Link {
    pub tx: mpsc::Sender<Out>,
    pub via: Via,
    pub label: String,
    /// Set once a valid Hello proves the other side holds the group key.
    pub authed: bool,
    pub peers: HashSet<String>,
}

struct PeerLive {
    name: String,
    links: HashSet<u64>,
}

#[derive(Default)]
struct Seen {
    set: HashSet<String>,
    order: VecDeque<String>,
}

impl Seen {
    /// Returns true the first time a key is seen.
    fn insert(&mut self, key: String) -> bool {
        if !self.set.insert(key.clone()) {
            return false;
        }
        self.order.push_back(key);
        while self.order.len() > SEEN_CAPACITY {
            if let Some(old) = self.order.pop_front() {
                self.set.remove(&old);
            }
        }
        true
    }
}

struct IncomingFile {
    path: PathBuf,
    /// Shares are written to a `.babblpart` file and renamed here once complete.
    final_path: Option<PathBuf>,
    /// Kept open for the whole transfer: reopening per chunk is slow (and rescanned by AV on Windows).
    file: Option<std::fs::File>,
    size: u64,
    received: u64,
}

enum IncomingKind {
    Clip,
    Share { origin_id: String, origin_name: String },
}

struct Incoming {
    kind: IncomingKind,
    dir: PathBuf,
    files: Vec<IncomingFile>,
    total: u64,
    received: u64,
    peer: String,
    summary: String,
    last_progress_ms: u64,
}

struct Outgoing {
    kind: &'static str,
    summary: String,
    peer: String,
    /// Bytes sent on each link the transfer uses; progress is the slowest one.
    lanes: Vec<u64>,
    total: u64,
}

/// A share validated and announced locally, ready to be streamed by `run_share`.
pub struct PreparedShare {
    pub id: String,
    pub summary: String,
    msg: Msg,
    paths: Vec<PathBuf>,
}

pub struct Discovered {
    pub name: String,
    pub addrs: Vec<IpAddr>,
    pub port: u16,
    pub fingerprint: String,
    pub fullname: String,
}

pub struct PairingSession {
    pub pin: String,
    pub room: String,
    pub expires_ms: u64,
    pub failures: u32,
    pub task: Option<tauri::async_runtime::JoinHandle<()>>,
}

#[derive(Clone, Serialize, Type)]
pub struct Activity {
    pub direction: String,
    pub summary: String,
    pub peer: String,
    pub at_ms: f64,
}

#[derive(Clone, Serialize, Type)]
pub struct TransferStatus {
    pub id: String,
    /// in | out
    pub direction: String,
    /// clipboard | share
    pub kind: String,
    pub summary: String,
    pub peer: String,
    pub received: f64,
    pub total: f64,
}

#[derive(Clone, Serialize, serde::Deserialize, Type)]
pub struct ShareRecord {
    pub id: String,
    /// sent | received
    pub direction: String,
    pub summary: String,
    pub files: Vec<String>,
    /// Full paths of the files on this machine (sources for sent, saved copies for received).
    #[serde(default)]
    pub paths: Vec<String>,
    /// Sender (received) or recipients (sent), as device names.
    pub peers: Vec<String>,
    pub peer_ids: Vec<String>,
    pub delivered_to: Vec<String>,
    /// sending | sent | delivered | failed | received
    pub state: String,
    pub error: Option<String>,
    /// Folder the received files were saved into.
    pub folder: Option<String>,
    pub at_ms: f64,
}

#[derive(Clone, Serialize, Type, Default)]
pub struct ServiceStatus {
    /// off | starting | downloading | running | error
    pub state: String,
    pub detail: Option<String>,
}

impl ServiceStatus {
    pub fn new(state: &str, detail: Option<String>) -> Self {
        Self {
            state: state.to_string(),
            detail,
        }
    }
}

#[derive(Clone, Serialize, Type)]
pub struct PeerStatus {
    pub device_id: String,
    pub name: String,
    pub connected: bool,
    pub via: Vec<Via>,
    pub last_seen_ms: f64,
    /// Clipboards are exchanged with this device.
    pub clipboard: bool,
    /// Files are shared with this device.
    pub files: bool,
}

#[derive(Clone, Serialize, Type)]
pub struct DiscoveredDevice {
    pub device_id: String,
    pub name: String,
    pub address: String,
    pub same_group: bool,
}

#[derive(Clone, Serialize, Type)]
pub struct RemoteUrlStatus {
    pub url: String,
    pub connected: bool,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Type)]
pub struct PairingInfo {
    pub pin: String,
    /// Code to type on the other device when pairing through the relay (ROOM-PIN).
    pub invite_code: Option<String>,
    pub expires_ms: f64,
}

#[derive(Clone, Serialize, Type)]
pub struct SyncStatus {
    pub config: SyncConfig,
    pub device_id: String,
    pub device_name: String,
    pub in_group: bool,
    pub group_fingerprint: Option<String>,
    pub peers: Vec<PeerStatus>,
    pub discovered: Vec<DiscoveredDevice>,
    pub lan: ServiceStatus,
    pub lan_port: Option<u16>,
    /// This machine's addresses other LAN devices can pair with ("ip:port").
    pub lan_addresses: Vec<String>,
    pub tunnel: ServiceStatus,
    pub tunnel_url: Option<String>,
    pub relay: ServiceStatus,
    pub remote_urls: Vec<RemoteUrlStatus>,
    pub pairing: Option<PairingInfo>,
    pub last_activity: Option<Activity>,
    pub transfers: Vec<TransferStatus>,
    pub shares: Vec<ShareRecord>,
    pub storage_dir: String,
}

pub struct Inner {
    pub host: Box<dyn Host>,
    pub store_path: PathBuf,
    history_path: PathBuf,
    pub store: Mutex<SyncStore>,
    pub cipher: Mutex<Option<FrameCipher>>,
    pub links: Mutex<HashMap<u64, Link>>,
    next_link: AtomicU64,
    peers: Mutex<HashMap<String, PeerLive>>,
    seen: Mutex<Seen>,
    incoming: Mutex<HashMap<String, Incoming>>,
    outgoing: Mutex<HashMap<String, Outgoing>>,
    shares: Mutex<VecDeque<ShareRecord>>,
    pub outbox: Mutex<super::outbox::OutboxState>,
    pub io_tx: Mutex<Option<std::sync::mpsc::Sender<IoCmd>>>,
    pub pairing: Mutex<Option<PairingSession>>,
    pub tasks: Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>,
    pub mdns: Mutex<Option<mdns_sd::ServiceDaemon>>,
    pub discovered: Mutex<HashMap<String, Discovered>>,
    pub lan_connecting: Mutex<HashSet<String>>,
    pub lan: Mutex<ServiceStatus>,
    pub lan_port: Mutex<Option<u16>>,
    pub tunnel: Mutex<ServiceStatus>,
    pub tunnel_url: Mutex<Option<String>>,
    pub relay: Mutex<ServiceStatus>,
    pub url_states: Mutex<HashMap<String, (bool, Option<String>)>>,
    last_activity: Mutex<Option<Activity>>,
    dirty: AtomicBool,
}

impl Inner {
    /// Creates the engine state, loading identity and group from disk.
    pub fn new(host: Box<dyn Host>) -> Arc<Self> {
        let store_path = super::store::store_path(&host.data_dir());
        let store = SyncStore::load(&store_path);
        let cipher = store.group_key_bytes().map(|k| FrameCipher::for_group(&k));
        let history_path = host.data_dir().join("share_history.json");
        let history = load_share_history(&history_path);
        Arc::new(Self {
            host,
            store_path,
            history_path,
            store: Mutex::new(store),
            cipher: Mutex::new(cipher),
            links: Mutex::new(HashMap::new()),
            next_link: AtomicU64::new(1),
            peers: Mutex::new(HashMap::new()),
            seen: Mutex::new(Seen::default()),
            incoming: Mutex::new(HashMap::new()),
            outgoing: Mutex::new(HashMap::new()),
            shares: Mutex::new(history),
            outbox: Mutex::new(Default::default()),
            io_tx: Mutex::new(None),
            pairing: Mutex::new(None),
            tasks: Mutex::new(Vec::new()),
            mdns: Mutex::new(None),
            discovered: Mutex::new(HashMap::new()),
            lan_connecting: Mutex::new(HashSet::new()),
            lan: Mutex::new(ServiceStatus::new("off", None)),
            lan_port: Mutex::new(None),
            tunnel: Mutex::new(ServiceStatus::new("off", None)),
            tunnel_url: Mutex::new(None),
            relay: Mutex::new(ServiceStatus::new("off", None)),
            url_states: Mutex::new(HashMap::new()),
            last_activity: Mutex::new(None),
            dirty: AtomicBool::new(true),
        })
    }

    pub fn config(&self) -> SyncConfig {
        self.store.lock().unwrap().config.clone()
    }

    pub fn device(&self) -> (String, String) {
        let s = self.store.lock().unwrap();
        (s.device_id.clone(), s.device_name.clone())
    }

    pub fn group_key(&self) -> Option<[u8; 32]> {
        self.store.lock().unwrap().group_key_bytes()
    }

    /// Mutates and persists the store.
    pub fn update_store<R>(&self, f: impl FnOnce(&mut SyncStore) -> R) -> R {
        let mut s = self.store.lock().unwrap();
        let r = f(&mut s);
        s.save(&self.store_path);
        r
    }

    /// Installs (or clears) the group key and the matching cipher.
    pub fn set_group(&self, key: Option<[u8; 32]>) {
        self.update_store(|s| {
            s.set_group_key(key);
            if key.is_none() {
                s.known_peers.clear();
                s.remote_urls.clear();
            }
        });
        *self.cipher.lock().unwrap() = key.map(|k| FrameCipher::for_group(&k));
        self.mark_dirty();
    }

    pub fn io_config(&self) -> IoConfig {
        let c = self.config();
        IoConfig {
            watch: c.enabled && c.auto_send,
            text: c.sync_text,
            images: c.sync_images,
            files: c.sync_files,
            max_file_bytes: c.max_file_bytes(),
        }
    }

    pub fn send_io(&self, cmd: IoCmd) -> bool {
        match self.io_tx.lock().unwrap().as_ref() {
            Some(tx) => tx.send(cmd).is_ok(),
            None => false,
        }
    }

    pub fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::Relaxed);
    }

    /// Emits the status event if anything changed since the last emit.
    pub fn flush_status(&self) {
        if self.dirty.swap(false, Ordering::Relaxed) {
            self.host.emit_status(&self.status());
        }
    }

    pub fn record_activity(&self, direction: &str, summary: String, peer: String) {
        *self.last_activity.lock().unwrap() = Some(Activity {
            direction: direction.to_string(),
            summary,
            peer,
            at_ms: now_ms() as f64,
        });
        self.mark_dirty();
    }

    pub fn register_link(&self, via: Via, label: String, tx: mpsc::Sender<Out>) -> u64 {
        let id = self.next_link.fetch_add(1, Ordering::Relaxed);
        self.links.lock().unwrap().insert(
            id,
            Link {
                tx,
                via,
                label,
                authed: false,
                peers: HashSet::new(),
            },
        );
        self.mark_dirty();
        id
    }

    pub fn unregister_link(&self, id: u64) {
        let removed = self.links.lock().unwrap().remove(&id);
        if let Some(link) = removed {
            let mut peers = self.peers.lock().unwrap();
            for peer_id in link.peers {
                if let Some(p) = peers.get_mut(&peer_id) {
                    p.links.remove(&id);
                    if p.links.is_empty() {
                        peers.remove(&peer_id);
                    }
                }
            }
        }
        self.mark_dirty();
    }

    pub fn is_peer_connected(&self, device_id: &str) -> bool {
        self.peers.lock().unwrap().contains_key(device_id)
    }

    /// Drops every live link (their tasks notice the closed channel and exit).
    pub fn drop_all_links(&self) {
        self.links.lock().unwrap().clear();
        self.peers.lock().unwrap().clear();
        self.mark_dirty();
    }

    /// Encrypted Hello frame for this device, if it belongs to a group.
    pub fn hello_frame(&self, want_reply: bool) -> Option<Bytes> {
        let (device_id, name) = self.device();
        let addrs = match *self.lan_port.lock().unwrap() {
            Some(port) if self.config().lan => super::discovery::local_addresses(port),
            _ => Vec::new(),
        };
        let msg = Msg::Hello {
            device_id,
            name,
            version: PROTOCOL_VERSION,
            want_reply,
            addrs,
        };
        self.seal(&msg)
    }

    pub fn seal(&self, msg: &Msg) -> Option<Bytes> {
        let cipher = self.cipher.lock().unwrap().clone()?;
        Some(Bytes::from(cipher.seal(&msg.encode())))
    }

    pub fn try_send(&self, link_id: u64, out: Out) {
        let tx = self.links.lock().unwrap().get(&link_id).map(|l| l.tx.clone());
        if let Some(tx) = tx {
            let _ = tx.try_send(out);
        }
    }

    /// Sends a frame to every authenticated link except `except`, with backpressure.
    pub async fn broadcast(&self, frame: Bytes, except: Option<u64>) -> usize {
        let targets: Vec<mpsc::Sender<Out>> = self
            .links
            .lock()
            .unwrap()
            .iter()
            .filter(|(id, l)| l.authed && Some(**id) != except)
            .map(|(_, l)| l.tx.clone())
            .collect();
        let mut sent = 0;
        for tx in targets {
            if tx.send(Out::Frame(frame.clone())).await.is_ok() {
                sent += 1;
            }
        }
        sent
    }

    pub fn authed_link_count(&self) -> usize {
        self.links.lock().unwrap().values().filter(|l| l.authed).count()
    }

    /// Marks a key as seen; returns true if it is new.
    pub fn mark_seen(&self, key: String) -> bool {
        self.seen.lock().unwrap().insert(key)
    }

    /// Root of the shared-files folder (`<app data>/storage`).
    pub fn storage_dir(&self) -> PathBuf {
        self.host.data_dir().join("storage")
    }

    /// Ids of every device currently connected on some link.
    pub fn connected_peer_ids(&self) -> Vec<String> {
        self.peers.lock().unwrap().keys().cloned().collect()
    }

    fn peer_name(&self, device_id: &str) -> String {
        if let Some(p) = self.peers.lock().unwrap().get(device_id) {
            return p.name.clone();
        }
        self.store
            .lock()
            .unwrap()
            .known_peers
            .iter()
            .find(|p| p.device_id == device_id)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| "Unknown device".to_string())
    }

    /// Recipients for a local clipboard: None when every device is selected.
    fn clipboard_recipients(&self) -> Result<Option<Vec<String>>, String> {
        let selected: Vec<String> = {
            let s = self.store.lock().unwrap();
            if s.known_peers.iter().all(|p| p.clipboard) {
                return Ok(None);
            }
            s.known_peers
                .iter()
                .filter(|p| p.clipboard)
                .map(|p| p.device_id.clone())
                .collect()
        };
        if !selected.iter().any(|id| self.is_peer_connected(id)) {
            return Err("None of the devices selected for clipboard sync is connected".to_string());
        }
        Ok(Some(selected))
    }

    /// Sends a small frame to every authenticated link without waiting for queue space.
    fn broadcast_now(&self, frame: Bytes) {
        for link in self.links.lock().unwrap().values().filter(|l| l.authed) {
            let _ = link.tx.try_send(Out::Frame(frame.clone()));
        }
    }

    fn push_share(&self, record: ShareRecord) {
        let mut shares = self.shares.lock().unwrap();
        shares.push_front(record);
        shares.truncate(SHARE_HISTORY);
        drop(shares);
        self.save_share_history();
        self.mark_dirty();
    }

    fn update_share(&self, id: &str, f: impl FnOnce(&mut ShareRecord)) {
        if let Some(r) = self.shares.lock().unwrap().iter_mut().find(|r| r.id == id) {
            f(r);
        }
        self.save_share_history();
        self.mark_dirty();
    }

    /// Writes the share history atomically so the per-machine file list survives restarts.
    fn save_share_history(&self) {
        let records: Vec<ShareRecord> = self.shares.lock().unwrap().iter().cloned().collect();
        let Ok(json) = serde_json::to_vec(&records) else { return };
        if let Some(dir) = self.history_path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = self.history_path.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() && std::fs::rename(&tmp, &self.history_path).is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
    }

    /// True if `path` is one of the files in the share history (the only paths the UI may open).
    pub fn is_shared_path(&self, path: &str) -> bool {
        let wanted = std::path::Path::new(path);
        self.shares
            .lock()
            .unwrap()
            .iter()
            .flat_map(|r| r.paths.iter())
            .any(|p| paths_equal(std::path::Path::new(p), wanted))
    }

    /// Full status snapshot for the UI.
    pub fn status(&self) -> SyncStatus {
        let (config, device_id, device_name, key, known, urls) = {
            let s = self.store.lock().unwrap();
            (
                s.config.clone(),
                s.device_id.clone(),
                s.device_name.clone(),
                s.group_key_bytes(),
                s.known_peers.clone(),
                s.remote_urls.clone(),
            )
        };
        let fingerprint = key.as_ref().map(crypto::group_fingerprint);

        let live: HashMap<String, (String, Vec<Via>)> = {
            let links = self.links.lock().unwrap();
            self.peers
                .lock()
                .unwrap()
                .iter()
                .map(|(id, p)| {
                    let mut via: Vec<Via> =
                        p.links.iter().filter_map(|l| links.get(l).map(|l| l.via)).collect();
                    via.sort_by_key(|v| *v as u8);
                    via.dedup();
                    (id.clone(), (p.name.clone(), via))
                })
                .collect()
        };
        let mut peers: Vec<PeerStatus> = known
            .iter()
            .map(|k| {
                let l = live.get(&k.device_id);
                PeerStatus {
                    device_id: k.device_id.clone(),
                    name: l.map(|l| l.0.clone()).unwrap_or_else(|| k.name.clone()),
                    connected: l.is_some(),
                    via: l.map(|l| l.1.clone()).unwrap_or_default(),
                    last_seen_ms: k.last_seen_ms as f64,
                    clipboard: k.clipboard,
                    files: k.files,
                }
            })
            .collect();
        peers.sort_by(|a, b| b.connected.cmp(&a.connected).then(a.name.cmp(&b.name)));

        let discovered = self
            .discovered
            .lock()
            .unwrap()
            .iter()
            .map(|(id, d)| DiscoveredDevice {
                device_id: id.clone(),
                name: d.name.clone(),
                address: d
                    .addrs
                    .first()
                    .map(|a| format!("{}:{}", a, d.port))
                    .unwrap_or_default(),
                same_group: fingerprint.as_deref() == Some(d.fingerprint.as_str()),
            })
            .collect();

        let url_states = self.url_states.lock().unwrap();
        let remote_urls = urls
            .iter()
            .map(|u| {
                let st = url_states.get(u);
                RemoteUrlStatus {
                    url: u.clone(),
                    connected: st.map(|s| s.0).unwrap_or(false),
                    error: st.and_then(|s| s.1.clone()),
                }
            })
            .collect();

        let pairing = self.pairing.lock().unwrap().as_ref().map(|p| PairingInfo {
            pin: p.pin.clone(),
            invite_code: (config.relay && !config.relay_url.trim().is_empty())
                .then(|| format!("{}-{}", p.room, p.pin)),
            expires_ms: p.expires_ms as f64,
        });

        let mut transfers: Vec<TransferStatus> = self
            .incoming
            .lock()
            .unwrap()
            .iter()
            .map(|(id, t)| TransferStatus {
                id: id.clone(),
                direction: "in".to_string(),
                kind: match t.kind {
                    IncomingKind::Clip => "clipboard",
                    IncomingKind::Share { .. } => "share",
                }
                .to_string(),
                summary: t.summary.clone(),
                peer: t.peer.clone(),
                received: t.received as f64,
                total: t.total as f64,
            })
            .collect();
        transfers.extend(self.outgoing.lock().unwrap().iter().map(|(id, t)| TransferStatus {
            id: id.clone(),
            direction: "out".to_string(),
            kind: t.kind.to_string(),
            summary: t.summary.clone(),
            peer: t.peer.clone(),
            received: t.lanes.iter().copied().min().unwrap_or(0) as f64,
            total: t.total as f64,
        }));
        let shares = self.shares.lock().unwrap().iter().cloned().collect();

        let lan_addresses = match *self.lan_port.lock().unwrap() {
            Some(port) if config.lan => super::discovery::local_addresses(port),
            _ => Vec::new(),
        };

        SyncStatus {
            config,
            device_id,
            device_name,
            in_group: key.is_some(),
            group_fingerprint: fingerprint,
            peers,
            discovered,
            lan: self.lan.lock().unwrap().clone(),
            lan_port: *self.lan_port.lock().unwrap(),
            lan_addresses,
            tunnel: self.tunnel.lock().unwrap().clone(),
            tunnel_url: self.tunnel_url.lock().unwrap().clone(),
            relay: self.relay.lock().unwrap().clone(),
            remote_urls,
            pairing,
            last_activity: self.last_activity.lock().unwrap().clone(),
            transfers,
            shares,
            storage_dir: self.storage_dir().to_string_lossy().to_string(),
        }
    }

    /// Handles one encrypted frame received on a link.
    pub async fn handle_frame(&self, link_id: u64, frame: &[u8]) {
        let Some(cipher) = self.cipher.lock().unwrap().clone() else {
            return;
        };
        let Some(plain) = cipher.open(frame) else {
            log::debug!("[clipboard-sync] dropping undecryptable frame on link {}", link_id);
            return;
        };
        let Some(msg) = Msg::decode(&plain) else {
            log::warn!("[clipboard-sync] dropping malformed message on link {}", link_id);
            return;
        };
        let (my_id, _) = self.device();

        match msg {
            Msg::Hello {
                device_id,
                name,
                version,
                want_reply,
                addrs,
            } => {
                if device_id == my_id {
                    return;
                }
                if version != PROTOCOL_VERSION {
                    log::warn!(
                        "[clipboard-sync] {} speaks protocol v{} (we speak v{})",
                        name,
                        version,
                        PROTOCOL_VERSION
                    );
                }
                self.on_hello(link_id, &device_id, &name, addrs);
                if want_reply {
                    if let Some(hello) = self.hello_frame(false) {
                        self.try_send(link_id, Out::Frame(hello));
                    }
                }
            }
            Msg::Bye { device_id } => {
                let mut links = self.links.lock().unwrap();
                if let Some(l) = links.get_mut(&link_id) {
                    l.peers.remove(&device_id);
                }
                drop(links);
                let mut peers = self.peers.lock().unwrap();
                if let Some(p) = peers.get_mut(&device_id) {
                    p.links.remove(&link_id);
                    if p.links.is_empty() {
                        peers.remove(&device_id);
                    }
                }
                self.mark_dirty();
            }
            Msg::ShareData {
                share_id,
                file_index,
                offset,
                compressed,
                data,
            } => self.on_share_data(&share_id, file_index, offset, compressed, data),
            // Shares go straight to each recipient's link, so they are never forwarded.
            Msg::Share(share) => {
                if share.origin != my_id && self.mark_seen(format!("share:{}", share.id)) {
                    self.on_share(share);
                }
            }
            other => {
                let Some(key) = other.dedupe_key() else { return };
                if !self.mark_seen(key) {
                    return;
                }
                // Forward the original frame untouched so hubs/relays reach everyone.
                self.broadcast(Bytes::copy_from_slice(frame), Some(link_id)).await;
                match other {
                    Msg::Clip(clip) if clip.origin != my_id => self.on_remote_clip(clip),
                    Msg::Chunk {
                        clip_id,
                        file_index,
                        offset,
                        data,
                    } => self.on_chunk(&clip_id, file_index, offset, &data),
                    Msg::ShareAck { share_id, name, .. } => self.on_share_ack(&share_id, &name),
                    _ => {}
                }
            }
        }
    }

    fn on_hello(&self, link_id: u64, device_id: &str, name: &str, addrs: Vec<String>) {
        {
            let mut links = self.links.lock().unwrap();
            let Some(link) = links.get_mut(&link_id) else { return };
            link.authed = true;
            link.peers.insert(device_id.to_string());
        }
        self.peers
            .lock()
            .unwrap()
            .entry(device_id.to_string())
            .or_insert_with(|| PeerLive {
                name: name.to_string(),
                links: HashSet::new(),
            })
            .links
            .insert(link_id);
        if let Some(p) = self.peers.lock().unwrap().get_mut(device_id) {
            p.name = name.to_string();
        }
        self.update_store(|s| {
            s.remember_peer(device_id, name, now_ms());
            if !addrs.is_empty() {
                if let Some(p) = s.known_peers.iter_mut().find(|p| p.device_id == device_id) {
                    p.addrs = addrs;
                }
            }
        });
        log::info!("[clipboard-sync] connected to {} on link {}", name, link_id);
        self.mark_dirty();
    }

    fn on_remote_clip(&self, clip: ClipMsg) {
        let (my_id, _) = self.device();
        if clip.to.as_ref().is_some_and(|to| !to.contains(&my_id)) {
            return;
        }
        if !self.store.lock().unwrap().clipboard_allowed(&clip.origin) {
            return;
        }
        let config = self.config();
        let summary = clip.content.summary();
        let peer = clip.origin_name.clone();
        match clip.content {
            ClipContent::Text { text } => {
                if !config.sync_text {
                    return;
                }
                self.send_io(IoCmd::Apply(ApplyContent::Text(text)));
                self.record_activity("received", summary, peer);
            }
            ClipContent::Image { png, .. } => {
                if !config.sync_images {
                    return;
                }
                self.send_io(IoCmd::Apply(ApplyContent::Image { png }));
                self.record_activity("received", summary, peer);
            }
            ClipContent::Files { files } => {
                if !config.sync_files {
                    return;
                }
                let total: u64 = files.iter().map(|f| f.size).sum();
                if total > config.max_file_bytes() {
                    self.record_activity(
                        "skipped",
                        format!("{} (over this device's size limit)", summary),
                        peer,
                    );
                    return;
                }
                match self.prepare_incoming(&clip.id, &files, total, &peer, &summary) {
                    Ok(true) => self.finish_incoming(&clip.id),
                    Ok(false) => {}
                    Err(e) => log::error!("[clipboard-sync] cannot receive files: {}", e),
                }
            }
        }
    }

    /// Creates the destination folder and empty files; returns true if already complete (all empty).
    fn prepare_incoming(
        &self,
        clip_id: &str,
        files: &[super::protocol::FileMeta],
        total: u64,
        peer: &str,
        summary: &str,
    ) -> Result<bool, String> {
        let base = self.host.download_dir().join("Babbl Clipboard");
        let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
        let short: String = clip_id.chars().take(6).collect();
        let dir = base.join(format!("{}_{}", stamp, short));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let mut used = HashSet::new();
        let mut entries = Vec::with_capacity(files.len());
        for meta in files {
            let mut name = sanitize_file_name(&meta.name);
            while !used.insert(name.to_lowercase()) {
                name = format!("_{}", name);
            }
            let path = dir.join(&name);
            let file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
            entries.push(IncomingFile {
                path,
                final_path: None,
                file: Some(file),
                size: meta.size,
                received: 0,
            });
        }
        self.incoming.lock().unwrap().insert(
            clip_id.to_string(),
            Incoming {
                kind: IncomingKind::Clip,
                dir,
                files: entries,
                total,
                received: 0,
                peer: peer.to_string(),
                summary: summary.to_string(),
                last_progress_ms: now_ms(),
            },
        );
        self.mark_dirty();
        Ok(total == 0)
    }

    fn on_chunk(&self, clip_id: &str, file_index: u32, offset: u64, data: &[u8]) {
        let complete = {
            let mut incoming = self.incoming.lock().unwrap();
            let Some(t) = incoming.get_mut(clip_id) else { return };
            let Some(f) = t.files.get_mut(file_index as usize) else { return };
            if offset + data.len() as u64 > f.size {
                log::warn!("[clipboard-sync] chunk beyond announced file size; ignoring");
                return;
            }
            let Some(file) = f.file.as_mut() else { return };
            let write = file.seek(SeekFrom::Start(offset)).and_then(|_| file.write_all(data));
            if let Err(e) = write {
                log::error!("[clipboard-sync] failed writing received file: {}", e);
                return;
            }
            f.received += data.len() as u64;
            t.received += data.len() as u64;
            t.last_progress_ms = now_ms();
            t.files.iter().all(|f| f.received >= f.size)
        };
        self.mark_dirty();
        if complete {
            self.finish_incoming(clip_id);
        }
    }

    /// Unpacks one direct share chunk (optionally zstd-compressed) and writes it.
    fn on_share_data(&self, share_id: &str, file_index: u32, offset: u64, compressed: bool, data: Vec<u8>) {
        if !self.incoming.lock().unwrap().contains_key(share_id) {
            return;
        }
        let data = if compressed {
            // The size cap stops a malicious frame from inflating into gigabytes.
            match zstd::bulk::decompress(&data, super::protocol::SHARE_CHUNK_SIZE) {
                Ok(raw) => raw,
                Err(e) => {
                    log::warn!("[clipboard-sync] dropping undecodable share chunk: {}", e);
                    return;
                }
            }
        } else {
            data
        };
        self.on_chunk(share_id, file_index, offset, &data);
    }

    fn finish_incoming(&self, clip_id: &str) {
        let Some(t) = self.incoming.lock().unwrap().remove(clip_id) else { return };
        let paths: Vec<PathBuf> = t
            .files
            .into_iter()
            .map(|f| {
                drop(f.file);
                match f.final_path {
                    Some(final_path) => match std::fs::rename(&f.path, &final_path) {
                        Ok(()) => final_path,
                        Err(e) => {
                            log::error!("[clipboard-sync] cannot finalize {:?}: {}", final_path, e);
                            f.path
                        }
                    },
                    None => f.path,
                }
            })
            .collect();
        log::info!(
            "[clipboard-sync] received {} file(s) from {} into {:?}",
            paths.len(),
            t.peer,
            t.dir
        );
        match t.kind {
            IncomingKind::Clip => {
                self.send_io(IoCmd::Apply(ApplyContent::Files(paths)));
            }
            IncomingKind::Share { origin_id, origin_name } => {
                let record = ShareRecord {
                    id: clip_id.to_string(),
                    direction: "received".to_string(),
                    summary: t.summary.clone(),
                    files: paths
                        .iter()
                        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
                        .collect(),
                    paths: paths.iter().map(|p| p.to_string_lossy().to_string()).collect(),
                    peers: vec![origin_name],
                    peer_ids: vec![origin_id],
                    delivered_to: Vec::new(),
                    state: "received".to_string(),
                    error: None,
                    folder: Some(t.dir.to_string_lossy().to_string()),
                    at_ms: now_ms() as f64,
                };
                self.host.emit_share_received(&record);
                self.push_share(record);
                let (device_id, name) = self.device();
                let ack = Msg::ShareAck {
                    share_id: clip_id.to_string(),
                    device_id,
                    name,
                };
                self.mark_seen(ack.dedupe_key().unwrap_or_default());
                if let Some(frame) = self.seal(&ack) {
                    self.broadcast_now(frame);
                }
            }
        }
        self.record_activity("received", t.summary, t.peer);
    }

    /// Drops transfers that stopped making progress (sender went away) and deletes partial files.
    pub fn cleanup_stale_transfers(&self) {
        let now = now_ms();
        let stale: Vec<Incoming> = {
            let mut incoming = self.incoming.lock().unwrap();
            let ids: Vec<String> = incoming
                .iter()
                .filter(|(_, t)| now.saturating_sub(t.last_progress_ms) > STALE_TRANSFER_MS)
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter().filter_map(|id| incoming.remove(&id)).collect()
        };
        for t in stale {
            log::warn!("[clipboard-sync] abandoning stalled transfer from {}", t.peer);
            let paths: Vec<PathBuf> = t
                .files
                .into_iter()
                .map(|f| {
                    drop(f.file);
                    f.path
                })
                .collect();
            match t.kind {
                IncomingKind::Clip => {
                    let _ = std::fs::remove_dir_all(&t.dir);
                }
                IncomingKind::Share { .. } => {
                    for p in &paths {
                        let _ = std::fs::remove_file(p);
                    }
                }
            }
            self.mark_dirty();
        }
    }

    /// Creates `.babblpart` files for a share addressed to this device.
    fn on_share(&self, share: ShareMsg) {
        let (my_id, _) = self.device();
        if !share.to.contains(&my_id) {
            return;
        }
        if !self.store.lock().unwrap().files_allowed(&share.origin) {
            log::info!("[clipboard-sync] ignoring files from {} (file sharing off)", share.origin_name);
            return;
        }
        let summary = ClipContent::Files {
            files: share.files.clone(),
        }
        .summary();
        let dir = self
            .storage_dir()
            .join("Received")
            .join(sanitize_file_name(&share.origin_name));
        if let Err(e) = std::fs::create_dir_all(&dir) {
            log::error!("[clipboard-sync] cannot create {:?}: {}", dir, e);
            return;
        }
        let mut used = HashSet::new();
        let mut entries: Vec<IncomingFile> = Vec::with_capacity(share.files.len());
        for meta in &share.files {
            let final_path = unique_path(&dir, &sanitize_file_name(&meta.name), &mut used);
            let mut part = final_path.clone().into_os_string();
            part.push(PART_SUFFIX);
            let part = PathBuf::from(part);
            let file = match std::fs::File::create(&part) {
                Ok(file) => file,
                Err(e) => {
                    log::error!("[clipboard-sync] cannot create {:?}: {}", part, e);
                    for f in entries {
                        drop(f.file);
                        let _ = std::fs::remove_file(&f.path);
                    }
                    return;
                }
            };
            entries.push(IncomingFile {
                path: part,
                final_path: Some(final_path),
                file: Some(file),
                size: meta.size,
                received: 0,
            });
        }
        let total: u64 = share.files.iter().map(|f| f.size).sum();
        self.incoming.lock().unwrap().insert(
            share.id.clone(),
            Incoming {
                kind: IncomingKind::Share {
                    origin_id: share.origin.clone(),
                    origin_name: share.origin_name.clone(),
                },
                dir,
                files: entries,
                total,
                received: 0,
                peer: share.origin_name.clone(),
                summary,
                last_progress_ms: now_ms(),
            },
        );
        self.mark_dirty();
        if total == 0 {
            self.finish_incoming(&share.id);
        }
    }

    fn on_share_ack(&self, share_id: &str, name: &str) {
        self.update_share(share_id, |r| {
            if r.direction != "sent" {
                return;
            }
            if !r.delivered_to.iter().any(|n| n == name) {
                r.delivered_to.push(name.to_string());
            }
            if r.delivered_to.len() >= r.peer_ids.len() {
                r.state = "delivered".to_string();
            }
        });
    }

    /// Sends a local clipboard item to the devices selected for clipboard sync.
    pub async fn send_local(&self, clip: super::clip_io::LocalClip) -> Result<String, String> {
        use super::clip_io::LocalClip;

        if self.authed_link_count() == 0 {
            return Err("No connected devices".to_string());
        }
        let to = self.clipboard_recipients()?;
        let (my_id, my_name) = self.device();
        let id = uuid::Uuid::new_v4().to_string();
        let (content, paths) = match clip {
            LocalClip::Text(text) => (ClipContent::Text { text }, Vec::new()),
            LocalClip::Image { png, width, height } => {
                (ClipContent::Image { png, width, height }, Vec::new())
            }
            LocalClip::Files { paths, .. } => {
                let files = paths.iter().map(|p| file_meta(p)).collect();
                (ClipContent::Files { files }, paths)
            }
        };
        let summary = content.summary();
        let total: u64 = match &content {
            ClipContent::Files { files } => files.iter().map(|f| f.size).sum(),
            _ => 0,
        };
        let msg = Msg::Clip(ClipMsg {
            id: id.clone(),
            origin: my_id,
            origin_name: my_name,
            created_ms: now_ms(),
            content,
            to,
        });
        self.mark_seen(msg.dedupe_key().unwrap_or_default());
        let frame = self.seal(&msg).ok_or("This device is not in a sync group")?;
        let reached = self.broadcast(frame, None).await;

        if !paths.is_empty() {
            self.outgoing.lock().unwrap().insert(
                id.clone(),
                Outgoing {
                    kind: "clipboard",
                    summary: summary.clone(),
                    peer: String::new(),
                    lanes: vec![0],
                    total,
                },
            );
            let result = self.stream_files(&id, &paths).await;
            self.outgoing.lock().unwrap().remove(&id);
            self.mark_dirty();
            result?;
        }
        let peers = format!("{} link(s)", reached);
        self.record_activity("sent", summary.clone(), peers);
        Ok(summary)
    }

    /// Streams file contents as chunks for transfer `id`, updating its outgoing progress.
    async fn stream_files(&self, id: &str, paths: &[PathBuf]) -> Result<(), String> {
        use super::protocol::FILE_CHUNK_SIZE;
        use tokio::io::AsyncReadExt;

        for (index, path) in paths.iter().enumerate() {
            let mut file = tokio::fs::File::open(path)
                .await
                .map_err(|e| format!("cannot read {:?}: {}", path, e))?;
            let mut offset = 0u64;
            let mut buf = vec![0u8; FILE_CHUNK_SIZE];
            loop {
                let n = file.read(&mut buf).await.map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                let chunk = Msg::Chunk {
                    clip_id: id.to_string(),
                    file_index: index as u32,
                    offset,
                    data: buf[..n].to_vec(),
                };
                self.mark_seen(chunk.dedupe_key().unwrap_or_default());
                let frame = self.seal(&chunk).ok_or("This device is not in a sync group")?;
                if self.broadcast(frame, None).await == 0 {
                    return Err("Lost connection to all devices".to_string());
                }
                offset += n as u64;
                if let Some(o) = self.outgoing.lock().unwrap().get_mut(id) {
                    if let Some(lane) = o.lanes.first_mut() {
                        *lane += n as u64;
                    }
                }
                self.mark_dirty();
            }
        }
        Ok(())
    }

    /// Validates a share, records it as "sending" and returns it ready to stream.
    pub fn prepare_share(&self, paths: Vec<PathBuf>, recipients: Vec<String>) -> Result<PreparedShare, String> {
        if self.group_key().is_none() {
            return Err("Pair a device first".to_string());
        }
        if paths.is_empty() {
            return Err("No files selected".to_string());
        }
        for p in &paths {
            let meta = std::fs::metadata(p).map_err(|e| format!("cannot read {:?}: {}", p, e))?;
            if !meta.is_file() {
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                return Err(format!("\"{}\" is a folder; only files can be shared (zip it first)", name));
            }
        }
        let mut to: Vec<String> = Vec::new();
        let mut blocked = false;
        for id in recipients {
            if !self.store.lock().unwrap().files_allowed(&id) {
                blocked = true;
                continue;
            }
            if !to.contains(&id) && self.is_peer_connected(&id) {
                to.push(id);
            }
        }
        if to.is_empty() {
            return Err(if blocked {
                "File sharing is turned off for the selected device".to_string()
            } else {
                "None of the selected devices is online".to_string()
            });
        }
        let files: Vec<FileMeta> = paths.iter().map(|p| file_meta(p)).collect();
        let total: u64 = files.iter().map(|f| f.size).sum();
        let summary = ClipContent::Files { files: files.clone() }.summary();
        let names: Vec<String> = to.iter().map(|id| self.peer_name(id)).collect();
        let (my_id, my_name) = self.device();
        let id = uuid::Uuid::new_v4().to_string();

        self.push_share(ShareRecord {
            id: id.clone(),
            direction: "sent".to_string(),
            summary: summary.clone(),
            files: files.iter().map(|f| f.name.clone()).collect(),
            paths: paths.iter().map(|p| p.to_string_lossy().to_string()).collect(),
            peers: names.clone(),
            peer_ids: to.clone(),
            delivered_to: Vec::new(),
            state: "sending".to_string(),
            error: None,
            folder: None,
            at_ms: now_ms() as f64,
        });
        self.outgoing.lock().unwrap().insert(
            id.clone(),
            Outgoing {
                kind: "share",
                summary: summary.clone(),
                peer: names.join(", "),
                lanes: vec![0],
                total,
            },
        );
        let msg = Msg::Share(ShareMsg {
            id: id.clone(),
            origin: my_id,
            origin_name: my_name,
            created_ms: now_ms(),
            to,
            files,
        });
        Ok(PreparedShare {
            id,
            summary,
            msg,
            paths,
        })
    }

    /// Announces and streams a prepared share; the record ends as "sent" or "failed".
    pub async fn run_share(&self, share: PreparedShare) -> Result<(), String> {
        let result = async {
            let to = match &share.msg {
                Msg::Share(s) => s.to.clone(),
                _ => Vec::new(),
            };
            let routes = self.share_routes(&to);
            if routes.is_empty() {
                return Err("None of the selected devices is online".to_string());
            }
            if let Some(o) = self.outgoing.lock().unwrap().get_mut(&share.id) {
                o.lanes = vec![0; routes.len()];
            }
            self.mark_seen(format!("share:{}", share.id));
            let header = self.seal(&share.msg).ok_or("This device is not in a sync group")?;
            // One independent stream per link, so a slow relay never holds back a LAN peer.
            let results = futures_util::future::join_all(
                routes
                    .iter()
                    .enumerate()
                    .map(|(lane, (link, via))| self.stream_share(*link, *via, lane, &share, header.clone())),
            )
            .await;
            let failures: Vec<String> = results.into_iter().filter_map(Result::err).collect();
            match failures.first() {
                None => Ok(()),
                Some(first) if failures.len() == routes.len() => Err(first.clone()),
                Some(_) => Err(format!("Some devices did not get it: {}", failures.join("; "))),
            }
        }
        .await;
        let peer = self
            .outgoing
            .lock()
            .unwrap()
            .remove(&share.id)
            .map(|o| o.peer)
            .unwrap_or_default();
        match &result {
            Ok(()) => {
                self.update_share(&share.id, |r| {
                    if r.state == "sending" {
                        r.state = "sent".to_string();
                    }
                });
                self.record_activity("shared", share.summary.clone(), peer);
            }
            Err(e) => {
                log::warn!("[clipboard-sync] share {} failed: {}", share.id, e);
                self.update_share(&share.id, |r| {
                    r.state = "failed".to_string();
                    r.error = Some(e.clone());
                });
            }
        }
        result
    }

    /// Picks the fastest direct link to each recipient (LAN first, relay last); one entry per link.
    pub(crate) fn share_routes(&self, to: &[String]) -> Vec<(u64, Via)> {
        let links = self.links.lock().unwrap();
        let peers = self.peers.lock().unwrap();
        let mut routes: Vec<(u64, Via)> = Vec::new();
        for id in to {
            let Some(peer) = peers.get(id) else { continue };
            let best = peer
                .links
                .iter()
                .filter_map(|l| links.get(l).filter(|x| x.authed).map(|x| (*l, x.via)))
                .min_by_key(|(_, via)| via_rank(*via));
            if let Some(route) = best {
                if !routes.iter().any(|r| r.0 == route.0) {
                    routes.push(route);
                }
            }
        }
        routes
    }

    /// Streams every file of a share over one link: reads, compresses and encrypts chunks in
    /// parallel on blocking threads while earlier chunks are on the wire.
    async fn stream_share(
        &self,
        link_id: u64,
        via: Via,
        lane: usize,
        share: &PreparedShare,
        header: Bytes,
    ) -> Result<(), String> {
        use futures_util::StreamExt;

        let lost = || "Lost connection to the device".to_string();
        let tx = self
            .links
            .lock()
            .unwrap()
            .get(&link_id)
            .map(|l| l.tx.clone())
            .ok_or_else(lost)?;
        let cipher = self.cipher.lock().unwrap().clone().ok_or("This device is not in a sync group")?;
        tx.send(Out::Frame(header)).await.map_err(|_| lost())?;
        // Relay bandwidth is scarce and paced, so spend more CPU on compression there.
        let level = if via == Via::Relay { 3 } else { 1 };
        let sizes: Vec<u64> = match &share.msg {
            Msg::Share(s) => s.files.iter().map(|f| f.size).collect(),
            _ => Vec::new(),
        };

        for (index, path) in share.paths.iter().enumerate() {
            let (raw_tx, raw_rx) = mpsc::channel::<std::io::Result<(u64, Vec<u8>)>>(PIPELINE_DEPTH);
            let reader = {
                let path = path.clone();
                let size = sizes.get(index).copied().unwrap_or(u64::MAX);
                tokio::task::spawn_blocking(move || read_chunks(&path, size, raw_tx))
            };
            let probe = Arc::new(CompressProbe::default());
            let frames = futures_util::stream::unfold(raw_rx, |mut rx| async move {
                rx.recv().await.map(|item| (item, rx))
            })
            .map(|item| {
                let cipher = cipher.clone();
                let probe = probe.clone();
                let share_id = share.id.clone();
                tokio::task::spawn_blocking(move || -> Result<(Bytes, u64), String> {
                    let (offset, raw) = item.map_err(|e| format!("cannot read file: {}", e))?;
                    let raw_len = raw.len() as u64;
                    let (compressed, data) = probe.pack(raw, level);
                    let msg = Msg::ShareData {
                        share_id,
                        file_index: index as u32,
                        offset,
                        compressed,
                        data,
                    };
                    Ok((Bytes::from(cipher.seal(&msg.encode())), raw_len))
                })
            })
            .buffered(PIPELINE_DEPTH);
            futures_util::pin_mut!(frames);
            while let Some(joined) = frames.next().await {
                let (frame, raw_len) = joined.map_err(|e| e.to_string())??;
                tx.send(Out::Frame(frame)).await.map_err(|_| lost())?;
                if let Some(o) = self.outgoing.lock().unwrap().get_mut(&share.id) {
                    if let Some(l) = o.lanes.get_mut(lane) {
                        *l += raw_len;
                    }
                }
                self.mark_dirty();
            }
            let _ = reader.await;
        }
        Ok(())
    }

    /// Updates whether clipboards are exchanged with a paired device.
    /// Clears finished entries from the share history, optionally only those with one machine.
    pub fn clear_share_history(&self, device_id: Option<&str>) {
        self.shares.lock().unwrap().retain(|r| {
            r.state == "sending" || device_id.is_some_and(|d| !r.peer_ids.iter().any(|p| p == d))
        });
        self.save_share_history();
        self.mark_dirty();
    }

    /// Updates whether clipboards are exchanged with a paired device.
    pub fn set_peer_clipboard(&self, device_id: &str, enabled: bool) {
        self.update_store(|s| {
            if let Some(p) = s.known_peers.iter_mut().find(|p| p.device_id == device_id) {
                p.clipboard = enabled;
            }
        });
        self.mark_dirty();
    }

    /// Updates whether files are shared with a paired device (both directions).
    pub fn set_peer_files(&self, device_id: &str, enabled: bool) {
        self.update_store(|s| {
            if let Some(p) = s.known_peers.iter_mut().find(|p| p.device_id == device_id) {
                p.files = enabled;
            }
        });
        self.mark_dirty();
    }
}

/// Chunks read/compressed/encrypted ahead of the socket, per link.
const PIPELINE_DEPTH: usize = 4;
/// Incompressible files are re-probed this often so mixed content still benefits.
const REPROBE_EVERY: u32 = 64;

fn via_rank(via: Via) -> u8 {
    match via {
        Via::Lan => 0,
        Via::Url => 1,
        Via::Tunnel => 2,
        Via::Relay => 3,
    }
}

/// Reads up to `size` bytes of `path` in share-sized chunks and feeds them to the pipeline.
fn read_chunks(path: &std::path::Path, size: u64, tx: mpsc::Sender<std::io::Result<(u64, Vec<u8>)>>) {
    use std::io::Read;
    use super::protocol::SHARE_CHUNK_SIZE;

    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            let _ = tx.blocking_send(Err(e));
            return;
        }
    };
    // The receiver only accepts the size announced up front, even if the file grows meanwhile.
    let mut file = file.take(size);
    let mut offset = 0u64;
    loop {
        let mut buf = vec![0u8; SHARE_CHUNK_SIZE];
        let mut filled = 0;
        while filled < buf.len() {
            match file.read(&mut buf[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => {
                    let _ = tx.blocking_send(Err(e));
                    return;
                }
            }
        }
        if filled == 0 {
            return;
        }
        buf.truncate(filled);
        if tx.blocking_send(Ok((offset, buf))).is_err() {
            return;
        }
        offset += filled as u64;
    }
}

/// Per-file compression decision: keep compressing while it saves space, back off otherwise.
#[derive(Default)]
struct CompressProbe {
    chunks: std::sync::atomic::AtomicU32,
    tried: std::sync::atomic::AtomicU32,
    won: std::sync::atomic::AtomicU32,
}

impl CompressProbe {
    /// Returns `(compressed, bytes)` for one chunk.
    fn pack(&self, raw: Vec<u8>, level: i32) -> (bool, Vec<u8>) {
        let n = self.chunks.fetch_add(1, Ordering::Relaxed);
        let tried = self.tried.load(Ordering::Relaxed);
        let won = self.won.load(Ordering::Relaxed);
        let promising = tried < 4 || won * 4 >= tried;
        if !promising && n % REPROBE_EVERY != 0 {
            return (false, raw);
        }
        self.tried.fetch_add(1, Ordering::Relaxed);
        match zstd::bulk::compress(&raw, level) {
            Ok(packed) if packed.len() < raw.len() / 100 * 95 => {
                self.won.fetch_add(1, Ordering::Relaxed);
                (true, packed)
            }
            _ => (false, raw),
        }
    }
}

/// Loads saved share history; transfers that were mid-flight when Babbl quit become "failed".
fn load_share_history(path: &std::path::Path) -> VecDeque<ShareRecord> {
    let mut records: Vec<ShareRecord> = std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    for r in records.iter_mut().filter(|r| r.state == "sending") {
        r.state = "failed".to_string();
        r.error = Some("Babbl was closed during the transfer".to_string());
    }
    records.truncate(SHARE_HISTORY);
    records.into()
}

/// Compares paths the way the OS does (case-insensitive on Windows).
fn paths_equal(a: &std::path::Path, b: &std::path::Path) -> bool {
    if cfg!(windows) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

fn file_meta(path: &std::path::Path) -> FileMeta {
    FileMeta {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string()),
        size: path.metadata().map(|m| m.len()).unwrap_or(0),
    }
}

/// Picks `name`, or `name (1)`, `name (2)`… so nothing in `dir` (or already chosen) is overwritten.
pub(crate) fn unique_path(dir: &std::path::Path, name: &str, used: &mut HashSet<String>) -> PathBuf {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut n = 0u32;
    loop {
        let candidate = if n == 0 {
            name.to_string()
        } else {
            format!("{} ({}){}", stem, n, ext)
        };
        let path = dir.join(&candidate);
        let part = dir.join(format!("{}{}", candidate, PART_SUFFIX));
        if !path.exists() && !part.exists() && used.insert(candidate.to_lowercase()) {
            return path;
        }
        n += 1;
    }
}

/// Makes a received file name safe to create inside our download folder.
pub(crate) fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "file".to_string()
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use super::sanitize_file_name;

    #[test]
    fn file_names_cannot_escape_folder() {
        assert_eq!(sanitize_file_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(sanitize_file_name("C:\\Windows\\x.dll"), "C__Windows_x.dll");
        assert_eq!(sanitize_file_name(".."), "file");
        assert_eq!(sanitize_file_name("report.pdf"), "report.pdf");
    }
}
