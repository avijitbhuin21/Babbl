#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::transcription::TranscriptionManager;
use crate::notify;
use crate::settings::{get_settings, AppSettings, APPLE_INTELLIGENCE_PROVIDER_ID};
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils::{self, show_recording_overlay, show_transcribing_overlay, show_refining_overlay};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, warn};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::AppHandle;
use tauri::Manager;

// Shortcut Action Trait
pub trait ShortcutAction: Send + Sync {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

// Transcribe Action
struct TranscribeAction;

/// Online provider configuration for audio transcription
struct OnlineTranscriptionProvider {
    provider_id: String,
    base_url: String,
    model: String,
    api_key: String,
}

/// Convert f32 audio samples to WAV format in memory
/// Shared by both OpenAI-compatible and Gemini transcription flows
fn convert_samples_to_wav(audio_samples: &[f32]) -> Result<Vec<u8>, String> {
    use hound::{WavSpec, WavWriter};
    use std::io::Cursor;

    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut buffer = Cursor::new(Vec::new());
    {
        let mut writer = WavWriter::new(&mut buffer, spec)
            .map_err(|e| format!("Failed to create WAV writer: {}", e))?;

        for sample in audio_samples {
            let i16_sample = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
            writer
                .write_sample(i16_sample)
                .map_err(|e| format!("Failed to write sample: {}", e))?;
        }
        writer
            .finalize()
            .map_err(|e| format!("Failed to finalize WAV: {}", e))?;
    }

    Ok(buffer.into_inner())
}

/// Transcribe audio using an online provider (OpenAI, Groq, Gemini)
async fn transcribe_online(
    provider: OnlineTranscriptionProvider,
    audio_samples: Vec<f32>,
    language: Option<String>,
    translate_to_english: bool,
) -> Result<String, String> {
    // Providers without a Whisper-style audio endpoint use chat completions with audio input
    if provider.provider_id == "gemini" || provider.provider_id == "openrouter" {
        return transcribe_online_chat_audio(provider, audio_samples, language, translate_to_english).await;
    }

    // Standard OpenAI-compatible /audio/transcriptions flow for OpenAI and Groq
    use log::info;

    info!(
        "[Cloud Transcription] Starting with provider: {} (model: {})",
        provider.base_url, provider.model
    );
    if provider.api_key.is_empty() {
        error!("[Cloud Transcription] API key is empty");
    }

    // Convert samples to WAV format
    let wav_data = convert_samples_to_wav(&audio_samples).map_err(|e| {
        error!("[Cloud Transcription] {}", e);
        e
    })?;

    info!("[Cloud Transcription] Created WAV data: {} bytes ({:.1}s of audio)", 
        wav_data.len(), 
        audio_samples.len() as f32 / 16000.0
    );

    // Build the transcription/translation endpoint URL
    // The /audio/translations endpoint only works with Whisper models (whisper-1)
    // For other models (gpt-4o-transcribe, etc.), we use transcriptions with a prompt
    let base_url = provider.base_url.trim_end_matches('/');
    let is_whisper_model = provider.model.to_lowercase().contains("whisper");
    let use_translations_endpoint = translate_to_english && is_whisper_model;
    
    let endpoint = if use_translations_endpoint {
        format!("{}/audio/translations", base_url)
    } else {
        format!("{}/audio/transcriptions", base_url)
    };
    info!("[Cloud Transcription] Sending request to: {} (translate: {}, whisper: {})", endpoint, translate_to_english, is_whisper_model);

    // Create multipart form
    let form = reqwest::multipart::Form::new()
        .text("model", provider.model.clone())
        .part(
            "file",
            reqwest::multipart::Part::bytes(wav_data)
                .file_name("audio.wav")
                .mime_str("audio/wav")
                .map_err(|e| {
                    error!("[Cloud Transcription] Failed to set MIME type: {}", e);
                    format!("Failed to set MIME type: {}", e)
                })?,
        );

    // Add language if specified and not "auto" (not used for translations endpoint)
    let form = if !use_translations_endpoint {
        if let Some(ref lang) = language {
            if lang != "auto" {
                info!("[Cloud Transcription] Using language: {}", lang);
                form.text("language", lang.clone())
            } else {
                form
            }
        } else {
            form
        }
    } else {
        form
    };

    // Detect if this is a GPT-4o transcribe model (uses "instructions" instead of "prompt")
    let is_gpt4o_transcribe = provider.model.to_lowercase().contains("gpt-4o");
    
    // For GPT-4o transcribe models with translation enabled, use the "instructions" field
    // For other non-Whisper models, use the "prompt" field
    let form = if translate_to_english && !is_whisper_model {
        if is_gpt4o_transcribe {
            info!("[Cloud Transcription] Adding translation instructions for GPT-4o transcribe model");
            form.text("instructions", "Transcribe this audio and translate it to English. Output only the translated English text.")
        } else {
            info!("[Cloud Transcription] Adding translation prompt for non-Whisper model");
            form.text("prompt", "Please transcribe this audio and translate it to English.")
        }
    } else {
        form
    };

    // Create HTTP client with authorization header
    let client = reqwest::Client::new();
    info!("[Cloud Transcription] Sending POST request...");
    
    let response = client
        .post(&endpoint)
        .bearer_auth(&provider.api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| {
            error!("[Cloud Transcription] Network error - failed to send request: {}", e);
            format!("Failed to send transcription request: {}", e)
        })?;

    let status = response.status();
    info!("[Cloud Transcription] Received response with status: {}", status);

    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!(
            "[Cloud Transcription] API ERROR - Status: {}, Provider: {}, Model: {}, Response: {}",
            status, base_url, provider.model, error_text
        );
        return Err(format!(
            "Transcription request failed ({}): {}",
            status, error_text
        ));
    }

