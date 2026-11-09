use super::types::SpeechInterval;
use crate::audio_toolkit::constants::WHISPER_SAMPLE_RATE;

const BUCKETS: usize = 16;

#[derive(Clone, Debug)]
struct SpeakerCentroid {
    speaker_id: usize,
    label: String,
    centroid: Vec<f32>,
    count: usize,
}

pub struct LocalDiarizer {
    threshold: f32,
    speakers: Vec<SpeakerCentroid>,
}

impl LocalDiarizer {
    pub fn new(threshold: f32) -> Self {
        Self {
            threshold: threshold.clamp(0.1, 0.99),
            speakers: Vec::new(),
        }
    }

    /// Extracts acoustic feature vectors for each speech interval and clusters them by speaker.
    pub fn diarize(
        &mut self,
        samples: &[f32],
        intervals: Vec<SpeechInterval>,
    ) -> Vec<SpeechInterval> {
        let mut diarized_intervals = Vec::with_capacity(intervals.len());

        for mut interval in intervals {
            let start_idx = ((interval.start_ms as f64 * WHISPER_SAMPLE_RATE as f64) / 1000.0) as usize;
            let end_idx = ((interval.end_ms as f64 * WHISPER_SAMPLE_RATE as f64) / 1000.0) as usize;

            if start_idx >= samples.len() {
                continue;
            }
            let end_idx = end_idx.min(samples.len());
            let chunk = &samples[start_idx..end_idx];

            if chunk.len() < 320 {
                // Too short for reliable embedding
                continue;
            }

            let embedding = extract_acoustic_embedding(chunk);
            let speaker_label = self.classify_or_register(embedding);
            interval.speaker = speaker_label;

            diarized_intervals.push(interval);
        }

        diarized_intervals
    }

    fn classify_or_register(&mut self, embedding: Vec<f32>) -> String {
        let mut best_sim = -1.0f32;
        let mut best_idx = None;

        for (idx, speaker) in self.speakers.iter().enumerate() {
            let sim = cosine_similarity(&embedding, &speaker.centroid);
            if sim > best_sim {
                best_sim = sim;
                best_idx = Some(idx);
            }
        }

        if let Some(idx) = best_idx {
            if best_sim >= self.threshold {
                // Update speaker centroid with weighted average
                let speaker = &mut self.speakers[idx];
                speaker.count += 1;
                let alpha = 1.0 / speaker.count as f32;
                for i in 0..speaker.centroid.len() {
                    speaker.centroid[i] = (1.0 - alpha) * speaker.centroid[i] + alpha * embedding[i];
                }
                normalize_vector(&mut speaker.centroid);
                return speaker.label.clone();
            }
        }

        // New speaker detected
        let new_id = self.speakers.len() + 1;
        let label = format!("Speaker {}", new_id);
        self.speakers.push(SpeakerCentroid {
            speaker_id: new_id,
            label: label.clone(),
            centroid: embedding,
            count: 1,
        });

        label
    }

    pub fn known_speakers(&self) -> Vec<String> {
        self.speakers.iter().map(|s| s.label.clone()).collect()
    }
}

use rustfft::{num_complex::Complex, FftPlanner};

/// Computes a normalized spectral energy distribution vector across vocal frequency bands using FFT.
fn extract_acoustic_embedding(samples: &[f32]) -> Vec<f32> {
    let mut energy_bands = vec![0.0f32; BUCKETS];
    let window_size = 512;
    let step = 256;

    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(window_size);

    let mut windows_processed = 0usize;
    let mut buffer: Vec<Complex<f32>> = Vec::with_capacity(window_size);

    for chunk in samples.windows(window_size).step_by(step) {
        buffer.clear();
        for &s in chunk {
            buffer.push(Complex { re: s, im: 0.0 });
        }

        fft.process(&mut buffer);

        // Map positive frequencies (first window_size / 2 bins) into BUCKETS
        let half_size = window_size / 2;
        for (bin, c) in buffer.iter().take(half_size).enumerate() {
            let magnitude = (c.re * c.re + c.im * c.im).sqrt();
            let bucket = (bin * BUCKETS) / half_size;
            if bucket < BUCKETS {
                energy_bands[bucket] += magnitude;
            }
        }
        windows_processed += 1;
    }

    if windows_processed > 0 {
        for val in energy_bands.iter_mut() {
            *val /= windows_processed as f32;
        }
    }

    // Zero crossing rate as pitch / roughness metric
    let mut zero_crossings = 0usize;
    for w in samples.windows(2) {
        if (w[0] >= 0.0 && w[1] < 0.0) || (w[0] < 0.0 && w[1] >= 0.0) {
            zero_crossings += 1;
        }
    }
    let zcr = zero_crossings as f32 / samples.len() as f32;
    energy_bands.push(zcr * 5.0); // weighted pitch feature

    normalize_vector(&mut energy_bands);
    energy_bands
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

    if norm_a == 0.0 || norm_b == 0.0 {
        0.0
    } else {
        (dot / (norm_a * norm_b)).clamp(-1.0, 1.0)
    }
}

fn normalize_vector(v: &mut [f32]) {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 1e-6 {
        for val in v.iter_mut() {
            *val /= norm;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_local_diarizer_clustering() {
        let mut diarizer = LocalDiarizer::new(0.70);

        // Synthetic 200 Hz tone (Speaker A)
        let mut audio_a = vec![0.0f32; 16000];
        for i in 0..16000 {
            audio_a[i] = (2.0 * std::f32::consts::PI * 200.0 * (i as f32 / 16000.0)).sin();
        }

        // Synthetic 1200 Hz tone (Speaker B)
        let mut audio_b = vec![0.0f32; 16000];
        for i in 0..16000 {
            audio_b[i] = (2.0 * std::f32::consts::PI * 1200.0 * (i as f32 / 16000.0)).sin();
        }

        let intervals = vec![
            SpeechInterval { start_ms: 0, end_ms: 800, speaker: String::new() },
            SpeechInterval { start_ms: 800, end_ms: 1600, speaker: String::new() },
        ];

        let result_a = diarizer.diarize(&audio_a, intervals);
        // Both intervals of audio_a should be identified as the same speaker ("Speaker 1")
        assert_eq!(result_a[0].speaker, "Speaker 1");
        assert_eq!(result_a[1].speaker, "Speaker 1");

        // Now feed audio_b (distinct frequency profile)
        let intervals_b = vec![
            SpeechInterval { start_ms: 0, end_ms: 800, speaker: String::new() },
        ];
        let result_b = diarizer.diarize(&audio_b, intervals_b);
        assert_eq!(result_b[0].speaker, "Speaker 2");
    }
}
