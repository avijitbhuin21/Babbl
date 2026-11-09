import React, { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({
  content,
  className = "",
}) => {
  const [copiedCodeIdx, setCopiedCodeIdx] = useState<number | null>(null);

  const handleCopyCode = async (code: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCodeIdx(idx);
      setTimeout(() => setCopiedCodeIdx(null), 2000);
    } catch (e) {
      console.warn("Failed to copy code:", e);
    }
  };

  const handleOpenLink = async (url: string, e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  // Split content by fenced code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className={`space-y-2 text-xs leading-relaxed text-neutral-200 ${className}`}>
      {parts.map((part, partIdx) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          // Code block
          const lines = part.slice(3, -3).split("\n");
          const firstLine = lines[0].trim();
          const language = firstLine || "text";
          const code = (firstLine ? lines.slice(1) : lines).join("\n").replace(/^\n+|\n+$/g, "");

          return (
            <div
              key={partIdx}
              className="my-3 rounded-lg overflow-hidden border border-neutral-800 bg-neutral-950 font-mono text-[11px]"
            >
              <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-900 border-b border-neutral-800 text-neutral-400">
                <span className="font-semibold text-[10px] uppercase tracking-wider text-primary-400">
                  {language}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyCode(code, partIdx)}
                  className="flex items-center gap-1 hover:text-neutral-200 transition text-[11px] cursor-pointer"
                  title="Copy code"
                >
                  {copiedCodeIdx === partIdx ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 overflow-x-auto text-neutral-100 leading-normal selection:bg-neutral-800">
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        // Render normal markdown blocks (paragraphs, lists, headings, quotes)
        const paragraphs = part.split(/\n\n+/);
        return paragraphs.map((para, pIdx) => {
          const trimmed = para.trim();
          if (!trimmed) return null;

          // Headings
          if (trimmed.startsWith("### ")) {
            return (
              <h4 key={`${partIdx}-${pIdx}`} className="font-bold text-neutral-100 text-sm mt-3 mb-1">
                {renderInline(trimmed.slice(4), handleOpenLink)}
              </h4>
            );
          }
          if (trimmed.startsWith("## ")) {
            return (
              <h3 key={`${partIdx}-${pIdx}`} className="font-bold text-neutral-100 text-base mt-4 mb-1.5 border-b border-neutral-800/80 pb-1">
                {renderInline(trimmed.slice(3), handleOpenLink)}
              </h3>
            );
          }
          if (trimmed.startsWith("# ")) {
            return (
              <h2 key={`${partIdx}-${pIdx}`} className="font-bold text-neutral-100 text-lg mt-4 mb-2 border-b border-neutral-800 pb-1">
                {renderInline(trimmed.slice(2), handleOpenLink)}
              </h2>
            );
          }

          // Blockquote
          if (trimmed.startsWith("> ")) {
            return (
              <blockquote
                key={`${partIdx}-${pIdx}`}
                className="border-l-2 border-primary-500/60 pl-3 py-1 my-2 bg-neutral-900/40 rounded-r text-neutral-300 italic"
              >
                {renderInline(trimmed.slice(2), handleOpenLink)}
              </blockquote>
            );
          }

          // List items
          const lines = trimmed.split("\n");
          const isBulletList = lines.every((l) => /^\s*[-*]\s+/.test(l));
          const isNumberList = lines.every((l) => /^\s*\d+\.\s+/.test(l));

          if (isBulletList) {
            return (
              <ul key={`${partIdx}-${pIdx}`} className="list-disc list-inside space-y-1 my-1.5 pl-1 text-neutral-300">
                {lines.map((l, lIdx) => (
                  <li key={lIdx}>
                    {renderInline(l.replace(/^\s*[-*]\s+/, ""), handleOpenLink)}
                  </li>
                ))}
              </ul>
            );
          }

          if (isNumberList) {
            return (
              <ol key={`${partIdx}-${pIdx}`} className="list-decimal list-inside space-y-1 my-1.5 pl-1 text-neutral-300">
                {lines.map((l, lIdx) => (
                  <li key={lIdx}>
                    {renderInline(l.replace(/^\s*\d+\.\s+/, ""), handleOpenLink)}
                  </li>
                ))}
              </ol>
            );
          }

          // Normal paragraph (handle single newlines inside paragraph)
          return (
            <p key={`${partIdx}-${pIdx}`} className="my-1.5 leading-relaxed text-neutral-200">
              {lines.map((l, lIdx) => (
                <React.Fragment key={lIdx}>
                  {renderInline(l, handleOpenLink)}
                  {lIdx < lines.length - 1 && <br />}
                </React.Fragment>
              ))}
            </p>
          );
        });
      })}
    </div>
  );
};

/**
 * Parses inline formatting: [link](url), `code`, **bold**, *italic*
 */
function renderInline(
  text: string,
  onOpenLink: (url: string, e: React.MouseEvent) => void
): React.ReactNode[] {
  // Tokenize regex
  // 1: [link](url)
  // 2: `inline code`
  // 3: **bold**
  // 4: *italic*
  const tokenRegex = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.substring(lastIndex, match.index));
    }

    const fullMatch = match[0];

    if (fullMatch.startsWith("[") && match[2] && match[3]) {
      // Link
      const label = match[2];
      const url = match[3];
      nodes.push(
        <a
          key={match.index}
          href={url}
          onClick={(e) => onOpenLink(url, e)}
          className="inline-flex items-center gap-0.5 text-primary-400 hover:text-primary-300 underline font-medium hover:underline cursor-pointer"
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${url}`}
        >
          <span>{label}</span>
          <ExternalLink className="w-2.5 h-2.5 inline opacity-70" />
        </a>
      );
    } else if (fullMatch.startsWith("`") && match[4]) {
      // Inline code
      nodes.push(
        <code
          key={match.index}
          className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-200 font-mono text-[11px] border border-neutral-700/60"
        >
          {match[4]}
        </code>
      );
    } else if (fullMatch.startsWith("**") && match[5]) {
      // Bold
      nodes.push(
        <strong key={match.index} className="font-semibold text-neutral-100">
          {match[5]}
        </strong>
      );
    } else if (fullMatch.startsWith("*") && match[6]) {
      // Italic
      nodes.push(
        <em key={match.index} className="italic text-neutral-300">
          {match[6]}
        </em>
      );
    } else {
      nodes.push(fullMatch);
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.substring(lastIndex));
  }

  return nodes;
}
