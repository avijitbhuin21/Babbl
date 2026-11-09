use serde::{Deserialize, Serialize};
use specta::Type;

/// A timestamped transcript segment tagged with speaker attribution.
#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
pub struct DiarizedSegment {
    /// Speaker label: "You" for the local user, "Speaker 1", "Speaker 2", etc. for remote attendees.
    pub speaker: String,
    pub start_secs: f32,
    pub end_secs: f32,
    pub text: String,
}

/// Complete structured meeting transcript.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct MeetingTranscript {
    pub segments: Vec<DiarizedSegment>,
    pub full_text: String,
    pub duration_secs: f32,
    pub speakers: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
pub enum DiarizationMode {
    /// Local on-device clustering using acoustic voice embeddings
    Local,
    /// Cloud API diarization (Deepgram Nova-2, AssemblyAI, etc.)
    CloudApi,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct DiarizationConfig {
    pub mode: DiarizationMode,
    /// Cosine similarity threshold for local clustering (0.0 to 1.0, default: 0.70)
    pub similarity_threshold: f32,
    /// Optional API key for Cloud API diarization
    pub api_key: Option<String>,
    /// Cloud provider name (e.g. "deepgram", "assemblyai")
    pub api_provider: Option<String>,
    /// Whether to translate speech into English
    pub translate_to_english: bool,
}

impl Default for DiarizationConfig {
    fn default() -> Self {
        Self {
            mode: DiarizationMode::Local,
            similarity_threshold: 0.70,
            api_key: None,
            api_provider: Some("deepgram".to_string()),
            translate_to_english: true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct MeetingStatus {
    pub is_recording: bool,
    pub elapsed_secs: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct MeetingResult {
    pub transcript: MeetingTranscript,
    pub mom: Option<super::mom::MeetingMom>,
}

/// Raw interval of detected speech in milliseconds.
#[derive(Clone, Debug, PartialEq)]
pub struct SpeechInterval {
    pub start_ms: u64,
    pub end_ms: u64,
    pub speaker: String,
}
