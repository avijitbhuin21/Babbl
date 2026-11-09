import { jsPDF } from "jspdf";
import type { MeetingResult } from "@/bindings";

function formatTimestamp(seconds: number): string {
  const totalSecs = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Normalizes Unicode characters to safe Latin-1/ASCII characters so standard
 * jsPDF fonts (like Times New Roman) do not scatter letters or fail kerning.
 */
function sanitizeTextForPdf(text: string): string {
  if (!text) return "";
  return text
    // Replace non-breaking / special hyphens and dashes
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    // Replace smart quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Replace special spaces (narrow no-break, no-break, zero-width)
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    // Replace common math/comparison symbols
    .replace(/≈/g, "~")
    .replace(/≠/g, "!=")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    // Replace common status emoji with clean textual tags
    .replace(/✅/g, "[Done]")
    .replace(/❌/g, "[Cancelled]")
    .replace(/⏳/g, "[Pending]")
    .replace(/⚠️/g, "[Warning]")
    // Replace ellipsis
    .replace(/…/g, "...");
}

/**
 * Strips inline markdown asterisks, backticks, and links while preserving plain readable text.
 */
function cleanMarkdownText(text: string): string {
  if (!text) return "";
  return sanitizeTextForPdf(text)
    .replace(/\*\*(.*?)\*\*/g, "$1") // Bold
    .replace(/\*(.*?)\*/g, "$1")     // Italic
    .replace(/`([^`]+)`/g, "$1")     // Code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // Links
}

/**
 * Generates an executive-styled PDF report in Times New Roman:
 * - Running headers & pagination ("Babbl transcript · Title · Date", "Page X of Y")
 * - Document Title & Attendance Metadata
 * - Babbl AI Notes (Executive Summary, Key Points, Action Items)
 * - Full Diarized Speaker Transcript with timestamps (MM:SS)
 */
export function generateMeetingPdf(result: MeetingResult): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const marginLeft = 45;
  const marginRight = 45;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const topMargin = 58;
  const bottomMargin = 45;

  let y = topMargin;

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - bottomMargin) {
      doc.addPage();
      y = topMargin;
    }
  };

  const rawTitle = result.mom?.title || "Meeting Transcript";
  const title = sanitizeTextForPdf(rawTitle);
  const dateStr = result.mom?.created_at
    ? new Date(result.mom.created_at).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : new Date().toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

  const durationSecs =
    result.transcript?.duration_secs || result.mom?.duration_secs || 0;
  const durationFormatted = formatTimestamp(durationSecs);
  const participants = sanitizeTextForPdf(
    result.mom?.participants?.length
      ? result.mom.participants.join(", ")
      : result.transcript?.speakers?.join(", ") || "Attendees"
  );

  // --- Page 1 Title ---
  doc.setFont("times", "bold");
  doc.setFontSize(18);
  doc.setTextColor(17, 24, 39);
  const titleLines = doc.splitTextToSize(
    `Meeting Transcript: ${title}`,
    contentWidth
  );
  for (const line of titleLines) {
    checkPageBreak(24);
    doc.text(line, marginLeft, y);
    y += 22;
  }

  y += 4;
  doc.setFont("times", "italic");
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Date: ${dateStr}   |   Duration: ${durationFormatted}   |   Attendees: ${participants}`,
    marginLeft,
    y
  );
  y += 18;

  // --- Section 1: AI Notes / MOM Summary ---
  if (result.mom?.summary_markdown) {
    checkPageBreak(30);
    doc.setFont("times", "bold");
    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59);
    doc.text("Babbl AI Notes", marginLeft, y);
    y += 18;

    const lines = result.mom.summary_markdown.split("\n");
    let inTable = false;
    let tableHeaders: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        y += 6;
        continue;
      }

      // Skip the redundant top "# Minutes of Meeting" heading
      if (
        line.startsWith("# ") &&
        line.toLowerCase().includes("minutes of meeting")
      ) {
        continue;
      }

      // Check Markdown Horizontal Rule (---, ***, ___)
      if (/^[-*_]{3,}$/.test(line)) {
        checkPageBreak(14);
        y += 5;
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.75);
        doc.line(marginLeft, y, pageWidth - marginRight, y);
        y += 10;
        inTable = false;
        continue;
      }

      // Check Markdown Subheadings (###)
      if (line.startsWith("### ")) {
        inTable = false;
        checkPageBreak(24);
        y += 8;
        doc.setFont("times", "bolditalic");
        doc.setFontSize(11);
        doc.setTextColor(30, 41, 59);
        const headingText = cleanMarkdownText(line.replace(/^###\s+/, ""));
        doc.text(headingText, marginLeft, y);
        y += 14;
        continue;
      }

      // Check Major Section Headings (##)
      if (line.startsWith("## ")) {
        inTable = false;
        checkPageBreak(28);
        y += 10;
        doc.setFont("times", "bold");
        doc.setFontSize(12.5);
        doc.setTextColor(15, 23, 42);
        const headingText = cleanMarkdownText(line.replace(/^##\s+/, ""));
        doc.text(headingText, marginLeft, y);
        y += 16;
        continue;
      }

      // Markdown Tables (e.g. Speakers & Discussion Points, Action Items)
      if (line.startsWith("|") && line.endsWith("|")) {
        const cells = line
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);

        // Skip separator row like | --- | --- |
        if (cells.every((c) => /^[-:]+$/.test(c))) {
          continue;
        }

        if (!inTable) {
          inTable = true;
          tableHeaders = cells.map((c) => cleanMarkdownText(c));
          continue;
        }

        checkPageBreak(24);

        // First cell is speaker or task name
        const primaryText = cleanMarkdownText(cells[0] || "");
        doc.setFont("times", "bold");
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);

        // Detail columns
        const details = cells.slice(1);
        if (details.length === 0) {
          const wrapped = doc.splitTextToSize(`• ${primaryText}`, contentWidth - 10);
          for (const wLine of wrapped) {
            checkPageBreak(14);
            doc.text(wLine, marginLeft + 6, y);
            y += 13.5;
          }
        } else {
          doc.text(`• ${primaryText}`, marginLeft + 6, y);
          y += 13.5;

          for (let cIdx = 0; cIdx < details.length; cIdx++) {
            const rawCell = details[cIdx];
            const headerName = tableHeaders[cIdx + 1] || "";

            // Split on <br> tags so multi-point entries become distinct sub-bullets
            const subItems = rawCell.split(/<br\s*\/?>/i);
            for (const subItem of subItems) {
              const cleaned = cleanMarkdownText(subItem)
                .replace(/^[-*•]\s*/, "")
                .trim();
              if (!cleaned) continue;

              doc.setFont("times", "normal");
              doc.setFontSize(9.5);
              doc.setTextColor(51, 65, 85);

              const prefix =
                headerName &&
                headerName !== "Points Discussed" &&
                headerName !== "Role" &&
                headerName !== "Description"
                  ? `${headerName}: `
                  : "- ";

              const indent = 20;
              const wrapWidth = contentWidth - indent;
              const wrapped = doc.splitTextToSize(`${prefix}${cleaned}`, wrapWidth);
              for (const wLine of wrapped) {
                checkPageBreak(14);
                doc.text(wLine, marginLeft + indent, y);
                y += 13.5;
              }
            }
          }
        }
        y += 4;
        continue;
      } else {
        inTable = false;
      }

      // Bullet points
      if (/^[-*•]\s+/.test(line)) {
        const bulletText = cleanMarkdownText(line.replace(/^[-*•]\s+/, ""));
        checkPageBreak(16);
        doc.setFont("times", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(51, 65, 85);

        const indent = 16;
        const wrapWidth = contentWidth - indent;
        const wrapped = doc.splitTextToSize(bulletText, wrapWidth);
        for (let i = 0; i < wrapped.length; i++) {
          checkPageBreak(14);
          if (i === 0) {
            doc.text("•", marginLeft + 4, y);
          }
          doc.text(wrapped[i], marginLeft + indent, y);
          y += 13.5;
        }
        y += 2;
        continue;
      }

      // Numbered lists
      if (/^\d+\.\s+/.test(line)) {
        const match = line.match(/^(\d+\.)\s+(.*)/);
        const num = match ? match[1] : "1.";
        const rest = cleanMarkdownText(match ? match[2] : line);

        checkPageBreak(16);
        doc.setFont("times", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(30, 41, 59);
        doc.text(num, marginLeft + 4, y);

        doc.setFont("times", "normal");
        doc.setTextColor(51, 65, 85);

        const indent = 20;
        const wrapWidth = contentWidth - indent;
        const wrapped = doc.splitTextToSize(rest, wrapWidth);
        for (let i = 0; i < wrapped.length; i++) {
          checkPageBreak(14);
          doc.text(wrapped[i], marginLeft + indent, y);
          y += 13.5;
        }
        y += 2;
        continue;
      }

      // Standard text / paragraph
      doc.setFont("times", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(51, 65, 85);
      const cleanLine = cleanMarkdownText(line);
      const wrapped = doc.splitTextToSize(cleanLine, contentWidth);
      for (const wLine of wrapped) {
        checkPageBreak(14);
        doc.text(wLine, marginLeft, y);
        y += 13.5;
      }
      y += 4;
    }
    y += 16;
  }

  // --- Section 2: Full Transcript ---
  if (result.transcript?.segments?.length) {
    checkPageBreak(35);
    doc.setFont("times", "bold");
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text("Full Transcript", marginLeft, y);
    y += 20;

    // Group adjacent segments from same speaker for natural paragraph flow
    interface MergedSegment {
      speaker: string;
      start_secs: number;
      end_secs: number;
      text: string;
    }

    const mergedSegments: MergedSegment[] = [];
    for (const seg of result.transcript.segments) {
      if (!seg.text || !seg.text.trim()) continue;
      const prev = mergedSegments[mergedSegments.length - 1];
      if (
        prev &&
        prev.speaker === seg.speaker &&
        seg.start_secs - prev.end_secs <= 3.5
      ) {
        prev.text = `${prev.text.trim()} ${seg.text.trim()}`;
        prev.end_secs = seg.end_secs;
      } else {
        mergedSegments.push({
          speaker: seg.speaker || "Speaker",
          start_secs: seg.start_secs,
          end_secs: seg.end_secs,
          text: seg.text.trim(),
        });
      }
    }

    for (const seg of mergedSegments) {
      checkPageBreak(38);

      const speakerName = cleanMarkdownText(seg.speaker);
      const cleanText = sanitizeTextForPdf(seg.text);

      // Speaker Name
      doc.setFont("times", "bold");
      doc.setFontSize(10.5);
      if (
        speakerName.toLowerCase().includes("you") ||
        speakerName.toLowerCase().includes("me")
      ) {
        doc.setTextColor(29, 78, 216); // Deep blue for local user
      } else {
        doc.setTextColor(30, 41, 59); // Dark slate for other attendees
      }
      doc.text(speakerName, marginLeft, y);
      y += 13;

      // Timestamp MM:SS
      doc.setFont("times", "italic");
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(formatTimestamp(seg.start_secs), marginLeft, y);
      y += 14;

      // Dialogue text
      doc.setFont("times", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(51, 65, 85);
      const wrapped = doc.splitTextToSize(cleanText, contentWidth);
      for (const wLine of wrapped) {
        checkPageBreak(14);
        doc.text(wLine, marginLeft, y);
        y += 13.5;
      }

      y += 8; // spacing between speaker turns
    }
  }

  // --- Post-pass: Stamp running headers and footers on ALL pages ---
  const totalPages = doc.getNumberOfPages();
  const cleanHeaderTitle =
    title.length > 50 ? title.substring(0, 47) + "..." : title;

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    // Header (pages 1..N)
    doc.setFont("times", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Babbl transcript · ${cleanHeaderTitle} · ${dateStr}`, marginLeft, 26);
    doc.text(`Page ${p} of ${totalPages}`, marginLeft, 38);

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.75);
    doc.line(marginLeft, 44, pageWidth - marginRight, 44);

    // Footer
    doc.setFont("times", "italic");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      "Babbl · Private & Local Meeting Intelligence",
      marginLeft,
      pageHeight - 20
    );
  }

  return doc;
}

/**
 * Downloads the styled PDF to the user's filesystem.
 */
export function downloadMeetingPdf(
  result: MeetingResult,
  customFilename?: string
): void {
  const doc = generateMeetingPdf(result);
  const title = (result.mom?.title || "Meeting_Transcript")
    .replace(/[^a-zA-Z0-9_\- ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  const dateStr = result.mom?.created_at
    ? new Date(result.mom.created_at).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];
  const filename = customFilename || `Transcript_${title}_${dateStr}.pdf`;
  doc.save(filename);
}

/**
 * Returns raw base64 string and filename suitable for sending as an email attachment.
 */
export function exportMeetingPdfBase64(result: MeetingResult): {
  base64: string;
  filename: string;
} {
  const doc = generateMeetingPdf(result);
  const title = (result.mom?.title || "Meeting_Transcript")
    .replace(/[^a-zA-Z0-9_\- ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  const dateStr = result.mom?.created_at
    ? new Date(result.mom.created_at).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];
  const filename = `Transcript_${title}_${dateStr}.pdf`;

  const dataUri = doc.output("datauristring");
  const commaIndex = dataUri.indexOf(",");
  const base64 = commaIndex !== -1 ? dataUri.substring(commaIndex + 1) : dataUri;

  return { base64, filename };
}