    // Parse the response - OpenAI returns { "text": "..." }
    let response_text = response
        .text()
        .await
        .map_err(|e| {
            error!("[Cloud Transcription] Failed to read response body: {}", e);
            format!("Failed to read response: {}", e)
        })?;

    debug!("[Cloud Transcription] Response body: {} bytes", response_text.len());

    let parsed: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| {
            error!("[Cloud Transcription] Failed to parse JSON response: {}", e);
            format!("Failed to parse response: {}", e)
        })?;

    let text = parsed
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    info!(
        "[Cloud Transcription] SUCCESS - Transcribed {} chars",
        text.len()
    );

    Ok(text)
}

/// Transcribe audio via an OpenAI-compatible chat completions API with multimodal audio input (Gemini, OpenRouter)
async fn transcribe_online_chat_audio(
    provider: OnlineTranscriptionProvider,
    audio_samples: Vec<f32>,
    language: Option<String>,
    translate_to_english: bool,
) -> Result<String, String> {
    use log::info;
    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

    let tag = format!("[Cloud Transcription - {}]", provider.provider_id);

    info!("{} Starting with model: {}", tag, provider.model);

    // Convert samples to WAV format
    let wav_data = convert_samples_to_wav(&audio_samples).map_err(|e| {
        error!("{} {}", tag, e);
        e
    })?;

    let audio_base64 = BASE64.encode(&wav_data);

    info!("{} Created WAV data: {} bytes, base64: {} chars", tag, wav_data.len(), audio_base64.len());

    // Build the chat completions endpoint URL
    let base_url = provider.base_url.trim_end_matches('/');
    let endpoint = format!("{}/chat/completions", base_url);
    info!("{} Sending request to: {}", tag, endpoint);

    // Build transcription prompt with optional translation
    let transcription_prompt = if translate_to_english {
        if let Some(ref lang) = language {
            if lang != "auto" {
                format!("Transcribe the following audio and translate it to English. The audio is in {}. Output ONLY the translated English text, nothing else.", lang)
            } else {
                "Transcribe the following audio and translate it to English. Output ONLY the translated English text, nothing else.".to_string()
            }
        } else {
            "Transcribe the following audio and translate it to English. Output ONLY the translated English text, nothing else.".to_string()
        }
    } else if let Some(ref lang) = language {
        if lang != "auto" {
            format!("Transcribe the following audio to text. The audio is in {}. Output ONLY the transcribed text, nothing else.", lang)
        } else {
            "Transcribe the following audio to text. Output ONLY the transcribed text, nothing else.".to_string()
        }
    } else {
        "Transcribe the following audio to text. Output ONLY the transcribed text, nothing else.".to_string()
    };

    // Build request body with multimodal content (text + audio)
    let request_body = serde_json::json!({
        "model": provider.model,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": transcription_prompt
                },
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": audio_base64,
                        "format": "wav"
                    }
                }
            ]
        }],
        "max_tokens": 4096
    });

    // Create HTTP client and send request
    let client = reqwest::Client::new();
    info!("{} Sending POST request...", tag);

    let mut request = client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .bearer_auth(&provider.api_key);
    if provider.provider_id == "openrouter" {
        request = request
            .header("HTTP-Referer", "https://github.com/avijitbhuin21/Babbl")
            .header("X-Title", "Babbl");
    }

    let response = request
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            error!("{} Network error: {}", tag, e);
            format!("Failed to send transcription request: {}", e)
        })?;

    let status = response.status();
    info!("{} Received response with status: {}", tag, status);

    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!(
            "{} API ERROR - Status: {}, Model: {}, Response: {}",
            tag, status, provider.model, error_text
        );
        return Err(format!(
            "{} transcription failed ({}): {}",
            provider.provider_id, status, error_text
        ));
    }

    // Parse the chat completion response
    let response_text = response
        .text()
        .await
        .map_err(|e| {
            error!("{} Failed to read response body: {}", tag, e);
            format!("Failed to read response: {}", e)
        })?;

    debug!("{} Response body: {} bytes", tag, response_text.len());

    let parsed: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| {
            error!("{} Failed to parse JSON: {}", tag, e);
            format!("Failed to parse response: {}", e)
        })?;

    // Extract text from chat completion response: choices[0].message.content
    let text = parsed
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    info!("{} SUCCESS - Transcribed {} chars", tag, text.len());

    Ok(text)
}

