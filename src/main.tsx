import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installFrontendErrorForwarding } from "./lib/utils/frontendLog";

// Initialize i18n
import "./i18n";

// In browser development preview outside Tauri, load dev mocks
if (import.meta.env.DEV && typeof window !== "undefined" && !(window as any).__TAURI_INTERNALS__) {
  await import("./devMock");
}

installFrontendErrorForwarding("main");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
