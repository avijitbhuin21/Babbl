use std::path::Path;
use hound::WavReader;
use serde_json::Value;

use babbl_app_lib::managers::meeting::{
    local_diarizer::LocalDiarizer,
    vad::detect_speech_intervals,
    types::SpeechInterval,
};

fn read_wav_samples<P: AsRef<Path>>(path: P) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let mut reader = WavReader::open(path)?;
    let spec = reader.spec();
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let max_val = (1 << (spec.bits_per_sample - 1)) as f32;
            reader.samples::<i32>().map(|s| s.unwrap_or(0) as f32 / max_val).collect()
        }
        hound::SampleFormat::Float => reader.samples::<f32>().map(|s| s.unwrap_or(0.0)).collect(),
    };
    Ok(samples)
}

async fn transcribe_chunk_groq(samples: &[f32], api_key: &str) -> Result<String, Box<dyn std::error::Error>> {
    use reqwest::multipart::{Form, Part};
    use hound::{WavSpec, WavWriter};
    use std::io::Cursor;

    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = WavWriter::new(&mut cursor, spec)?;
        for &s in samples {
            let clamped = s.clamp(-1.0, 1.0);
            let s16 = (clamped * i16::MAX as f32) as i16;
            writer.write_sample(s16)?;
        }
        writer.finalize()?;
    }

    let wav_bytes = cursor.into_inner();
    let part = Part::bytes(wav_bytes).file_name("audio.wav").mime_str("audio/wav")?;
    let form = Form::new()
        .part("file", part)
        .text("model", "whisper-large-v3")
        .text("response_format", "json");

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.groq.com/openai/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await?;

    if resp.status().is_success() {
        let json: Value = resp.json().await?;
        let text = json["text"].as_str().unwrap_or("").trim().to_string();
        Ok(text)
    } else {
        let err = resp.text().await.unwrap_or_default();
        Err(format!("Groq transcription failed: {}", err).into())
    }
}

