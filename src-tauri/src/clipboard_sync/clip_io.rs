//! Owns the OS clipboard on a dedicated thread: detects local copies and applies remote ones.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

use super::protocol::MAX_INLINE_IMAGE_BYTES;

const POLL_INTERVAL: Duration = Duration::from_millis(350);
/// On platforms without a change counter, images are only re-read every Nth poll (they're big).
#[cfg(not(target_os = "windows"))]
const IMAGE_POLL_EVERY: u32 = 3;

static SUPPRESS_UNTIL_MS: AtomicU64 = AtomicU64::new(0);

/// Current wall-clock time in milliseconds.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Ignores clipboard changes for a while (Babbl's own paste / selection capture, remote applies).
pub fn suppress_for(duration: Duration) {
    let until = now_ms() + duration.as_millis() as u64;
    SUPPRESS_UNTIL_MS.fetch_max(until, Ordering::Relaxed);
}

fn suppressed() -> bool {
    now_ms() < SUPPRESS_UNTIL_MS.load(Ordering::Relaxed)
}

#[derive(Debug, Clone)]
pub struct IoConfig {
    pub watch: bool,
    pub text: bool,
    pub images: bool,
    pub files: bool,
    pub max_file_bytes: u64,
}

#[derive(Debug, Clone)]
pub enum LocalClip {
    Text(String),
    Image { png: Vec<u8>, width: u32, height: u32 },
    Files { paths: Vec<PathBuf>, total: u64 },
}

pub enum IoEvent {
    Local(LocalClip),
    Skipped(String),
}

pub enum ApplyContent {
    Text(String),
    Image { png: Vec<u8> },
    Files(Vec<PathBuf>),
}

pub enum IoCmd {
    Configure(IoConfig),
    Apply(ApplyContent),
    ReadNow(Sender<Result<LocalClip, String>>),
    Shutdown,
}

/// Spawns the clipboard thread; `on_event` is called from that thread.
pub fn spawn(
    config: IoConfig,
    on_event: impl Fn(IoEvent) + Send + 'static,
) -> std::io::Result<Sender<IoCmd>> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("clipboard-sync-io".into())
        .spawn(move || run(config, rx, on_event))?;
    Ok(tx)
}

fn run(mut config: IoConfig, rx: Receiver<IoCmd>, on_event: impl Fn(IoEvent)) {
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            log::error!("[clipboard-sync] cannot open clipboard: {}", e);
            return;
        }
    };
    let mut watcher = Watcher::default();
    // Whatever is on the clipboard at start-up is not a "new copy".
    watcher.refresh_baseline(&mut clipboard, &config);

    loop {
        match rx.recv_timeout(POLL_INTERVAL) {
            Ok(IoCmd::Configure(c)) => {
                config = c;
                watcher.refresh_baseline(&mut clipboard, &config);
            }
            Ok(IoCmd::Apply(content)) => {
                // Our own write must not bounce back out as a local copy.
                suppress_for(Duration::from_millis(1500));
                if let Err(e) = apply(&mut clipboard, content) {
                    log::warn!("[clipboard-sync] failed to apply remote clipboard: {}", e);
                }
            }
            Ok(IoCmd::ReadNow(reply)) => {
                let result = if is_sensitive() {
                    Err("The clipboard holds content marked private (e.g. a password manager)".to_string())
                } else {
                    read(&mut clipboard, &config, true).and_then(|c| c.ok_or_else(|| "Clipboard is empty or holds an unsupported type".to_string()))
                };
                let _ = reply.send(result);
            }
            Ok(IoCmd::Shutdown) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }

        if !config.watch {
            continue;
        }
        if let Some(event) = watcher.poll(&mut clipboard, &config) {
            on_event(event);
        }
    }
    log::info!("[clipboard-sync] clipboard thread stopped");
}

#[derive(Default)]
struct Watcher {
    last_signature: Option<u64>,
    #[cfg(target_os = "windows")]
    last_sequence: u32,
    #[cfg(not(target_os = "windows"))]
    tick: u32,
}

impl Watcher {
    fn refresh_baseline(&mut self, clipboard: &mut arboard::Clipboard, config: &IoConfig) {
        #[cfg(target_os = "windows")]
        {
            self.last_sequence = sequence_number();
        }
        self.last_signature = signature(clipboard, config, true);
    }

    fn poll(&mut self, clipboard: &mut arboard::Clipboard, config: &IoConfig) -> Option<IoEvent> {
        #[cfg(target_os = "windows")]
        let include_image = {
            let seq = sequence_number();
            if seq == self.last_sequence {
                return None;
            }
            self.last_sequence = seq;
            true
        };
        #[cfg(not(target_os = "windows"))]
        let include_image = {
            self.tick = self.tick.wrapping_add(1);
            self.tick % IMAGE_POLL_EVERY == 0
        };

        let sig = signature(clipboard, config, include_image);
        if sig.is_none() && !include_image {
            // Text/files are empty; an image may be present but isn't checked on this tick.
            return None;
        }
        if sig == self.last_signature {
            return None;
        }
        self.last_signature = sig;
        sig?;

        if suppressed() {
            return None;
        }
        if is_sensitive() {
            log::info!("[clipboard-sync] skipping clipboard content marked private");
            return None;
        }
        match read(clipboard, config, include_image) {
            Ok(Some(clip)) => Some(IoEvent::Local(clip)),
            Ok(None) => None,
            Err(reason) => Some(IoEvent::Skipped(reason)),
        }
    }
}

