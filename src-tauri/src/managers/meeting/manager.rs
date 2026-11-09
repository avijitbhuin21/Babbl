use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

use super::{
    mom::MomGenerator,
    pipeline::MeetingPipeline,
    types::{DiarizationConfig, DiarizedSegment, MeetingResult, MeetingStatus, MeetingTranscript},
};
use crate::{
    audio_toolkit::audio::DualAudioRecorder,
    managers::transcription::TranscriptionManager,
    settings::get_settings,
};

pub struct MeetingManager {
    app_handle: AppHandle,
    transcription_manager: Arc<TranscriptionManager>,
    recorder: Arc<Mutex<Option<DualAudioRecorder>>>,
    is_recording: Arc<AtomicBool>,
    start_time: Arc<Mutex<Option<Instant>>>,
    current_config: Arc<Mutex<DiarizationConfig>>,
    last_result: Arc<Mutex<Option<MeetingResult>>>,
    live_transcript: Arc<Mutex<MeetingTranscript>>,
    live_worker_abort: Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    mic_stream_buf: Arc<Mutex<Vec<f32>>>,
    sys_stream_buf: Arc<Mutex<Vec<f32>>>,
}

impl MeetingManager {
    pub fn new(app_handle: &AppHandle, transcription_manager: Arc<TranscriptionManager>) -> Self {
        Self {
            app_handle: app_handle.clone(),
            transcription_manager,
            recorder: Arc::new(Mutex::new(None)),
            is_recording: Arc::new(AtomicBool::new(false)),
            start_time: Arc::new(Mutex::new(None)),
            current_config: Arc::new(Mutex::new(DiarizationConfig::default())),
            last_result: Arc::new(Mutex::new(None)),
            live_transcript: Arc::new(Mutex::new(MeetingTranscript {
                segments: Vec::new(),
                full_text: String::new(),
                duration_secs: 0.0,
                speakers: Vec::new(),
            })),
            live_worker_abort: Arc::new(Mutex::new(None)),
            mic_stream_buf: Arc::new(Mutex::new(Vec::new())),
            sys_stream_buf: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::SeqCst)
    }

    pub fn get_status(&self) -> MeetingStatus {
        let is_rec = self.is_recording();
        let elapsed = if is_rec {
            self.start_time
                .lock()
                .unwrap()
                .map(|t| t.elapsed().as_secs_f32())
                .unwrap_or(0.0)
        } else {
            0.0
        };

        MeetingStatus {
            is_recording: is_rec,
            elapsed_secs: elapsed,
        }
    }

    pub fn get_last_meeting(&self) -> Option<MeetingResult> {
        self.last_result.lock().unwrap().clone()
    }

    pub fn get_live_transcript(&self) -> MeetingTranscript {
        let mut lt = self.live_transcript.lock().unwrap().clone();
        if self.is_recording() {
            if let Some(st) = *self.start_time.lock().unwrap() {
                lt.duration_secs = st.elapsed().as_secs_f32();
            }
        }
        lt
    }

    pub fn has_speech(samples: &[f32], threshold: f32) -> bool {
        if samples.is_empty() {
            return false;
        }
        let sum_sq: f32 = samples.iter().map(|&s| s * s).sum();
        let rms = (sum_sq / samples.len() as f32).sqrt();
        rms >= threshold
    }

    pub fn is_hallucination(text: &str) -> bool {
        let t = text.trim().to_lowercase();
        let cleaned = t.trim_matches(|c: char| !c.is_alphanumeric());
        cleaned.is_empty()
            || cleaned == "you"
            || cleaned == "thank you"
            || cleaned == "thanks for watching"
            || cleaned == "thank you for watching"
            || cleaned == "subscribe"
            || cleaned == "subtitles by"
            || cleaned == "bye"
            || cleaned == "goodbye"
            || t.starts_with("[music")
            || t.starts_with("(music")
            || t.starts_with("[applause")
            || t.starts_with("[laughter")
    }

