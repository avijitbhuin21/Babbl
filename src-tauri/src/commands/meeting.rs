use std::sync::Arc;
use tauri::{AppHandle, Manager};

use crate::managers::history::{HistoryManager, PastMeetingRecord};
use crate::managers::meeting::{
    assistant::{AssistantQueryRequest, AssistantResponse, MeetingAssistantAgent},
    types::{DiarizationConfig, MeetingResult, MeetingStatus, MeetingTranscript},
    MeetingManager,
};

#[tauri::command]
#[specta::specta]
pub fn start_meeting(app: AppHandle, config: DiarizationConfig) -> Result<(), String> {
    let meeting_manager = app.state::<Arc<MeetingManager>>();
    meeting_manager.start_meeting(config)
}

#[tauri::command]
#[specta::specta]
pub async fn stop_meeting(app: AppHandle) -> Result<MeetingResult, String> {
    let meeting_manager = app.state::<Arc<MeetingManager>>().inner().clone();
    meeting_manager.stop_meeting().await
}

#[tauri::command]
#[specta::specta]
pub fn get_meeting_status(app: AppHandle) -> Result<MeetingStatus, String> {
    let meeting_manager = app.state::<Arc<MeetingManager>>();
    Ok(meeting_manager.get_status())
}

#[tauri::command]
#[specta::specta]
pub fn get_last_meeting(app: AppHandle) -> Result<Option<MeetingResult>, String> {
    let meeting_manager = app.state::<Arc<MeetingManager>>();
    Ok(meeting_manager.get_last_meeting())
}

#[tauri::command]
#[specta::specta]
pub fn get_live_meeting_transcript(app: AppHandle) -> Result<MeetingTranscript, String> {
    let meeting_manager = app.state::<Arc<MeetingManager>>();
    Ok(meeting_manager.get_live_transcript())
}

#[tauri::command]
#[specta::specta]
pub async fn send_meeting_mom_email(
    _app: AppHandle,
    request: crate::managers::meeting::email::SendMomEmailRequest,
) -> Result<(), String> {
    crate::managers::meeting::email::send_mom_email(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn ask_meeting_assistant(
    app: AppHandle,
    request: AssistantQueryRequest,
) -> Result<AssistantResponse, String> {
    MeetingAssistantAgent::ask(&app, request).await
}

#[tauri::command]
#[specta::specta]
pub fn get_past_meetings(
    app: AppHandle,
    query: Option<String>,
) -> Result<Vec<PastMeetingRecord>, String> {
    let history_mgr = app
        .try_state::<Arc<HistoryManager>>()
        .ok_or_else(|| "HistoryManager state not found".to_string())?;
    history_mgr
        .get_past_meetings(query.as_deref())
        .map_err(|e| format!("Failed to retrieve meetings: {}", e))
}

