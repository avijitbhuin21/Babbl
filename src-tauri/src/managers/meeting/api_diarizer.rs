use super::types::DiarizedSegment;
use hound::{WavSpec, WavWriter};
use reqwest::Client;
use serde::Deserialize;
use std::io::Cursor;

#[derive(Deserialize, Debug)]
struct DeepgramResponse {
    results: Option<DeepgramResults>,
}

#[derive(Deserialize, Debug)]
struct DeepgramResults {
    utterances: Option<Vec<DeepgramUtterance>>,
}

#[derive(Deserialize, Debug)]
struct DeepgramUtterance {
    start: f32,
    end: f32,
    speaker: usize,
    transcript: String,
}

pub struct ApiDiarizer {
    client: Client,
    api_key: String,
    provider: String,
}

impl ApiDiarizer {
    pub fn new(api_key: String, provider: Option<String>) -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_else(|_| Client::new()),
            api_key,
            provider: provider.unwrap_or_else(|| "deepgram".to_string()),
        }
    }

    /// Uploads audio samples to the cloud diarization provider and returns speaker segments.
    pub async fn diarize_and_transcribe(
        &self,
        samples: &[f32],
    ) -> Result<Vec<DiarizedSegment>, String> {
        if samples.is_empty() {
            return Ok(Vec::new());
        }

        if self.api_key.trim().is_empty() {
            return Err("Cloud diarization API key is empty. Configure it in settings.".to_string());
        }

        let wav_bytes = convert_samples_to_wav(samples)
            .map_err(|e| format!("Failed to encode WAV for API diarization: {}", e))?;

        match self.provider.to_lowercase().as_str() {
            "deepgram" | _ => self.call_deepgram(wav_bytes).await,
        }
    }

    async fn call_deepgram(&self, wav_bytes: Vec<u8>) -> Result<Vec<DiarizedSegment>, String> {
        let url = "https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&punctuate=true&utterances=true";

        let response = self
            .client
            .post(url)
            .header("Authorization", format!("Token {}", self.api_key.trim()))
            .header("Content-Type", "audio/wav")
            .body(wav_bytes)
            .send()
            .await
            .map_err(|e| format!("Deepgram request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Deepgram API returned {}: {}", status, body));
        }

        let parsed: DeepgramResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Deepgram response: {}", e))?;

        let mut segments = Vec::new();

        if let Some(results) = parsed.results {
            if let Some(utterances) = results.utterances {
                for u in utterances {
                    let text = u.transcript.trim().to_string();
                    if text.is_empty() {
                        continue;
                    }
                    segments.push(DiarizedSegment {
                        speaker: format!("Speaker {}", u.speaker + 1),
                        start_secs: u.start,
                        end_secs: u.end,
                        text,
                    });
                }
            }
        }

        Ok(segments)
    }
}

fn convert_samples_to_wav(samples: &[f32]) -> Result<Vec<u8>, hound::Error> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: crate::audio_toolkit::constants::WHISPER_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = WavWriter::new(&mut cursor, spec)?;
        for &sample in samples {
            let clamped = sample.clamp(-1.0, 1.0);
            let s16 = (clamped * i16::MAX as f32) as i16;
            writer.write_sample(s16)?;
        }
        writer.finalize()?;
    }

    Ok(cursor.into_inner())
}
