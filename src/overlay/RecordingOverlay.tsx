import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CancelIcon } from "../components/icons";
import "./RecordingOverlay.css";
import { commands } from "@/bindings";
import { syncLanguageFromSettings } from "@/i18n";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";

type OverlayState = "recording" | "recording_refine" | "transcribing" | "refining" | "error";

interface AppErrorPayload {
  title: string;
  message: string;
}

interface OverlayLayout {
  live: boolean;
  top: boolean;
}

interface StreamText {
  committed: string;
  tentative: string;
}

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  const [layout, setLayout] = useState<OverlayLayout>({ live: false, top: false });
  const [liveText, setLiveText] = useState<StreamText>({ committed: "", tentative: "" });
  const liveTextRef = useRef<HTMLDivElement>(null);
  const [errorText, setErrorText] = useState<string>("");
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [levels, setLevels] = useState<number[]>(Array(16).fill(0));
  const smoothedLevelsRef = useRef<number[]>(Array(16).fill(0));
  const [recordingIconSrc, setRecordingIconSrc] = useState<string>("");
  const [transcribingIconSrc, setTranscribingIconSrc] = useState<string>("");

  // Load icon paths on mount
  useEffect(() => {
    const loadIcons = async () => {
      try {
        const recordingPath = await resolveResource("resources/recording.png");
        const transcribingPath = await resolveResource("resources/transcribing.png");
        setRecordingIconSrc(convertFileSrc(recordingPath));
        setTranscribingIconSrc(convertFileSrc(transcribingPath));
      } catch (e) {
        console.error("Failed to load overlay icons:", e);
      }
    };
    loadIcons();
  }, []);

  useEffect(() => {
    const setupEventListeners = async () => {
      // Listen for show-overlay event from Rust
      const unlistenShow = await listen("show-overlay", async (event) => {
        // Sync language from settings each time overlay is shown
        await syncLanguageFromSettings();
        const overlayState = event.payload as OverlayState;
        if (overlayState === "recording" || overlayState === "recording_refine") {
          setLiveText({ committed: "", tentative: "" });
        }
        setState(overlayState);
        setIsVisible(true);
      });

      const unlistenLayout = await listen<OverlayLayout>("overlay-layout", (event) => {
        setLayout(event.payload);
      });

      const unlistenStream = await listen<StreamText>("stream-text", (event) => {
        setLiveText(event.payload);
      });

      // Listen for hide-overlay event from Rust
      const unlistenHide = await listen("hide-overlay", () => {
        setIsVisible(false);
      });

      // Surface pipeline errors briefly in the overlay
      const unlistenError = await listen<AppErrorPayload>("babbl://error", (event) => {
        setErrorText(event.payload.title);
        setState("error");
        setIsVisible(true);
        if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = setTimeout(() => setIsVisible(false), 2500);
      });

      // Listen for mic-level updates
      const unlistenLevel = await listen<number[]>("mic-level", (event) => {
        const newLevels = event.payload as number[];

        // Apply smoothing to reduce jitter
        const smoothed = smoothedLevelsRef.current.map((prev, i) => {
          const target = newLevels[i] || 0;
          return prev * 0.7 + target * 0.3; // Smooth transition
        });

        smoothedLevelsRef.current = smoothed;
        setLevels(smoothed.slice(0, 9));
      });

      // Cleanup function
      return () => {
        unlistenShow();
        unlistenLayout();
        unlistenStream();
        unlistenHide();
        unlistenError();
        unlistenLevel();
      };
    };

    setupEventListeners();
  }, []);

  const isRecording = state === "recording" || state === "recording_refine";

  useEffect(() => {
    const el = liveTextRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveText]);

  const getIcon = () => {
    const iconSrc = isRecording ? recordingIconSrc : transcribingIconSrc;
    if (!iconSrc) return null;
    return <img src={iconSrc} alt={state} className="overlay-icon" />;
  };

  const showLive = layout.live && isRecording;
  const hasLiveText = liveText.committed.trim() !== "" || liveText.tentative.trim() !== "";

  return (
    <div className={`overlay-root ${layout.live ? "overlay-live" : ""} ${layout.top ? "overlay-top" : ""}`}>
      {showLive && (
        <div className={`live-text ${isVisible && hasLiveText ? "fade-in" : ""}`} ref={liveTextRef}>
          <span className="live-committed">{liveText.committed}</span>
          <span className="live-tentative">{liveText.tentative}</span>
        </div>
      )}
    <div className={`recording-overlay ${isVisible ? "fade-in" : ""} ${state === "error" ? "overlay-error" : ""}`}>
      <div className="overlay-left">{getIcon()}</div>

      <div className="overlay-middle">
        {isRecording && (
          <div className="bars-container">
            {levels.map((v, i) => (
              <div
                key={i}
                className={`bar ${state === "recording_refine" ? "bar-refine" : ""}`}
                style={{
                  height: `${Math.min(20, 4 + Math.pow(v, 0.7) * 16)}px`, // Cap at 20px max height
                  transition: "height 60ms ease-out, opacity 120ms ease-out",
                  opacity: Math.max(0.2, v * 1.7), // Minimum opacity for visibility
                }}
              />
            ))}
          </div>
        )}
        {state === "transcribing" && (
          <div className="transcribing-text">{t("overlay.transcribing")}</div>
        )}
        {state === "refining" && (
          <div className="transcribing-text">{t("overlay.refining", "Refining...")}</div>
        )}
        {state === "error" && (
          <div className="transcribing-text overlay-error-text" title={errorText}>
            {errorText || t("overlay.error", "Error")}
          </div>
        )}
      </div>

      <div className="overlay-right">
        {isRecording && (
          <div
            className="cancel-button"
            onClick={() => {
              commands.cancelOperation();
            }}
          >
            <CancelIcon color="#8BAE66" />
          </div>
        )}
      </div>
    </div>
    </div>
  );
};

export default RecordingOverlay;
