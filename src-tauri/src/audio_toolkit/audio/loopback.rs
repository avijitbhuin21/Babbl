use std::{
    sync::{mpsc, Arc},
    time::Duration,
};

use cpal::{
    traits::{DeviceTrait, StreamTrait},
    Device, Sample, SizedSample,
};

use crate::audio_toolkit::{
    audio::{device::get_default_output_device, AudioVisualiser, FrameResampler},
    constants,
};

enum Cmd {
    Start,
    Stop(mpsc::Sender<Vec<f32>>),
    Shutdown,
}

pub type LoopbackFrameCallback = Arc<dyn Fn(&[f32]) + Send + Sync + 'static>;

/// Captures system audio (output device / loopback) in real-time
/// and resamples it to 16 kHz mono (compatible with Whisper and VAD).
pub struct LoopbackRecorder {
    device: Option<Device>,
    cmd_tx: Option<mpsc::Sender<Cmd>>,
    worker_handle: Option<std::thread::JoinHandle<()>>,
    level_cb: Option<Arc<dyn Fn(Vec<f32>) + Send + Sync + 'static>>,
    frame_cb: Option<LoopbackFrameCallback>,
}

impl LoopbackRecorder {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(LoopbackRecorder {
            device: None,
            cmd_tx: None,
            worker_handle: None,
            level_cb: None,
            frame_cb: None,
        })
    }

    pub fn with_frame_callback(mut self, cb: LoopbackFrameCallback) -> Self {
        self.frame_cb = Some(cb);
        self
    }

    pub fn with_level_callback<F>(mut self, cb: F) -> Self
    where
        F: Fn(Vec<f32>) + Send + Sync + 'static,
    {
        self.level_cb = Some(Arc::new(cb));
        self
    }

    pub fn open(&mut self, device: Option<Device>) -> Result<(), Box<dyn std::error::Error>> {
        if self.worker_handle.is_some() {
            return Ok(());
        }

        let (sample_tx, sample_rx) = mpsc::channel::<Vec<f32>>();
        let (cmd_tx, cmd_rx) = mpsc::channel::<Cmd>();

        let device = match device {
            Some(dev) => dev,
            None => get_default_output_device()?,
        };

        let thread_device = device.clone();
        let level_cb = self.level_cb.clone();
        let frame_cb = self.frame_cb.clone();

        let worker = std::thread::spawn(move || {
            let config = match thread_device.default_output_config() {
                Ok(cfg) => cfg,
                Err(e) => {
                    log::error!("Failed to fetch default output config for loopback: {}", e);
                    return;
                }
            };

            let sample_rate = config.sample_rate().0;
            let channels = config.channels() as usize;

            log::info!(
                "Using loopback device: {} (sample rate: {}, channels: {}, format: {:?})",
                thread_device
                    .name()
                    .unwrap_or_else(|_| "unknown".to_string()),
                sample_rate,
                channels,
                config.sample_format()
            );

            let stream = match config.sample_format() {
                cpal::SampleFormat::U8 => {
                    LoopbackRecorder::build_stream::<u8>(&thread_device, &config, sample_tx, channels)
                }
                cpal::SampleFormat::I8 => {
                    LoopbackRecorder::build_stream::<i8>(&thread_device, &config, sample_tx, channels)
                }
                cpal::SampleFormat::I16 => {
                    LoopbackRecorder::build_stream::<i16>(&thread_device, &config, sample_tx, channels)
                }
                cpal::SampleFormat::I32 => {
                    LoopbackRecorder::build_stream::<i32>(&thread_device, &config, sample_tx, channels)
                }
                cpal::SampleFormat::F32 => {
                    LoopbackRecorder::build_stream::<f32>(&thread_device, &config, sample_tx, channels)
                }
                _ => {
                    log::error!("Unsupported loopback sample format");
                    return;
                }
            };

            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    log::error!("Failed to build loopback stream: {}", e);
                    return;
                }
            };

            if let Err(e) = stream.play() {
                log::error!("Failed to start loopback stream: {}", e);
                return;
            }

            run_loopback_consumer(sample_rate, sample_rx, cmd_rx, level_cb, frame_cb);
        });

        self.device = Some(device);
        self.cmd_tx = Some(cmd_tx);
        self.worker_handle = Some(worker);

        Ok(())
    }

    pub fn start(&self) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(tx) = &self.cmd_tx {
            tx.send(Cmd::Start)?;
        }
        Ok(())
    }

    pub fn stop(&self) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
        let (resp_tx, resp_rx) = mpsc::channel();
        if let Some(tx) = &self.cmd_tx {
            tx.send(Cmd::Stop(resp_tx))?;
        }
        Ok(resp_rx.recv()?)
    }

    pub fn close(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(tx) = self.cmd_tx.take() {
            let _ = tx.send(Cmd::Shutdown);
        }
        if let Some(h) = self.worker_handle.take() {
            let _ = h.join();
        }
        self.device = None;
        Ok(())
    }

    fn build_stream<T>(
        device: &cpal::Device,
        config: &cpal::SupportedStreamConfig,
        sample_tx: mpsc::Sender<Vec<f32>>,
        channels: usize,
    ) -> Result<cpal::Stream, cpal::BuildStreamError>
    where
        T: Sample + SizedSample + Send + 'static,
        f32: cpal::FromSample<T>,
    {
        let mut output_buffer = Vec::new();

        let stream_cb = move |data: &[T], _: &cpal::InputCallbackInfo| {
            output_buffer.clear();

            if channels == 1 {
                output_buffer.extend(data.iter().map(|&sample| sample.to_sample::<f32>()));
            } else {
                let frame_count = data.len() / channels;
                output_buffer.reserve(frame_count);

                for frame in data.chunks_exact(channels) {
                    let mono_sample = frame
                        .iter()
                        .map(|&sample| sample.to_sample::<f32>())
                        .sum::<f32>()
                        / channels as f32;
                    output_buffer.push(mono_sample);
                }
            }

            let _ = sample_tx.send(output_buffer.clone());
        };

        device.build_input_stream(
            &config.clone().into(),
            stream_cb,
            |err| log::error!("Loopback stream error: {}", err),
            None,
        )
    }
}

