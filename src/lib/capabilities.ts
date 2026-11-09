import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModelInfo } from "@/bindings";

export interface CloudModel {
  value: string;
  label: string;
  streaming: boolean;
  multilingual: boolean;
  /** USD per minute of audio, as listed by the provider (Nov 2026). */
  pricePerMin?: number;
  /** True when the provider bills by tokens, so the per-minute figure is an estimate. */
  approxPrice?: boolean;
}

/** Formats a model's per-minute price for display, e.g. "$0.0045/min" or "~$0.0016/min". */
export const formatCloudPrice = (model: CloudModel): string | null => {
  if (model.pricePerMin == null) return null;
  const p = model.pricePerMin;
  const digits = p < 0.001 ? 5 : 4;
  const value = Number(p.toFixed(digits)).toString();
  return `${model.approxPrice ? "~" : ""}$${value}/min`;
};

export interface CloudProvider {
  value: string;
  label: string;
  defaultModel: string;
  models: CloudModel[];
}

// Capabilities are hard-coded per model: the backend only sends finished recordings to cloud APIs, so no cloud model streams yet.
// Realtime-only models (gpt-live-transcribe, gemini-*-transcribe-live) are left out for the same reason.
// Prices: provider list prices checked Nov 2026. Token-billed models are estimated from audio-input tokens (Gemini ≈ 32 tokens/s).
export const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    value: "openai",
    label: "OpenAI",
    defaultModel: "gpt-transcribe",
    models: [
      { value: "gpt-transcribe", label: "GPT Transcribe", streaming: false, multilingual: true, pricePerMin: 0.0045 },
      { value: "gpt-4o-transcribe", label: "GPT-4o Transcribe", streaming: false, multilingual: true, pricePerMin: 0.006, approxPrice: true },
      { value: "gpt-4o-mini-transcribe", label: "GPT-4o Mini Transcribe", streaming: false, multilingual: true, pricePerMin: 0.003, approxPrice: true },
      { value: "whisper-1", label: "Whisper-1", streaming: false, multilingual: true, pricePerMin: 0.006 },
    ],
  },
  {
    value: "groq",
    label: "Groq",
    defaultModel: "whisper-large-v3-turbo",
    models: [
      { value: "whisper-large-v3-turbo", label: "Whisper Large v3 Turbo", streaming: false, multilingual: true, pricePerMin: 0.04 / 60 },
      { value: "whisper-large-v3", label: "Whisper Large v3", streaming: false, multilingual: true, pricePerMin: 0.111 / 60 },
    ],
  },
  {
    value: "gemini",
    label: "Gemini",
    defaultModel: "gemini-3.5-transcribe",
    models: [
      { value: "gemini-3.5-transcribe", label: "Gemini 3.5 Transcribe", streaming: false, multilingual: true, pricePerMin: 0.005, approxPrice: true },
      { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash", streaming: false, multilingual: true, pricePerMin: 0.0016, approxPrice: true },
      { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash", streaming: false, multilingual: true, pricePerMin: 0.0058, approxPrice: true },
      { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", streaming: false, multilingual: true, pricePerMin: 0.0006, approxPrice: true },
      { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", streaming: false, multilingual: true, pricePerMin: 0.001, approxPrice: true },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", streaming: false, multilingual: true, pricePerMin: 0.0019, approxPrice: true },
    ],
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    defaultModel: "openai/gpt-transcribe",
    // Curated picks; the full live catalogue (speech-to-text and audio-input chat models) is fetched at runtime.
    models: [
      { value: "openai/gpt-transcribe", label: "OpenAI GPT Transcribe", streaming: false, multilingual: true, pricePerMin: 0.0045 },
      { value: "google/gemini-3.5-transcribe", label: "Gemini 3.5 Transcribe", streaming: false, multilingual: true, pricePerMin: 0.005, approxPrice: true },
      { value: "elevenlabs/scribe-v2", label: "ElevenLabs Scribe v2", streaming: false, multilingual: true, pricePerMin: 0.000061 * 60 },
      { value: "deepgram/nova-3", label: "Deepgram Nova-3", streaming: false, multilingual: true, pricePerMin: 0.0000717 * 60 },
      { value: "mistralai/voxtral-mini-transcribe-3-0", label: "Voxtral Mini Transcribe 3", streaming: false, multilingual: true },
      { value: "openai/whisper-large-v3-turbo", label: "Whisper Large v3 Turbo", streaming: false, multilingual: true },
      { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (audio chat)", streaming: false, multilingual: true, pricePerMin: 0.0019, approxPrice: true },
    ],
  },
];

export const CLOUD_SUPPORTS_STREAMING = CLOUD_PROVIDERS.some((p) =>
  p.models.some((m) => m.streaming),
);

export interface CapabilityFilter {
  live: boolean;
  multilingual: boolean;
}

/** True when a local model accepts more than one language. */
export const isMultilingual = (model: ModelInfo): boolean => model.languages.length > 1;

/** True when a local model has every capability the filter asks for. */
export const localModelMatches = (model: ModelInfo, filter: CapabilityFilter): boolean =>
  (!filter.live || model.supports_streaming) && (!filter.multilingual || isMultilingual(model));

/** True when a cloud model has every capability the filter asks for. */
export const cloudModelMatches = (model: CloudModel, filter: CapabilityFilter): boolean =>
  (!filter.live || model.streaming) && (!filter.multilingual || model.multilingual);

interface CapabilityPrefs {
  multilingual: boolean;
  setMultilingual: (value: boolean) => void;
}

// Live text is a real backend setting; "multilingual" only narrows the model choice, so it lives in the UI.
export const useCapabilityPrefs = create<CapabilityPrefs>()(
  persist(
    (set) => ({
      multilingual: false,
      setMultilingual: (multilingual) => set({ multilingual }),
    }),
    { name: "babbl.capability-prefs" },
  ),
);