/// Get the online provider configuration from settings
fn get_online_transcription_provider(settings: &AppSettings) -> Option<OnlineTranscriptionProvider> {
    let provider_id = &settings.online_provider_id;
    let api_key = settings
        .online_provider_api_keys
        .get(provider_id)
        .cloned()
        .unwrap_or_default();

    if api_key.trim().is_empty() {
        error!(
            "Online transcription skipped: no API key for provider '{}'",
            provider_id
        );
        return None;
    }

    let model = settings
        .online_provider_models
        .get(provider_id)
        .cloned()
        .unwrap_or_else(|| {
            // Default models per provider
            match provider_id.as_str() {
                "openai" => "whisper-1".to_string(),
                "groq" => "whisper-large-v3-turbo".to_string(),
                "gemini" => "gemini-2.5-flash".to_string(),
                "openrouter" => "google/gemini-2.5-flash".to_string(),
                _ => "whisper-1".to_string(),
            }
        });

    // Provider base URLs
    let base_url = match provider_id.as_str() {
        "openai" => "https://api.openai.com/v1".to_string(),
        "groq" => "https://api.groq.com/openai/v1".to_string(),
        "gemini" => "https://generativelanguage.googleapis.com/v1beta/openai".to_string(),
        "openrouter" => "https://openrouter.ai/api/v1".to_string(),
        _ => {
            error!("Unknown online provider: {}", provider_id);
            return None;
        }
    };

    Some(OnlineTranscriptionProvider {
        provider_id: provider_id.clone(),
        base_url,
        model,
        api_key,
    })
}


