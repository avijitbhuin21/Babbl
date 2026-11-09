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

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
pub struct MeetingEmailSettings {
    pub sender_email: String,
    pub has_password: bool,
    pub default_recipients: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub fn get_meeting_email_settings(app: AppHandle) -> Result<MeetingEmailSettings, String> {
    let settings = crate::settings::get_settings(&app);
    Ok(MeetingEmailSettings {
        sender_email: settings.meeting_sender_email,
        has_password: !settings.meeting_app_password.is_empty(),
        default_recipients: settings.meeting_default_recipients,
    })
}

#[tauri::command]
#[specta::specta]
pub fn save_meeting_email_settings(
    app: AppHandle,
    sender_email: String,
    app_password: Option<String>,
    default_recipients: Vec<String>,
) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app);
    settings.meeting_sender_email = sender_email;
    if let Some(pass) = app_password {
        if !pass.is_empty() {
            settings.meeting_app_password = pass;
        }
    }
    settings.meeting_default_recipients = default_recipients;
    crate::settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn clear_meeting_email_credentials(app: AppHandle) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app);
    settings.meeting_sender_email = String::new();
    settings.meeting_app_password = String::new();
    settings.meeting_default_recipients = Vec::new();
    crate::settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn send_meeting_mom_email(
    app: AppHandle,
    mut request: crate::managers::meeting::email::SendMomEmailRequest,
) -> Result<(), String> {
    if request.app_password.trim().is_empty() {
        let settings = crate::settings::get_settings(&app);
        if settings.meeting_app_password.is_empty() {
            return Err("No Gmail App Password provided or saved in backend settings.".to_string());
        }
        request.app_password = settings.meeting_app_password;
    }
    if request.sender_email.trim().is_empty() {
        let settings = crate::settings::get_settings(&app);
        if settings.meeting_sender_email.is_empty() {
            return Err("No sender email provided or saved in backend settings.".to_string());
        }
        request.sender_email = settings.meeting_sender_email;
    }
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

