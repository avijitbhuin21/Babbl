// Re-export all audio components
mod device;
pub mod dual_recorder;
pub mod loopback;
mod recorder;
mod resampler;
mod utils;
mod visualizer;

pub use device::{
    get_default_input_device, get_default_output_device, get_input_device_by_name,
    get_output_device_by_name, list_input_devices, list_output_devices, CpalDeviceInfo,
};
pub use dual_recorder::{DualAudioRecorder, MeetingAudio};
pub use loopback::{LoopbackFrameCallback, LoopbackRecorder};
pub use recorder::{AudioRecorder, FrameCallback};
pub use resampler::FrameResampler;
pub use utils::save_wav_file;
pub use visualizer::AudioVisualiser;
