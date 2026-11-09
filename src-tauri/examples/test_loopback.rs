use std::{thread::sleep, time::Duration};

use cpal::traits::DeviceTrait;
use babbl_app_lib::audio_toolkit::{
    get_default_input_device, get_default_output_device, list_input_devices, list_output_devices,
    save_wav_file, DualAudioRecorder,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=======================================================");
    println!("     Babbl - Meeting Audio Loopback & Dual Recorder    ");
    println!("=======================================================\n");

    // 1. List audio devices
    println!("Scanning audio devices...");
    let input_devices = list_input_devices()?;
    println!("Found {} input device(s):", input_devices.len());
    for d in &input_devices {
        println!("  - [Mic] {} (default: {})", d.name, d.is_default);
    }

    let output_devices = list_output_devices()?;
    println!("\nFound {} output device(s):", output_devices.len());
    for d in &output_devices {
        println!("  - [Speaker] {} (default: {})", d.name, d.is_default);
    }

    let default_input = get_default_input_device()?;
    let default_output = get_default_output_device()?;
    println!("\nActive Microphone : {}", default_input.name()?);
    println!("Active System Out : {}", default_output.name()?);

    // 2. Initialize DualAudioRecorder
    println!("\nInitializing Dual Audio Recorder (Mic + Loopback)...");
    let mut recorder = DualAudioRecorder::new()?;
    recorder.open(Some(default_input), Some(default_output))?;

    let duration_secs: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(10);

    println!("\n>>> STARTING {}-SECOND RECORDING <<<", duration_secs);
    println!(">>> Capturing browser/system sound + microphone in real-time... <<<\n");

    recorder.start()?;

    for i in (1..=duration_secs).rev() {
        print!("\rRecording... {:2}s remaining ", i);
        std::io::Write::flush(&mut std::io::stdout())?;
        sleep(Duration::from_secs(1));
    }
    println!("\rRecording complete! Processing audio...          ");

    let meeting_audio = recorder.stop()?;
    recorder.close()?;

    println!("\n=======================================================");
    println!("Recording Results:");
    println!("  Duration       : {:.2} seconds", meeting_audio.duration_secs);
    println!("  Mic Samples    : {} (16 kHz mono)", meeting_audio.mic_samples.len());
    println!("  System Samples : {} (16 kHz mono)", meeting_audio.system_samples.len());
    println!("  Mixed Samples  : {} (16 kHz mono)", meeting_audio.mixed_samples.len());

    // Calculate peak amplitudes
    let mic_peak = meeting_audio.mic_samples.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
    let sys_peak = meeting_audio.system_samples.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
    println!("  Mic Peak Energy   : {:.4}", mic_peak);
    println!("  System Peak Energy: {:.4}", sys_peak);

    // 3. Save audio files
    let mic_path = "test_meeting_mic.wav";
    let sys_path = "test_meeting_system.wav";
    let mix_path = "test_meeting_mixed.wav";

    save_wav_file(mic_path, &meeting_audio.mic_samples).await?;
    save_wav_file(sys_path, &meeting_audio.system_samples).await?;
    save_wav_file(mix_path, &meeting_audio.mixed_samples).await?;

    println!("\nSaved Audio Files to current directory:");
    println!("  1. {}  -> Your voice only", mic_path);
    println!("  2. {}  -> System / attendee sound only", sys_path);
    println!("  3. {}  -> Combined mix (ready for transcription)", mix_path);
    println!("=======================================================\n");

    Ok(())
}