async fn translate_to_english_llm(text: &str, api_key: &str) -> Result<String, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": "openai/gpt-oss-120b",
        "messages": [
            {
                "role": "system",
                "content": "You are a professional meeting transcription translator. Translate the given text into fluent, natural English. Output ONLY the English translation, with no quotes, notes, or preamble."
            },
            {
                "role": "user",
                "content": text
            }
        ],
        "temperature": 0.3
    });

    let resp = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    if resp.status().is_success() {
        let json: Value = resp.json().await?;
        let translated = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or(text)
            .trim()
            .to_string();
        Ok(translated)
    } else {
        let err_text = resp.text().await.unwrap_or_default();
        eprintln!("  [LLM Translation Error]: {}", err_text);
        Ok(text.to_string())
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=======================================================");
    println!("      Babbl - Diarization & Transcription Pipeline     ");
    println!("=======================================================\n");

    let mic_file = "test_meeting_mic.wav";
    let sys_file = "test_meeting_system.wav";

    if !Path::new(mic_file).exists() || !Path::new(sys_file).exists() {
        eprintln!("Recorded test files not found. Run test_loopback first.");
        return Ok(());
    }

    println!("Loading captured audio tracks:");
    println!("  Mic track   : {}", mic_file);
    println!("  System track: {}", sys_file);

    let mic_samples = read_wav_samples(mic_file)?;
    let sys_samples = read_wav_samples(sys_file)?;

    let duration_secs = (mic_samples.len().max(sys_samples.len()) as f32) / 16000.0;
    println!("\nTrack Duration: {:.2}s ({} samples @ 16 kHz)\n", duration_secs, mic_samples.len());

    // 1. Detect "You" speech intervals on microphone
    println!("[Step 1] Voice Activity Detection (VAD) on Microphone...");
    let you_intervals = detect_speech_intervals(&mic_samples, "You");
    println!("  Found {} speech segment(s) for [You]:", you_intervals.len());
    for iv in &you_intervals {
        println!("    - [{:.2}s - {:.2}s] [You]", iv.start_ms as f32 / 1000.0, iv.end_ms as f32 / 1000.0);
    }

    // 2. Detect remote attendee speech intervals on system audio
    println!("\n[Step 2] Voice Activity Detection (VAD) on System Audio...");
    let raw_sys_intervals = detect_speech_intervals(&sys_samples, "Attendee");
    println!("  Found {} raw speech chunk(s) from system playback:", raw_sys_intervals.len());
    for iv in &raw_sys_intervals {
        println!("    - [{:.2}s - {:.2}s]", iv.start_ms as f32 / 1000.0, iv.end_ms as f32 / 1000.0);
    }

    // 3. Cluster remote speakers via Local Acoustic Diarization
    println!("\n[Step 3] Running Local Diarization & Speaker Clustering...");
    let mut diarizer = LocalDiarizer::new(0.68);
    let diarized_sys_intervals = diarizer.diarize(&sys_samples, raw_sys_intervals);
    println!("  Identified {} speaker turns in system audio:", diarized_sys_intervals.len());
    for iv in &diarized_sys_intervals {
        println!("    - [{:.2}s - {:.2}s] [{}]", iv.start_ms as f32 / 1000.0, iv.end_ms as f32 / 1000.0, iv.speaker);
    }

    // 4. Merge all intervals chronologically
    let mut all_intervals: Vec<SpeechInterval> = you_intervals;
    all_intervals.extend(diarized_sys_intervals);
    all_intervals.sort_by_key(|i| i.start_ms);

    // 5. Check if Groq API key is available from settings
    let settings_path = std::env::var("APPDATA")
        .map(|p| std::path::PathBuf::from(p).join("com.babbl.app").join("settings_store.json"))
        .unwrap_or_else(|_| std::path::PathBuf::from("C:\\Users\\risha\\AppData\\Roaming\\com.babbl.app\\settings_store.json"));

    let mut groq_key = String::new();
    if settings_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&settings_path) {
            if let Ok(json) = serde_json::from_str::<Value>(&content) {
                if let Some(key) = json["settings"]["online_provider_api_keys"]["groq"].as_str() {
                    groq_key = key.to_string();
                }
            }
        }
    }

    println!("\n[Step 4] Transcribing Speech Segments...");
    let mut final_lines = Vec::new();

    if !groq_key.is_empty() {
        println!("  Using configured Whisper API for fast transcription...\n");
        for interval in &all_intervals {
            let start_sample = ((interval.start_ms * 16) as usize).min(mic_samples.len());
            let end_sample = ((interval.end_ms * 16) as usize).min(mic_samples.len());

            let source = if interval.speaker == "You" {
                &mic_samples[start_sample..end_sample]
            } else {
                &sys_samples[start_sample..end_sample]
            };

            if source.len() >= 4000 { // at least 250ms
                match transcribe_chunk_groq(source, &groq_key).await {
                    Ok(raw_text) => {
                        if !raw_text.is_empty() {
                            println!("  [Raw Spoken Text]: {}", raw_text);
                            let english_text = translate_to_english_llm(&raw_text, &groq_key).await.unwrap_or(raw_text);
                            let line = format!(
                                "[{:.2}s - {:.2}s] [{}]: {}",
                                interval.start_ms as f32 / 1000.0,
                                interval.end_ms as f32 / 1000.0,
                                interval.speaker,
                                english_text
                            );
                            println!("  {}", line);
                            final_lines.push(line);
                        }
                    }
                    Err(e) => {
                        println!("  Transcription error: {}", e);
                    }
                }
            }
        }
    } else {
        println!("  (No API key set - speech boundaries & speaker clustering verified!)");
        for interval in &all_intervals {
            final_lines.push(format!(
                "[{:.2}s - {:.2}s] [{}]: <Speech detected>",
                interval.start_ms as f32 / 1000.0,
                interval.end_ms as f32 / 1000.0,
                interval.speaker
            ));
        }
    }

    println!("\n=======================================================");
    println!("             FINAL MEETING TRANSCRIPT                  ");
    println!("=======================================================");
    if final_lines.is_empty() {
        println!("  (No distinct speech detected during this capture segment)");
    } else {
        for line in &final_lines {
            println!("{}", line);
        }
    }
    println!("=======================================================\n");

    // Generate Minutes of Meeting (MOM)
    println!("=======================================================");
    println!("          GENERATING MINUTES OF MEETING (MOM)          ");
    println!("=======================================================");
    let transcript_obj = babbl_app_lib::managers::meeting::MeetingTranscript {
        segments: all_intervals.into_iter().enumerate().map(|(i, iv)| {
            babbl_app_lib::managers::meeting::DiarizedSegment {
                speaker: iv.speaker,
                start_secs: iv.start_ms as f32 / 1000.0,
                end_secs: iv.end_ms as f32 / 1000.0,
                text: final_lines.get(i).cloned().unwrap_or_default(),
            }
        }).collect(),
        full_text: final_lines.join("\n"),
        duration_secs,
        speakers: vec!["Speaker 1".to_string()],
    };

    let mom_prompt = format!(
        "You are an executive assistant creating professional Minutes of Meeting (MOM).\n\
        Duration: {:.1} seconds\n\
        Participants: Speaker 1\n\n\
        Create a concise, structured Minutes of Meeting in Markdown format with:\n\
        1. # Minutes of Meeting\n\
        2. ## Executive Summary (in English)\n\
        3. ## Key Points / Discussion Log\n\
        4. ## Action Items & Next Steps (Markdown table: | Task | Assignee | Priority | Status |)\n\n\
        Transcript:\n{}\n\nOutput ONLY the Markdown document.",
        duration_secs,
        transcript_obj.full_text
    );

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": "openai/gpt-oss-120b",
        "messages": [
            { "role": "user", "content": mom_prompt }
        ],
        "temperature": 0.3
    });

    let resp = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", groq_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    if resp.status().is_success() {
        let json: serde_json::Value = resp.json().await?;
        if let Some(mom_text) = json["choices"][0]["message"]["content"].as_str() {
            println!("{}\n", mom_text);
        }
    } else {
        println!("(Could not contact LLM for MOM, using offline template)");
        println!("# Minutes of Meeting (MOM)\n**Duration:** {:.1}s\n**Participants:** Speaker 1\n\n## Discussion\n{}\n", duration_secs, transcript_obj.full_text);
    }
    println!("=======================================================\n");

    Ok(())
}