async fn maybe_post_process_transcription(
    settings: &AppSettings,
    transcription: &str,
) -> Result<Option<String>, String> {
    if !settings.post_process_enabled {
        return Ok(None);
    }

    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => provider,
        None => {
            return Err("Post-processing is enabled but no provider is selected.".to_string());
        }
    };

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.trim().is_empty() {
        return Err(format!(
            "Post-processing provider '{}' has no model configured.",
            provider.label
        ));
    }

    let selected_prompt_id = match &settings.post_process_selected_prompt_id {
        Some(id) => id.clone(),
        None => {
            return Err("Post-processing is enabled but no prompt is selected.".to_string());
        }
    };

    let prompt = match settings
        .post_process_prompts
        .iter()
        .find(|prompt| prompt.id == selected_prompt_id)
    {
        Some(prompt) => prompt.prompt.clone(),
        None => {
            return Err(format!(
                "Selected post-processing prompt '{}' was not found.",
                selected_prompt_id
            ));
        }
    };

    if prompt.trim().is_empty() {
        return Err("The selected post-processing prompt is empty.".to_string());
    }

    debug!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );

    // Replace ${output} variable in the prompt with the actual text
    let processed_prompt = prompt.replace("${output}", transcription);
    debug!("Processed prompt length: {} chars", processed_prompt.len());

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                return Err("Apple Intelligence is selected but not currently available on this device.".to_string());
            }

            let token_limit = model.trim().parse::<i32>().unwrap_or(0);
            return match apple_intelligence::process_text(&processed_prompt, token_limit) {
                Ok(result) => {
                    if result.trim().is_empty() {
                        Err("Apple Intelligence returned an empty response.".to_string())
                    } else {
                        debug!(
                            "Apple Intelligence post-processing succeeded. Output length: {} chars",
                            result.len()
                        );
                        Ok(Some(result))
                    }
                }
                Err(err) => Err(format!("Apple Intelligence post-processing failed: {}", err)),
            };
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            return Err("Apple Intelligence is not available on this platform.".to_string());
        }
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let client = crate::llm_client::create_client(&provider, api_key)
        .map_err(|e| format!("Failed to create LLM client: {}", e))?;

    let content = client
        .chat_completion(&model, &processed_prompt)
        .await
        .map_err(|e| format!("LLM request to '{}' failed: {}", provider.label, e))?;

    if content.trim().is_empty() {
        return Err(format!("LLM '{}' returned an empty response.", provider.label));
    }

    debug!(
        "LLM post-processing succeeded for provider '{}'. Output length: {} chars",
        provider.id,
        content.len()
    );
    Ok(Some(content))
}

async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    // Check if language is set to Simplified or Traditional Chinese
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        return None;
    }

    debug!(
        "Starting Chinese translation using OpenCC for language: {}",
        settings.selected_language
    );

    // Use OpenCC to convert based on selected language
    let config = if is_simplified {
        // Convert Traditional Chinese to Simplified Chinese
        BuiltinConfig::Tw2sp
    } else {
        // Convert Simplified Chinese to Traditional Chinese
        BuiltinConfig::S2twp
    };

    match OpenCC::from_config(config) {
        Ok(converter) => {
            let converted = converter.convert(transcription);
            debug!(
                "OpenCC translation completed. Input length: {}, Output length: {}",
                transcription.len(),
                converted.len()
            );
            Some(converted)
        }
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}. Falling back to original transcription.", e);
            None
        }
    }
}

/// Holds the text that was selected when a refine-mode recording started.
#[derive(Default)]
pub struct RefineState {
    pub pending_selection: Mutex<Option<String>>,
}

/// True while a stop -> transcribe -> (refine) -> paste pipeline is running.
pub static PIPELINE_BUSY: AtomicBool = AtomicBool::new(false);

/// Clears PIPELINE_BUSY when the pipeline task ends, on every exit path.
struct BusyGuard;

impl Drop for BusyGuard {
    fn drop(&mut self) {
        PIPELINE_BUSY.store(false, Ordering::SeqCst);
    }
}

