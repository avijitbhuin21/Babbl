import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import {
  ArrowLeftRight,
  AudioLines,
  Cloud,
  Cpu,
  FlaskConical,
  HardDrive,
  History,
  Info,
  SlidersHorizontal,
  Users,
  Wand2,
} from "lucide-react";
import BabblIcon from "./icons/BabblIcon";
import { useSettings } from "../hooks/useSettings";
import {
  GeneralSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  SyncSettings,
} from "./settings";
import { InferenceSettings } from "./settings/inference/InferenceSettings";
import { RefineSettings } from "./settings/refine/RefineSettings";
import { useNavStore, type RailId, type TranscribePage } from "../stores/navStore";
import UpdateChecker from "./update-checker";

type IconType = React.ComponentType<{ size?: number | string; className?: string }>;

interface PageConfig {
  labelKey: string;
  fallback: string;
  icon: IconType;
  component: React.ComponentType;
}

/** Placeholder for features that are planned but not built yet. */
const ComingSoon: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-surface/50 py-16 text-center">
      <span className="text-sm font-medium text-text/80">{t("nav.comingSoon.title", "Coming soon")}</span>
      <span className="max-w-xs text-xs text-text/50">
        {t("nav.comingSoon.description", "This feature is on the way. Check back after the next update.")}
      </span>
    </div>
  );
};

export const TRANSCRIBE_PAGES: Record<TranscribePage, PageConfig> = {
  general: { labelKey: "sidebar.general", fallback: "General", icon: SlidersHorizontal, component: GeneralSettings },
  inference: { labelKey: "nav.inference", fallback: "Inference", icon: Cpu, component: InferenceSettings },
  refine: { labelKey: "nav.refine", fallback: "Refine", icon: Wand2, component: RefineSettings },
  history: { labelKey: "sidebar.history", fallback: "History", icon: History, component: HistorySettings },
  debug: { labelKey: "sidebar.debug", fallback: "Debug", icon: FlaskConical, component: DebugSettings },
};

export const RAIL_ITEMS: Record<RailId, PageConfig> = {
  transcribe: { labelKey: "nav.transcribe", fallback: "Transcribe", icon: AudioLines, component: GeneralSettings },
  sync: { labelKey: "nav.sync", fallback: "Sync", icon: ArrowLeftRight, component: SyncSettings },
  meeting: { labelKey: "nav.meetingAssistant", fallback: "Meeting assistant", icon: Users, component: ComingSoon },
  about: { labelKey: "sidebar.about", fallback: "About", icon: Info, component: AboutSettings },
};

const TOP_RAIL: RailId[] = ["transcribe", "sync", "meeting"];

const ENGINES = [
  { cloud: false, icon: HardDrive, labelKey: "inference.engine.local", fallback: "Local" },
  { cloud: true, icon: Cloud, labelKey: "inference.engine.cloud", fallback: "Cloud" },
];

/** Transcribe sub-pages visible with the current settings. */
export const useTranscribePages = (): TranscribePage[] => {
  const { settings } = useSettings();
  const pages: TranscribePage[] = ["general", "inference", "refine", "history"];
  if (settings?.debug_mode) pages.push("debug");
  return pages;
};

const RailButton: React.FC<{ id: RailId; active: boolean; onClick: () => void }> = ({ id, active, onClick }) => {
  const { t } = useTranslation();
  const { icon: Icon, labelKey, fallback } = RAIL_ITEMS[id];
  const label = t(labelKey, fallback);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors cursor-pointer ${
        active ? "bg-background-ui/20 text-background-ui" : "text-text/55 hover:bg-white/5 hover:text-text/90"
      }`}
    >
      <Icon size={19} />
    </button>
  );
};

/** Narrow icon rail plus, for Transcribe, a second panel listing its pages. */
export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const { rail, transcribePage, setRail, openTranscribePage } = useNavStore();
  const pages = useTranscribePages();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const useCloud = getSetting("use_online_provider") || false;
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch((error) => console.error("Failed to get app version:", error));
  }, []);

  return (
    <div className="flex h-full shrink-0">
      <nav className="flex w-14 flex-col items-center gap-1 border-r border-border/30 bg-surface/40 py-4">
        <BabblIcon width={26} height={26} className="mb-4 text-background-ui" />
        {TOP_RAIL.map((id) => (
          <RailButton key={id} id={id} active={rail === id} onClick={() => setRail(id)} />
        ))}
        <div className="flex-1" />
        <RailButton id="about" active={rail === "about"} onClick={() => setRail("about")} />
        <UpdateChecker compact version={version} className="mt-1" />
      </nav>

      {rail === "transcribe" && (
        <div className="flex w-36 flex-col gap-0.5 border-r border-border/30 bg-surface/20 px-2 py-4">
          <span className="px-2 pb-3 text-[11px] font-semibold uppercase tracking-wider text-text/40">
            {t("nav.transcribe", "Transcribe")}
          </span>
          {pages.map((id) => {
            const { icon: Icon, labelKey, fallback } = TRANSCRIBE_PAGES[id];
            const active = transcribePage === id;
            const isInference = id === "inference";
            return (
              <div
                key={id}
                className={`rounded-md transition-colors duration-300 ${
                  active ? "bg-background-ui/20 text-background-ui" : "text-text/60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => openTranscribePage(id)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors cursor-pointer ${
                    active ? "" : "hover:bg-white/5 hover:text-text/90"
                  }`}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="truncate font-medium">{t(labelKey, fallback)}</span>
                </button>
                {isInference && (
                  <div
                    className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                      active ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    }`}
                    aria-hidden={!active}
                  >
                    <div className="overflow-hidden">
                      <div
                        role="radiogroup"
                        className="ml-[1.05rem] mb-1.5 mr-1 flex flex-col gap-0.5 border-l border-background-ui/30 pl-2"
                      >
                        {ENGINES.map(({ cloud, icon: EngineIcon, labelKey: engineKey, fallback: engineFallback }) => {
                          const selected = useCloud === cloud;
                          return (
                            <button
                              key={engineKey}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              tabIndex={active ? 0 : -1}
                              disabled={isUpdating("use_online_provider")}
                              onClick={() => {
                                if (!selected) updateSetting("use_online_provider", cloud);
                              }}
                              className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors cursor-pointer disabled:cursor-wait ${
                                selected
                                  ? "bg-background-ui/20 text-background-ui"
                                  : "text-text/55 hover:bg-white/5 hover:text-text/90"
                              }`}
                            >
                              <EngineIcon size={13} className="shrink-0" />
                              <span className="flex-1 truncate font-medium">{t(engineKey, engineFallback)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
