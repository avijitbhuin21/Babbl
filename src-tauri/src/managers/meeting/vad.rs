use super::types::SpeechInterval;
use crate::audio_toolkit::constants::WHISPER_SAMPLE_RATE;

const FRAME_MS: u64 = 30;
const FRAME_SAMPLES: usize = (WHISPER_SAMPLE_RATE as u64 * FRAME_MS / 1000) as usize; // 480 samples
const MIN_SPEECH_DURATION_MS: u64 = 350;
const SPEECH_HANGOVER_MS: u64 = 600;
const SPEECH_ENERGY_THRESHOLD: f32 = 0.012;

/// Detects continuous speech intervals from a 16 kHz mono audio buffer.
pub fn detect_speech_intervals(samples: &[f32], speaker_label: &str) -> Vec<SpeechInterval> {
    if samples.is_empty() {
        return Vec::new();
    }

    let mut intervals = Vec::new();
    let total_frames = samples.len() / FRAME_SAMPLES;

    let mut in_speech = false;
    let mut speech_start_ms = 0u64;
    let mut last_speech_ms = 0u64;

    for frame_idx in 0..total_frames {
        let start_sample = frame_idx * FRAME_SAMPLES;
        let end_sample = start_sample + FRAME_SAMPLES;
        let frame = &samples[start_sample..end_sample];

        let current_time_ms = frame_idx as u64 * FRAME_MS;

        // Compute frame RMS energy
        let sum_sq: f32 = frame.iter().map(|&s| s * s).sum();
        let rms = (sum_sq / FRAME_SAMPLES as f32).sqrt();

        let is_speech_frame = rms > SPEECH_ENERGY_THRESHOLD;

        if is_speech_frame {
            if !in_speech {
                in_speech = true;
                speech_start_ms = current_time_ms;
            }
            last_speech_ms = current_time_ms + FRAME_MS;
        } else if in_speech {
            // Check if silence exceeded hangover duration
            if current_time_ms > last_speech_ms + SPEECH_HANGOVER_MS {
                let duration = last_speech_ms.saturating_sub(speech_start_ms);
                if duration >= MIN_SPEECH_DURATION_MS {
                    intervals.push(SpeechInterval {
                        start_ms: speech_start_ms,
                        end_ms: last_speech_ms,
                        speaker: speaker_label.to_string(),
                    });
                }
                in_speech = false;
            }
        }
    }

    // Flush any pending interval at end of audio
    if in_speech {
        let duration = last_speech_ms.saturating_sub(speech_start_ms);
        if duration >= MIN_SPEECH_DURATION_MS {
            intervals.push(SpeechInterval {
                start_ms: speech_start_ms,
                end_ms: last_speech_ms,
                speaker: speaker_label.to_string(),
            });
        }
    }

    intervals
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_silence() {
        let silence = vec![0.0f32; 16000 * 2]; // 2 seconds of silence
        let intervals = detect_speech_intervals(&silence, "You");
        assert!(intervals.is_empty());
    }

    #[test]
    fn test_detect_speech_tone() {
        let mut audio = vec![0.0f32; 16000 * 3]; // 3 seconds
        // Generate a 440 Hz tone in the middle second (1.0s to 2.0s)
        for i in 16000..32000 {
            let t = i as f32 / 16000.0;
            audio[i] = (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.5;
        }

        let intervals = detect_speech_intervals(&audio, "Speaker 1");
        assert_eq!(intervals.len(), 1);
        assert!(intervals[0].start_ms >= 900 && intervals[0].start_ms <= 1100);
        assert!(intervals[0].end_ms >= 1900 && intervals[0].end_ms <= 2400);
        assert_eq!(intervals[0].speaker, "Speaker 1");
    }
}
