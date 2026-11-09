import React, { useState, useRef, useEffect } from "react";
import {
  Bot,
  Send,
  Loader2,
  Sparkles,
  Search,
  Terminal,
  Folder,
  Calendar,
  FileText,
  Trash2,
  Info,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import {
  commands,
  type ChatMessage,
  type AssistantResponse,
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
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: "welcome-1",
      role: "assistant",
      content:
        "Hello! I am your **Meeting Intelligence Assistant**.\n\nHere is how I can help:\n- **Live Q&A & Copilot**: Ask me questions about what participants or you have spoken in the current call.\n- **Past Meeting Memory**: Search past decisions, attendees, and topics saved in your local SQLite history.\n- **Real-Time Fact Verification**: Ask me to verify claims or regulations, and I will search the web and provide direct markdown citation links.\n- **Action Items & Summaries**: Extract key takeaways, deadlines, and follow-ups instantly.",
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
      toast.info(`Loaded past meeting "${activePastMeeting.title}" into Copilot context.`);
    }
  }, [activePastMeeting]);

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
        toast.error(`Assistant error: ${res.error}`);
        const errMsg: DisplayMessage = {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: `⚠️ Error communicating with assistant: ${res.error}`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, errMsg]);
      }
    } catch (e: any) {
      toast.error(`Assistant request failed: ${e?.message || e}`);
      const errMsg: DisplayMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `⚠️ Failed to execute request: ${e?.message || e}`,
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
        content: "Chat history cleared. How can I assist you with your meeting?",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
    toast.info("Cleared conversation history");
  };

  // Quick Action Pills
  const quickActions = [
    {
      label: "Summarize discussion so far",
      icon: <Sparkles className="w-3 h-3 text-primary-400" />,
      prompt: "Can you provide a clear and concise summary of the key points discussed so far?",
    },
    {
      label: "Verify last statement with web links",
      icon: <Search className="w-3 h-3 text-blue-400" />,
      prompt: "Please verify the facts and statements from the discussion on the web, and provide reliable citation links.",
    },
    {
      label: "Search past meeting decisions",
      icon: <Calendar className="w-3 h-3 text-emerald-400" />,
      prompt: "Can you search past meetings in the database and list what decisions or action items were agreed upon previously?",
    },
    {
      label: "Extract action items & next steps",
      icon: <CheckCircle2 className="w-3 h-3 text-amber-400" />,
      prompt: "Extract all action items, assignees, and next steps mentioned in this meeting.",
    },
    {
      label: "What questions remain unanswered?",
      icon: <FileText className="w-3 h-3 text-purple-400" />,
      prompt: "Review the discussion and list any open questions or concerns that were raised but not yet answered.",
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
          Web Verification
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
          Past Meeting Memory
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
          Live Transcript
        </span>
      );
    }
    return (
      <span
        key={tool}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-300 border border-neutral-700"
      >
        {tool}
      </span>
    );
  };

  const activeTranscript = getActiveTranscriptText();
  const wordCount = activeTranscript ? activeTranscript.split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className="flex flex-col h-[650px] bg-neutral-900/60 border border-neutral-800 rounded-xl overflow-hidden">
      {/* Top Copilot Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-neutral-900 border-b border-neutral-800">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary-500/15 border border-primary-500/30 text-primary-400">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-neutral-100">
                Meeting Intelligence Copilot
              </h3>
              <span className="flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Active Copilot
              </span>
            </div>
            <p className="text-[11px] text-neutral-400">
              Capabilities: Real-time Transcript Q&A &bull; Web Fact Verification &bull; Past Meeting Memory
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Context indicator */}
          <div className="flex items-center gap-1.5 bg-neutral-800/80 px-2.5 py-1 rounded-lg border border-neutral-700/80 text-[11px] text-neutral-300">
            <input
              type="checkbox"
              id="includeContext"
              checked={includeTranscriptContext}
              onChange={(e) => setIncludeTranscriptContext(e.target.checked)}
              className="rounded bg-neutral-700 border-neutral-600 text-primary-500 focus:ring-0"
            />
            <label htmlFor="includeContext" className="cursor-pointer select-none">
              {activePastMeeting ? (
                <span className="text-purple-300 font-medium truncate max-w-[140px] inline-block">
                  Meeting: {activePastMeeting.title}
                </span>
              ) : isRecording ? (
                <span className="text-red-400 font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  Live Meeting ({liveTranscript?.segments.length || 0} turns)
                </span>
              ) : currentMeetingResult ? (
                <span className="text-emerald-300 font-medium">
                  Transcript ({wordCount} words)
                </span>
              ) : (
                <span className="text-neutral-400">No meeting transcript</span>
              )}
            </label>
            {activePastMeeting && onClearActivePastMeeting && (
              <button
                onClick={onClearActivePastMeeting}
                className="text-neutral-400 hover:text-neutral-200 ml-1 text-xs"
                title="Detach past meeting context"
              >
                &times;
              </button>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearChat}
            className="h-7 px-2 text-xs text-neutral-400 hover:text-neutral-200 cursor-pointer"
            title="Clear Chat History"
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
              Live Meeting In Progress
            </span>
            <span className="text-neutral-400 font-mono text-[11px]">
              &bull; {liveTranscript?.segments.length || 0} turns transcribed live
            </span>
          </div>
          <span className="text-neutral-400 text-[11px] hidden sm:inline">
            Copilot automatically knows what was spoken up to this second
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
              <div className="w-7 h-7 rounded-lg bg-primary-500/20 border border-primary-500/30 flex items-center justify-center text-primary-400 shrink-0 mt-0.5">
                <Bot className="w-4 h-4" />
              </div>
            )}

            <div
              className={`max-w-[85%] rounded-2xl p-3.5 text-xs ${
                msg.role === "user"
                  ? "bg-primary-600 text-white rounded-tr-sm shadow-md"
                  : "bg-neutral-950/80 border border-neutral-800 text-neutral-200 rounded-tl-sm shadow-sm"
              }`}
            >
              {/* Tool Execution Badges */}
              {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pb-2 mb-2 border-b border-neutral-800/80">
                  <span className="text-[10px] text-neutral-500 font-mono">Tools invoked:</span>
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
                  msg.role === "user" ? "text-primary-200/70" : "text-neutral-500"
                }`}
              >
                {msg.timestamp}
              </div>
            </div>
          </div>
        ))}

        {isAsking && (
          <div className="flex gap-3 justify-start items-center">
            <div className="w-7 h-7 rounded-lg bg-primary-500/20 border border-primary-500/30 flex items-center justify-center text-primary-400 shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-neutral-950/80 border border-neutral-800 rounded-2xl px-4 py-2.5 text-xs text-neutral-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-400" />
              <span>Analyzing transcript, executing tools & verifying...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Action Prompt Pills */}
      <div className="px-4 py-2 bg-neutral-950/50 border-t border-neutral-800/60 overflow-x-auto flex items-center gap-2 no-scrollbar">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 shrink-0">
          Quick Prompts:
        </span>
        {quickActions.map((qa, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSendMessage(qa.prompt)}
            disabled={isAsking}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-neutral-800/80 hover:bg-neutral-800 text-neutral-300 hover:text-neutral-100 border border-neutral-700/60 transition shrink-0 cursor-pointer disabled:opacity-50"
          >
            {qa.icon}
            <span>{qa.label}</span>
          </button>
        ))}
      </div>

      {/* Input Form */}
      <div className="p-3 bg-neutral-900 border-t border-neutral-800">
        <div className="flex items-end gap-2 bg-neutral-950 rounded-xl border border-neutral-800 p-2 focus-within:border-primary-500/80 transition">
          <textarea
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Ask anything about this meeting, search past decisions, or verify facts..."
            className="flex-1 bg-transparent text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none resize-none leading-relaxed py-1 px-1 max-h-32"
          />

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => handleSendMessage()}
            disabled={!inputQuery.trim() || isAsking}
            className="h-8 w-8 p-0 flex items-center justify-center rounded-lg bg-primary-600 hover:bg-primary-500 text-white shrink-0 cursor-pointer disabled:opacity-40"
            title="Send Message (Enter)"
          >
            {isAsking ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
        <div className="flex items-center justify-between text-[10px] text-neutral-500 mt-1.5 px-1 font-mono">
          <span>Press Enter to send, Shift+Enter for new line</span>
          <span>Privacy: Audio stays local; questions use configured Refine model</span>
        </div>
      </div>
    </div>
  );
};
