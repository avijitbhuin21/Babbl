use cpal::Device;

use crate::audio_toolkit::{
    audio::{loopback::LoopbackFrameCallback, AudioRecorder, FrameCallback, LoopbackRecorder},
    vad::VoiceActivityDetector,
};

/// Combined audio result from a dual-recording meeting session.
#[derive(Clone, Debug)]
pub struct MeetingAudio {
    /// Microphone audio from the local user (16 kHz mono).
    pub mic_samples: Vec<f32>,
    /// Loopback audio from remote participants / system audio (16 kHz mono).
    pub system_samples: Vec<f32>,
    /// Balanced mixed audio of both tracks (16 kHz mono).
    pub mixed_samples: Vec<f32>,
    /// Duration in seconds.
    pub duration_secs: f32,
}

/// Orchestrates simultaneous recording of user microphone and system audio loopback.
pub struct DualAudioRecorder {
    mic_recorder: AudioRecorder,
    loopback_recorder: LoopbackRecorder,
    is_open: bool,
    is_recording: bool,
}

impl DualAudioRecorder {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            mic_recorder: AudioRecorder::new()?,
            loopback_recorder: LoopbackRecorder::new()?,
            is_open: false,
            is_recording: false,
        })
    }

    pub fn with_mic_vad(mut self, vad: Box<dyn VoiceActivityDetector>) -> Self {
        self.mic_recorder = self.mic_recorder.with_vad(vad);
        self
    }

    pub fn with_mic_frame_callback(mut self, cb: FrameCallback) -> Self {
        self.mic_recorder = self.mic_recorder.with_frame_callback(cb);
        self
    }

    pub fn with_mic_level_callback<F>(mut self, cb: F) -> Self
    where
        F: Fn(Vec<f32>) + Send + Sync + 'static,
    {
        self.mic_recorder = self.mic_recorder.with_level_callback(cb);
        self
    }

    pub fn with_loopback_frame_callback(mut self, cb: LoopbackFrameCallback) -> Self {
        self.loopback_recorder = self.loopback_recorder.with_frame_callback(cb);
        self
    }

    pub fn with_loopback_level_callback<F>(mut self, cb: F) -> Self
    where
        F: Fn(Vec<f32>) + Send + Sync + 'static,
    {
        self.loopback_recorder = self.loopback_recorder.with_level_callback(cb);
        self
    }

    /// Opens both audio streams.
    pub fn open(
        &mut self,
        mic_device: Option<Device>,
        loopback_device: Option<Device>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if self.is_open {
            return Ok(());
        }

        self.mic_recorder.open(mic_device)?;
        self.loopback_recorder.open(loopback_device)?;
        self.is_open = true;

        Ok(())
    }

    /// Starts recording from both microphone and loopback streams.
    pub fn start(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if !self.is_open {
            return Err("DualAudioRecorder must be opened before starting".into());
        }

        self.mic_recorder.start()?;
        self.loopback_recorder.start()?;
        self.is_recording = true;

        Ok(())
    }

    /// Stops both streams, aligns track durations with padding, and mixes them.
    /// Never discards microphone audio even if loopback fails or is not supported.
    pub fn stop(&mut self) -> Result<MeetingAudio, Box<dyn std::error::Error>> {
        if !self.is_recording {
            return Err("DualAudioRecorder is not currently recording".into());
        }

        // Stop microphone first and guarantee its samples are preserved
        let mic_samples = match self.mic_recorder.stop() {
            Ok(samples) => samples,
            Err(e) => {
                log::error!("Microphone recorder stop error: {}", e);
                Vec::new()
            }
        };

        // Stop loopback recorder without failing if loopback was unavailable or errored
        let system_samples = self.loopback_recorder.stop().unwrap_or_else(|e| {
            log::warn!("Loopback recorder stop warning (non-fatal): {}", e);
            Vec::new()
        });

        self.is_recording = false;

        let mic_len = mic_samples.len();
        let sys_len = system_samples.len();
        let max_len = mic_len.max(sys_len);

        if max_len == 0 {
            return Err("No audio captured from either microphone or system audio".into());
        }

        let mut mic_aligned = mic_samples;
        mic_aligned.resize(max_len, 0.0);

        let mut sys_aligned = system_samples;
        sys_aligned.resize(max_len, 0.0);

        // Mix down: if system audio was present, mix 50/50. Otherwise, use full mic audio.
        let mut mixed_samples = Vec::with_capacity(max_len);
        if sys_len > 0 {
            for i in 0..max_len {
                let mixed = (mic_aligned[i] * 0.5) + (sys_aligned[i] * 0.5);
                mixed_samples.push(mixed);
            }
        } else {
            mixed_samples = mic_aligned.clone();
        }

        let duration_secs = max_len as f32 / crate::audio_toolkit::constants::WHISPER_SAMPLE_RATE as f32;

        Ok(MeetingAudio {
            mic_samples: mic_aligned,
            system_samples: sys_aligned,
            mixed_samples,
            duration_secs,
        })
    }

    /// Shuts down both streams and releases devices.
    pub fn close(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let mic_res = self.mic_recorder.close();
        let loopback_res = self.loopback_recorder.close();
        self.is_open = false;
        self.is_recording = false;

        mic_res?;
        loopback_res?;

        Ok(())
    }

    pub fn is_open(&self) -> bool {
        self.is_open
    }

    pub fn is_recording(&self) -> bool {
        self.is_recording
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_dual_recorder() {
        let recorder = DualAudioRecorder::new();
        assert!(recorder.is_ok());
        let recorder = recorder.unwrap();
        assert!(!recorder.is_open());
        assert!(!recorder.is_recording());
    }

    #[test]
    fn test_meeting_audio_mix_alignment() {
        let mic = vec![1.0f32, 1.0, 1.0];
        let sys = vec![0.5f32, 0.5];

        let max_len = mic.len().max(sys.len());
        let mut mic_aligned = mic;
        mic_aligned.resize(max_len, 0.0);
        let mut sys_aligned = sys;
        sys_aligned.resize(max_len, 0.0);

        let mut mixed = Vec::with_capacity(max_len);
        for i in 0..max_len {
            mixed.push(mic_aligned[i] * 0.5 + sys_aligned[i] * 0.5);
        }

        assert_eq!(mixed.len(), 3);
        assert!((mixed[0] - 0.75).abs() < 1e-6); // 1.0*0.5 + 0.5*0.5 = 0.75
        assert!((mixed[1] - 0.75).abs() < 1e-6);
        assert!((mixed[2] - 0.50).abs() < 1e-6); // 1.0*0.5 + 0.0*0.5 = 0.50
    }
}
