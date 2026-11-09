import { create } from "zustand";

export type RailId =
  | "transcribe"
  | "sync"
  | "meeting"
  | "about";

export type TranscribePage =
  | "general"
  | "inference"
  | "refine"
  | "history"
  | "debug";

interface NavState {
  rail: RailId;
  transcribePage: TranscribePage;
  setRail: (rail: RailId) => void;
  openTranscribePage: (page: TranscribePage) => void;
}

export const useNavStore = create<NavState>()((set) => ({
  rail: "transcribe",
  transcribePage: "general",
  setRail: (rail) => set({ rail }),
  openTranscribePage: (transcribePage) => set({ rail: "transcribe", transcribePage }),
}));