    /// Finds the best boundary (minimum audio energy / natural pause) to cut an audio buffer
    fn find_best_cut_point(buf: &[f32], min_samples: usize, max_samples: usize) -> usize {
        let upper = usize::min(buf.len(), max_samples);
        if upper <= min_samples {
            return upper;
        }

        // Search in the range [min_samples..upper] for a 100ms window (1600 samples) with minimum RMS energy
        let window_size = 1600;
        let mut min_energy = f32::MAX;
        let mut best_cut = upper;

        let start_search = min_samples;
        let end_search = upper.saturating_sub(window_size);

        let mut i = start_search;
        while i <= end_search {
            let window = &buf[i..i + window_size];
            let energy: f32 = window.iter().map(|&x| x * x).sum();
            if energy < min_energy {
                min_energy = energy;
                best_cut = i + (window_size / 2);
            }
            i += 800; // Step by 50ms
        }

        best_cut
    }

    pub fn start_meeting(&self, config: DiarizationConfig) -> Result<(), String> {
        if self.is_recording() {
            return Err("A meeting recording is already active".to_string());
        }

        let mut recorder = DualAudioRecorder::new()
            .map_err(|e| format!("Failed to create dual recorder: {}", e))?;

        // Level callbacks for live audio metering
        let ah_mic = self.app_handle.clone();
        recorder = recorder.with_mic_level_callback(move |levels| {
            let max = levels.iter().cloned().fold(0.0f32, f32::max);
            let _ = ah_mic.emit("babbl://meeting_mic_level", max);
        });

        let ah_sys = self.app_handle.clone();
        recorder = recorder.with_loopback_level_callback(move |levels| {
            let max = levels.iter().cloned().fold(0.0f32, f32::max);
            let _ = ah_sys.emit("babbl://meeting_system_level", max);
        });

        // Frame callbacks to accumulate samples for live slicing & ongoing transcription
        self.mic_stream_buf.lock().unwrap().clear();
        self.sys_stream_buf.lock().unwrap().clear();

        let mic_buf_clone = self.mic_stream_buf.clone();
        recorder = recorder.with_mic_frame_callback(Arc::new(move |frames: &[f32]| {
            if let Ok(mut lock) = mic_buf_clone.lock() {
                lock.extend_from_slice(frames);
            }
        }));

        let sys_buf_clone = self.sys_stream_buf.clone();
        recorder = recorder.with_loopback_frame_callback(Arc::new(move |frames: &[f32]| {
            if let Ok(mut lock) = sys_buf_clone.lock() {
                lock.extend_from_slice(frames);
            }
        }));

        // Open default mic and system loopback
        recorder
            .open(None, None)
            .map_err(|e| format!("Failed to open audio devices for meeting: {}", e))?;

        recorder
            .start()
            .map_err(|e| format!("Failed to start dual recording: {}", e))?;

        let start_time_instant = Instant::now();
        *self.recorder.lock().unwrap() = Some(recorder);
        *self.start_time.lock().unwrap() = Some(start_time_instant);
        *self.current_config.lock().unwrap() = config.clone();
        self.is_recording.store(true, Ordering::SeqCst);

        // Reset live transcript
        {
            let mut lt = self.live_transcript.lock().unwrap();
            lt.segments.clear();
            lt.full_text.clear();
            lt.duration_secs = 0.0;
            lt.speakers.clear();
        }

        // Setup abort channel for ongoing live transcription worker
        let (abort_tx, mut abort_rx) = tokio::sync::oneshot::channel::<()>();
        *self.live_worker_abort.lock().unwrap() = Some(abort_tx);

        let app_handle_worker = self.app_handle.clone();
        let mic_buf_worker = self.mic_stream_buf.clone();
        let sys_buf_worker = self.sys_stream_buf.clone();
        let live_transcript_worker = self.live_transcript.clone();
        let is_rec_worker = self.is_recording.clone();
        let translate_to_en = config.translate_to_english;

        // Spawn ongoing meeting background transcription loop
        tauri::async_runtime::spawn(async move {
            log::info!("[Live Meeting] Background ongoing transcription worker started");

            // Slicing parameters: 16 kHz mono
            // 4.0 seconds = 64,000 samples. Max chunk = 6.0 seconds = 96,000 samples.
            let min_samples = 16000 * 4;
            let max_samples = 16000 * 6;

            let mut mic_processed_samples: usize = 0;
            let mut sys_processed_samples: usize = 0;

            loop {
                // Sleep between checks (every 2.5s)
                tokio::select! {
                    _ = &mut abort_rx => {
                        log::info!("[Live Meeting] Worker received stop signal");
                        break;
                    }
                    _ = tokio::time::sleep(tokio::time::Duration::from_millis(2500)) => {}
                }

                if !is_rec_worker.load(Ordering::SeqCst) {
                    break;
                }

                // Check mic buffer (User)
                let mic_data: Option<(Vec<f32>, f32, f32)> = {
                    let mut buf = mic_buf_worker.lock().unwrap();
                    if buf.len() >= min_samples {
                        let cut_len = Self::find_best_cut_point(&buf, min_samples, max_samples);
                        let samples: Vec<f32> = buf.drain(..cut_len).collect();
                        let start_secs = mic_processed_samples as f32 / 16000.0;
                        mic_processed_samples += samples.len();
                        let end_secs = mic_processed_samples as f32 / 16000.0;
                        Some((samples, start_secs, end_secs))
                    } else {
                        None
                    }
                };

                if let Some((samples, start_s, end_s)) = mic_data {
                    if Self::has_speech(&samples, 0.008) {
                        log::info!("[Live Meeting] Transcribing mic chunk: {:.1}s - {:.1}s", start_s, end_s);
                        match crate::actions::transcribe_audio(&app_handle_worker, samples, translate_to_en).await {
                            Ok(text) => {
                                let trimmed = text.trim();
                                if !Self::is_hallucination(trimmed) {
                                    let seg = DiarizedSegment {
                                        speaker: "You".to_string(),
                                        start_secs: start_s,
                                        end_secs: end_s,
                                        text: trimmed.to_string(),
                                    };
                                    let mut lt = live_transcript_worker.lock().unwrap();
                                    if !lt.speakers.contains(&seg.speaker) {
                                        lt.speakers.push(seg.speaker.clone());
                                    }
                                    lt.segments.push(seg.clone());
                                    lt.segments.sort_by(|a, b| a.start_secs.partial_cmp(&b.start_secs).unwrap_or(std::cmp::Ordering::Equal));
                                    lt.duration_secs = end_s;
                                    lt.full_text = lt.segments
                                        .iter()
                                        .map(|s| format!("[{}] {}", s.speaker, s.text))
                                        .collect::<Vec<_>>()
                                        .join("\n");

                                    let _ = app_handle_worker.emit("babbl://meeting_live_transcript", &*lt);
                                    let _ = app_handle_worker.emit("babbl://meeting_live_segment", &seg);
                                    log::info!("[Live Meeting] [You]: {}", trimmed);
                                }
                            }
                            Err(e) => {
                                log::warn!("[Live Meeting] Mic live transcription error: {}", e);
                            }
                        }
                    }
                }

                // Check system audio buffer (Attendee)
                let sys_data: Option<(Vec<f32>, f32, f32)> = {
                    let mut buf = sys_buf_worker.lock().unwrap();
                    if buf.len() >= min_samples {
                        let cut_len = Self::find_best_cut_point(&buf, min_samples, max_samples);
                        let samples: Vec<f32> = buf.drain(..cut_len).collect();
                        let start_secs = sys_processed_samples as f32 / 16000.0;
                        sys_processed_samples += samples.len();
                        let end_secs = sys_processed_samples as f32 / 16000.0;
                        Some((samples, start_secs, end_secs))
                    } else {
                        None
                    }
                };

                if let Some((samples, start_s, end_s)) = sys_data {
                    if Self::has_speech(&samples, 0.008) {
                        log::info!("[Live Meeting] Transcribing system chunk: {:.1}s - {:.1}s", start_s, end_s);
                        match crate::actions::transcribe_audio(&app_handle_worker, samples, translate_to_en).await {
                            Ok(text) => {
                                let trimmed = text.trim();
                                if !Self::is_hallucination(trimmed) {
                                    let seg = DiarizedSegment {
                                        speaker: "Attendee".to_string(),
                                        start_secs: start_s,
                                        end_secs: end_s,
                                        text: trimmed.to_string(),
                                    };
                                    let mut lt = live_transcript_worker.lock().unwrap();
                                    if !lt.speakers.contains(&seg.speaker) {
                                        lt.speakers.push(seg.speaker.clone());
                                    }
                                    lt.segments.push(seg.clone());
                                    lt.segments.sort_by(|a, b| a.start_secs.partial_cmp(&b.start_secs).unwrap_or(std::cmp::Ordering::Equal));
                                    lt.duration_secs = end_s;
                                    lt.full_text = lt.segments
                                        .iter()
                                        .map(|s| format!("[{}] {}", s.speaker, s.text))
                                        .collect::<Vec<_>>()
                                        .join("\n");

                                    let _ = app_handle_worker.emit("babbl://meeting_live_transcript", &*lt);
                                    let _ = app_handle_worker.emit("babbl://meeting_live_segment", &seg);
                                    log::info!("[Live Meeting] [Attendee]: {}", trimmed);
                                }
                            }
                            Err(e) => {
                                log::warn!("[Live Meeting] System live transcription error: {}", e);
                            }
                        }
                    }
                }
            }

            log::info!("[Live Meeting] Ongoing transcription worker finished");
        });

        let _ = self.app_handle.emit(
            "babbl://meeting_state",
            serde_json::json!({
                "is_recording": true,
                "is_processing": false,
            }),
        );

        log::info!("Meeting recording started with ongoing live transcription");
        Ok(())
    }

