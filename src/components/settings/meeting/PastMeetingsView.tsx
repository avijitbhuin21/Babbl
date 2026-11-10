import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  Clock,
  Users,
  Search,
  FileText,
  Download,
  MessageSquare,
  RefreshCw,
  X,
  Copy,
  Check,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { commands, type PastMeetingRecord, type MeetingResult } from "@/bindings";
import { Button } from "../../ui/Button";
import { downloadMeetingPdf } from "@/lib/pdfGenerator";

interface PastMeetingsViewProps {
  onAskCopilotAboutMeeting?: (meeting: PastMeetingRecord) => void;
}

export const PastMeetingsView: React.FC<PastMeetingsViewProps> = ({
  onAskCopilotAboutMeeting,
}) => {
  const { t } = useTranslation();
  const [meetings, setMeetings] = useState<PastMeetingRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Selected meeting for modal view
  const [selectedMeeting, setSelectedMeeting] = useState<PastMeetingRecord | null>(null);
  const [copiedMOM, setCopiedMOM] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);

  const fetchMeetings = async (query?: string) => {
    setIsLoading(true);
    try {
      const res = await commands.getPastMeetings(query || null);
      if (res.status === "ok") {
        setMeetings(res.data);
      } else {
        toast.error(`Failed to fetch meetings: ${res.error}`);
      }
    } catch (e: any) {
      console.warn("Error fetching past meetings:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMeetings();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchMeetings(searchQuery);
  };

  const formatDuration = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = Math.floor(totalSecs % 60);
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs.toString().padStart(2, "0")}s`;
  };

  const handleDownloadPdf = (meeting: PastMeetingRecord) => {
    try {
      // Reconstruct MeetingResult from record for the PDF generator
      const segments = meeting.full_transcript
        ? [
            {
              speaker: "All Speakers",
              start_secs: 0,
              end_secs: meeting.duration_secs,
              text: meeting.full_transcript,
            },
          ]
        : [];

      const result: MeetingResult = {
        transcript: {
          segments,
          full_text: meeting.full_transcript,
          duration_secs: meeting.duration_secs,
          speakers: meeting.participants,
        },
        mom: {
          title: meeting.title,
          created_at: meeting.created_at,
          duration_secs: meeting.duration_secs,
          participants: meeting.participants,
          summary_markdown: meeting.summary_markdown,
          raw_transcript: meeting.full_transcript,
        },
      };

      downloadMeetingPdf(result);
      toast.success(
        t("meeting.history.pdfSuccess", `Downloaded PDF for "${meeting.title}"`, {
          title: meeting.title,
        })
      );
    } catch (e: any) {
      toast.error(`Error generating PDF: ${e?.message || e}`);
    }
  };

  const handleCopyText = async (text: string, isMom: boolean) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isMom) {
        setCopiedMOM(true);
        setTimeout(() => setCopiedMOM(false), 2000);
      } else {
        setCopiedTranscript(true);
        setTimeout(() => setCopiedTranscript(false), 2000);
      }
      toast.success(t("meeting.history.copiedToast", "Copied to clipboard!"));
    } catch (e) {
      console.warn("Copy error:", e);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header and Search */}
      <div className="bg-surface/50 border border-border/30 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-background-ui" />
            <h2 className="text-sm font-semibold text-text/90">
              {t("meeting.history.title", "Cross-Meeting Memory & History")}
            </h2>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-mid-gray/15 text-text/70 border border-border/30">
              {t("meeting.history.sqliteTag", "SQLite indexed")}
            </span>
          </div>
          <p className="text-xs text-text/50 mt-1">
            {t(
              "meeting.history.description",
              "Every meeting, decision, MOM, and participant list is preserved and queryable by both you and the AI Copilot."
            )}
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text/40 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("meeting.history.searchPlaceholder", "Search past decisions, attendees, topics...")}
              className="w-64 bg-mid-gray/10 border border-border/40 rounded-lg pl-8 pr-3 py-1.5 text-xs text-text/90 placeholder-text/30 focus:outline-none focus:border-background-ui"
            />
          </div>

          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={isLoading}
            className="h-8 px-3 text-xs bg-mid-gray/15 text-text/80 border border-border/40 hover:bg-mid-gray/25 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-background-ui" : ""}`} />
            <span>{t("meeting.history.searchButton", "Search")}</span>
          </Button>
        </form>
      </div>

      {/* Meetings Grid / List */}
      {meetings.length === 0 ? (
        <div className="bg-surface/30 border border-dashed border-border/40 rounded-xl p-12 text-center text-text/40 space-y-2">
          <Calendar className="w-10 h-10 mx-auto text-text/30 mb-2" />
          <h4 className="text-text/80 font-medium text-sm">
            {searchQuery
              ? t("meeting.history.emptySearchTitle", "No matching meetings found")
              : t("meeting.history.emptyTitle", "No Past Meetings Recorded")}
          </h4>
          <p className="text-xs text-text/40 max-w-md mx-auto">
            {searchQuery
              ? t(
                  "meeting.history.emptySearchDesc",
                  `No meetings found matching "${searchQuery}". Try different keywords.`,
                  { query: searchQuery }
                )
              : t(
                  "meeting.history.emptyDesc",
                  "When you end a meeting recording, the full transcript, AI summary, and decisions will automatically appear here."
                )}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {meetings.map((m) => (
            <div
              key={m.id}
              className="bg-surface/50 border border-border/30 rounded-xl p-4 flex flex-col justify-between hover:border-border/60 transition space-y-3 shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-sm text-text/90 leading-snug line-clamp-1">
                    {m.title}
                  </h3>
                  <span className="font-mono text-[10px] text-text/50 bg-mid-gray/20 px-2 py-0.5 rounded shrink-0">
                    #{m.id}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-text/50 mt-2">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-text/40" />
                    {m.created_at}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-text/40" />
                    {formatDuration(m.duration_secs)}
                  </span>
                </div>

                {m.participants.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    <Users className="w-3 h-3 text-text/40 shrink-0" />
                    {m.participants.map((p, idx) => (
                      <span
                        key={idx}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-mid-gray/20 text-text/80 border border-border/30"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                )}

                {/* Summary Preview */}
                <p className="text-xs text-text/60 line-clamp-3 mt-3 bg-mid-gray/10 p-2.5 rounded-lg border border-border/25 leading-relaxed font-sans">
                  {m.summary_markdown || m.full_transcript || "No preview available."}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-border/25 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedMeeting(m)}
                  className="h-7 px-2 text-xs flex items-center gap-1.5 text-text/70 hover:text-text/95 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 text-background-ui" />
                  <span>{t("meeting.history.viewDetails", "View Details")}</span>
                </Button>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownloadPdf(m)}
                    className="h-7 px-2 text-xs flex items-center gap-1 text-text/60 hover:text-text/90 cursor-pointer"
                    title={t("meeting.history.downloadPdf", "Download PDF")}
                  >
                    <Download className="w-3.5 h-3.5 text-background-ui" />
                    <span>{t("meeting.history.downloadPdf", "PDF")}</span>
                  </Button>

                  {onAskCopilotAboutMeeting && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onAskCopilotAboutMeeting(m)}
                      className="h-7 px-2.5 text-xs flex items-center gap-1 bg-background-ui/10 text-background-ui border border-background-ui/25 hover:bg-background-ui/20 cursor-pointer"
                    >
                      <MessageSquare className="w-3 h-3" />
                      <span>{t("meeting.history.askCopilot", "Ask Copilot")}</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected Meeting Details Modal */}
      {selectedMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border/40 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col p-6 shadow-2xl relative">
            <div className="flex items-start justify-between pb-4 mb-4 border-b border-border/30">
              <div>
                <h3 className="text-base font-bold text-text/90 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-background-ui" />
                  {selectedMeeting.title}
                </h3>
                <div className="flex items-center gap-3 text-xs text-text/50 mt-1">
                  <span>{selectedMeeting.created_at}</span>
                  <span>&bull;</span>
                  <span>{formatDuration(selectedMeeting.duration_secs)}</span>
                  <span>&bull;</span>
                  <span>{selectedMeeting.participants.join(", ")}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedMeeting(null)}
                className="text-text/40 hover:text-text/90 p-1.5 rounded-lg hover:bg-white/5 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-2 text-xs">
              {/* MOM Summary */}
              <div className="bg-mid-gray/10 p-4 rounded-xl border border-border/30">
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-border/20">
                  <span className="font-semibold text-text/90 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-background-ui" />
                    {t("meeting.history.momTitle", "Minutes of Meeting (MOM)")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopyText(selectedMeeting.summary_markdown, true)}
                    className="h-6 px-2 text-[11px] text-text/60 hover:text-text/90 cursor-pointer"
                  >
                    {copiedMOM ? (
                      <Check className="w-3 h-3 text-emerald-400 inline mr-1" />
                    ) : (
                      <Copy className="w-3 h-3 inline mr-1" />
                    )}
                    {copiedMOM
                      ? t("meeting.history.copied", "Copied")
                      : t("meeting.history.copyMom", "Copy MOM")}
                  </Button>
                </div>
                <div className="whitespace-pre-line text-text/80 leading-relaxed font-sans">
                  {selectedMeeting.summary_markdown || "No MOM recorded."}
                </div>
              </div>

              {/* Full Transcript */}
              <div className="bg-mid-gray/10 p-4 rounded-xl border border-border/30">
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-border/20">
                  <span className="font-semibold text-text/90 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                    {t("meeting.history.transcriptTitle", "Full Meeting Transcript")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopyText(selectedMeeting.full_transcript, false)}
                    className="h-6 px-2 text-[11px] text-text/60 hover:text-text/90 cursor-pointer"
                  >
                    {copiedTranscript ? (
                      <Check className="w-3 h-3 text-emerald-400 inline mr-1" />
                    ) : (
                      <Copy className="w-3 h-3 inline mr-1" />
                    )}
                    {copiedTranscript
                      ? t("meeting.history.copied", "Copied")
                      : t("meeting.history.copyTranscript", "Copy Transcript")}
                  </Button>
                </div>
                <div className="whitespace-pre-line text-text/70 font-mono text-[11px] leading-relaxed max-h-60 overflow-y-auto pr-1">
                  {selectedMeeting.full_transcript || "No transcript available."}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 mt-4 border-t border-border/30">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleDownloadPdf(selectedMeeting)}
                className="text-xs flex items-center gap-1.5 bg-mid-gray/15 text-text/80 border border-border/30 hover:bg-mid-gray/25 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-background-ui" />
                <span>{t("meeting.history.downloadPdfFull", "Download Styled PDF")}</span>
              </Button>

              <div className="flex items-center gap-2">
                {onAskCopilotAboutMeeting && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      const m = selectedMeeting;
                      setSelectedMeeting(null);
                      onAskCopilotAboutMeeting(m);
                    }}
                    className="text-xs flex items-center gap-1.5 bg-background-ui hover:bg-background-ui/90 text-white font-medium cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>{t("meeting.history.askCopilotThis", "Ask Copilot About This Meeting")}</span>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedMeeting(null)}
                  className="text-xs text-text/60 hover:text-text/90 cursor-pointer"
                >
                  {t("meeting.history.close", "Close")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
