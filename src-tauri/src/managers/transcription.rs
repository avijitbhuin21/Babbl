use crate::audio_toolkit::apply_custom_words;
use crate::managers::model::ModelManager;
use crate::settings::{get_settings, AppSettings, ModelUnloadTimeout};
use anyhow::Result;
use log::{debug, error, info, warn};
use serde::Serialize;
use specta::Type;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};
use transcribe_cpp::{
    Backend, Model, ModelOptions, RunExtension, RunOptions, Session, StreamOptions, Task,
    WhisperRunOptions,
};

const STREAM_FINALIZE_TIMEOUT: Duration = Duration::from_secs(30);

static LIVE_ROUTER: std::sync::OnceLock<Arc<StreamRouter>> = std::sync::OnceLock::new();

/// Called by the audio recorder for every 16 kHz frame while recording.
pub fn feed_live_frame(frame: &[f32]) {
    if let Some(router) = LIVE_ROUTER.get() {
        router.feed(frame);
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ModelStateEvent {
    pub event_type: String,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub error: Option<String>,
}

/// Live transcript shown in the overlay while a streaming model is recording.
#[derive(Clone, Debug, Serialize, Type)]
pub struct StreamTextEvent {
    /// Stable prefix that will not change any more.
    pub committed: String,
    /// Still-revisable tail.
    pub tentative: String,
}

enum StreamCmd {
    Feed(Vec<f32>),
    /// Flush and reply with the final raw text, or `None` when no stream ran.
    Finalize(mpsc::Sender<Option<String>>),
    Cancel,
}

/// Routes 16 kHz recorder frames to the active streaming worker. A frame with no stream
/// open costs one relaxed atomic load.
pub struct StreamRouter {
    tx: Mutex<Option<mpsc::Sender<StreamCmd>>>,
    open: AtomicBool,
}

impl StreamRouter {
    fn new() -> Self {
        Self {
            tx: Mutex::new(None),
            open: AtomicBool::new(false),
        }
    }

    fn open(&self) -> mpsc::Receiver<StreamCmd> {
        let (tx, rx) = mpsc::channel();
        *self.tx.lock().unwrap() = Some(tx);
        self.open.store(true, Ordering::Release);
        rx
    }

    fn take(&self) -> Option<mpsc::Sender<StreamCmd>> {
        self.open.store(false, Ordering::Release);
        self.tx.lock().unwrap().take()
    }

    /// Forwards one resampled frame to the streaming worker, if one is running.
    pub fn feed(&self, frame: &[f32]) {
        if !self.open.load(Ordering::Relaxed) {
            return;
        }
        if let Some(tx) = self.tx.lock().unwrap().as_ref() {
            let _ = tx.send(StreamCmd::Feed(frame.to_vec()));
        }
    }
}

/// Language + task for one run, gated by what the loaded model supports.
struct RunPlan {
    task: Task,
    language: Option<String>,
    target_language: Option<String>,
}

/// Maps the language setting onto the model: only advertised languages are passed; models that
/// cannot auto-detect get a concrete language; translation only where the model supports it.
fn run_plan(
    selected_language: &str,
    translate_to_english: bool,
    languages: &[String],
    supports_language_detect: bool,
    supports_translate: bool,
) -> RunPlan {
    let requested = match selected_language {
        "auto" | "" => None,
        "zh-Hans" | "zh-Hant" => Some("zh".to_string()),
        other => Some(other.to_string()),
    };
    let mut language = requested.filter(|l| languages.iter().any(|m| m == l));
    if language.is_none() && !supports_language_detect && languages.len() > 1 {
        language = Some(if languages.iter().any(|l| l == "en") {
            "en".to_string()
        } else {
            languages[0].clone()
        });
    }
    let translate =
        translate_to_english && supports_translate && language.as_deref() != Some("en");
    RunPlan {
        task: if translate { Task::Translate } else { Task::Transcribe },
        target_language: translate.then(|| "en".to_string()),
        language,
    }
}

/// Custom-word correction (when the model was not already prompted with them) and trimming.
fn post_process(text: &str, settings: &AppSettings, prompted: bool) -> String {
    let corrected = if !settings.custom_words.is_empty() && !prompted {
        apply_custom_words(text, &settings.custom_words, settings.word_correction_threshold)
    } else {
        text.to_string()
    };
    corrected.trim().to_string()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[derive(Clone)]
pub struct TranscriptionManager {
    engine: Arc<Mutex<Option<Session>>>,
    model_manager: Arc<ModelManager>,
    app_handle: AppHandle,
    current_model_id: Arc<Mutex<Option<String>>>,
    /// Human-readable compute device the loaded model is bound to.
    current_device: Arc<Mutex<Option<String>>>,
    last_activity: Arc<AtomicU64>,
    shutdown_signal: Arc<AtomicBool>,
    watcher_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
    router: Arc<StreamRouter>,
    /// True while the streaming worker holds the session outside `engine`.
    engine_leased: Arc<AtomicBool>,
    /// True while a live stream is actually producing text.
    stream_active: Arc<AtomicBool>,
}

impl TranscriptionManager {
    pub fn new(app_handle: &AppHandle, model_manager: Arc<ModelManager>) -> Result<Self> {
        let manager = Self {
            engine: Arc::new(Mutex::new(None)),
            model_manager,
            app_handle: app_handle.clone(),
            current_model_id: Arc::new(Mutex::new(None)),
            current_device: Arc::new(Mutex::new(None)),
            last_activity: Arc::new(AtomicU64::new(now_ms())),
            shutdown_signal: Arc::new(AtomicBool::new(false)),
            watcher_handle: Arc::new(Mutex::new(None)),
            is_loading: Arc::new(Mutex::new(false)),
            loading_condvar: Arc::new(Condvar::new()),
            router: Arc::new(StreamRouter::new()),
            engine_leased: Arc::new(AtomicBool::new(false)),
            stream_active: Arc::new(AtomicBool::new(false)),
        };
        let _ = LIVE_ROUTER.set(manager.router.clone());

        {
            let app_handle_cloned = app_handle.clone();
            let manager_cloned = manager.clone();
            let shutdown_signal = manager.shutdown_signal.clone();
            let handle = thread::spawn(move || {
                while !shutdown_signal.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_secs(10));
                    if shutdown_signal.load(Ordering::Relaxed) {
                        break;
                    }

                    let settings = get_settings(&app_handle_cloned);
                    let Some(limit_seconds) = settings.model_unload_timeout.to_seconds() else {
                        continue;
                    };
                    // Immediate unloading is handled directly after each transcription.
                    if settings.model_unload_timeout == ModelUnloadTimeout::Immediately {
                        continue;
                    }
                    let last = manager_cloned.last_activity.load(Ordering::Relaxed);
                    if now_ms().saturating_sub(last) > limit_seconds * 1000
                        && manager_cloned.is_model_loaded()
                        && !manager_cloned.engine_leased.load(Ordering::Acquire)
                    {
                        debug!("Unloading model due to inactivity");
                        let _ = manager_cloned.unload_model();
                    }
                }
                debug!("Idle watcher thread shutting down gracefully");
            });
            *manager.watcher_handle.lock().unwrap() = Some(handle);
        }

        Ok(manager)
    }

    fn touch_activity(&self) {
        self.last_activity.store(now_ms(), Ordering::Relaxed);
    }

    fn emit_state(&self, event_type: &str, model_id: Option<&str>, name: Option<&str>, error: Option<String>) {
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: event_type.to_string(),
                model_id: model_id.map(str::to_string),
                model_name: name.map(str::to_string),
                error,
            },
        );
    }

    /// Returns true while a model load is in progress.
    pub fn is_loading(&self) -> bool {
        *self.is_loading.lock().unwrap()
    }

    pub fn is_model_loaded(&self) -> bool {
        self.engine_leased.load(Ordering::Acquire) || self.engine.lock().unwrap().is_some()
    }

    /// The compute device the loaded model runs on (e.g. "Vulkan: NVIDIA GeForce RTX 4070").
    pub fn current_device(&self) -> Option<String> {
        self.current_device.lock().unwrap().clone()
    }

    pub fn unload_model(&self) -> Result<()> {
        *self.engine.lock().unwrap() = None;
        *self.current_model_id.lock().unwrap() = None;
        *self.current_device.lock().unwrap() = None;
        self.emit_state("unloaded", None, None, None);
        debug!("Model unloaded");
        Ok(())
    }

    pub fn load_model(&self, model_id: &str) -> Result<()> {
        let load_start = Instant::now();
        debug!("Starting to load model: {}", model_id);
        self.emit_state("loading_started", Some(model_id), None, None);

        let Some(model_info) = self.model_manager.get_model_info(model_id) else {
            let msg = format!("Model not found: {}", model_id);
            self.emit_state("loading_failed", Some(model_id), None, Some(msg.clone()));
            return Err(anyhow::anyhow!(msg));
        };
        let fail = |msg: String| {
            self.emit_state("loading_failed", Some(model_id), Some(&model_info.name), Some(msg.clone()));
            anyhow::anyhow!(msg)
        };

        if !model_info.is_downloaded {
            return Err(fail("Model not downloaded".to_string()));
        }
        let model_path = self
            .model_manager
            .get_model_path(model_id)
            .map_err(|e| fail(e.to_string()))?;

        // Free the previous model first so two large models are never resident at once.
        *self.engine.lock().unwrap() = None;
        *self.current_model_id.lock().unwrap() = None;
        *self.current_device.lock().unwrap() = None;

        let settings = get_settings(&self.app_handle);
        let backend = if settings.use_gpu { Backend::Auto } else { Backend::Cpu };
        let model = Model::load_with(&model_path, &ModelOptions { backend, device: None })
            .map_err(|e| fail(format!("Failed to load model {}: {}", model_id, e)))?;
        let device = match model.device() {
            Ok(d) if !d.description.is_empty() => format!("{}: {}", model.backend(), d.description),
            _ => model.backend(),
        };
        let caps = model.capabilities();
        let session = model
            .session()
            .map_err(|e| fail(format!("Failed to create session for {}: {}", model_id, e)))?;

        info!(
            "Loaded model '{}' (arch '{}', requested {:?}, running on '{}', streaming={}, translate={}) in {}ms",
            model_id,
            model.arch(),
            backend,
            device,
            caps.supports_streaming,
            caps.supports_translate,
            load_start.elapsed().as_millis()
        );

        *self.engine.lock().unwrap() = Some(session);
        *self.current_model_id.lock().unwrap() = Some(model_id.to_string());
        *self.current_device.lock().unwrap() = Some(device);
        self.touch_activity();
        self.emit_state("loading_completed", Some(model_id), Some(&model_info.name), None);
        Ok(())
    }

    /// Kicks off the model loading in a background thread if it's not already loaded
    pub fn initiate_model_load(&self) {
        let mut is_loading = self.is_loading.lock().unwrap();
        if *is_loading || self.is_model_loaded() {
            return;
        }

        *is_loading = true;
        let self_clone = self.clone();
        thread::spawn(move || {
            let settings = get_settings(&self_clone.app_handle);
            if let Err(e) = self_clone.load_model(&settings.selected_model) {
                error!("Failed to load model: {}", e);
            }
            *self_clone.is_loading.lock().unwrap() = false;
            self_clone.loading_condvar.notify_all();
        });
    }

    pub fn get_current_model(&self) -> Option<String> {
        self.current_model_id.lock().unwrap().clone()
    }

    fn wait_for_load(&self) {
        let mut is_loading = self.is_loading.lock().unwrap();
        while *is_loading {
            is_loading = self.loading_condvar.wait(is_loading).unwrap();
        }
    }

    fn maybe_unload_immediately(&self, settings: &AppSettings) {
        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately {
            info!("Immediately unloading model after transcription");
            if let Err(e) = self.unload_model() {
                error!("Failed to immediately unload model: {}", e);
            }
        }
    }

    pub fn transcribe(&self, audio: Vec<f32>) -> Result<String> {
        self.touch_activity();
        let st = Instant::now();
        debug!("Audio vector length: {}", audio.len());
        if audio.is_empty() {
            return Ok(String::new());
        }

        self.wait_for_load();
        let settings = get_settings(&self.app_handle);

        let (raw, prompted) = {
            let mut guard = self.engine.lock().unwrap();
            let session = guard.as_mut().ok_or_else(|| {
                anyhow::anyhow!("Model is not loaded. Please check your model settings.")
            })?;
            let model = session.model();
            let caps = model.capabilities();
            let is_whisper = model.arch() == "whisper";
            let plan = run_plan(
                &settings.selected_language,
                settings.translate_to_english,
                &caps.languages,
                caps.supports_language_detect,
                caps.supports_translate,
            );
            // Only whisper accepts the initial-prompt extension; other archs reject it.
            let prompted = is_whisper && !settings.custom_words.is_empty();
            let options = RunOptions {
                task: plan.task,
                language: plan.language,
                target_language: plan.target_language,
                family: prompted.then(|| {
                    RunExtension::Whisper(WhisperRunOptions {
                        initial_prompt: Some(settings.custom_words.join(", ")),
                        ..Default::default()
                    })
                }),
                ..Default::default()
            };
            debug!("transcribe run: task={:?} language={:?}", options.task, options.language);
            let out = session
                .run(&audio, &options)
                .map_err(|e| anyhow::anyhow!("Transcription failed: {}", e))?;
            (out.text, prompted)
        };

        let final_result = post_process(&raw, &settings, prompted);
        info!(
            "Transcription completed in {}ms ({} chars)",
            st.elapsed().as_millis(),
            final_result.chars().count()
        );
        self.maybe_unload_immediately(&settings);
        Ok(final_result)
    }

    /// Whether a live stream is currently producing text.
    pub fn is_streaming(&self) -> bool {
        self.stream_active.load(Ordering::Acquire)
    }

    /// Whether the selected local model can show text live while recording.
    pub fn selected_model_streams(&self) -> bool {
        let settings = get_settings(&self.app_handle);
        self.model_manager
            .get_model_info(&settings.selected_model)
            .map(|m| m.supports_streaming)
            .unwrap_or(false)
    }

    /// Opens a live stream for the current recording. Frames fed before the model finishes
    /// loading queue on the channel and are not lost; if the model can't stream, the worker
    /// idles and `finalize_stream` returns `None` so the caller falls back to batch.
    pub fn start_stream(&self) {
        if self.router.open.load(Ordering::Acquire) {
            warn!("start_stream called while a stream is already open");
            return;
        }
        let rx = self.router.open();
        let manager = self.clone();
        thread::spawn(move || manager.run_stream_worker(rx));
    }

    fn run_stream_worker(&self, rx: mpsc::Receiver<StreamCmd>) {
        self.wait_for_load();
        let model_id = self.get_current_model().unwrap_or_default();

        let Some(mut session) = self.engine.lock().unwrap().take() else {
            info!("Live text: no model loaded; falling back to batch transcription");
            drain_until_finalize(rx);
            return;
        };
        self.engine_leased.store(true, Ordering::Release);

        let model = session.model();
        let caps = model.capabilities();
        if !caps.supports_streaming {
            debug!("Live text: model '{}' does not stream", model_id);
            self.return_engine(session, &model_id);
            drain_until_finalize(rx);
            return;
        }

        let settings = get_settings(&self.app_handle);
        let plan = run_plan(
            &settings.selected_language,
            settings.translate_to_english,
            &caps.languages,
            caps.supports_language_detect,
            caps.supports_translate,
        );
        let options = RunOptions {
            task: plan.task,
            language: plan.language,
            target_language: plan.target_language,
            ..Default::default()
        };

        let mut reply: Option<(mpsc::Sender<Option<String>>, Option<String>)> = None;
        let begin_error: Option<String> = 'run: {
            let mut stream = match session.stream(&options, &StreamOptions::default()) {
                Ok(s) => s,
                Err(e) => break 'run Some(e.to_string()),
            };
            self.stream_active.store(true, Ordering::Release);
            info!("Live streaming started (model '{}', {})", model_id, model.backend());
            self.emit_stream_text("", "");

            while let Ok(cmd) = rx.recv() {
                match cmd {
                    StreamCmd::Feed(pcm) => {
                        self.touch_activity();
                        match stream.feed(&pcm) {
                            Ok(u) if u.committed_changed || u.tentative_changed => {
                                let t = stream.text();
                                self.emit_stream_text(&t.committed, &t.tentative);
                            }
                            Ok(_) => {}
                            Err(e) => warn!("Live stream feed failed: {}", e),
                        }
                    }
                    StreamCmd::Finalize(tx) => {
                        let text = match stream.finalize() {
                            Ok(_) => Some(stream.text().full),
                            Err(e) => {
                                error!("Live stream finalize failed: {}; using batch", e);
                                None
                            }
                        };
                        reply = Some((tx, text));
                        break;
                    }
                    StreamCmd::Cancel => {
                        stream.reset();
                        break;
                    }
                }
            }
            None
        };
        drop(model);
        if let Some(e) = begin_error {
            error!("Failed to begin live stream: {}", e);
            self.return_engine(session, &model_id);
            drain_until_finalize(rx);
            return;
        }
        self.stream_active.store(false, Ordering::Release);
        // Return the session before replying so a batch fallback can use it immediately.
        self.return_engine(session, &model_id);
        if let Some((tx, text)) = reply {
            let _ = tx.send(text);
        }
    }

    /// Puts the leased session back unless the model was switched or unloaded meanwhile.
    fn return_engine(&self, session: Session, model_id: &str) {
        let mut engine = self.engine.lock().unwrap();
        if self.current_model_id.lock().unwrap().as_deref() == Some(model_id) {
            *engine = Some(session);
        } else {
            info!("Model changed during live stream; dropping stale session '{}'", model_id);
        }
        self.engine_leased.store(false, Ordering::Release);
    }

    /// Flushes the live stream and returns its final text. `Ok(None)` means no stream produced
    /// text and the caller should run batch transcription on the recorded samples.
    pub fn finalize_stream(&self) -> Result<Option<String>> {
        let Some(tx) = self.router.take() else {
            return Ok(None);
        };
        let (reply_tx, reply_rx) = mpsc::channel();
        if tx.send(StreamCmd::Finalize(reply_tx)).is_err() {
            return Ok(None);
        }
        let raw = match reply_rx.recv_timeout(STREAM_FINALIZE_TIMEOUT) {
            Ok(Some(text)) => text,
            Ok(None) | Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(None),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err(anyhow::anyhow!("Timed out finishing live transcription"));
            }
        };
        let settings = get_settings(&self.app_handle);
        let text = post_process(&raw, &settings, false);
        info!("Live transcription finalized ({} chars)", text.chars().count());
        self.maybe_unload_immediately(&settings);
        Ok(Some(text))
    }

    /// Abandons any live stream without producing text.
    pub fn cancel_stream(&self) {
        if let Some(tx) = self.router.take() {
            let _ = tx.send(StreamCmd::Cancel);
        }
    }

    fn emit_stream_text(&self, committed: &str, tentative: &str) {
        let _ = self.app_handle.emit(
            "stream-text",
            StreamTextEvent {
                committed: committed.to_string(),
                tentative: tentative.to_string(),
            },
        );
    }
}