/// Replaces em/en dashes and double hyphens with plain punctuation so pasted text never contains them.
pub fn strip_em_dashes(text: &str) -> String {
    let mut out = text
        .replace(" \u{2014} ", ", ")
        .replace("\u{2014}", ", ")
        .replace(" \u{2013} ", ", ")
        .replace("\u{2013}", ", ")
        .replace(" -- ", ", ")
        .replace("--", ", ");
    while out.contains(",,") {
        out = out.replace(",,", ",");
    }
    out = out.replace(" ,", ",").replace(",  ", ", ");
    out = out.replace(", \n", ".\n").replace(", \r\n", ".\r\n");
    if let Some(stripped) = out.strip_suffix(", ") {
        out = format!("{}.", stripped);
    } else if let Some(stripped) = out.strip_suffix(",") {
        out = format!("{}.", stripped);
    }
    out
}

/// Rewrites the selected text according to a spoken instruction using the configured post-processing LLM.
async fn refine_selected_text(
    settings: &AppSettings,
    selected_text: &str,
    instruction: &str,
) -> Result<String, String> {
    let provider_id = if settings.refine_provider_id.trim().is_empty() {
        settings.post_process_provider_id.clone()
    } else {
        settings.refine_provider_id.clone()
    };
    let provider = settings
        .post_process_provider(&provider_id)
        .cloned()
        .ok_or_else(|| "No refine provider is selected. Configure one under Cloud Models > Refine.".to_string())?;

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        return Err("Refine mode requires an API-based provider.".to_string());
    }

    let model = settings
        .refine_models
        .get(&provider.id)
        .cloned()
        .filter(|m| !m.trim().is_empty())
        .or_else(|| settings.post_process_models.get(&provider.id).cloned())
        .unwrap_or_default();
    if model.trim().is_empty() {
        return Err(format!(
            "No refine model configured for provider '{}'. Pick one under Cloud Models > Refine.",
            provider.label
        ));
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();
    if api_key.trim().is_empty() && provider.id != "custom" {
        return Err(format!(
            "No API key configured for provider '{}'. Add one under Cloud Models > Refine.",
            provider.label
        ));
    }

    let prompt = format!(
        "You are a precise text editor. Rewrite the TEXT below by following the INSTRUCTION.\n\
         Rules:\n\
         - Return only the rewritten text. No explanations, quotes, titles, or preamble.\n\
         - Preserve the original language, formatting, and line breaks unless the instruction says otherwise.\n\
         - Never use em dashes or en dashes.\n\n\
         INSTRUCTION:\n{}\n\nTEXT:\n{}",
        instruction.trim(),
        selected_text
    );

    debug!(
        "Refine: provider '{}' model '{}', selection {} chars, instruction {} chars",
        provider.id,
        model,
        selected_text.len(),
        instruction.len()
    );

    let client = crate::llm_client::create_client(&provider, api_key)?;
    let content = client.chat_completion(&model, &prompt).await?;
    if content.trim().is_empty() {
        return Err("The model returned an empty response.".to_string());
    }
    Ok(content.trim().to_string())
}

/// Returns true when the refine binding is the same key as the transcribe binding.
pub fn refine_shares_transcribe_binding(settings: &AppSettings) -> bool {
    match (settings.bindings.get("refine"), settings.bindings.get("transcribe")) {
        (Some(r), Some(t)) => {
            r.current_binding.trim().eq_ignore_ascii_case(t.current_binding.trim())
        }
        _ => false,
    }
}

/// Decides whether this shortcut press should refine a selection and captures it if so.
fn resolve_refine_selection(app: &AppHandle, settings: &AppSettings, binding_id: &str) -> Result<Option<String>, String> {
    let is_refine_key = binding_id == "refine";
    let shared = refine_shares_transcribe_binding(settings);

    if !settings.refine_enabled {
        if is_refine_key {
            return Err("Refine mode is disabled in settings.".to_string());
        }
        return Ok(None);
    }

    let should_probe = is_refine_key || shared;
    if !should_probe {
        return Ok(None);
    }

    let selection = utils::capture_selected_text(app)?;
    match selection {
        Some(text) if !text.trim().is_empty() => {
            if text.chars().count() > MAX_REFINE_SELECTION_CHARS {
                return Err(format!(
                    "Selection is too long to refine ({} characters, max {}).",
                    text.chars().count(),
                    MAX_REFINE_SELECTION_CHARS
                ));
            }
            Ok(Some(text))
        }
        _ if is_refine_key && !shared => Err("Select some text first, then press the refine shortcut.".to_string()),
        _ => Ok(None),
    }
}

