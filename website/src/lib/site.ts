export const GITHUB_REPO = "avijitbhuin21/Babbl";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const RELEASES_URL = `${GITHUB_URL}/releases`;
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;

export const NAV_LINKS = [
  { label: "Features", href: "/#features" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Docs", href: "/docs" },
  { label: "Changelog", href: "/changelog" },
];

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
    body: "Transcription happens locally with Whisper models. No account, no upload, no telemetry. Your audio never leaves the device.",
  },
  {
    icon: "Keyboard",
    title: "One shortcut, any app",
    body: "Hold your key, speak, release. Babbl types the result straight into whatever window has focus: editor, browser, chat.",
  },
  {
    icon: "Sparkles",
    title: "Optional clean-up",
    body: "Send the raw transcript through a local or hosted model to fix punctuation, tone or formatting before it is pasted.",
  },
  {
    icon: "Languages",
    title: "Ninety-nine languages",
    body: "Dictate in your own language or translate to English on the fly. The interface itself ships in nine languages.",
  },
  {
    icon: "Gauge",
    title: "Light on resources",
    body: "A Rust and Tauri core with voice activity detection. Models unload when idle, so nothing sits in memory for no reason.",
  },
  {
    icon: "History",
    title: "Your history, your rules",
    body: "Every transcript is stored locally with a retention window you choose. Clear it whenever you like.",
  },
];

export const STEPS = [
  {
    title: "Pick a model",
    body: "Choose a Whisper model on first launch. Babbl downloads it once and keeps it on disk.",
  },
  {
    title: "Hold the shortcut",
    body: "A small overlay confirms Babbl is listening. Push-to-talk or toggle, whichever you prefer.",
  },
  {
    title: "Keep typing",
    body: "Release and the text lands at your cursor, cleaned up if you enabled post-processing.",
  },
];

export const FAQS = [
  {
    q: "Does Babbl send my audio anywhere?",
    a: "No. Recording and transcription run entirely on your machine. The only network calls are model downloads, update checks, and, if you explicitly enable it, a cloud provider you configure yourself.",
  },
  {
    q: "Is it free?",
    a: "Yes. Babbl is open source under the MIT licence and free to use.",
  },
  {
    q: "Which models can I use?",
    a: "Any of the bundled Whisper variants, from tiny to large. Smaller models are faster; larger ones are more accurate. You can switch at any time.",
  },
  {
    q: "Does it work offline?",
    a: "Once a model is downloaded, yes, completely.",
  },
  {
    q: "How does it type into other apps?",
    a: "Babbl pastes through the clipboard or simulates keystrokes, whichever you configure. On macOS this needs accessibility permission.",
  },
];
