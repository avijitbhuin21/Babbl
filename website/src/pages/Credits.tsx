import React from "react";
import { ArrowUpRight, Heart } from "lucide-react";
import { Container } from "../components/Container";
import { PageHeader } from "../components/PageHeader";
import { Prose } from "../components/Prose";
import { Reveal } from "../components/Reveal";
import { Action } from "../components/Action";
import { GITHUB_URL, HANDY_DONATE_URL, HANDY_GITHUB_URL, HANDY_URL } from "../lib/site";

const FROM_HANDY = [
  {
    title: "The app itself",
    body: "Babbl is a fork of Handy. Its foundation comes from Handy: the recording pipeline, the global shortcuts, the overlay, pasting into other apps, history and the settings app.",
  },
  {
    title: "The model catalogue",
    body: "Babbl's list of local speech models is generated from Handy's transcribe.cpp catalogue. The GGUF model builds Babbl downloads are published by the handy-computer organisation on Hugging Face.",
  },
  {
    title: "Audio libraries",
    body: "Voice activity detection uses CJ Pais's vad-rs, and audio playback uses his fork of rodio.",
  },
];

const ALSO_BUILT_ON = [
  { name: "Tauri", href: "https://tauri.app" },
  { name: "Silero VAD", href: "https://github.com/snakers4/silero-vad" },
  { name: "Whisper (OpenAI)", href: "https://github.com/openai/whisper" },
  { name: "Parakeet and Canary (NVIDIA)", href: "https://huggingface.co/nvidia" },
  { name: "Moonshine", href: "https://github.com/moonshine-ai/moonshine" },
  { name: "Qwen3-ASR", href: "https://huggingface.co/Qwen" },
];

const Credits: React.FC = () => (
  <>
    <PageHeader
      eyebrow="Credits"
      title="Standing on Handy's shoulders"
      description="Babbl wouldn't exist without Handy, the open-source speech-to-text app by CJ Pais. Here's what we built on."
    />

    <Container className="py-16 md:py-20">
      <Reveal>
        <div className="rounded-xl border border-border/40 bg-surface/30 p-7 md:p-9">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent/80">
            Based on
          </p>
          <h2 className="mt-3 text-[26px] font-semibold tracking-[-0.02em]">Handy</h2>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-text/55">
            Handy is a free, open-source and extensible speech-to-text app that runs entirely
            offline. Babbl started as a fork of it and still shares much of its core, released
            under the same MIT licence with Handy's copyright notice kept. Thank you to CJ Pais and
            everyone who contributes to Handy for their excellent work.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Action href={HANDY_URL} external>
              Visit handy.computer
              <ArrowUpRight size={15} />
            </Action>
            <Action href={HANDY_GITHUB_URL} external variant="secondary">
              Handy on GitHub
            </Action>
            <Action href={HANDY_DONATE_URL} external variant="secondary">
              <Heart size={14} />
              Support Handy
            </Action>
          </div>
        </div>
      </Reveal>

      <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-border/40 bg-border/40 md:grid-cols-3">
        {FROM_HANDY.map((item, i) => (
          <Reveal key={item.title} delay={i * 60}>
            <div className="h-full bg-background p-7">
              <h3 className="text-[15px] font-medium tracking-tight">{item.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-text/50">{item.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-16">
        <Prose>
          <h2>What Babbl adds</h2>
          <p>
            On top of Handy, Babbl adds clipboard sync and file sharing between paired machines,
            voice refinement of selected text, cloud transcription providers, and its own design
            and website. Full details are on the{" "}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              GitHub repository
            </a>
            .
          </p>

          <h2>Also built on</h2>
          <p>Babbl and Handy both depend on these open-source projects and models:</p>
          <ul>
            {ALSO_BUILT_ON.map((item) => (
              <li key={item.name}>
                <a href={item.href} target="_blank" rel="noreferrer">
                  {item.name}
                </a>
              </li>
            ))}
          </ul>
          <p>
            Every model in the catalogue keeps the licence its authors chose. Babbl doesn't change
            or relicense any of them.
          </p>
        </Prose>
      </Reveal>
    </Container>
  </>
);

export default Credits;
