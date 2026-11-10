// Development-only mock for browser preview when running outside native Tauri window.
// This module is only loaded when import.meta.env.DEV is true AND window.__TAURI_INTERNALS__ is undefined.

if (typeof window !== "undefined" && !(window as any).__TAURI_INTERNALS__) {
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

  let mockMeetingEmail = {
    sender_email: "",
    has_password: false,
    default_recipients: [] as string[],
  };

  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: any) => {
      console.log("[Browser Dev Mode] Mock invoke:", cmd, args);
      if (
        cmd === "get_app_settings" ||
        cmd === "get_settings" ||
        cmd === "get_default_settings"
      ) {
        return defaultSettings;
      }
      if (cmd === "get_meeting_email_settings") {
        return mockMeetingEmail;
      }
      if (cmd === "save_meeting_email_settings") {
        mockMeetingEmail = {
          sender_email: args?.senderEmail || "",
          has_password: Boolean(args?.appPassword),
          default_recipients: args?.defaultRecipients || [],
        };
        return null;
      }
      if (cmd === "clear_meeting_email_credentials") {
        mockMeetingEmail = {
          sender_email: "",
          has_password: false,
          default_recipients: [],
        };
        return null;
      }
      if (cmd === "send_meeting_mom_email") {
        return null;
      }
      if (cmd === "ask_meeting_assistant") {
        return {
          reply: `Here is what I found regarding **"${args?.request?.query || "your query"}"**:\n\nThe meeting discussion focused on delivering structured, production-ready audio and AI copilot capabilities.`,
          tools_used: ["get_live_meeting_transcript"],
        };
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
}

export {};