fn run_loopback_consumer(
    in_sample_rate: u32,
    sample_rx: mpsc::Receiver<Vec<f32>>,
    cmd_rx: mpsc::Receiver<Cmd>,
    level_cb: Option<Arc<dyn Fn(Vec<f32>) + Send + Sync + 'static>>,
    frame_cb: Option<LoopbackFrameCallback>,
) {
    let mut frame_resampler = FrameResampler::new(
        in_sample_rate as usize,
        constants::WHISPER_SAMPLE_RATE as usize,
        Duration::from_millis(30),
    );

    let mut processed_samples = Vec::<f32>::new();
    let mut recording = false;

    // Visualisation setup
    const BUCKETS: usize = 16;
    const WINDOW_SIZE: usize = 512;
    let mut visualizer = AudioVisualiser::new(
        in_sample_rate,
        WINDOW_SIZE,
        BUCKETS,
        400.0,
        4000.0,
    );

    // Timeout duration for handling WASAPI silence periods
    let timeout = Duration::from_millis(50);
    let silence_len = ((in_sample_rate as f32) * 0.05) as usize;
    let silence_frame = vec![0.0f32; silence_len];

    loop {
        let (raw, is_silence) = match sample_rx.recv_timeout(timeout) {
            Ok(s) => (s, false),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if recording {
                    (silence_frame.clone(), true)
                } else {
                    while let Ok(cmd) = cmd_rx.try_recv() {
                        match cmd {
                            Cmd::Start => {
                                processed_samples.clear();
                                recording = true;
                                visualizer.reset();
                            }
                            Cmd::Stop(reply_tx) => {
                                recording = false;
                                let _ = reply_tx.send(std::mem::take(&mut processed_samples));
                            }
                            Cmd::Shutdown => return,
                        }
                    }
                    continue;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };

        if !is_silence {
            if let Some(buckets) = visualizer.feed(&raw) {
                if let Some(cb) = &level_cb {
                    cb(buckets);
                }
            }
        }

        frame_resampler.push(&raw, &mut |frame: &[f32]| {
            if recording {
                if let Some(cb) = &frame_cb {
                    cb(frame);
                }
                processed_samples.extend_from_slice(frame);
            }
        });

        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                Cmd::Start => {
                    processed_samples.clear();
                    recording = true;
                    visualizer.reset();
                }
                Cmd::Stop(reply_tx) => {
                    recording = false;
                    frame_resampler.finish(&mut |frame: &[f32]| {
                        processed_samples.extend_from_slice(frame);
                    });
                    let _ = reply_tx.send(std::mem::take(&mut processed_samples));
                }
                Cmd::Shutdown => return,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_loopback_recorder() {
        let recorder = LoopbackRecorder::new();
        assert!(recorder.is_ok());
    }

    #[test]
    fn test_list_and_get_default_output_device() {
        use crate::audio_toolkit::audio::device::{get_default_output_device, list_output_devices};
        let devices = list_output_devices();
        assert!(devices.is_ok());

        // On Windows systems with audio hardware, default output should be present
        if let Ok(dev) = get_default_output_device() {
            println!("Default output device name: {:?}", dev.name());
        }
    }
}
