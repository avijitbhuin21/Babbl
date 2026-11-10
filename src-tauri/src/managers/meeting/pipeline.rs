use std::collections::HashSet;
use std::sync::Arc;

use super::{
    local_diarizer::LocalDiarizer,
    types::{DiarizationConfig, DiarizedSegment, MeetingTranscript},
    vad::detect_speech_intervals,
};
use crate::{
    audio_toolkit::{constants::WHISPER_SAMPLE_RATE, MeetingAudio},
    managers::transcription::TranscriptionManager,
};

pub struct MeetingPipeline {
    app_handle: tauri::AppHandle,
    transcription_manager: Arc<TranscriptionManager>,
    config: DiarizationConfig,
}

impl MeetingPipeline {
    pub fn new(
        app_handle: tauri::AppHandle,
        transcription_manager: Arc<TranscriptionManager>,
        config: DiarizationConfig,
    ) -> Self {
        Self {
            app_handle,
            transcription_manager,
            config,
        }
    }

    /// Processes dual-channel meeting audio into a structured, speaker-labeled transcript.
    pub async fn process(&self, audio: &MeetingAudio) -> Result<MeetingTranscript, String> {
        let duration_secs = audio.duration_secs;

        if audio.mic_samples.is_empty() && audio.system_samples.is_empty() {
            return Ok(MeetingTranscript {
                segments: Vec::new(),
                full_text: String::new(),
                duration_secs: 0.0,
                speakers: Vec::new(),
            });
        }

        // 1. Detect "You" speech intervals on the microphone track
        let you_intervals = detect_speech_intervals(&audio.mic_samples, "You");

        let mut final_segments = Vec::new();

        // 2a. Detect remote attendee speech intervals on the system loopback track
        let raw_remote_intervals = detect_speech_intervals(&audio.system_samples, "Attendee");

        // 2b. Cluster remote speaker intervals
        let mut diarizer = LocalDiarizer::new(self.config.similarity_threshold);
        let remote_intervals = diarizer.diarize(&audio.system_samples, raw_remote_intervals);

        // 2c. Merge and sort all intervals chronologically
        let mut all_intervals = you_intervals;
        all_intervals.extend(remote_intervals);
        all_intervals.sort_by_key(|i| i.start_ms);

        // Consolidate consecutive speech intervals for the same speaker if silence gap <= 2.5s
        // and combined duration <= 28s. This vastly reduces API calls and avoids 429 RPM limits.
        let mut consolidated_intervals: Vec<super::types::SpeechInterval> = Vec::new();
        for interval in all_intervals {
            if let Some(last) = consolidated_intervals.last_mut() {
                let gap = interval.start_ms.saturating_sub(last.end_ms);
                let combined_duration = interval.end_ms.saturating_sub(last.start_ms);
                if last.speaker == interval.speaker && gap <= 2500 && combined_duration <= 28_000 {
                    last.end_ms = interval.end_ms;
                    continue;
                }
            }
            consolidated_intervals.push(interval);
        }

        log::info!(
            "[MeetingPipeline] Processing {} speech chunks (merged from raw speech intervals)",
            consolidated_intervals.len()
        );

        // 2d. Transcribe each speech interval
        for interval in consolidated_intervals {
            let start_sample = ((interval.start_ms as f64 * WHISPER_SAMPLE_RATE as f64) / 1000.0) as usize;
            let end_sample = ((interval.end_ms as f64 * WHISPER_SAMPLE_RATE as f64) / 1000.0) as usize;

            // Choose appropriate track for audio slice
            let source_track = if interval.speaker == "You" {
                &audio.mic_samples
            } else {
                &audio.system_samples
            };

            if start_sample >= source_track.len() {
                continue;
            }
            let end_sample = end_sample.min(source_track.len());
            let slice = &source_track[start_sample..end_sample];

            if slice.len() < (WHISPER_SAMPLE_RATE as usize / 4) {
                // Skip chunks shorter than 250ms
                continue;
            }

            // Transcribe slice
            let text = crate::actions::transcribe_audio(
                &self.app_handle,
                slice.to_vec(),
                self.config.translate_to_english,
            )
            .await
            .map_err(|e| format!("Meeting transcription failed: {}", e))?;

            let trimmed = text.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }

            final_segments.push(DiarizedSegment {
                speaker: interval.speaker,
                start_secs: interval.start_ms as f32 / 1000.0,
                end_secs: interval.end_ms as f32 / 1000.0,
                text: trimmed,
            });

            // Modest throttle between chunks to pace requests evenly
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }

        // 4. Build formatted full transcript text
        let mut full_text_lines = Vec::new();
        let mut speaker_set = HashSet::new();

        for seg in &final_segments {
            speaker_set.insert(seg.speaker.clone());
            let start_min = (seg.start_secs / 60.0).floor() as u32;
            let start_sec = (seg.start_secs % 60.0).floor() as u32;
            let end_min = (seg.end_secs / 60.0).floor() as u32;
            let end_sec = (seg.end_secs % 60.0).floor() as u32;

            full_text_lines.push(format!(
                "[{:02}:{:02} - {:02}:{:02}] [{}]: {}",
                start_min, start_sec, end_min, end_sec, seg.speaker, seg.text
            ));
        }

        let mut speakers: Vec<String> = speaker_set.into_iter().collect();
        speakers.sort();

        let full_text = full_text_lines.join("\n");

        Ok(MeetingTranscript {
            segments: final_segments,
            full_text,
            duration_secs,
            speakers,
        })
    }
}
