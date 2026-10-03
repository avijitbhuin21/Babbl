import React from "react";
import { Mic } from "lucide-react";

const bars = [8, 16, 26, 14, 32, 20, 11, 24, 30, 15, 9, 21, 28, 13, 18];

export const AppWindowMock: React.FC = () => (
  <div className="overflow-hidden rounded-xl border border-border/50 bg-surface/50 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.9)]">
    <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
      <span className="h-2.5 w-2.5 rounded-full bg-text/15" />
      <span className="h-2.5 w-2.5 rounded-full bg-text/15" />
      <span className="h-2.5 w-2.5 rounded-full bg-text/15" />
      <span className="ml-2 text-xs text-text/35">Babbl</span>
    </div>

    <div className="grid grid-cols-[128px_1fr] min-h-[300px]">
      <div className="border-r border-border/40 bg-background/40 p-3">
        <img src="/babbl-wordmark.png" alt="" className="mb-5 w-[72px] opacity-80" />
        <div className="space-y-1">
          {["General", "Advanced", "History", "Sync", "About"].map((item, i) => (
            <div
              key={item}
              className={`rounded-md px-2.5 py-1.5 text-xs ${
                i === 0 ? "bg-accent/15 text-accent" : "text-text/40"
              }`}
            >
              {item}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 p-5">
        <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3.5 py-3">
          <div>
            <p className="text-xs font-medium">Shortcut</p>
            <p className="text-[11px] text-text/35">Hold to dictate</p>
          </div>
          <div className="flex gap-1.5">
            {["Ctrl", "Space"].map((key) => (
              <kbd
                key={key}
                className="rounded border border-border/60 bg-surface px-2 py-1 text-[10px] text-text/70"
              >
                {key}
              </kbd>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3.5 py-3">
          <div>
            <p className="text-xs font-medium">Model</p>
            <p className="text-[11px] text-text/35">parakeet-unified-en · Live</p>
          </div>
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
            Ready
          </span>
        </div>

        <div className="rounded-lg border border-accent/25 bg-accent/[0.06] px-3.5 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Mic size={13} />
            </span>
            <div className="flex h-7 flex-1 items-center gap-[3px]">
              {bars.map((height, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-accent/60"
                  style={{ height: `${height}px` }}
                />
              ))}
            </div>
            <span className="text-[10px] text-accent/70">Listening</span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-text/70">
            Rewrite the onboarding copy so it reads calmer, and keep it under two sentences.
          </p>
        </div>
      </div>
    </div>
  </div>
);