const MAX_REFINE_SELECTION_CHARS: usize = 20_000;

/// Resets UI state and reports a pipeline failure to the user.
fn fail_and_reset(app: &AppHandle, title: &str, message: &str) {
    notify::report_error(app, title, message);
    utils::hide_recording_overlay(app);
    change_tray_icon(app, TrayIconState::Idle);
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        if PIPELINE_BUSY.load(Ordering::SeqCst) {
            debug!("Ignoring shortcut press: previous transcription is still processing");
            if let Ok(mut states) = app.state::<crate::ManagedToggleState>().lock() {
                states.active_toggles.insert(binding_id.to_string(), false);
            }
            return;
        }

        let settings = get_settings(app);

        let selection = match resolve_refine_selection(app, &settings, binding_id) {
            Ok(selection) => selection,
            Err(message) => {
                notify::report_error(app, "Refine", &message);
                return;
            }
        };
        let is_refine = selection.is_some();
        if let Some(state) = app.try_state::<RefineState>() {
            if let Ok(mut pending) = state.pending_selection.lock() {
                *pending = selection;
            }
        }

        // Only load the local model if we're NOT using an online provider
        if !settings.use_online_provider {
            let tm = app.state::<Arc<TranscriptionManager>>();
            tm.initiate_model_load();
        } else {
            debug!("Using online provider for transcription, skipping local model load");
        }

        let binding_id = binding_id.to_string();
        change_tray_icon(app, TrayIconState::Recording);
        show_recording_overlay(app, is_refine);

        let rm = app.state::<Arc<AudioRecordingManager>>();

        // Get the microphone mode to determine audio feedback timing
        let is_always_on = settings.always_on_microphone;
        debug!("Microphone mode - always_on: {}, refine: {}", is_always_on, is_refine);

        let mut recording_started = false;
        if is_always_on {
            // Always-on mode: Play audio feedback immediately, then apply mute after sound finishes
            debug!("Always-on mode: Playing audio feedback immediately");
            let rm_clone = Arc::clone(&rm);
            let app_clone = app.clone();
            // The blocking helper exits immediately if audio feedback is disabled,
            // so we can always reuse this thread to ensure mute happens right after playback.
            std::thread::spawn(move || {
                play_feedback_sound_blocking(&app_clone, SoundType::Start);
                rm_clone.apply_mute();
            });

            recording_started = rm.try_start_recording(&binding_id);
            debug!("Recording started: {}", recording_started);
        } else {
            // On-demand mode: Start recording first, then play audio feedback, then apply mute
            // This allows the microphone to be activated before playing the sound
            debug!("On-demand mode: Starting recording first, then audio feedback");
            let recording_start_time = Instant::now();
            if rm.try_start_recording(&binding_id) {
                recording_started = true;
                debug!("Recording started in {:?}", recording_start_time.elapsed());
                // Small delay to ensure microphone stream is active
                let app_clone = app.clone();
                let rm_clone = Arc::clone(&rm);
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    debug!("Handling delayed audio feedback/mute sequence");
                    // Helper handles disabled audio feedback by returning early, so we reuse it
                    // to keep mute sequencing consistent in every mode.
                    play_feedback_sound_blocking(&app_clone, SoundType::Start);
                    rm_clone.apply_mute();
                });
            }
        }

        if recording_started {
            // Dynamically register the cancel shortcut in a separate task to avoid deadlock
            shortcut::register_cancel_shortcut(app);
        } else {
            take_pending_selection(app);
            fail_and_reset(
                app,
                "Recording",
                "Could not start recording. Check that a microphone is connected and not in use by another app.",
            );
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        // Unregister the cancel shortcut when transcription stops
        shortcut::unregister_cancel_shortcut(app);

        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());

        let selected_text = take_pending_selection(app);
        let is_refine = selected_text.is_some();

        if let Some(expected) = selected_text.as_deref() {
            match utils::capture_selected_text(app) {
                Ok(probe) => debug!(
                    "Refine: selection intact at stop press: {}",
                    probe.as_deref().map(str::trim) == Some(expected.trim())
                ),
                Err(e) => debug!("Refine: selection probe at stop failed: {}", e),
            }
        }

        change_tray_icon(app, TrayIconState::Transcribing);
        if is_refine {
            show_refining_overlay(app);
        } else {
            show_transcribing_overlay(app);
        }

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();

        // Play audio feedback for recording stop
        play_feedback_sound(app, SoundType::Stop);

        let binding_id = binding_id.to_string(); // Clone binding_id for the async task

        PIPELINE_BUSY.store(true, Ordering::SeqCst);

        tauri::async_runtime::spawn(async move {
            let _busy = BusyGuard;
            let binding_id = binding_id.clone(); // Clone for the inner async task
            debug!(
                "Starting async transcription task for binding: {}",
                binding_id
            );

            let stop_recording_time = Instant::now();
            let samples = match rm.stop_recording(&binding_id) {
                Some(samples) => samples,
                None => {
                    debug!("No samples retrieved from recording stop");
                    utils::hide_recording_overlay(&ah);
                    change_tray_icon(&ah, TrayIconState::Idle);
                    return;
                }
            };
            debug!(
                "Recording stopped and samples retrieved in {:?}, sample count: {}",
                stop_recording_time.elapsed(),
                samples.len()
            );

            let settings = get_settings(&ah);

            let transcription_time = Instant::now();
            let samples_clone = samples.clone(); // Clone for history saving

            // Use either online or local transcription based on settings
            let transcription_result: Result<String, String> = if settings.use_online_provider {
                debug!("Using online provider for transcription");
                if let Some(provider) = get_online_transcription_provider(&settings) {
                    let language = if settings.selected_language == "auto" {
                        None
                    } else {
                        Some(settings.selected_language.clone())
                    };
                    let translate = settings.translate_to_english;
                    transcribe_online(provider, samples, language, translate)
                        .await
                        .map_err(|e| format!("Online transcription failed: {}", e))
                } else {
                    Err("Online provider is not configured. Add an API key under Online Providers.".to_string())
                }
            } else {
                debug!("Using local model for transcription");
                tm.transcribe(samples).map_err(|e| e.to_string())
            };

            let transcription = match transcription_result {
                Ok(t) => t,
                Err(err) => {
                    fail_and_reset(&ah, "Transcription failed", &err);
                    return;
                }
            };

            debug!(
                "Transcription completed in {:?} ({} chars)",
                transcription_time.elapsed(),
                transcription.chars().count()
            );

            if transcription.trim().is_empty() {
                if is_refine {
                    notify::report_error(&ah, "Refine", "No instruction was heard. The selection was left unchanged.");
                }
                utils::hide_recording_overlay(&ah);
                change_tray_icon(&ah, TrayIconState::Idle);
                return;
            }

            let mut final_text = transcription.clone();
            let mut post_processed_text: Option<String> = None;
            let mut post_process_prompt: Option<String> = None;
            let mut replace_target: Option<String> = None;

            if let Some(selected) = selected_text {
                match refine_selected_text(&settings, &selected, &transcription).await {
                    Ok(refined) => {
                        let cleaned = strip_em_dashes(&refined);
                        final_text = cleaned.clone();
                        post_processed_text = Some(cleaned);
                        post_process_prompt = Some(format!("[refine] {}", transcription));
                        replace_target = Some(selected);
                    }
                    Err(err) => {
                        fail_and_reset(&ah, "Refine failed", &err);
                        return;
                    }
                }
            } else if let Some(converted_text) =
                maybe_convert_chinese_variant(&settings, &transcription).await
            {
                final_text = converted_text.clone();
                post_processed_text = Some(converted_text);
            } else if settings.post_process_enabled {
                match maybe_post_process_transcription(&settings, &transcription).await {
                    Ok(Some(processed_text)) => {
                        final_text = processed_text.clone();
                        post_processed_text = Some(processed_text);
                        if let Some(prompt_id) = &settings.post_process_selected_prompt_id {
                            if let Some(prompt) = settings
                                .post_process_prompts
                                .iter()
                                .find(|p| &p.id == prompt_id)
                            {
                                post_process_prompt = Some(prompt.prompt.clone());
                            }
                        }
                    }
                    Ok(None) => {}
                    Err(err) => {
                        warn!("Post-processing failed, pasting raw transcription: {}", err);
                        notify::report_error(
                            &ah,
                            "Post-processing failed",
                            &format!("{} The raw transcription was pasted instead.", err),
                        );
                    }
                }
            }

            // Save to history with post-processed text and prompt
            let hm_clone = Arc::clone(&hm);
            let transcription_for_history = transcription.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = hm_clone
                    .save_transcription(
                        samples_clone,
                        transcription_for_history,
                        post_processed_text,
                        post_process_prompt,
                    )
                    .await
                {
                    error!("Failed to save transcription to history: {}", e);
                }
            });

            // Paste the final text (either processed or original)
            let ah_clone = ah.clone();
            let paste_time = Instant::now();
            ah.run_on_main_thread(move || {
                let result = match replace_target.as_deref() {
                    Some(expected) => utils::paste_over_selection(expected, final_text, &ah_clone).map(|replaced| {
                        if !replaced {
                            notify::report_error(
                                &ah_clone,
                                "Refine",
                                "Could not re-select the original text, so the result was inserted at the cursor instead of replacing it.",
                            );
                        }
                    }),
                    None => utils::paste(final_text, ah_clone.clone()),
                };
                match result {
                    Ok(()) => debug!(
                        "Text pasted successfully in {:?}",
                        paste_time.elapsed()
                    ),
                    Err(e) => notify::report_error(&ah_clone, "Paste failed", &e),
                }
                // Hide the overlay after transcription is complete
                utils::hide_recording_overlay(&ah_clone);
                change_tray_icon(&ah_clone, TrayIconState::Idle);
            })
            .unwrap_or_else(|e| {
                fail_and_reset(&ah, "Paste failed", &format!("Could not run paste on main thread: {:?}", e));
            });
        });

        debug!(
            "TranscribeAction::stop completed in {:?}",
            stop_time.elapsed()
        );
    }
}

