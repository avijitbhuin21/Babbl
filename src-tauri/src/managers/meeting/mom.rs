use chrono::Local;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::types::MeetingTranscript;
use crate::{llm_client, settings::AppSettings};

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct MeetingMom {
    pub title: String,
    pub created_at: String,
    pub duration_secs: f32,
    pub participants: Vec<String>,
    pub summary_markdown: String,
    pub raw_transcript: String,
}

pub struct MomGenerator;

impl MomGenerator {
    /// Generates structured Minutes of Meeting (MOM) in Markdown format.
    /// Uses the active LLM provider if configured, or falls back to an offline heuristic template.
    pub async fn generate(
        transcript: &MeetingTranscript,
        settings: &AppSettings,
    ) -> Result<MeetingMom, String> {
        let now_str = Local::now().format("%Y-%m-%d %H:%M").to_string();
        let title = format!("Meeting Summary - {}", Local::now().format("%B %d, %Y"));

        let participants = if transcript.speakers.is_empty() {
            vec!["Attendee".to_string()]
        } else {
            transcript.speakers.clone()
        };

        // Format transcript with timestamps and speakers for LLM
        let mut formatted_transcript = String::new();
        for seg in &transcript.segments {
            formatted_transcript.push_str(&format!(
                "[{:.2}s - {:.2}s] [{}]: {}\n",
                seg.start_secs, seg.end_secs, seg.speaker, seg.text
            ));
        }

        if formatted_transcript.trim().is_empty() {
            formatted_transcript = transcript.full_text.clone();
        }

        // Try generating with LLM
        let summary_markdown = match Self::generate_with_llm(&formatted_transcript, &participants, transcript.duration_secs, settings).await {
            Ok(llm_mom) => llm_mom,
            Err(e) => {
                log::warn!("LLM MOM generation failed ({}), using structured offline fallback", e);
                Self::generate_offline_fallback(&formatted_transcript, &participants, transcript.duration_secs, &now_str)
            }
        };

        Ok(MeetingMom {
            title,
            created_at: now_str,
            duration_secs: transcript.duration_secs,
            participants,
            summary_markdown,
            raw_transcript: transcript.full_text.clone(),
        })
    }

    async fn generate_with_llm(
        transcript_text: &str,
        participants: &[String],
        duration_secs: f32,
        settings: &AppSettings,
    ) -> Result<String, String> {
        // Find a provider with a valid API key.
        // First check active post-process provider, then online_provider_id, then any provider with a key.
        let mut candidates = Vec::new();

        // 1. Check active post-processing provider
        if let Some(p) = settings.active_post_process_provider() {
            candidates.push(p.clone());
        }

        // 2. Check online provider
        if let Some(p) = settings.post_process_providers.iter().find(|p| p.id == settings.online_provider_id) {
            if !candidates.iter().any(|c| c.id == p.id) {
                candidates.push(p.clone());
            }
        }

        // 3. Add all remaining known providers
        for p in &settings.post_process_providers {
            if !candidates.iter().any(|c| c.id == p.id) {
                candidates.push(p.clone());
            }
        }

        // Find the first candidate with an API key
        for provider in candidates {
            let mut api_key = settings.post_process_api_keys.get(&provider.id).cloned().unwrap_or_default();
            if api_key.trim().is_empty() {
                if let Some(alt_key) = settings.online_provider_api_keys.get(&provider.id) {
                    api_key = alt_key.clone();
                }
            }

            if !api_key.trim().is_empty() {
                let mut model = settings.post_process_models.get(&provider.id).cloned().unwrap_or_default();
                if model.trim().is_empty() {
                    model = match provider.id.as_str() {
                        "groq" => "openai/gpt-oss-120b".to_string(),
                        "openai" => "gpt-4o-mini".to_string(),
                        _ => "llama-3.1-8b-instant".to_string(),
                    };
                }
                log::info!("Generating MOM using LLM provider '{}' with model '{}'", provider.id, model);
                return Self::call_llm(&provider, &model, &api_key, transcript_text, participants, duration_secs).await;
            }
        }

        Err("No API key configured for any LLM post-processing provider".to_string())
    }

    async fn call_llm(
        provider: &crate::settings::PostProcessProvider,
        model: &str,
        api_key: &str,
        transcript_text: &str,
        participants: &[String],
        duration_secs: f32,
    ) -> Result<String, String> {
        let client = llm_client::create_client(provider, api_key.to_string())?;

        let model_name = if model.trim().is_empty() {
            if provider.id == "groq" {
                "openai/gpt-oss-120b"
            } else if provider.id == "openai" {
                "gpt-4o-mini"
            } else {
                "llama-3.1-8b-instant"
            }
        } else {
            model
        };

        let system_prompt = format!(
            "You are an executive assistant creating professional Minutes of Meeting (MOM).\n\
            Duration: {:.1} seconds\n\
            Participants: {}\n\n\
            Create a comprehensive, beautifully structured Minutes of Meeting in Markdown format with the following sections:\n\
            1. # Minutes of Meeting\n\
            2. ## Executive Summary (concise summary of the meeting, in English)\n\
            3. ## Key Discussion Points (grouped by topic with speaker attribution where relevant)\n\
            4. ## Decisions Made (bullet points)\n\
            5. ## Action Items & Next Steps (a Markdown table with columns: | Task | Assignee | Priority | Status |)\n\n\
            Ensure everything is written in professional, fluent English. Output ONLY the markdown document.",
            duration_secs,
            participants.join(", ")
        );

        let user_prompt = format!(
            "Here is the diarized transcript of the meeting:\n\n{}\n\nPlease produce the Minutes of Meeting (MOM) markdown.",
            transcript_text
        );

        let full_prompt = format!("System: {}\n\nUser: {}", system_prompt, user_prompt);
        let response = client.chat_completion(model_name, &full_prompt).await?;
        Ok(response)
    }

    fn generate_offline_fallback(
        transcript_text: &str,
        participants: &[String],
        duration_secs: f32,
        created_at: &str,
    ) -> String {
        format!(
            "# Minutes of Meeting (MOM)\n\n\
            **Date & Time:** {}\n\
            **Duration:** {:.1}s\n\
            **Participants:** {}\n\n\
            ---\n\n\
            ## Executive Summary\n\
            Discussion held with {} participant(s). Captured audio transcribed and diarized below.\n\n\
            ## Discussion Log\n\
            {}\n\n\
            ## Action Items\n\
            | Task | Assignee | Priority | Status |\n\
            |---|---|---|---|\n\
            | Review meeting transcript | All | Normal | Pending |\n",
            created_at,
            duration_secs,
            participants.join(", "),
            participants.len(),
            transcript_text
        )
    }
}
