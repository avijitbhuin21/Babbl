import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installFrontendErrorForwarding } from "./lib/utils/frontendLog";

// Initialize i18n
import "./i18n";

// Browser development fallback when running outside native Tauri window
if (typeof window !== "undefined") {
  (window as any).__TAURI_OS_PLUGIN_INTERNALS__ = {
    eol: "\r\n",
    platform: "windows",
    version: "10.0.26100",
    family: "windows",
    os_type: "windows",
    arch: "x86_64",
    exe_extension: "exe",
  };

  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };

  if (!(window as any).__TAURI_INTERNALS__) {
    const defaultSettings = {
      selected_language: "auto",
      always_on_microphone: false,
      audio_feedback: false,
      audio_feedback_volume: 1.0,
      sound_theme: "default",
      start_hidden: false,
      autostart_enabled: false,
      update_checks_enabled: false,
      push_to_talk: false,
      selected_microphone: "default",
      clamshell_microphone: null,
      selected_output_device: "default",
      live_transcription: true,
      use_gpu: false,
      model_unload_timeout: 300,
      history_limit: 100,
      recording_retention_period: 30,
      use_online_provider: false,
      online_provider_id: "groq",
      online_provider_models: {},
      online_provider_api_keys: {},
      online_provider_base_urls: {},
      post_process_provider_id: "groq",
      post_process_models: {},
      post_process_api_keys: {},
      post_process_base_urls: {},
      refine_provider_id: "groq",
      refine_models: {},
      refine_api_keys: {},
      refine_base_urls: {},
      post_processing_enabled: false,
      post_processing_prompt: "",
      refine_prompt: "",
      debug_mode: false,
      shortcuts: {},
      custom_words: [],
      append_trailing_space: true,
      paste_method: "clipboard",
      clipboard_handling: "dont_modify",
    };

    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        console.log("[Browser Dev Mode] Mock invoke:", cmd, args);
        if (cmd === "get_settings" || cmd === "get_default_settings") {
          return defaultSettings;
        }
        if (cmd === "get_meeting_status") {
          return { is_recording: false, elapsed_secs: 0 };
        }
        if (cmd === "get_last_meeting") {
          return null;
        }
        if (cmd === "get_past_meetings") {
          return [];
        }
        if (cmd === "plugin:macos-permissions|checkAccessibilityPermission") {
          return true;
        }
        if (cmd === "plugin:os|platform") {
          return "windows";
        }
        if (cmd === "plugin:os|type") {
          return "Windows_NT";
        }
        if (cmd === "plugin:event|listen" || cmd === "plugin:event|register_listener") {
          return 1;
        }
        if (cmd === "plugin:event|unlisten") {
          return null;
        }
        if (cmd === "plugin:app|version") {
          return "0.2.5";
        }
        if (cmd === "has_any_models_available") {
          return false;
        }
        if (
          cmd === "get_available_models" ||
          cmd === "get_downloading_models" ||
          cmd === "get_extracting_models" ||
          cmd === "get_audio_devices" ||
          cmd === "get_output_devices" ||
          cmd === "get_bindings" ||
          cmd === "get_custom_words" ||
          cmd === "get_history"
        ) {
          return [];
        }
        if (cmd === "get_current_model") {
          return "";
        }
        return null;
      },
      transformCallback: () => 1,
      ipc: () => {},
    };
  } else {
    installFrontendErrorForwarding("main");
  }
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: any }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: "#fff", background: "#111", fontFamily: "sans-serif" }}>
          <h2>Frontend Error</h2>
          <pre style={{ color: "#f87171", whiteSpace: "pre-wrap" }}>
            {String(this.state.error?.stack || this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
