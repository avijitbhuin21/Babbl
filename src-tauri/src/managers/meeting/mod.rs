pub mod api_diarizer;
pub mod assistant;
pub mod email;
pub mod local_diarizer;
pub mod manager;
pub mod mom;
pub mod pipeline;
pub mod types;
pub mod vad;

pub use api_diarizer::ApiDiarizer;
pub use assistant::{
    AssistantQueryRequest, AssistantResponse, ChatMessage, CodeExecutionResult,
    MeetingAssistantAgent, SearchResult, WorkspaceFileEntry, WorkspaceManager,
};
pub use local_diarizer::LocalDiarizer;
pub use manager::MeetingManager;
pub use mom::{MeetingMom, MomGenerator};
pub use pipeline::MeetingPipeline;
pub use types::{
    DiarizationConfig, DiarizationMode, DiarizedSegment, MeetingResult, MeetingStatus,
    MeetingTranscript, SpeechInterval,
};
pub use vad::detect_speech_intervals;
