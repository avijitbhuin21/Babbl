export const GITHUB_REPO = "avijitbhuin21/Babbl";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const RELEASES_URL = `${GITHUB_URL}/releases`;
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;

export const NAV_LINKS = [
  { label: "Features", href: "/#features" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Docs", href: "/docs" },
  { label: "Changelog", href: "/changelog" },
  { label: "Credits", href: "/credits" },
  { label: "Contact", href: "/contact" },
];

export const CONTACT_EMAIL = "avijitbhuin21@gmail.com";

export const HANDY_URL = "https://handy.computer";
export const HANDY_GITHUB_URL = "https://github.com/cjpais/handy";
export const HANDY_DONATE_URL = "https://handy.computer/donate";

export const DOWNLOAD_PATH = "/download";

export const PLATFORMS = [
  {
    name: "Windows",
    detail: "Windows 10 and 11, .exe installer",
    href: DOWNLOAD_PATH,
  },
  {
    name: "macOS",
    detail: "macOS 10.13+, Apple silicon and Intel",
    href: DOWNLOAD_PATH,
  },
  {
    name: "Linux",
    detail: "AppImage, .deb and .rpm",
    href: DOWNLOAD_PATH,
  },
];

export const FEATURES = [
  {
    icon: "ShieldCheck",
    title: "Runs on your machine",
    body: "Transcription happens locally. No account, no upload, no telemetry. Your audio stays on your device.",
  },
  {
    icon: "Keyboard",
    title: "One shortcut, any app",
    body: "Hold your key, speak, release. Babbl types the result into whichever window has focus: editor, browser or chat.",
  },
  {
    icon: "Radio",
    title: "Live text while you speak",
    body: "With a streaming model, your words show up in the overlay as you talk. The final text is pasted when you stop.",
  },
  {
    icon: "Boxes",
    title: "A model for every machine",
    body: "Pick from Whisper, Parakeet, Moonshine, Qwen3-ASR, Canary, Voxtral and more. Tiny ones run on any laptop; large ones are more accurate.",
  },
  {
    icon: "Cpu",
    title: "GPU acceleration",
    body: "Local models run on your graphics card through Vulkan on Windows and Linux, or Metal on macOS. If there is no GPU, Babbl uses the CPU.",
  },
  {
    icon: "Wand2",
    title: "Refine selected text",
    body: "Select some text, hold the refine shortcut and say what to change, for example \"make this friendlier\". Babbl rewrites it in place.",
  },
  {
    icon: "Sparkles",
    title: "Optional clean-up",
    body: "Run the transcript through a language model to fix punctuation, tone or formatting. Bring your own provider, or use Apple Intelligence on supported Macs.",
  },
  {
    icon: "MonitorSmartphone",
    title: "Clipboard sync and file sharing",
    body: "Pair your computers with a PIN to share a clipboard and send files of any size. It works over your local network or the internet, and everything is end-to-end encrypted.",
  },
  {
    icon: "Languages",
    title: "Your language",
    body: "Dictate in dozens of languages, or translate to English as you speak. The interface itself is available in several languages.",
  },
  {
    icon: "Cloud",
    title: "Cloud when you want it",
    body: "Prefer speed over locality? Connect a cloud transcription provider with your own API key. This is off by default.",
  },
  {
    icon: "Gauge",
    title: "Light on resources",
    body: "A Rust and Tauri core with voice activity detection. Models unload when idle, so nothing sits in memory without reason.",
  },
  {
    icon: "History",
    title: "Your history, your rules",
    body: "Every transcript is stored locally for as long as you choose. Clear it whenever you like.",
  },
];

export const STEPS = [
  {
    title: "Pick a model",
    body: "Choose a speech model on first launch. Babbl downloads it once and keeps it on disk.",
  },
  {
    title: "Hold the shortcut",
    body: "A small overlay shows that Babbl is listening, along with live text on streaming models. Use push-to-talk or toggle, whichever you prefer.",
  },
  {
    title: "Keep typing",
    body: "Release and the text appears at your cursor, cleaned up first if you turned on post-processing.",
  },
];

export const FAQS = [
  {
    q: "Does Babbl send my audio anywhere?",
    a: "No. Recording and transcription happen entirely on your machine. Babbl only goes online to download models and check for updates. It also connects to a cloud provider or to sync, but only if you set those up yourself.",
  },
  {
    q: "Is it free?",
    a: "Yes. Babbl is open source under the MIT licence and free to use.",
  },
  {
    q: "Which models can I use?",
    a: "Babbl has a catalogue of local models: Whisper, Parakeet, Moonshine, Qwen3-ASR, Canary, Voxtral, Granite Speech, SenseVoice and others. Some support live text or translation. Smaller models are faster and larger ones are more accurate. You can switch at any time.",
  },
  {
    q: "How does clipboard sync work?",
    a: "Pair two computers with a short PIN. After that, copied text and images show up on the other machine, and you can send files between them. Each item goes over the most direct route it can find: your local network, a direct address or a relay. Everything is encrypted end to end with a key that only your devices hold.",
  },
  {
    q: "Does it work offline?",
    a: "Once a model is downloaded, yes, completely.",
  },
  {
    q: "How does it type into other apps?",
    a: "Babbl pastes through the clipboard or simulates keystrokes, whichever you configure. On macOS this needs accessibility permission.",
  },
  {
    q: "Where did Babbl come from?",
    a: "Babbl started as a fork of Handy, the open-source speech-to-text app by CJ Pais. See the Credits page for details.",
  },
];