    pub async fn stop_meeting(&self) -> Result<MeetingResult, String> {
        if !self.is_recording() {
            return Err("No meeting recording currently running".to_string());
        }

        // 1. Terminate ongoing live worker
        if let Some(abort_tx) = self.live_worker_abort.lock().unwrap().take() {
            let _ = abort_tx.send(());
        }

        let mut recorder = {
            let mut guard = self.recorder.lock().unwrap();
            guard
                .take()
                .ok_or_else(|| "Recorder instance not found".to_string())?
        };

        self.is_recording.store(false, Ordering::SeqCst);
        *self.start_time.lock().unwrap() = None;

        let _ = self.app_handle.emit(
            "babbl://meeting_state",
            serde_json::json!({
                "is_recording": false,
                "is_processing": true,
            }),
        );

        log::info!("Stopping meeting recording and gathering audio streams...");
        let meeting_audio = match recorder.stop() {
            Ok(audio) => audio,
            Err(e) => {
                let _ = self.app_handle.emit(
                    "babbl://meeting_state",
                    serde_json::json!({
                        "is_recording": false,
                        "is_processing": false,
                    }),
                );
                return Err(format!("Error stopping recorder: {}", e));
            }
        };
        let _ = recorder.close();

        let config = self.current_config.lock().unwrap().clone();
        let settings = get_settings(&self.app_handle);

        log::info!(
            "Processing meeting audio: {:.2}s duration (mic: {}, sys: {} samples)",
            meeting_audio.duration_secs,
            meeting_audio.mic_samples.len(),
            meeting_audio.system_samples.len()
        );

        // Process any remaining tail audio from mic and sys buffers
        let tail_mic = {
            let mut buf = self.mic_stream_buf.lock().unwrap();
            std::mem::take(&mut *buf)
        };
        let tail_sys = {
            let mut buf = self.sys_stream_buf.lock().unwrap();
            std::mem::take(&mut *buf)
        };

        if tail_mic.len() >= 24000 && Self::has_speech(&tail_mic, 0.008) {
            let end_s = meeting_audio.duration_secs;
            let start_s = (end_s - (tail_mic.len() as f32 / 16000.0)).max(0.0);
            if let Ok(text) = crate::actions::transcribe_audio(&self.app_handle, tail_mic, config.translate_to_english).await {
                let trimmed = text.trim();
                if !Self::is_hallucination(trimmed) {
                    let mut lt = self.live_transcript.lock().unwrap();
                    lt.segments.push(DiarizedSegment {
                        speaker: "You".to_string(),
                        start_secs: start_s,
                        end_secs: end_s,
                        text: trimmed.to_string(),
                    });
                }
            }
        }

        if tail_sys.len() >= 24000 && Self::has_speech(&tail_sys, 0.008) {
            let end_s = meeting_audio.duration_secs;
            let start_s = (end_s - (tail_sys.len() as f32 / 16000.0)).max(0.0);
            if let Ok(text) = crate::actions::transcribe_audio(&self.app_handle, tail_sys, config.translate_to_english).await {
                let trimmed = text.trim();
                if !Self::is_hallucination(trimmed) {
                    let mut lt = self.live_transcript.lock().unwrap();
                    lt.segments.push(DiarizedSegment {
                        speaker: "Attendee".to_string(),
                        start_secs: start_s,
                        end_secs: end_s,
                        text: trimmed.to_string(),
                    });
                }
            }
        }

        // Finalize transcript from ongoing chunks
        let mut transcript = {
            let mut lt = self.live_transcript.lock().unwrap();
            lt.segments.sort_by(|a, b| a.start_secs.partial_cmp(&b.start_secs).unwrap_or(std::cmp::Ordering::Equal));
            lt.duration_secs = meeting_audio.duration_secs;
            let mut speakers: Vec<String> = Vec::new();
            for s in &lt.segments {
                if !speakers.contains(&s.speaker) {
                    speakers.push(s.speaker.clone());
                }
            }
            lt.speakers = speakers;
            lt.full_text = lt.segments
                .iter()
                .map(|s| format!("[{}] {}", s.speaker, s.text))
                .collect::<Vec<_>>()
                .join("\n");
            lt.clone()
        };

        // Fallback: If live transcript has no segments, run pipeline
        if transcript.segments.is_empty() {
            log::info!("Live transcript had no segments; running post-call pipeline fallback");
            let pipeline = MeetingPipeline::new(self.app_handle.clone(), self.transcription_manager.clone(), config.clone());
            transcript = pipeline.process(&meeting_audio).await?;

            // If English translation is enabled and segments contain non-English text, translate them
            if config.translate_to_english {
                Self::maybe_translate_transcript_to_english(&mut transcript, &settings).await;
            }
        }

        // Drop meeting_audio immediately to free high-memory audio buffers (~700MB for 1hr calls)
        drop(meeting_audio);

        log::info!("Meeting transcript produced: {} segments. Generating Minutes of Meeting (MOM)...", transcript.segments.len());
        let mom = MomGenerator::generate(&transcript, &settings).await.ok();

        let result = MeetingResult {
            transcript,
            mom,
        };

        *self.last_result.lock().unwrap() = Some(result.clone());

        // Automatically persist meeting to SQLite history and assistant workspace
        if let Some(history_mgr) = self.app_handle.try_state::<Arc<crate::managers::history::HistoryManager>>() {
            let title = result.mom.as_ref().map(|m| m.title.as_str()).unwrap_or("Meeting");
            let participants = result
                .mom
                .as_ref()
                .map(|m| m.participants.clone())
                .unwrap_or_else(|| result.transcript.speakers.clone());
            let summary_markdown = result.mom.as_ref().map(|m| m.summary_markdown.as_str()).unwrap_or("");
            let full_transcript = &result.transcript.full_text;
            let segments_json = serde_json::to_string(&result.transcript.segments).unwrap_or_default();

            if let Err(e) = history_mgr.save_meeting(
                title,
                result.transcript.duration_secs,
                &participants,
                summary_markdown,
                full_transcript,
                &segments_json,
            ) {
                log::warn!("Failed to save meeting to history database: {}", e);
            }
        }

        let _ = self.app_handle.emit("babbl://meeting_finished", &result);
        let _ = self.app_handle.emit(
            "babbl://meeting_state",
            serde_json::json!({
                "is_recording": false,
                "is_processing": false,
            }),
        );

        Ok(result)
    }

