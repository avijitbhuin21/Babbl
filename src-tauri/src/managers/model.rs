use crate::managers::catalog::{CatalogEntry, CATALOG};
use crate::settings::{get_settings, write_settings};
use anyhow::Result;
use futures_util::StreamExt;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::collections::HashMap;
use std::fs;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Model files are mirrored in Babbl's own bucket and served (via presigned redirect) from the website.
pub const MODEL_BASE_URL: &str = "https://website-production-0dbd.up.railway.app/models/";

/// Model ids from earlier catalogs mapped to their transcribe.cpp (GGUF) replacement.
pub const LEGACY_MODEL_IDS: &[(&str, &str)] = &[
    ("small", "whisper-small"),
    ("medium", "whisper-large-v3-turbo"),
    ("turbo", "whisper-large-v3-turbo"),
    ("large", "whisper-large-v3-turbo"),
    ("moonshine-tiny-streaming-en", "moonshine-streaming-tiny"),
    ("moonshine-small-streaming-en", "moonshine-streaming-small"),
    ("moonshine-medium-streaming-en", "moonshine-streaming-medium"),
    ("sense-voice-int8", "SenseVoiceSmall"),
    ("cohere-int8", "cohere-transcribe-03-2026"),
];

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub filename: String,
    pub url: Option<String>,
    pub size_mb: u64,
    pub is_downloaded: bool,
    pub is_downloading: bool,
    pub partial_size: u64,
    /// Shows text live while recording (streaming-capable model).
    pub supports_streaming: bool,
    pub supports_translate: bool,
    pub supports_language_detect: bool,
    /// ISO codes the model accepts as a language hint; one entry means a single-language model.
    pub languages: Vec<String>,
    pub accuracy_score: f32, // 0.0 to 1.0, higher is more accurate
    pub speed_score: f32,    // 0.0 to 1.0, higher is faster
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DownloadProgress {
    pub model_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
}

pub struct ModelManager {
    app_handle: AppHandle,
    models_dir: PathBuf,
    available_models: Mutex<HashMap<String, ModelInfo>>,
    // model id -> cancel flag for the one in-flight download of that model
    active_downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

pub const DOWNLOAD_CANCELLED_MSG: &str = "Download cancelled";
const MAX_DOWNLOAD_RETRIES: u32 = 3;

enum DownloadError {
    Cancelled,
    Transient(anyhow::Error),
    Fatal(anyhow::Error),
}

/// Clears the in-flight download marker however `download_model` exits.
struct ActiveDownloadGuard<'a> {
    manager: &'a ModelManager,
    model_id: String,
}

impl Drop for ActiveDownloadGuard<'_> {
    fn drop(&mut self) {
        self.manager
            .active_downloads
            .lock()
            .unwrap()
            .remove(&self.model_id);
        if let Some(model) = self
            .manager
            .available_models
            .lock()
            .unwrap()
            .get_mut(&self.model_id)
        {
            model.is_downloading = false;
        }
    }
}

/// Extracts the full resource size from a `Content-Range: bytes */TOTAL` style header.
fn content_range_total(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)?
        .to_str()
        .ok()?
        .rsplit('/')
        .next()?
        .trim()
        .parse()
        .ok()
}

fn file_len(path: &Path) -> u64 {
    path.metadata().map(|m| m.len()).unwrap_or(0)
}

/// Hex SHA-256 of a file, read in 1 MiB chunks.
fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect())
}

/// Catalog entry for a model id.
pub fn catalog_entry(model_id: &str) -> Option<&'static CatalogEntry> {
    CATALOG.iter().find(|e| e.id == model_id)
}

/// The current id for a model id that may come from an older catalog.
pub fn migrate_model_id(model_id: &str) -> &str {
    LEGACY_MODEL_IDS
        .iter()
        .find(|(old, _)| *old == model_id)
        .map(|(_, new)| *new)
        .unwrap_or(model_id)
}

fn model_info_from(entry: &CatalogEntry) -> ModelInfo {
    ModelInfo {
        id: entry.id.to_string(),
        name: entry.name.to_string(),
        description: entry.description.to_string(),
        filename: entry.filename.to_string(),
        url: Some(format!("{}{}", MODEL_BASE_URL, entry.filename)),
        size_mb: entry.size_bytes / (1024 * 1024),
        is_downloaded: false,
        is_downloading: false,
        partial_size: 0,
        supports_streaming: entry.streaming,
        supports_translate: entry.translate,
        supports_language_detect: entry.language_detect,
        languages: entry.languages.iter().map(|l| l.to_string()).collect(),
        accuracy_score: entry.accuracy,
        speed_score: entry.speed,
    }
}

