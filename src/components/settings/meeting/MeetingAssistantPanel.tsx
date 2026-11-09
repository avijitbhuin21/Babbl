import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Send,
  Loader2,
  Sparkles,
  Search,
  Calendar,
  FileText,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import {
  commands,
  type ChatMessage,
  type MeetingResult,
  type MeetingTranscript,
  type PastMeetingRecord,
} from "@/bindings";
import { Button } from "../../ui/Button";
import { MarkdownView } from "./MarkdownView";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
  timestamp: string;
}

interface MeetingAssistantPanelProps {
  currentMeetingResult: MeetingResult | null;
  liveTranscript?: MeetingTranscript | null;
  isRecording?: boolean;
  activePastMeeting?: PastMeetingRecord | null;
  onClearActivePastMeeting?: () => void;
}

export const MeetingAssistantPanel: React.FC<MeetingAssistantPanelProps> = ({
  currentMeetingResult,
  liveTranscript,
  isRecording,
  activePastMeeting,
  onClearActivePastMeeting,
}) => {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: "welcome-1",
      role: "assistant",
      content: t(
        "meeting.assistant.welcome",
        "Hello! I am your **Meeting Intelligence Assistant**.\n\nHere is how I can help:\n- **Live Q&A & Copilot**: Ask me questions about what participants or you have spoken in the current call.\n- **Past Meeting Memory**: Search past decisions, attendees, and topics saved in your local SQLite history.\n- **Real-Time Fact Verification**: Ask me to verify claims or regulations, and I will search the web and provide direct markdown citation links.\n- **Action Items & Summaries**: Extract key takeaways, deadlines, and follow-ups instantly."
      ),
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [inputQuery, setInputQuery] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [includeTranscriptContext, setIncludeTranscriptContext] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAsking]);

  // If a past meeting is passed in, inject a prompt hint
  useEffect(() => {
    if (activePastMeeting) {
      toast.info(
        t("meeting.assistant.context.loadedToast", `Loaded past meeting "${activePastMeeting.title}" into Copilot context.`, {
          title: activePastMeeting.title,
        })
      );
    }
  }, [activePastMeeting, t]);

  // Determine active context transcript
  const getActiveTranscriptText = (): string | null => {
    if (!includeTranscriptContext) return null;

    if (activePastMeeting) {
      return `PAST MEETING CONTEXT (${activePastMeeting.created_at}) Title: ${activePastMeeting.title}\nParticipants: ${activePastMeeting.participants.join(", ")}\nSummary MOM:\n${activePastMeeting.summary_markdown}\nFull Transcript:\n${activePastMeeting.full_transcript}`;
    }

    if (isRecording && liveTranscript?.full_text) {
      return `LIVE ONGOING MEETING TRANSCRIPT (${liveTranscript.segments.length} spoken turns captured so far):\n${liveTranscript.full_text}`;
    }

    if (currentMeetingResult?.transcript?.full_text) {
      return currentMeetingResult.transcript.full_text;
    }

    if (liveTranscript?.full_text) {
      return liveTranscript.full_text;
    }

    return null;
  };

  const handleSendMessage = async (queryToSend?: string) => {
    const text = (queryToSend || inputQuery).trim();
    if (!text || isAsking) return;

    const userMsg: DisplayMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery("");
    setIsAsking(true);

    try {
      // Build history for backend LLM
      const history: ChatMessage[] = messages
        .filter((m) => m.id !== "welcome-1")
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const contextTranscript = getActiveTranscriptText();

      const res = await commands.askMeetingAssistant({
        query: text,
        current_transcript: contextTranscript,
        history,
      });

      if (res.status === "ok") {
        const assistantMsg: DisplayMessage = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: res.data.reply,
          toolsUsed: res.data.tools_used,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        toast.error(`${t("meeting.assistant.chat.errorTitle", "Error communicating with assistant:")} ${res.error}`);
        const errMsg: DisplayMessage = {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: `⚠️ ${t("meeting.assistant.chat.errorTitle", "Error communicating with assistant:")} ${res.error}`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, errMsg]);
      }
    } catch (e: any) {
      toast.error(`${t("meeting.assistant.chat.errorTitle", "Error communicating with assistant:")} ${e?.message || e}`);
      const errMsg: DisplayMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `⚠️ ${e?.message || e}`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsAsking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: "welcome-1",
        role: "assistant",
        content: t(
          "meeting.assistant.chat.clearedWelcome",
          "Chat history cleared. How can I assist you with your meeting?"
        ),
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
    toast.info(t("meeting.assistant.chat.clearedToast", "Cleared conversation history"));
  };

  // Quick Action Pills
  const quickActions = [
    {
      label: t("meeting.assistant.quickPrompts.summarize", "Summarize discussion so far"),
      icon: <Sparkles className="w-3 h-3 text-background-ui" />,
      prompt: t(
        "meeting.assistant.quickPrompts.summarizePrompt",
        "Can you provide a clear and concise summary of the key points discussed so far?"
      ),
    },
    {
      label: t("meeting.assistant.quickPrompts.verify", "Verify last statement with web links"),
      icon: <Search className="w-3 h-3 text-blue-400" />,
      prompt: t(
        "meeting.assistant.quickPrompts.verifyPrompt",
        "Please verify the facts and statements from the discussion on the web, and provide reliable citation links."
      ),
    },
    {
      label: t("meeting.assistant.quickPrompts.searchPast", "Search past meeting decisions"),
      icon: <Calendar className="w-3 h-3 text-purple-400" />,
      prompt: t(
        "meeting.assistant.quickPrompts.searchPastPrompt",
        "Can you search past meetings in the database and list what decisions or action items were agreed upon previously?"
      ),
    },
    {
      label: t("meeting.assistant.quickPrompts.actionItems", "Extract action items & next steps"),
      icon: <CheckCircle2 className="w-3 h-3 text-amber-400" />,
      prompt: t(
        "meeting.assistant.quickPrompts.actionItemsPrompt",
        "Extract all action items, assignees, and next steps mentioned in this meeting."
      ),
    },
    {
      label: t("meeting.assistant.quickPrompts.unanswered", "What questions remain unanswered?"),
      icon: <FileText className="w-3 h-3 text-emerald-400" />,
      prompt: t(
        "meeting.assistant.quickPrompts.unansweredPrompt",
        "Review the discussion and list any open questions or concerns that were raised but not yet answered."
      ),
    },
  ];

  const formatToolBadge = (tool: string) => {
    if (tool.includes("web_search")) {
      return (
        <span
          key={tool}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30"
        >
          <Search className="w-2.5 h-2.5" />
          {t("meeting.assistant.chat.webVerification", "Web Verification")}
        </span>
      );
    }
    if (tool.includes("past_meetings")) {
      return (
        <span
          key={tool}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30"
        >
          <Calendar className="w-2.5 h-2.5" />
          {t("meeting.assistant.chat.pastMemory", "Past Meeting Memory")}
        </span>
      );
    }
    if (tool.includes("live_meeting") || tool.includes("transcript")) {
      return (
        <span
          key={tool}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
        >
          <FileText className="w-2.5 h-2.5" />
          {t("meeting.assistant.chat.liveTranscript", "Live Transcript")}
        </span>
      );
    }
    return (
      <span
        key={tool}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-mid-gray/20 text-text/70 border border-border/30"
      >
        {tool}
      </span>
    );
  };

  const activeTranscript = getActiveTranscriptText();
  const wordCount = activeTranscript ? activeTranscript.split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className="flex flex-col h-[650px] bg-surface/50 border border-border/30 rounded-xl overflow-hidden shadow-sm">
      {/* Top Copilot Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface/90 border-b border-border/30">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-background-ui/10 border border-background-ui/20 text-background-ui">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-text/90">
                {t("meeting.assistant.title", "Meeting Intelligence Copilot")}
              </h3>
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {t("meeting.assistant.activeCopilot", "Active Copilot")}
              </span>
            </div>
            <p className="text-[11px] text-text/50">
              {t(
                "meeting.assistant.capabilities",
                "Capabilities: Real-time Transcript Q&A • Web Fact Verification • Past Meeting Memory"
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Context indicator */}
          <div className="flex items-center gap-1.5 bg-mid-gray/15 px-2.5 py-1 rounded-lg border border-border/30 text-[11px] text-text/70">
            <input
              type="checkbox"
              id="includeContext"
              checked={includeTranscriptContext}
              onChange={(e) => setIncludeTranscriptContext(e.target.checked)}
              className="rounded bg-mid-gray/20 border-border/40 text-background-ui focus:ring-0 cursor-pointer"
            />
            <label htmlFor="includeContext" className="cursor-pointer select-none">
              {activePastMeeting ? (
                <span className="text-purple-300 font-medium truncate max-w-[140px] inline-block">
                  {t("meeting.assistant.context.meetingPrefix", "Meeting:")} {activePastMeeting.title}
                </span>
              ) : isRecording ? (
                <span className="text-red-400 font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  {t("meeting.assistant.context.liveMeeting", `Live Meeting (${liveTranscript?.segments.length || 0} turns)`, {
                    turns: liveTranscript?.segments.length || 0,
                  })}
                </span>
              ) : currentMeetingResult ? (
                <span className="text-emerald-300 font-medium">
                  {t("meeting.assistant.context.transcriptWords", `Transcript (${wordCount} words)`, {
                    words: wordCount,
                  })}
                </span>
              ) : (
                <span className="text-text/40">{t("meeting.assistant.context.noTranscript", "No meeting transcript")}</span>
              )}
            </label>
            {activePastMeeting && onClearActivePastMeeting && (
              <button
                onClick={onClearActivePastMeeting}
                className="text-text/40 hover:text-text/90 ml-1 text-xs cursor-pointer"
                title={t("meeting.assistant.context.detachPast", "Detach past meeting context")}
              >
                &times;
              </button>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearChat}
            className="h-7 px-2 text-xs text-text/40 hover:text-text/90 cursor-pointer"
            title={t("meeting.assistant.chat.clearTitle", "Clear Chat History")}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Live Meeting Active Banner */}
      {isRecording && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-400 font-semibold">
              {t("meeting.assistant.liveBanner.inProgress", "Live Meeting In Progress")}
            </span>
            <span className="text-text/50 font-mono text-[11px]">
              &bull; {t("meeting.assistant.liveBanner.turnsLive", `${liveTranscript?.segments.length || 0} turns transcribed live`, {
                turns: liveTranscript?.segments.length || 0,
              })}
            </span>
          </div>
          <span className="text-text/40 text-[11px] hidden sm:inline">
            {t("meeting.assistant.liveBanner.hint", "Copilot automatically knows what was spoken up to this second")}
          </span>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-lg bg-background-ui/15 border border-background-ui/25 flex items-center justify-center text-background-ui shrink-0 mt-0.5">
                <Bot className="w-4 h-4" />
              </div>
            )}

            <div
              className={`max-w-[85%] rounded-2xl p-3.5 text-xs ${
                msg.role === "user"
                  ? "bg-background-ui text-white rounded-tr-sm shadow-sm"
                  : "bg-surface/90 border border-border/35 text-text/90 rounded-tl-sm shadow-sm"
              }`}
            >
              {/* Tool Execution Badges */}
              {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pb-2 mb-2 border-b border-border/25">
                  <span className="text-[10px] text-text/40 font-mono">{t("meeting.assistant.chat.toolsInvoked", "Tools invoked:")}</span>
                  {msg.toolsUsed.map((tool) => formatToolBadge(tool))}
                </div>
              )}

              {msg.role === "assistant" ? (
                <MarkdownView content={msg.content} />
              ) : (
                <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
              )}

              <div
                className={`text-[10px] mt-1.5 text-right font-mono ${
                  msg.role === "user" ? "text-white/60" : "text-text/40"
                }`}
              >
                {msg.timestamp}
              </div>
            </div>
          </div>
        ))}

        {isAsking && (
          <div className="flex gap-3 justify-start items-center">
            <div className="w-7 h-7 rounded-lg bg-background-ui/15 border border-background-ui/25 flex items-center justify-center text-background-ui shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-surface/90 border border-border/30 rounded-2xl px-4 py-2.5 text-xs text-text/60 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-background-ui" />
              <span>{t("meeting.assistant.chat.analyzing", "Analyzing transcript, executing tools & verifying...")}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Action Prompt Pills */}
      <div className="px-4 py-2 bg-surface/40 border-t border-border/20 overflow-x-auto flex items-center gap-2 no-scrollbar">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text/40 shrink-0">
          {t("meeting.assistant.quickPromptsTitle", "Quick Prompts:")}
        </span>
        {quickActions.map((qa, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSendMessage(qa.prompt)}
            disabled={isAsking}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-mid-gray/15 hover:bg-mid-gray/25 text-text/80 hover:text-text/100 border border-border/30 transition shrink-0 cursor-pointer disabled:opacity-50"
          >
            {qa.icon}
            <span>{qa.label}</span>
          </button>
        ))}
      </div>

      {/* Input Form */}
      <div className="p-3 bg-surface/80 border-t border-border/30">
        <div className="flex items-end gap-2 bg-mid-gray/10 rounded-xl border border-border/40 p-2 focus-within:border-background-ui/80 transition">
          <textarea
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={t(
              "meeting.assistant.chat.inputPlaceholder",
              "Ask anything about this meeting, search past decisions, or verify facts..."
            )}
            className="flex-1 bg-transparent text-xs text-text/90 placeholder-text/30 focus:outline-none resize-none leading-relaxed py-1 px-1 max-h-32"
          />

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => handleSendMessage()}
            disabled={!inputQuery.trim() || isAsking}
            className="h-8 w-8 p-0 flex items-center justify-center rounded-lg bg-background-ui hover:bg-background-ui/90 text-white shrink-0 cursor-pointer disabled:opacity-40"
            title={t("meeting.assistant.chat.sendTitle", "Send Message (Enter)")}
          >
            {isAsking ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
        <div className="flex items-center justify-between text-[10px] text-text/40 mt-1.5 px-1 font-mono">
          <span>{t("meeting.assistant.chat.inputHint", "Press Enter to send, Shift+Enter for new line")}</span>
          <span>{t("meeting.assistant.chat.privacyHint", "Privacy: Audio stays local; questions use configured Refine model")}</span>
        </div>
      </div>
    </div>
  );
};
