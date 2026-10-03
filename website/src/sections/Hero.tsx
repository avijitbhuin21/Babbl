import React from "react";
import { ArrowRight } from "lucide-react";
import { Container } from "../components/Container";
import { Action } from "../components/Action";
import { Reveal } from "../components/Reveal";
import { AppWindowMock } from "../components/AppWindowMock";
import { GITHUB_URL, DOWNLOAD_PATH } from "../lib/site";

export const Hero: React.FC = () => (
  <section className="relative overflow-hidden">
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] grid-lines" />

    <Container className="relative pt-24 pb-20 md:pt-32 md:pb-28">
      <Reveal className="max-w-[720px]">
        <span className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-surface/50 px-3 py-1 text-xs text-text/55">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Open source · Runs offline
        </span>

        <h1 className="mt-6 text-[40px] font-semibold leading-[1.08] tracking-[-0.03em] md:text-[60px]">
          Speak. It types.
          <br />
          <span className="text-text/40">Nothing leaves your machine.</span>
        </h1>

        <p className="mt-6 max-w-[54ch] text-[16px] leading-relaxed text-text/55 md:text-[17px]">
          Babbl is a local-first dictation app for your desktop. Hold a shortcut and say what you
          mean. The words appear live as you speak and land wherever your cursor is. You can
          also refine selected text by voice and share your clipboard between your computers.
          No account and no upload.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Action to={DOWNLOAD_PATH} size="lg">
            Download for free
            <ArrowRight size={16} />
          </Action>
          <Action href={GITHUB_URL} external variant="secondary" size="lg">
            View source
          </Action>
        </div>

        <p className="mt-4 text-xs text-text/35">Windows, macOS and Linux · MIT licensed</p>
      </Reveal>

      <Reveal delay={120} className="mt-16 md:mt-20">
        <AppWindowMock />
      </Reveal>
    </Container>
  </section>
);