/// Takes and clears the pending refine selection, if any.
pub fn take_pending_selection(app: &AppHandle) -> Option<String> {
    app.try_state::<RefineState>()
        .and_then(|state| state.pending_selection.lock().ok().and_then(|mut p| p.take()))
}

#[cfg(test)]
mod tests {
    use super::strip_em_dashes;

    #[test]
    fn replaces_em_dashes_between_words() {
        assert_eq!(
            strip_em_dashes("This is good \u{2014} really good."),
            "This is good, really good."
        );
    }

    #[test]
    fn replaces_tight_em_dashes_and_double_hyphens() {
        assert_eq!(strip_em_dashes("fast\u{2014}and cheap--too"), "fast, and cheap, too");
    }

    #[test]
    fn handles_trailing_and_line_end_dashes() {
        assert_eq!(strip_em_dashes("First point \u{2014}\nSecond \u{2014}"), "First point.\nSecond.");
    }

    #[test]
    fn leaves_text_without_dashes_untouched() {
        assert_eq!(strip_em_dashes("Plain text, with a hyphen-word."), "Plain text, with a hyphen-word.");
    }
}

// Cancel Action
struct CancelAction;

impl ShortcutAction for CancelAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        utils::cancel_current_operation(app);
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing to do on stop for cancel
    }
}

// Test Action
struct TestAction;

impl ShortcutAction for TestAction {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Started - {} (App: {})",
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Stopped - {} (App: {})",
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }
}

// Static Action Map
pub static ACTION_MAP: Lazy<HashMap<String, Arc<dyn ShortcutAction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "cancel".to_string(),
        Arc::new(CancelAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "test".to_string(),
        Arc::new(TestAction) as Arc<dyn ShortcutAction>,
    );
    map
});