impl ModelManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        let models_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?
            .join("models");

        if !models_dir.exists() {
            fs::create_dir_all(&models_dir)?;
        }

        let available_models = CATALOG
            .iter()
            .map(|e| (e.id.to_string(), model_info_from(e)))
            .collect();

        let manager = Self {
            app_handle: app_handle.clone(),
            models_dir,
            available_models: Mutex::new(available_models),
            active_downloads: Mutex::new(HashMap::new()),
        };

        manager.update_download_status()?;
        manager.auto_select_model_if_needed()?;

        Ok(manager)
    }

    pub fn get_available_models(&self) -> Vec<ModelInfo> {
        let models = self.available_models.lock().unwrap();
        let mut list: Vec<ModelInfo> = models.values().cloned().collect();
        let rank = |id: &str| CATALOG.iter().position(|e| e.id == id).unwrap_or(usize::MAX);
        list.sort_by_key(|m| rank(&m.id));
        list
    }

    pub fn get_model_info(&self, model_id: &str) -> Option<ModelInfo> {
        let models = self.available_models.lock().unwrap();
        models.get(model_id).cloned()
    }

    fn update_download_status(&self) -> Result<()> {
        let active: std::collections::HashSet<String> =
            self.active_downloads.lock().unwrap().keys().cloned().collect();
        let mut models = self.available_models.lock().unwrap();

        for model in models.values_mut() {
            let model_path = self.models_dir.join(&model.filename);
            let partial_path = self.models_dir.join(format!("{}.partial", &model.filename));
            model.is_downloaded = model_path.is_file();
            model.is_downloading = active.contains(&model.id);
            model.partial_size = file_len(&partial_path);
        }

        Ok(())
    }

    fn auto_select_model_if_needed(&self) -> Result<()> {
        let mut settings = get_settings(&self.app_handle);

        let migrated = migrate_model_id(&settings.selected_model).to_string();
        if migrated != settings.selected_model {
            info!(
                "Selected model '{}' was replaced by '{}'",
                settings.selected_model, migrated
            );
            settings.selected_model = migrated;
            write_settings(&self.app_handle, settings.clone());
        }

        let selected_ok = self
            .get_model_info(&settings.selected_model)
            .map(|m| m.is_downloaded)
            .unwrap_or(false);
        if selected_ok {
            return Ok(());
        }

        let first_downloaded = self
            .get_available_models()
            .into_iter()
            .find(|m| m.is_downloaded)
            .map(|m| m.id);
        let replacement = first_downloaded.unwrap_or_default();
        if replacement != settings.selected_model
            && (!replacement.is_empty() || !settings.selected_model.is_empty())
        {
            info!(
                "Auto-selecting model '{}' (previous '{}' is not downloaded)",
                if replacement.is_empty() { "<none>" } else { &replacement },
                settings.selected_model
            );
            settings.selected_model = replacement;
            write_settings(&self.app_handle, settings);
        }

        Ok(())
    }

    pub async fn download_model(&self, model_id: &str) -> Result<()> {
        let model_info = self
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;
        let expected_sha = catalog_entry(model_id).map(|e| e.sha256.to_string());

        let url = model_info
            .url
            .ok_or_else(|| anyhow::anyhow!("No download URL for model"))?;
        let model_path = self.models_dir.join(&model_info.filename);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));

        if model_path.exists() {
            if partial_path.exists() {
                let _ = fs::remove_file(&partial_path);
            }
            self.update_download_status()?;
            return Ok(());
        }

        let cancel_flag = {
            let mut models = self.available_models.lock().unwrap();
            let mut active = self.active_downloads.lock().unwrap();
            if active.contains_key(model_id) {
                return Err(anyhow::anyhow!("Model {} is already downloading", model_id));
            }
            let flag = Arc::new(AtomicBool::new(false));
            active.insert(model_id.to_string(), flag.clone());
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = true;
            }
            flag
        };
        let _guard = ActiveDownloadGuard {
            manager: self,
            model_id: model_id.to_string(),
        };

        let mut attempt: u32 = 0;
        let total_size = loop {
            match self
                .download_attempt(model_id, &url, &partial_path, &cancel_flag)
                .await
            {
                Ok(total) => break total,
                Err(DownloadError::Cancelled) => {
                    info!(
                        "Download of model {} cancelled at {} bytes (partial kept for resume)",
                        model_id,
                        file_len(&partial_path)
                    );
                    let _ = self.app_handle.emit("model-download-cancelled", model_id);
                    return Err(anyhow::anyhow!(DOWNLOAD_CANCELLED_MSG));
                }
                Err(DownloadError::Transient(e)) if attempt < MAX_DOWNLOAD_RETRIES => {
                    attempt += 1;
                    let backoff = Duration::from_secs(2u64.pow(attempt));
                    warn!(
                        "Download of model {} interrupted ({}); retry {}/{} in {:?}",
                        model_id, e, attempt, MAX_DOWNLOAD_RETRIES, backoff
                    );
                    let deadline = std::time::Instant::now() + backoff;
                    while std::time::Instant::now() < deadline {
                        if cancel_flag.load(Ordering::Relaxed) {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(250)).await;
                    }
                }
                Err(DownloadError::Transient(e)) | Err(DownloadError::Fatal(e)) => {
                    log::error!("Download of model {} failed: {}", model_id, e);
                    return Err(e);
                }
            }
        };

        if total_size > 0 {
            let actual_size = file_len(&partial_path);
            if actual_size != total_size {
                let _ = fs::remove_file(&partial_path);
                return Err(anyhow::anyhow!(
                    "Download incomplete: expected {} bytes, got {} bytes",
                    total_size,
                    actual_size
                ));
            }
        }

        if let Some(expected) = expected_sha {
            let _ = self.app_handle.emit("model-verification-started", model_id);
            let path = partial_path.clone();
            let actual = tokio::task::spawn_blocking(move || sha256_file(&path))
                .await
                .map_err(|e| anyhow::anyhow!("Checksum task failed: {}", e))??;
            if !actual.eq_ignore_ascii_case(&expected) {
                let _ = fs::remove_file(&partial_path);
                return Err(anyhow::anyhow!(
                    "Downloaded file is corrupted (checksum mismatch). Please try again."
                ));
            }
            debug!("Checksum verified for model {}", model_id);
        }

        fs::rename(&partial_path, &model_path)?;

        {
            let mut models = self.available_models.lock().unwrap();
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = false;
                model.is_downloaded = true;
                model.partial_size = 0;
            }
        }

        let _ = self.app_handle.emit("model-download-complete", model_id);
        info!("Successfully downloaded model {} to {:?}", model_id, model_path);
        Ok(())
    }

    /// Performs one HTTP download pass (resuming from any partial file); returns expected total size.
    async fn download_attempt(
        &self,
        model_id: &str,
        url: &str,
        partial_path: &Path,
        cancel_flag: &AtomicBool,
    ) -> std::result::Result<u64, DownloadError> {
        let client = reqwest::Client::new();
        let mut resume_from = file_len(partial_path);
        if resume_from > 0 {
            info!("Resuming download of model {} from byte {}", model_id, resume_from);
        } else {
            info!("Starting fresh download of model {} from {}", model_id, url);
        }

        let mut request = client.get(url);
        if resume_from > 0 {
            request = request.header("Range", format!("bytes={}-", resume_from));
        }
        let mut response = request
            .send()
            .await
            .map_err(|e| DownloadError::Transient(e.into()))?;

        if resume_from > 0 && response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            match content_range_total(&response) {
                Some(total) if total == resume_from => {
                    info!(
                        "Partial file for model {} is already complete ({} bytes)",
                        model_id, total
                    );
                    return Ok(total);
                }
                total => {
                    warn!(
                        "Server rejected resume of model {} at byte {} (server size {:?}); discarding partial file and restarting",
                        model_id, resume_from, total
                    );
                    drop(response);
                    let _ = fs::remove_file(partial_path);
                    resume_from = 0;
                    response = client
                        .get(url)
                        .send()
                        .await
                        .map_err(|e| DownloadError::Transient(e.into()))?;
                }
            }
        }

        // A 200 to a range request means the server sent the whole file; start the partial over.
        if resume_from > 0 && response.status() == reqwest::StatusCode::OK {
            warn!(
                "Server doesn't support range requests for model {}, restarting download",
                model_id
            );
            resume_from = 0;
        }

        let status = response.status();
        if !status.is_success() {
            let err = anyhow::anyhow!("Failed to download model: HTTP {}", status);
            return Err(
                if status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    DownloadError::Transient(err)
                } else {
                    DownloadError::Fatal(err)
                },
            );
        }

        let total_size = if resume_from > 0 {
            resume_from + response.content_length().unwrap_or(0)
        } else {
            response.content_length().unwrap_or(0)
        };

        let mut file = if resume_from > 0 {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(partial_path)
        } else {
            File::create(partial_path)
        }
        .map_err(|e| DownloadError::Fatal(e.into()))?;

        let mut downloaded = resume_from;
        let emit_progress = |downloaded: u64| {
            let progress = DownloadProgress {
                model_id: model_id.to_string(),
                downloaded,
                total: total_size,
                percentage: if total_size > 0 {
                    (downloaded as f64 / total_size as f64) * 100.0
                } else {
                    0.0
                },
            };
            let _ = self.app_handle.emit("model-download-progress", &progress);
        };
        emit_progress(downloaded);

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if cancel_flag.load(Ordering::Relaxed) {
                let _ = file.flush();
                return Err(DownloadError::Cancelled);
            }
            let chunk = chunk.map_err(|e| {
                let _ = file.flush();
                DownloadError::Transient(e.into())
            })?;
            file.write_all(&chunk)
                .map_err(|e| DownloadError::Fatal(e.into()))?;
            downloaded += chunk.len() as u64;
            emit_progress(downloaded);
        }

        file.flush().map_err(|e| DownloadError::Fatal(e.into()))?;
        drop(file);

        if cancel_flag.load(Ordering::Relaxed) {
            return Err(DownloadError::Cancelled);
        }
        if total_size > 0 && downloaded < total_size {
            return Err(DownloadError::Transient(anyhow::anyhow!(
                "connection closed early ({} of {} bytes)",
                downloaded,
                total_size
            )));
        }

        Ok(total_size)
    }

    pub fn delete_model(&self, model_id: &str) -> Result<()> {
        debug!("ModelManager: delete_model called for: {}", model_id);
        let model_info = self
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        let model_path = self.models_dir.join(&model_info.filename);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));

        let mut deleted_something = false;
        for path in [&model_path, &partial_path] {
            if path.is_file() {
                info!("Deleting model file at: {:?}", path);
                fs::remove_file(path)?;
                deleted_something = true;
            }
        }

        if !deleted_something {
            return Err(anyhow::anyhow!("No model files found to delete"));
        }

        self.update_download_status()?;
        Ok(())
    }

    pub fn get_model_path(&self, model_id: &str) -> Result<PathBuf> {
        let model_info = self
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if !model_info.is_downloaded {
            return Err(anyhow::anyhow!("Model not available: {}", model_id));
        }
        if model_info.is_downloading {
            return Err(anyhow::anyhow!("Model is currently downloading: {}", model_id));
        }

        let model_path = self.models_dir.join(&model_info.filename);
        if model_path.is_file() {
            Ok(model_path)
        } else {
            Err(anyhow::anyhow!("Complete model file not found: {}", model_id))
        }
    }

    pub fn cancel_download(&self, model_id: &str) -> Result<()> {
        debug!("ModelManager: cancel_download called for: {}", model_id);

        if !self.available_models.lock().unwrap().contains_key(model_id) {
            return Err(anyhow::anyhow!("Model not found: {}", model_id));
        }

        // The download task notices the flag on its next chunk, keeps the partial file for
        // resuming, and clears its own in-flight state.
        match self.active_downloads.lock().unwrap().get(model_id) {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                info!("Cancellation requested for download: {}", model_id);
            }
            None => debug!("No active download to cancel for: {}", model_id),
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_ids_map_to_catalog_models() {
        for (old, new) in LEGACY_MODEL_IDS {
            assert!(catalog_entry(new).is_some(), "{} -> {} missing", old, new);
            assert_eq!(migrate_model_id(old), *new);
        }
        assert_eq!(migrate_model_id("Qwen3-ASR-1.7B"), "Qwen3-ASR-1.7B");
    }

    #[test]
    fn catalog_entries_are_well_formed() {
        let mut ids = std::collections::HashSet::new();
        for e in CATALOG {
            assert!(ids.insert(e.id), "duplicate id {}", e.id);
            assert!(e.filename.ends_with(".gguf"));
            assert_eq!(e.sha256.len(), 64);
            assert!(e.size_bytes > 1_000_000);
            assert!(e.upstream.starts_with("https://huggingface.co/"));
        }
        assert!(catalog_entry("Qwen3-ASR-1.7B").is_some());
        assert!(CATALOG.iter().any(|e| e.streaming));
    }
}
