import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Mic,
  Volume2,
  Users,
  Play,
  Square,
  FileText,
  Copy,
  Check,
  Sparkles,
  Loader2,
  Clock,
  Send,
  Mail,
  Key,
  X,
  AtSign,
  Download,
  Bot,
  Calendar,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  commands,
  type DiarizationConfig,
  type MeetingResult,
  type MeetingTranscript,
  type PastMeetingRecord,
} from "@/bindings";
import { Button } from "../../ui/Button";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { InfoTip } from "../../ui/InfoTip";
import {
  downloadMeetingPdf,
  exportMeetingPdfBase64,
} from "@/lib/pdfGenerator";
import { MeetingAssistantPanel } from "./MeetingAssistantPanel";
import { PastMeetingsView } from "./PastMeetingsView";

export const MeetingSettings: React.FC = () => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Audio level meters (0.0 to 1.0)
  const [micLevel, setMicLevel] = useState(0);
  const [systemLevel, setSystemLevel] = useState(0);

  // Configuration
  const [translateToEnglish, setTranslateToEnglish] = useState(true);
  const [similarityThreshold, setSimilarityThreshold] = useState(0.70);

  // Results
  const [lastResult, setLastResult] = useState<MeetingResult | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<MeetingTranscript | null>(null);
  const liveTranscriptEndRef = useRef<HTMLDivElement | null>(null);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [copiedMom, setCopiedMom] = useState(false);

  // Subtabs (Live Meeting, AI Copilot, Past Meetings)
  const [activeTab, setActiveTab] = useState<"meeting" | "copilot" | "history">("meeting");
  const [selectedPastMeetingForCopilot, setSelectedPastMeetingForCopilot] = useState<PastMeetingRecord | null>(null);

  const handleAskCopilotAboutMeeting = (meeting: PastMeetingRecord) => {
    setSelectedPastMeetingForCopilot(meeting);
    setActiveTab("copilot");
  };

  // Email sending state (PR B: Secure desktop backend settings storage)
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [senderEmail, setSenderEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [rememberCredentials, setRememberCredentials] = useState(true);
  const [recipientsInput, setRecipientsInput] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  // Load email settings from desktop application backend
  const loadEmailSettings = async () => {
    try {
      const res = await commands.getMeetingEmailSettings();
      if (res?.status === "ok") {
        if (res.data.sender_email) {
          setSenderEmail(res.data.sender_email);
        }
        setHasSavedPassword(res.data.has_password);
        if (res.data.default_recipients?.length > 0) {
          setRecipientsInput(res.data.default_recipients.join(", "));
        }
      }
    } catch (e) {
      console.warn("Could not load email settings from backend:", e);
    }
  };

  useEffect(() => {
    loadEmailSettings();
  }, []);

  useEffect(() => {
    if (lastResult?.mom?.title) {
      setEmailSubject(lastResult.mom.title);
    }
  }, [lastResult]);

  const handleClearCredentials = async () => {
    try {
      const res = await commands.clearMeetingEmailCredentials();
      if (res?.status === "ok") {
        setHasSavedPassword(false);
        setAppPassword("");
        setSenderEmail("");
        setRecipientsInput("");
        toast.success(t("meeting.emailModal.clearedSuccess", "Saved email credentials removed."));
      } else {
        toast.error(`Failed to clear credentials: ${res?.error}`);
      }
    } catch (e: any) {
      toast.error(`Failed to clear credentials: ${e?.message || e}`);
    }
  };

  const handleSendEmail = async () => {
    const cleanSender = senderEmail.trim();
    const cleanPass = appPassword.trim();
    const recipientList = recipientsInput
      .split(/[,;\n]/)
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    if (!cleanSender) {
      toast.error(t("meeting.emailModal.senderRequired", "Please enter your Gmail address."));
      return;
    }
    if (!cleanPass && !hasSavedPassword) {
      toast.error(t("meeting.emailModal.passwordRequired", "Please enter your 16-character Gmail App Password."));
      return;
    }
    if (recipientList.length === 0) {
      toast.error(t("meeting.emailModal.recipientsRequired", "Please specify at least one recipient email address."));
      return;
    }

    // Persist securely to desktop settings store if enabled
    if (rememberCredentials) {
      try {
        await commands.saveMeetingEmailSettings(
          cleanSender,
          cleanPass.length > 0 ? cleanPass : null,
          recipientList
        );
        setHasSavedPassword(true);
      } catch (e) {
        console.warn("Could not save meeting email settings:", e);
      }
    }

    setIsSendingEmail(true);
    toast.info(t("meeting.emailModal.sendingToast", "Sending MOM with transcript PDF..."));

    try {
      let pdfBase64: string | null = null;
      let pdfFilename: string | null = null;

      if (lastResult) {
        try {
          const exported = exportMeetingPdfBase64(lastResult);
          pdfBase64 = exported.base64;
          pdfFilename = exported.filename;
        } catch (pdfErr) {
          console.warn("Failed to generate PDF attachment:", pdfErr);
        }
      }

      const res = await commands.sendMeetingMomEmail({
        sender_email: cleanSender,
        app_password: cleanPass, // If blank, backend automatically retrieves saved password from backend settings
        recipients: recipientList,
        subject: emailSubject || t("meeting.emailModal.defaultSubject", "Minutes of Meeting"),
        mom_markdown: lastResult?.mom?.summary_markdown || "",
        pdf_base64: pdfBase64,
        pdf_filename: pdfFilename,
      });

      setIsSendingEmail(false);
      if (res.status === "ok") {
        toast.success(t("meeting.emailModal.sentSuccess", "MOM & Transcript PDF delivered successfully!"));
        setShowEmailModal(false);
      } else {
        toast.error(`${t("meeting.emailModal.sentFailed", "Email delivery failed")}: ${res.error}`);
      }
    } catch (e: any) {
      setIsSendingEmail(false);
      toast.error(`${t("meeting.emailModal.sentError", "Error sending email")}: ${e?.message || e}`);
    }
  };

  const timerRef = useRef<number | null>(null);

  // Check initial meeting status & load last meeting
  useEffect(() => {
    try {
      commands.getMeetingStatus().then((res) => {
        if (res?.status === "ok") {
          setIsRecording(res.data.is_recording);
          setElapsedSeconds(Math.floor(res.data.elapsed_secs));
        }
      }).catch((e) => console.warn("Meeting status unavailable outside desktop app:", e));

      commands.getLastMeeting().then((res) => {
        if (res?.status === "ok" && res.data) {
          setLastResult(res.data);
        }
      }).catch((e) => console.warn("Last meeting unavailable outside desktop app:", e));
    } catch (e) {
      console.warn("Meeting initialization check skipped:", e);
    }
  }, []);

  // Timer while recording
  useEffect(() => {
    if (isRecording) {
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  // Auto-scroll ongoing transcript as new segments arrive
  useEffect(() => {
    if (isRecording) {
      liveTranscriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [liveTranscript, isRecording]);

  // Listen to Tauri events for levels, live transcript, and state
  useEffect(() => {
    let unlistenMic: (() => void) | null = null;
    let unlistenSys: (() => void) | null = null;
    let unlistenState: (() => void) | null = null;
    let unlistenFinished: (() => void) | null = null;
    let unlistenLive: (() => void) | null = null;

    listen<number>("babbl://meeting_mic_level", (event) => {
      setMicLevel(Math.min(1.0, event.payload * 5.0));
    }).then((fn) => {
      unlistenMic = fn;
    });

    listen<number>("babbl://meeting_system_level", (event) => {
      setSystemLevel(Math.min(1.0, event.payload * 5.0));
    }).then((fn) => {
      unlistenSys = fn;
    });

    listen<MeetingTranscript>("babbl://meeting_live_transcript", (event) => {
      setLiveTranscript(event.payload);
    }).then((fn) => {
      unlistenLive = fn;
    });

    listen<{ is_recording: boolean; is_processing: boolean }>(
      "babbl://meeting_state",
      (event) => {
        setIsRecording(event.payload.is_recording);
        setIsProcessing(event.payload.is_processing);
      }
    ).then((fn) => {
      unlistenState = fn;
    });

    listen<MeetingResult>("babbl://meeting_finished", (event) => {
      setLastResult(event.payload);
      setLiveTranscript(null);
      toast.success(t("meeting.status.readyToast", "Meeting ended! Transcript & MOM ready."));
    }).then((fn) => {
      unlistenFinished = fn;
    });

    return () => {
      if (unlistenMic) unlistenMic();
      if (unlistenSys) unlistenSys();
      if (unlistenState) unlistenState();
      if (unlistenFinished) unlistenFinished();
      if (unlistenLive) unlistenLive();
    };
  }, [t]);

  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleStartMeeting = async () => {
    try {
      if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
        toast.error("Please use the Babbl desktop application window.");
        return;
      }

      const config: DiarizationConfig = {
        similarity_threshold: similarityThreshold,
        translate_to_english: translateToEnglish,
      };

      setElapsedSeconds(0);
      setLiveTranscript(null);
      const res = await commands.startMeeting(config);
      if (res.status === "ok") {
        setIsRecording(true);
        toast.success(t("meeting.status.startedToast", "Meeting recording started. Listening to mic & system audio."));
      } else {
        toast.error(`Failed to start meeting: ${res.error}`);
      }
    } catch (e: any) {
      console.error("Start meeting error:", e);
      toast.error(`Error starting meeting: ${e?.message || e}`);
    }
  };

  const handleStopMeeting = async () => {
    try {
      if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
        toast.error("Please use the Babbl desktop application window.");
        return;
      }
      setIsProcessing(true);
      setIsRecording(false);
      toast.info(t("meeting.status.processingToast", "Processing meeting audio & generating MOM..."));
      const res = await commands.stopMeeting();
      setIsProcessing(false);
      if (res.status === "ok") {
        setLastResult(res.data);
      } else {
        toast.error(`Meeting processing failed: ${res.error}`);
      }
    } catch (e: any) {
      setIsProcessing(false);
      console.error("Stop meeting error:", e);
      toast.error(`Error stopping meeting: ${e?.message || e}`);
    }
  };

  const copyToClipboard = async (text: string, isMom: boolean) => {
    await navigator.clipboard.writeText(text);
    if (isMom) {
      setCopiedMom(true);
      setTimeout(() => setCopiedMom(false), 2000);
    } else {
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 2000);
    }
    toast.success(t("meeting.actions.copiedToast", "Copied to clipboard!"));
  };

  const getSpeakerBadgeColor = (speaker: string) => {
    if (speaker === "You") {
      return "bg-background-ui/20 text-background-ui border-background-ui/30";
    }
    if (speaker.includes("1")) {
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    }
    if (speaker.includes("2")) {
      return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    }
    return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  };

  return (
    <div className="w-full space-y-6">
      {/* Sub-Tabs Selector */}
      <div className="flex items-center gap-1.5 p-1 bg-surface/40 border border-border/30 rounded-xl overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveTab("meeting")}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer shrink-0 ${
            activeTab === "meeting"
              ? "bg-background-ui/20 text-background-ui shadow-sm"
              : "text-text/60 hover:text-text/90 hover:bg-white/5"
          }`}
        >
          <Users size={14} />
          <span>{t("meeting.tabs.live", "Live Meeting & MOM")}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("copilot")}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer shrink-0 ${
            activeTab === "copilot"
              ? "bg-background-ui/20 text-background-ui shadow-sm"
              : "text-text/60 hover:text-text/90 hover:bg-white/5"
          }`}
        >
          <Bot size={14} />
          <span>{t("meeting.tabs.copilot", "AI Copilot & Assistant")}</span>
          {isRecording ? (
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          ) : lastResult ? (
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer shrink-0 ${
            activeTab === "history"
              ? "bg-background-ui/20 text-background-ui shadow-sm"
              : "text-text/60 hover:text-text/90 hover:bg-white/5"
          }`}
        >
          <Calendar size={14} />
          <span>{t("meeting.tabs.history", "Past Meetings Memory")}</span>
        </button>
      </div>

      {/* Persistent recording status bar when user views other tabs */}
      {isRecording && activeTab !== "meeting" && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs font-semibold text-red-400">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
              {t("meeting.status.recording", "RECORDING")} ({formatTimer(elapsedSeconds)})
            </span>
            <span className="text-xs text-text/50 hidden sm:inline">
              Mic: {(micLevel * 100).toFixed(0)}% &bull; System: {(systemLevel * 100).toFixed(0)}%
            </span>
          </div>
          <Button
            size="sm"
            variant="danger"
            onClick={handleStopMeeting}
            disabled={isProcessing}
            className="h-8 px-3 text-xs flex items-center gap-1.5 cursor-pointer font-semibold shadow-md"
          >
            <Square size={13} className="fill-current" />
            <span>{t("meeting.actions.end", "End Meeting & Create MOM")}</span>
          </Button>
        </div>
      )}

      {/* TAB 1: Live Meeting & MOM */}
      {activeTab === "meeting" && (
        <div className="space-y-6">
          {/* Main Control Card */}
          <div className="bg-surface/50 border border-border/30 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-text/90">
                  {t("meeting.title", "Meeting Mode")}
                </h3>
                {isRecording ? (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    {t("meeting.status.recording", "RECORDING")} ({formatTimer(elapsedSeconds)})
                  </span>
                ) : isProcessing ? (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-background-ui/20 text-background-ui border border-background-ui/30">
                    <Loader2 size={12} className="animate-spin" />
                    {t("meeting.status.processing", "TRANSCRIBING & GENERATING MOM...")}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-mid-gray/20 text-text/50 border border-border/30">
                    {t("meeting.status.idle", "Idle")}
                  </span>
                )}
              </div>
              <p className="text-xs text-text/60 leading-relaxed max-w-xl">
                {t(
                  "meeting.description",
                  "Dual-track recording captures your microphone ('You') and conference audio ('Attendee') with live transcription and automatic Minutes of Meeting."
                )}
              </p>
              <p className="text-[11px] text-text/40 flex items-center gap-1 pt-0.5">
                <InfoTip
                  text={t(
                    "meeting.headphoneTip",
                    "Wear headphones during meetings to prevent remote attendee speech from echoing back into your microphone."
                  )}
                  position="bottom"
                />
                <span>
                  {t(
                    "meeting.headphoneTip",
                    "Tip: Wear headphones to prevent remote speech echoing into your mic."
                  )}
                </span>
              </p>
            </div>

            <div className="shrink-0">
              {isRecording ? (
                <Button
                  onClick={handleStopMeeting}
                  disabled={isProcessing}
                  variant="danger"
                  className="flex items-center gap-2 px-5 py-2.5 font-semibold shadow-lg shadow-red-500/10 cursor-pointer"
                >
                  <Square size={15} className="fill-current" />
                  {t("meeting.actions.end", "End Meeting & Create MOM")}
                </Button>
              ) : (
                <Button
                  onClick={handleStartMeeting}
                  disabled={isProcessing}
                  variant="primary"
                  className="flex items-center gap-2 px-5 py-2.5 font-semibold shadow-lg cursor-pointer bg-background-ui hover:bg-background-ui/90 text-white"
                >
                  <Play size={15} className="fill-current" />
                  {t("meeting.actions.start", "Start Meeting Mode")}
                </Button>
              )}
            </div>
          </div>

          {/* Audio Channels & Live Monitoring */}
          <SettingsGroup
            title={t("meeting.monitors.title", "Audio Channels")}
            info={t(
              "meeting.monitors.info",
              "Dual-channel capture isolates your voice on channel 0 and meeting participants on channel 1."
            )}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/30 p-4 gap-4">
              {/* Duration */}
              <div className="flex flex-col justify-between space-y-2">
                <div className="flex items-center justify-between text-xs text-text/60">
                  <span className="flex items-center gap-1.5">
                    <Clock size={14} className="text-text/40" />
                    {t("meeting.monitors.duration", "Duration")}
                  </span>
                  <span className="font-mono text-[11px]">
                    {isRecording
                      ? t("meeting.monitors.live", "LIVE")
                      : t("meeting.monitors.stopped", "STOPPED")}
                  </span>
                </div>
                <div className="text-2xl font-mono font-bold text-text/90">
                  {formatTimer(elapsedSeconds)}
                </div>
                <p className="text-[11px] text-text/40">
                  16 kHz synchronous dual-track
                </p>
              </div>

              {/* Microphone Level */}
              <div className="flex flex-col justify-between space-y-2 md:px-4">
                <div className="flex items-center justify-between text-xs text-text/60">
                  <span className="flex items-center gap-1.5">
                    <Mic size={14} className="text-background-ui" />
                    {t("meeting.monitors.mic", "Your Microphone (You)")}
                  </span>
                  <span className="font-mono text-[11px] text-background-ui">CH 0</span>
                </div>
                <div className="w-full bg-mid-gray/20 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-background-ui h-full rounded-full transition-all duration-75"
                    style={{ width: `${Math.min(100, Math.max(4, micLevel * 100))}%` }}
                  />
                </div>
                <p className="text-[11px] text-text/40">
                  {t("meeting.monitors.micDesc", "Dedicated user voice stream with zero ambiguity")}
                </p>
              </div>

              {/* System Audio Level */}
              <div className="flex flex-col justify-between space-y-2 md:pl-4">
                <div className="flex items-center justify-between text-xs text-text/60">
                  <span className="flex items-center gap-1.5">
                    <Volume2 size={14} className="text-emerald-400" />
                    {t("meeting.monitors.system", "System / Attendees Audio")}
                  </span>
                  <span className="font-mono text-[11px] text-emerald-400">CH 1</span>
                </div>
                <div className="w-full bg-mid-gray/20 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-75"
                    style={{ width: `${Math.min(100, Math.max(4, systemLevel * 100))}%` }}
                  />
                </div>
                <p className="text-[11px] text-text/40">
                  {t("meeting.monitors.systemDesc", "System loopback capturing Zoom, Teams & calls")}
                </p>
              </div>
            </div>
          </SettingsGroup>

          {/* Configuration SettingsGroup */}
          <SettingsGroup
            title={t("meeting.configuration.title", "Capture & Transcription Settings")}
            info={t(
              "meeting.configuration.info",
              "Configure dual-channel audio capture and automatic English translation."
            )}
          >
            <ToggleSwitch
              label={t("meeting.configuration.translateLabel", "Translate foreign speech to English")}
              description={t(
                "meeting.configuration.translateDesc",
                "Automatically translates speech from foreign languages to English during transcription"
              )}
              checked={translateToEnglish}
              onChange={setTranslateToEnglish}
              grouped={true}
              disabled={isRecording}
            />
            <div className="px-4 py-3 flex items-center justify-between text-xs">
              <div className="space-y-0.5">
                <span className="font-medium text-text/90">
                  {t("meeting.configuration.separationThreshold", "Speaker Separation Threshold")}
                </span>
                <p className="text-[11px] text-text/50">
                  {t("meeting.configuration.separationDesc", "Cosine similarity cutoff for clustering remote speakers")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.5"
                  max="0.9"
                  step="0.02"
                  value={similarityThreshold}
                  onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
                  disabled={isRecording}
                  className="w-24 accent-background-ui cursor-pointer"
                />
                <span className="font-mono text-text/80 text-xs w-10 text-right">
                  {(similarityThreshold * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </SettingsGroup>

          {/* Real-Time Live Ongoing Transcription Card */}
          {isRecording && (
            <div className="bg-surface/50 border border-red-500/30 rounded-xl p-4 flex flex-col h-[360px] shadow-lg shadow-red-500/5">
              <div className="flex items-center justify-between border-b border-border/30 pb-3 mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <h3 className="font-semibold text-text/90 text-xs flex items-center gap-2">
                    {t("meeting.liveTranscript.title", "Ongoing Real-Time Meeting Transcript")}
                  </h3>
                  <span className="text-[11px] bg-red-500/10 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full font-mono">
                    {t("meeting.liveTranscript.turns", "{{count}} spoken turns", {
                      count: liveTranscript?.segments.length || 0,
                    })}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("copilot")}
                  className="h-7 px-2 text-xs flex items-center gap-1.5 cursor-pointer text-background-ui hover:text-background-ui hover:bg-background-ui/10 border border-background-ui/30"
                >
                  <Bot size={13} />
                  <span>{t("meeting.liveTranscript.askCopilot", "Ask Copilot About Ongoing Meeting")}</span>
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1.5 text-xs">
                {!liveTranscript || liveTranscript.segments.length === 0 ? (
                  <div className="text-text/40 italic text-center py-14 flex flex-col items-center gap-2">
                    <Loader2 size={18} className="animate-spin text-text/30" />
                    <span>{t("meeting.liveTranscript.listening", "Listening for speech... Continuous live transcription streams here automatically.")}</span>
                  </div>
                ) : (
                  liveTranscript.segments.map((seg, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-surface/40 border border-border/30 space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span
                          className={`px-2 py-0.5 rounded font-semibold border ${getSpeakerBadgeColor(
                            seg.speaker
                          )}`}
                        >
                          {seg.speaker}
                        </span>
                        <span className="font-mono text-text/40">
                          {seg.start_secs.toFixed(1)}s - {seg.end_secs.toFixed(1)}s
                        </span>
                      </div>
                      <p className="text-text/80 leading-relaxed text-xs">
                        {seg.text}
                      </p>
                    </div>
                  ))
                )}
                <div ref={liveTranscriptEndRef} />
              </div>
            </div>
          )}

          {/* Results View: Transcript & MOM */}
          {lastResult ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Diarized Transcript Column */}
              <div className="bg-surface/50 border border-border/30 rounded-xl p-4 flex flex-col h-[500px]">
                <div className="flex items-center justify-between border-b border-border/30 pb-3 mb-3">
                  <div className="flex items-center gap-2">
                    <FileText size={15} className="text-text/50" />
                    <h3 className="font-semibold text-text/90 text-xs">
                      {t("meeting.results.diarizedTranscript", "Dual-Track English Transcript")}
                    </h3>
                    <span className="text-[11px] text-text/40 font-mono">
                      {t("meeting.results.turnsCount", "({{count}} turns)", {
                        count: lastResult.transcript.segments.length,
                      })}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(lastResult.transcript.full_text, false)
                    }
                    className="h-7 px-2 text-xs flex items-center gap-1.5 cursor-pointer text-text/60 hover:text-text/90"
                  >
                    {copiedTranscript ? (
                      <>
                        <Check size={13} className="text-emerald-400" />
                        <span>{t("meeting.actions.copied", "Copied")}</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} />
                        <span>{t("meeting.actions.copyTranscript", "Copy")}</span>
                      </>
                    )}
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1.5 text-xs">
                  {lastResult.transcript.segments.length === 0 ? (
                    <div className="text-text/40 italic text-center py-12">
                      {t("meeting.results.noSpeech", "No speech segments detected.")}
                    </div>
                  ) : (
                    lastResult.transcript.segments.map((seg, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-surface/40 border border-border/20 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span
                            className={`px-2 py-0.5 rounded font-semibold border ${getSpeakerBadgeColor(
                              seg.speaker
                            )}`}
                          >
                            {seg.speaker}
                          </span>
                          <span className="font-mono text-text/40">
                            {seg.start_secs.toFixed(1)}s - {seg.end_secs.toFixed(1)}s
                          </span>
                        </div>
                        <p className="text-text/80 leading-relaxed text-xs">
                          {seg.text}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Minutes of Meeting (MOM) Column */}
              <div className="bg-surface/50 border border-border/30 rounded-xl p-4 flex flex-col h-[500px]">
                <div className="flex items-center justify-between border-b border-border/30 pb-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles size={15} className="text-background-ui" />
                    <h3 className="font-semibold text-text/90 text-xs">
                      {t("meeting.results.momTitle", "Generated Minutes of Meeting (MOM)")}
                    </h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        if (lastResult) {
                          downloadMeetingPdf(lastResult);
                          toast.success(t("meeting.actions.pdfDownloaded", "Downloaded meeting transcript PDF!"));
                        }
                      }}
                      className="h-7 px-2 text-xs flex items-center gap-1 cursor-pointer"
                      title="Download PDF report"
                    >
                      <Download size={13} className="text-background-ui" />
                      <span>{t("meeting.actions.downloadPdf", "PDF")}</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowEmailModal(true)}
                      className="h-7 px-2 text-xs flex items-center gap-1 cursor-pointer"
                    >
                      <Mail size={13} />
                      <span>{t("meeting.actions.sendEmail", "Email")}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(
                          lastResult.mom?.summary_markdown || "",
                          true
                        )
                      }
                      className="h-7 px-2 text-xs flex items-center gap-1 cursor-pointer text-text/60 hover:text-text/90"
                    >
                      {copiedMom ? (
                        <>
                          <Check size={13} className="text-emerald-400" />
                          <span>{t("meeting.actions.copied", "Copied")}</span>
                        </>
                      ) : (
                        <>
                          <Copy size={13} />
                          <span>{t("meeting.actions.copyMom", "Copy")}</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-1.5">
                  {lastResult.mom ? (
                    <div className="text-xs text-text/80 space-y-2 leading-relaxed whitespace-pre-line font-normal">
                      {lastResult.mom.summary_markdown}
                    </div>
                  ) : (
                    <div className="text-text/40 italic text-center py-12">
                      {t("meeting.results.noMom", "No MOM generated yet.")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Empty State */
            <div className="border border-dashed border-border/40 rounded-xl p-10 text-center text-text/50">
              <Users size={32} className="mx-auto text-text/30 mb-2.5" />
              <h4 className="text-text/80 font-medium text-xs">
                {t("meeting.emptyState.title", "No Meeting Recorded Yet")}
              </h4>
              <p className="text-[11px] text-text/40 max-w-md mx-auto mt-1">
                {t(
                  "meeting.emptyState.description",
                  "Click Start Meeting Mode above before starting your Google Meet, Zoom, or online call. Both your microphone and attendee audio will be captured and converted into structured Minutes of Meeting."
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: AI Copilot & Assistant */}
      {activeTab === "copilot" && (
        <MeetingAssistantPanel
          currentMeetingResult={lastResult}
          liveTranscript={liveTranscript}
          isRecording={isRecording}
          activePastMeeting={selectedPastMeetingForCopilot}
          onClearActivePastMeeting={() => setSelectedPastMeetingForCopilot(null)}
        />
      )}

      {/* TAB 3: Past Meetings Memory */}
      {activeTab === "history" && (
        <PastMeetingsView
          onAskCopilotAboutMeeting={handleAskCopilotAboutMeeting}
        />
      )}

      {/* Send MOM via Gmail Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border/40 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border/30">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-background-ui/10 border border-background-ui/20 rounded-lg text-background-ui">
                  <Mail size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text/90">
                    {t("meeting.emailModal.title", "Send MOM via Gmail")}
                  </h3>
                  <p className="text-xs text-text/50">
                    {t("meeting.emailModal.description", "Dispatch meeting minutes using your Gmail account & App Password.")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEmailModal(false)}
                className="text-text/50 hover:text-text/90 p-1.5 rounded-lg hover:bg-white/5 transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* Sender Email */}
              <div>
                <label className="block font-medium text-text/80 mb-1 flex items-center gap-1.5">
                  <AtSign size={13} className="text-text/40" />
                  {t("meeting.emailModal.senderLabel", "Your Gmail Address")}
                </label>
                <input
                  type="email"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder={t("meeting.emailModal.senderPlaceholder", "e.g. you@gmail.com")}
                  className="w-full bg-mid-gray/10 border border-border/40 rounded-lg px-3 py-2 text-text/90 placeholder-text/30 focus:outline-none focus:border-background-ui text-xs"
                />
              </div>

              {/* Gmail App Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-medium text-text/80 flex items-center gap-1.5">
                    <Key size={13} className="text-text/40" />
                    <span>{t("meeting.emailModal.passwordLabel", "Gmail App Password")}</span>
                    {hasSavedPassword && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20 font-normal">
                        <ShieldCheck size={11} />
                        {t("meeting.emailModal.savedBadge", "Saved in desktop settings")}
                      </span>
                    )}
                  </label>
                  <span className="text-[10px] text-text/40">
                    {t("meeting.emailModal.passwordHint", "16-character Google App Password")}
                  </span>
                </div>
                <input
                  type="password"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  placeholder={
                    hasSavedPassword
                      ? t(
                          "meeting.emailModal.passwordSavedPlaceholder",
                          "•••••••••••••••• (Saved in desktop settings)"
                        )
                      : "abcd efgh ijkl mnop"
                  }
                  className="w-full bg-mid-gray/10 border border-border/40 rounded-lg px-3 py-2 text-text/90 placeholder-text/30 focus:outline-none focus:border-background-ui text-xs font-mono"
                />
                <p className="text-[10px] text-text/40 mt-1">
                  {t(
                    "meeting.emailModal.passwordTip",
                    "Generate in your Google Account → Security → 2-Step Verification → App Passwords."
                  )}
                </p>
              </div>

              {/* Recipients */}
              <div>
                <label className="block font-medium text-text/80 mb-1">
                  {t("meeting.emailModal.recipientsLabel", "Recipients (comma or newline separated)")}
                </label>
                <textarea
                  value={recipientsInput}
                  onChange={(e) => setRecipientsInput(e.target.value)}
                  rows={2}
                  placeholder={t("meeting.emailModal.recipientsPlaceholder", "colleague@example.com, manager@example.com")}
                  className="w-full bg-mid-gray/10 border border-border/40 rounded-lg px-3 py-2 text-text/90 placeholder-text/30 focus:outline-none focus:border-background-ui text-xs resize-none"
                />
              </div>

              {/* Subject */}
              <div>
                <label className="block font-medium text-text/80 mb-1">
                  {t("meeting.emailModal.subjectLabel", "Email Subject")}
                </label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder={t("meeting.emailModal.subjectPlaceholder", "Meeting Summary")}
                  className="w-full bg-mid-gray/10 border border-border/40 rounded-lg px-3 py-2 text-text/90 placeholder-text/30 focus:outline-none focus:border-background-ui text-xs"
                />
              </div>

              {/* Automatic PDF Attachment Card */}
              <div className="bg-surface/40 border border-border/30 rounded-xl p-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-background-ui/10 border border-background-ui/20 rounded-lg text-background-ui">
                    <FileText size={15} />
                  </div>
                  <div>
                    <div className="font-medium text-text/90">
                      {t("meeting.emailModal.attachmentTitle", "Full Transcript & AI Notes PDF Attached")}
                    </div>
                    <div className="text-[11px] text-text/40">
                      {t("meeting.emailModal.attachmentDesc", "Includes complete speaker diarization, timestamps, and MOM")}
                    </div>
                  </div>
                </div>
                {lastResult && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => downloadMeetingPdf(lastResult)}
                    className="h-7 px-2 text-xs flex items-center gap-1 text-background-ui hover:text-background-ui cursor-pointer"
                  >
                    <Download size={13} />
                    <span>{t("meeting.emailModal.preview", "Preview")}</span>
                  </Button>
                )}
              </div>

              {/* Credential Persistence & Management */}
              <div className="bg-surface/30 border border-border/25 rounded-xl p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-text/80 select-none">
                    <input
                      type="checkbox"
                      checked={rememberCredentials}
                      onChange={(e) => setRememberCredentials(e.target.checked)}
                      className="rounded border-border/40 text-background-ui focus:ring-background-ui/30 bg-mid-gray/20 h-3.5 w-3.5 cursor-pointer"
                    />
                    <span className="font-medium text-text/90">
                      {t(
                        "meeting.emailModal.rememberCredentials",
                        "Save credentials securely in desktop settings"
                      )}
                    </span>
                  </label>
                  {hasSavedPassword && (
                    <button
                      type="button"
                      onClick={handleClearCredentials}
                      className="text-[11px] text-red-400/80 hover:text-red-400 flex items-center gap-1 hover:underline cursor-pointer transition"
                    >
                      <Trash2 size={11} />
                      <span>{t("meeting.emailModal.clearCredentials", "Clear saved credentials")}</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-text/40">
                  {t(
                    "meeting.emailModal.rememberCredentialsDesc",
                    "Stores your sender address and password in backend settings so you don't have to re-type them."
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/30">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowEmailModal(false)}
                className="text-xs text-text/60 hover:text-text/90"
              >
                {t("meeting.emailModal.cancel", "Cancel")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSendEmail}
                disabled={isSendingEmail}
                className="text-xs flex items-center gap-1.5 bg-background-ui hover:bg-background-ui/90 text-white font-medium px-4 py-2"
              >
                {isSendingEmail ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>{t("meeting.emailModal.sending", "Sending Email...")}</span>
                  </>
                ) : (
                  <>
                    <Send size={13} />
                    <span>{t("meeting.emailModal.send", "Send MOM Now")}</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
