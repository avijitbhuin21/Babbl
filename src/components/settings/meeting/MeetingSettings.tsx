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
  Languages,
  Mail,
  Key,
  X,
  AtSign,
  Download,
  Bot,
  Folder,
  Calendar,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  commands,
  type DiarizationConfig,
  type MeetingResult,
  type MeetingStatus,
  type MeetingTranscript,
  type PastMeetingRecord,
} from "@/bindings";
import { Button } from "../../ui/Button";
import {
  downloadMeetingPdf,
  exportMeetingPdfBase64,
} from "@/lib/pdfGenerator";
import { MeetingAssistantPanel } from "./MeetingAssistantPanel";
import { WorkspaceManagerView } from "./WorkspaceManagerView";
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

  // Subtabs (Live Meeting, AI Copilot, Workspace, Past Meetings)
  const [activeTab, setActiveTab] = useState<"meeting" | "copilot" | "workspace" | "history">("meeting");
  const [selectedPastMeetingForCopilot, setSelectedPastMeetingForCopilot] = useState<PastMeetingRecord | null>(null);

  const handleAskCopilotAboutMeeting = (meeting: PastMeetingRecord) => {
    setSelectedPastMeetingForCopilot(meeting);
    setActiveTab("copilot");
  };

  // Email sending state (Task 2)
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [senderEmail, setSenderEmail] = useState(
    () => localStorage.getItem("babbl_gmail_sender") || ""
  );
  const [appPassword, setAppPassword] = useState(
    () => localStorage.getItem("babbl_gmail_password") || ""
  );
  const [recipientsInput, setRecipientsInput] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  useEffect(() => {
    if (lastResult?.mom?.title) {
      setEmailSubject(lastResult.mom.title);
    }
  }, [lastResult]);

  const handleSendEmail = async () => {
    const cleanSender = senderEmail.trim();
    const cleanPass = appPassword.trim();
    const recipientList = recipientsInput
      .split(/[,;\n]/)
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    if (!cleanSender) {
      toast.error("Please enter your Gmail address.");
      return;
    }
    if (!cleanPass) {
      toast.error("Please enter your 16-character Gmail App Password.");
      return;
    }
    if (recipientList.length === 0) {
      toast.error("Please specify at least one recipient email address.");
      return;
    }

    // Save sender & password in localStorage for convenience
    localStorage.setItem("babbl_gmail_sender", cleanSender);
    localStorage.setItem("babbl_gmail_password", cleanPass);

    setIsSendingEmail(true);
    toast.info(`Sending MOM with transcript PDF to ${recipientList.length} recipient(s)...`);

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
        app_password: cleanPass,
        recipients: recipientList,
        subject: emailSubject || "Minutes of Meeting",
        mom_markdown: lastResult?.mom?.summary_markdown || "",
        pdf_base64: pdfBase64,
        pdf_filename: pdfFilename,
      });

      setIsSendingEmail(false);
      if (res.status === "ok") {
        toast.success(`MOM & Transcript PDF delivered to ${recipientList.length} recipient(s)!`);
        setShowEmailModal(false);
      } else {
        toast.error(`Email delivery failed: ${res.error}`);
      }
    } catch (e: any) {
      setIsSendingEmail(false);
      toast.error(`Error sending email: ${e?.message || e}`);
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
      setMicLevel(Math.min(1.0, event.payload * 5.0)); // scale for visual responsiveness
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
      toast.success("Meeting ended! Transcript & MOM ready.");
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
  }, []);

  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleStartMeeting = async () => {
    try {
      if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
        toast.error("Please use the Babbl desktop application window. Meeting recording requires native hardware audio loopback.");
        return;
      }

      const config: DiarizationConfig = {
        mode: "Local",
        similarity_threshold: similarityThreshold,
        api_key: null,
        api_provider: "deepgram",
        translate_to_english: translateToEnglish,
      };

      setElapsedSeconds(0);
      setLiveTranscript(null);
      const res = await commands.startMeeting(config);
      if (res.status === "ok") {
        setIsRecording(true);
        toast.success("Meeting recording started. Listening to mic & system audio.");
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
      toast.info("Processing meeting audio, diarizing speakers & generating MOM...");
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
    toast.success("Copied to clipboard!");
  };

  const getSpeakerBadgeColor = (speaker: string) => {
    if (speaker === "You") {
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
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
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-100 flex items-center gap-2">
              <Users className="w-6 h-6 text-primary-400" />
              Meeting Mode
            </h1>
            {isRecording ? (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                RECORDING
              </span>
            ) : isProcessing ? (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                <Loader2 className="w-3 h-3 animate-spin" />
                TRANSCRIBING & GENERATING MOM...
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
                Idle
              </span>
            )}
          </div>
          <p className="text-sm text-neutral-400 mt-1">
            Simultaneously records your microphone & attendee system audio with speaker diarization, English transcription, and automatic Minutes of Meeting.
          </p>
        </div>

        {/* Action Button */}
        <div>
          {isRecording ? (
            <Button
              onClick={handleStopMeeting}
              disabled={isProcessing}
              variant="danger"
              className="flex items-center gap-2 px-5 py-2.5 font-semibold shadow-lg shadow-red-500/10 cursor-pointer"
            >
              <Square className="w-4 h-4 fill-current" />
              End Meeting & Create MOM
            </Button>
          ) : (
            <Button
              onClick={handleStartMeeting}
              disabled={isProcessing}
              variant="primary"
              className="flex items-center gap-2 px-5 py-2.5 font-semibold shadow-lg cursor-pointer bg-primary-600 hover:bg-primary-500 text-white"
            >
              <Play className="w-4 h-4 fill-current" />
              Start Meeting Mode
            </Button>
          )}
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-neutral-800 pb-2 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveTab("meeting")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer shrink-0 ${
            activeTab === "meeting"
              ? "bg-primary-500/20 text-primary-400 border border-primary-500/30"
              : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Live Meeting & MOM</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("copilot")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer shrink-0 ${
            activeTab === "copilot"
              ? "bg-primary-500/20 text-primary-400 border border-primary-500/30"
              : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60"
          }`}
        >
          <Bot className="w-3.5 h-3.5 text-primary-400" />
          <span>AI Copilot & Assistant</span>
          {isRecording ? (
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" title="Ongoing meeting active - Copilot listening" />
          ) : lastResult ? (
            <span className="w-2 h-2 rounded-full bg-emerald-400" title="Transcript loaded in context" />
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("workspace")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer shrink-0 ${
            activeTab === "workspace"
              ? "bg-primary-500/20 text-primary-400 border border-primary-500/30"
              : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60"
          }`}
        >
          <Folder className="w-3.5 h-3.5 text-amber-400" />
          <span>Workspace & Code</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer shrink-0 ${
            activeTab === "history"
              ? "bg-primary-500/20 text-primary-400 border border-primary-500/30"
              : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60"
          }`}
        >
          <Calendar className="w-3.5 h-3.5 text-purple-400" />
          <span>Past Meetings Memory</span>
        </button>
      </div>

      {/* Persistent recording status bar if user navigates to other tabs while recording */}
      {isRecording && activeTab !== "meeting" && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs font-semibold text-red-400">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
              RECORDING IN PROGRESS ({formatTimer(elapsedSeconds)})
            </span>
            <span className="text-xs text-neutral-400 hidden sm:inline">
              Mic Level: {(micLevel * 100).toFixed(0)}% &bull; System Audio: {(systemLevel * 100).toFixed(0)}%
            </span>
          </div>
          <Button
            size="sm"
            variant="danger"
            onClick={handleStopMeeting}
            disabled={isProcessing}
            className="h-8 px-3.5 text-xs flex items-center gap-1.5 cursor-pointer font-semibold shadow-md"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>End Meeting & Create MOM</span>
          </Button>
        </div>
      )}

      {/* Tab 1: Live Meeting & MOM */}
      {activeTab === "meeting" && (
        <>
      {/* Live Audio Monitors & Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Timer Card */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-neutral-400 text-xs">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-neutral-400" />
              Duration
            </span>
            <span className="font-mono text-xs">{isRecording ? "LIVE" : "STOPPED"}</span>
          </div>
          <div className="my-2">
            <span className="text-3xl font-mono font-bold text-neutral-100">
              {formatTimer(elapsedSeconds)}
            </span>
          </div>
          <p className="text-xs text-neutral-500">
            Synchronous 16 kHz dual-channel capture
          </p>
        </div>

        {/* Microphone Audio Level */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-neutral-400 text-xs">
            <span className="flex items-center gap-1.5">
              <Mic className="w-4 h-4 text-blue-400" />
              Your Microphone ([You])
            </span>
            <span className="font-mono text-xs text-blue-400">CH 0</span>
          </div>
          <div className="my-3">
            <div className="w-full bg-neutral-800 h-3 rounded-full overflow-hidden">
              <div
                className="bg-blue-500 h-full rounded-full transition-all duration-75"
                style={{ width: `${Math.min(100, Math.max(4, micLevel * 100))}%` }}
              />
            </div>
          </div>
          <p className="text-xs text-neutral-500">
            Dedicated user voice stream with zero speaker ambiguity
          </p>
        </div>

        {/* System Loopback Audio Level */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-neutral-400 text-xs">
            <span className="flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-emerald-400" />
              System / Attendees Audio
            </span>
            <span className="font-mono text-xs text-emerald-400">CH 1</span>
          </div>
          <div className="my-3">
            <div className="w-full bg-neutral-800 h-3 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-75"
                style={{ width: `${Math.min(100, Math.max(4, systemLevel * 100))}%` }}
              />
            </div>
          </div>
          <p className="text-xs text-neutral-500">
            WASAPI loopback capturing Zoom, Teams & browser audio
          </p>
        </div>
      </div>

      {/* Options Bar */}
      <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-neutral-300">
            <input
              type="checkbox"
              checked={translateToEnglish}
              onChange={(e) => setTranslateToEnglish(e.target.checked)}
              className="rounded bg-neutral-800 border-neutral-700 text-primary-500 focus:ring-0"
            />
            <Languages className="w-3.5 h-3.5 text-primary-400" />
            <span className="font-medium">Translate foreign speech to English</span>
          </label>
        </div>

        <div className="flex items-center gap-2 text-neutral-400">
          <span>Speaker Separation Threshold:</span>
          <input
            type="range"
            min="0.5"
            max="0.9"
            step="0.02"
            value={similarityThreshold}
            onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
            className="w-24 accent-primary-500"
          />
          <span className="font-mono text-neutral-200">
            {(similarityThreshold * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Real-Time Live Ongoing Transcription Card */}
      {isRecording && (
        <div className="bg-neutral-900/80 border border-red-500/30 rounded-xl p-5 flex flex-col h-[380px] shadow-lg shadow-red-500/5 mt-4">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <h3 className="font-semibold text-neutral-100 text-sm flex items-center gap-2">
                Ongoing Real-Time Meeting Transcript
              </h3>
              <span className="text-xs bg-red-500/20 text-red-300 border border-red-500/30 px-2 py-0.5 rounded-full font-mono">
                {liveTranscript?.segments.length || 0} spoken turns
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab("copilot")}
                className="h-8 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer text-primary-400 hover:text-primary-300 hover:bg-primary-500/10 border border-primary-500/30"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>Ask Copilot About Ongoing Meeting</span>
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-2 text-sm">
            {!liveTranscript || liveTranscript.segments.length === 0 ? (
              <div className="text-neutral-500 italic text-center py-16 flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-neutral-600" />
                <span>Listening for speech... Continuous live transcription streams here automatically.</span>
              </div>
            ) : (
              liveTranscript.segments.map((seg, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-neutral-950/60 border border-neutral-800/80 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${getSpeakerBadgeColor(
                        seg.speaker
                      )}`}
                    >
                      {seg.speaker}
                    </span>
                    <span className="font-mono text-neutral-500 text-[11px]">
                      {seg.start_secs.toFixed(1)}s - {seg.end_secs.toFixed(1)}s
                    </span>
                  </div>
                  <p className="text-neutral-200 leading-relaxed text-xs">
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Diarized Transcript Column */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-5 flex flex-col h-[520px]">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-neutral-400" />
                <h3 className="font-semibold text-neutral-200 text-sm">
                  Diarized English Transcript
                </h3>
                <span className="text-xs text-neutral-500 font-mono">
                  ({lastResult.transcript.segments.length} turns)
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  copyToClipboard(lastResult.transcript.full_text, false)
                }
                className="h-8 px-2 text-xs flex items-center gap-1.5 cursor-pointer text-neutral-400 hover:text-neutral-100"
              >
                {copiedTranscript ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 text-sm">
              {lastResult.transcript.segments.length === 0 ? (
                <div className="text-neutral-500 italic text-center py-12">
                  No speech segments detected.
                </div>
              ) : (
                lastResult.transcript.segments.map((seg, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-neutral-950/40 border border-neutral-800/60 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${getSpeakerBadgeColor(
                          seg.speaker
                        )}`}
                      >
                        {seg.speaker}
                      </span>
                      <span className="font-mono text-neutral-500 text-[11px]">
                        {seg.start_secs.toFixed(1)}s - {seg.end_secs.toFixed(1)}s
                      </span>
                    </div>
                    <p className="text-neutral-200 leading-relaxed text-xs">
                      {seg.text}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Minutes of Meeting (MOM) Column */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-5 flex flex-col h-[520px]">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary-400" />
                <h3 className="font-semibold text-neutral-200 text-sm">
                  Generated Minutes of Meeting (MOM)
                </h3>
                <span className="text-[11px] bg-primary-500/20 text-primary-400 border border-primary-500/30 px-2 py-0.5 rounded-full font-medium">
                  Ready to Send
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (lastResult) {
                      downloadMeetingPdf(lastResult);
                      toast.success("Downloaded meeting transcript PDF!");
                    }
                  }}
                  className="h-8 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer bg-neutral-800 text-neutral-200 border border-neutral-700 hover:bg-neutral-700 hover:text-white"
                  title="Download styled PDF matching Fireflies layout"
                >
                  <Download className="w-3.5 h-3.5 text-primary-400" />
                  <span>Download PDF</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowEmailModal(true)}
                  className="h-8 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer bg-primary-500/15 text-primary-400 border border-primary-500/30 hover:bg-primary-500/25 hover:text-primary-300"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Send via Gmail</span>
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
                  className="h-8 px-2 text-xs flex items-center gap-1.5 cursor-pointer text-neutral-400 hover:text-neutral-100"
                >
                  {copiedMom ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy MOM</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2">
              {lastResult.mom ? (
                <div className="prose prose-invert prose-sm max-w-none text-xs text-neutral-300 space-y-3 leading-relaxed whitespace-pre-line">
                  {lastResult.mom.summary_markdown}
                </div>
              ) : (
                <div className="text-neutral-500 italic text-center py-12">
                  No MOM generated yet.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="border border-dashed border-neutral-800 rounded-xl p-12 text-center text-neutral-500">
          <Users className="w-10 h-10 mx-auto text-neutral-600 mb-3" />
          <h4 className="text-neutral-300 font-medium text-sm">
            No Meeting Recorded Yet
          </h4>
          <p className="text-xs text-neutral-500 max-w-md mx-auto mt-1">
            Click <strong>Start Meeting Mode</strong> above before starting your Google Meet, Zoom, or online call. Both your microphone and attendee audio will be captured and converted into structured Minutes of Meeting.
          </p>
        </div>
      )}
        </>
      )}

      {/* Tab 2: AI Copilot & Assistant */}
      {activeTab === "copilot" && (
        <MeetingAssistantPanel
          currentMeetingResult={lastResult}
          liveTranscript={liveTranscript}
          isRecording={isRecording}
          activePastMeeting={selectedPastMeetingForCopilot}
          onClearActivePastMeeting={() => setSelectedPastMeetingForCopilot(null)}
        />
      )}

      {/* Tab 3: Autonomous Workspace & Code Runner */}
      {activeTab === "workspace" && (
        <WorkspaceManagerView />
      )}

      {/* Tab 4: Past Meetings SQLite Memory */}
      {activeTab === "history" && (
        <PastMeetingsView
          onAskCopilotAboutMeeting={handleAskCopilotAboutMeeting}
        />
      )}

      {/* Send MOM via Gmail Modal (Task 2) */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-neutral-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-primary-500/10 border border-primary-500/20 rounded-lg text-primary-400">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-neutral-100">
                    Send MOM via Gmail
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Dispatch meeting minutes using your Gmail account & App Password.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowEmailModal(false)}
                className="text-neutral-400 hover:text-neutral-200 p-1.5 rounded-lg hover:bg-neutral-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Sender Email */}
              <div>
                <label className="block font-medium text-neutral-300 mb-1 flex items-center gap-1.5">
                  <AtSign className="w-3.5 h-3.5 text-neutral-400" />
                  Your Gmail Address
                </label>
                <input
                  type="email"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder="e.g. you@gmail.com"
                  className="w-full bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-primary-500 text-xs"
                />
              </div>

              {/* Gmail App Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-medium text-neutral-300 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-neutral-400" />
                    Gmail App Password
                  </label>
                  <span className="text-[10px] text-neutral-400">
                    16-character Google App Password
                  </span>
                </div>
                <input
                  type="password"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  placeholder="abcd efgh ijkl mnop"
                  className="w-full bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-primary-500 text-xs font-mono"
                />
                <p className="text-[10px] text-neutral-500 mt-1">
                  Tip: Generate in your Google Account &rarr; Security &rarr; 2-Step Verification &rarr; App Passwords.
                </p>
              </div>

              {/* Recipients for this Meeting */}
              <div>
                <label className="block font-medium text-neutral-300 mb-1">
                  Recipients (comma or newline separated)
                </label>
                <textarea
                  value={recipientsInput}
                  onChange={(e) => setRecipientsInput(e.target.value)}
                  rows={2}
                  placeholder="colleague@example.com, manager@example.com"
                  className="w-full bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-primary-500 text-xs resize-none"
                />
              </div>

              {/* Subject */}
              <div>
                <label className="block font-medium text-neutral-300 mb-1">
                  Email Subject
                </label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Meeting Summary"
                  className="w-full bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-primary-500 text-xs"
                />
              </div>

              {/* Automatic PDF Attachment Card */}
              <div className="bg-neutral-800/50 border border-neutral-700/60 rounded-xl p-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-primary-500/10 border border-primary-500/20 rounded-lg text-primary-400">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-medium text-neutral-200">
                      Full Transcript & AI Notes PDF Attached
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      Includes complete speaker diarization, timestamps, and MOM
                    </div>
                  </div>
                </div>
                {lastResult && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => downloadMeetingPdf(lastResult)}
                    className="h-7 px-2 text-xs flex items-center gap-1 text-primary-400 hover:text-primary-300 cursor-pointer"
                    title="Download and preview the attached PDF"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Preview</span>
                  </Button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 mt-6 pt-4 border-t border-neutral-800">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowEmailModal(false)}
                className="text-xs text-neutral-400 hover:text-neutral-200"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSendEmail}
                disabled={isSendingEmail}
                className="text-xs flex items-center gap-1.5 bg-primary-600 hover:bg-primary-500 text-white font-medium px-4 py-2"
              >
                {isSendingEmail ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Sending Email...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send MOM Now</span>
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