/// Ignores fed audio until the caller finalizes (replying `None`) or cancels.
fn drain_until_finalize(rx: mpsc::Receiver<StreamCmd>) {
    while let Ok(cmd) = rx.recv() {
        match cmd {
            StreamCmd::Feed(_) => {}
            StreamCmd::Finalize(reply) => {
                let _ = reply.send(None);
                break;
            }
            StreamCmd::Cancel => break,
        }
    }
}

impl Drop for TranscriptionManager {
    fn drop(&mut self) {
        // Clones share the watcher; only the last external handle shuts it down. The watcher
        // thread itself holds two references (its signal and its manager clone).
        if Arc::strong_count(&self.shutdown_signal) > 3 {
            return;
        }
        self.shutdown_signal.store(true, Ordering::Relaxed);
        if let Some(handle) = self.watcher_handle.lock().unwrap().take() {
            if let Err(e) = handle.join() {
                warn!("Failed to join idle watcher thread: {:?}", e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn langs(codes: &[&str]) -> Vec<String> {
        codes.iter().map(|c| c.to_string()).collect()
    }

    #[test]
    fn unsupported_language_falls_back_to_auto() {
        let p = run_plan("fr", false, &langs(&["en", "de"]), true, false);
        assert_eq!(p.language, None);
        assert!(matches!(p.task, Task::Transcribe));
    }

    #[test]
    fn chinese_variants_map_to_zh() {
        let p = run_plan("zh-Hant", false, &langs(&["en", "zh"]), true, false);
        assert_eq!(p.language.as_deref(), Some("zh"));
    }

    #[test]
    fn models_without_detection_get_a_concrete_language() {
        let p = run_plan("auto", false, &langs(&["de", "en", "fr"]), false, true);
        assert_eq!(p.language.as_deref(), Some("en"));
    }

    #[test]
    fn translation_only_when_supported_and_not_english() {
        let p = run_plan("de", true, &langs(&["de", "en"]), true, true);
        assert!(matches!(p.task, Task::Translate));
        assert_eq!(p.target_language.as_deref(), Some("en"));
        let p = run_plan("en", true, &langs(&["de", "en"]), true, true);
        assert!(matches!(p.task, Task::Transcribe));
        let p = run_plan("de", true, &langs(&["de", "en"]), true, false);
        assert!(matches!(p.task, Task::Transcribe));
    }
}
