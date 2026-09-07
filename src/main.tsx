import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installFrontendErrorForwarding } from "./lib/utils/frontendLog";

// Initialize i18n
import "./i18n";

installFrontendErrorForwarding("main");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
