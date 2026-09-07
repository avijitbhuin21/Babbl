import { invoke } from "@tauri-apps/api/core";

type Level = "error" | "warn" | "info";

/** Serializes any thrown value into a readable string. */
const stringify = (value: unknown): string => {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/** Sends a log line to the Rust side so it ends up in babbl.log. */
export const logToBackend = (level: Level, source: string, ...parts: unknown[]) => {
  const message = parts.map(stringify).join(" ");
  invoke("log_frontend", { level, source, message }).catch(() => {});
};

/** Forwards console.error/warn, uncaught errors and unhandled rejections from this webview to the app log. */
export const installFrontendErrorForwarding = (source: string) => {
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    originalError(...args);
    logToBackend("error", source, ...args);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    logToBackend("warn", source, ...args);
  };

  window.addEventListener("error", (event) => {
    logToBackend("error", source, "Uncaught:", event.message, event.error ?? "");
  });
  window.addEventListener("unhandledrejection", (event) => {
    logToBackend("error", source, "Unhandled rejection:", event.reason);
  });
};