/// Cheap fingerprint of the current clipboard content (files > text > image).
fn signature(clipboard: &mut arboard::Clipboard, config: &IoConfig, include_image: bool) -> Option<u64> {
    let mut h = DefaultHasher::new();
    if config.files {
        if let Ok(paths) = clipboard.get().file_list() {
            if !paths.is_empty() {
                ("files", paths).hash(&mut h);
                return Some(h.finish());
            }
        }
    }
    if let Ok(text) = clipboard.get_text() {
        if !text.is_empty() {
            ("text", text).hash(&mut h);
            return Some(h.finish());
        }
    }
    if include_image && config.images {
        if let Ok(img) = clipboard.get_image() {
            ("image", img.width, img.height).hash(&mut h);
            // Sampled hash: full hashing of a 4K screenshot every poll would be wasteful.
            let step = (img.bytes.len() / 4096).max(1);
            img.bytes.iter().step_by(step).for_each(|b| b.hash(&mut h));
            return Some(h.finish());
        }
    }
    None
}

/// Reads the clipboard into a sendable clip, honouring content toggles and the file size limit.
fn read(clipboard: &mut arboard::Clipboard, config: &IoConfig, include_image: bool) -> Result<Option<LocalClip>, String> {
    if let Ok(paths) = clipboard.get().file_list() {
        if !paths.is_empty() {
            if !config.files {
                return Ok(None);
            }
            let files: Vec<PathBuf> = paths.into_iter().filter(|p| p.is_file()).collect();
            if files.is_empty() {
                return Err("Folders can't be synced yet — copy the files inside instead".to_string());
            }
            let total: u64 = files
                .iter()
                .map(|p| p.metadata().map(|m| m.len()).unwrap_or(0))
                .sum();
            if total > config.max_file_bytes {
                return Err(format!(
                    "Files not synced: {} exceeds the {} limit",
                    super::protocol::human_size(total),
                    super::protocol::human_size(config.max_file_bytes)
                ));
            }
            return Ok(Some(LocalClip::Files { paths: files, total }));
        }
    }
    if let Ok(text) = clipboard.get_text() {
        if !text.is_empty() {
            return Ok(if config.text { Some(LocalClip::Text(text)) } else { None });
        }
    }
    if include_image && config.images {
        if let Ok(img) = clipboard.get_image() {
            let (width, height) = (img.width as u32, img.height as u32);
            let png = encode_png(width, height, img.bytes.into_owned())?;
            if png.len() > MAX_INLINE_IMAGE_BYTES {
                return Err(format!(
                    "Image not synced: {} is larger than the {} image limit",
                    super::protocol::human_size(png.len() as u64),
                    super::protocol::human_size(MAX_INLINE_IMAGE_BYTES as u64)
                ));
            }
            return Ok(Some(LocalClip::Image { png, width, height }));
        }
    }
    Ok(None)
}

fn encode_png(width: u32, height: u32, rgba: Vec<u8>) -> Result<Vec<u8>, String> {
    let img = image::RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| "clipboard image has an unexpected size".to_string())?;
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| format!("failed to encode image: {}", e))?;
    Ok(out.into_inner())
}

fn apply(clipboard: &mut arboard::Clipboard, content: ApplyContent) -> Result<(), String> {
    match content {
        ApplyContent::Text(text) => clipboard.set_text(text).map_err(|e| e.to_string()),
        ApplyContent::Image { png } => {
            let img = image::load_from_memory_with_format(&png, image::ImageFormat::Png)
                .map_err(|e| format!("invalid image: {}", e))?
                .to_rgba8();
            let (w, h) = img.dimensions();
            clipboard
                .set_image(arboard::ImageData {
                    width: w as usize,
                    height: h as usize,
                    bytes: std::borrow::Cow::Owned(img.into_raw()),
                })
                .map_err(|e| e.to_string())
        }
        ApplyContent::Files(paths) => clipboard.set().file_list(&paths).map_err(|e| e.to_string()),
    }
}

#[cfg(target_os = "windows")]
fn sequence_number() -> u32 {
    unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

/// True when the source app asked clipboard monitors to ignore this content (password managers).
#[cfg(target_os = "windows")]
fn is_sensitive() -> bool {
    use windows::core::w;
    use windows::Win32::System::DataExchange::{IsClipboardFormatAvailable, RegisterClipboardFormatW};
    unsafe {
        [
            w!("ExcludeClipboardContentFromMonitorProcessing"),
            w!("Clipboard Viewer Ignore"),
        ]
        .into_iter()
        .any(|name| {
            let fmt = RegisterClipboardFormatW(name);
            fmt != 0 && IsClipboardFormatAvailable(fmt).is_ok()
        })
    }
}

// Concealed-type detection is not exposed by arboard on macOS/Linux yet.
#[cfg(not(target_os = "windows"))]
fn is_sensitive() -> bool {
    false
}