    async fn maybe_translate_transcript_to_english(
        transcript: &mut MeetingTranscript,
        settings: &crate::settings::AppSettings,
    ) {
        // Find configured provider
        let mut candidates = Vec::new();
        if let Some(p) = settings.active_post_process_provider() {
            candidates.push(p.clone());
        }
        if let Some(p) = settings.post_process_providers.iter().find(|p| p.id == settings.online_provider_id) {
            if !candidates.iter().any(|c| c.id == p.id) {
                candidates.push(p.clone());
            }
        }
        for p in &settings.post_process_providers {
            if !candidates.iter().any(|c| c.id == p.id) {
                candidates.push(p.clone());
            }
        }

        let mut active_cred: Option<(String, String, String)> = None;
        for provider in candidates {
            let mut api_key = settings.post_process_api_keys.get(&provider.id).cloned().unwrap_or_default();
            if api_key.trim().is_empty() {
                if let Some(alt) = settings.online_provider_api_keys.get(&provider.id) {
                    api_key = alt.clone();
                }
            }
            if api_key.trim().is_empty() {
                if provider.id == "groq" {
                    api_key = std::env::var("GROQ_API_KEY").unwrap_or_default();
                } else if provider.id == "openai" {
                    api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
                } else if provider.id == "gemini" {
                    api_key = std::env::var("GEMINI_API_KEY").unwrap_or_default();
                } else if provider.id == "openrouter" {
                    api_key = std::env::var("OPENROUTER_API_KEY").unwrap_or_default();
                } else if provider.id == "custom" {
                    api_key = "local-key".to_string();
                }
            }
            if !api_key.trim().is_empty() {
                let mut model = settings.post_process_models.get(&provider.id).cloned().unwrap_or_default();
                if model.trim().is_empty() {
                    model = match provider.id.as_str() {
                        "groq" => "openai/gpt-oss-120b".to_string(),
                        "openai" => "gpt-4o-mini".to_string(),
                        "gemini" => "gemini-1.5-flash".to_string(),
                        "openrouter" => "meta-llama/llama-3.1-8b-instruct".to_string(),
                        "cerebras" => "llama3.1-8b".to_string(),
                        _ => "llama-3.1-8b-instant".to_string(),
                    };
                }
                let base_url = if provider.base_url.trim().is_empty() {
                    match provider.id.as_str() {
                        "groq" => "https://api.groq.com/openai/v1".to_string(),
                        "openai" => "https://api.openai.com/v1".to_string(),
                        "gemini" => "https://generativelanguage.googleapis.com/v1beta/openai".to_string(),
                        "openrouter" => "https://openrouter.ai/api/v1".to_string(),
                        "cerebras" => "https://api.cerebras.ai/v1".to_string(),
                        "custom" => "http://localhost:11434/v1".to_string(),
                        _ => "https://api.groq.com/openai/v1".to_string(),
                    }
                } else {
                    provider.base_url.clone()
                };
                active_cred = Some((base_url, model, api_key));
                break;
            }
        }

        let (base_url, model, api_key) = match active_cred {
            Some(cred) => cred,
            None => return,
        };

        let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
        let client = reqwest::Client::new();
        for seg in &mut transcript.segments {
            // Check if text has non-ASCII characters indicating foreign language
            let has_non_ascii = seg.text.chars().any(|c| !c.is_ascii());
            if has_non_ascii && !seg.text.trim().is_empty() {
                let body = serde_json::json!({
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a professional meeting transcription assistant. Translate the following speech transcript into natural, accurate English. If it is already in English, return it unchanged. Output ONLY the English translation, with no explanation or notes."
                        },
                        {
                            "role": "user",
                            "content": &seg.text
                        }
                    ],
                    "temperature": 0.2
                });

                if let Ok(resp) = client
                    .post(&endpoint)
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("Content-Type", "application/json")
                    .json(&body)
                    .send()
                    .await
                {
                    if resp.status().is_success() {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            if let Some(trans) = json["choices"][0]["message"]["content"].as_str() {
                                let trimmed = trans.trim();
                                if !trimmed.is_empty() {
                                    let clean = crate::llm_client::strip_reasoning_blocks(trimmed);
                                    if !clean.trim().is_empty() {
                                        seg.text = clean.trim().to_string();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Rebuild full_text
        transcript.full_text = transcript
            .segments
            .iter()
            .map(|s| format!("[{:.2}s - {:.2}s] [{}]: {}", s.start_secs, s.end_secs, s.speaker, s.text))
            .collect::<Vec<_>>()
            .join("\n");
    }
}
