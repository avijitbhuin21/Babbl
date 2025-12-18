import React from "react";
import { useTranslation } from "react-i18next";
import { Cog, FlaskConical, History, Info, Sparkles, Cloud } from "lucide-react";
// Logo image is loaded from src-tauri/icons
import BabblIcon from "./icons/BabblIcon";
import { useSettings } from "../hooks/useSettings";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  PostProcessingSettings,
  OnlineProviderSettings,
} from "./settings";

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  [key: string]: any;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: any) => boolean;
}

export const SECTIONS_CONFIG = {
  general: {
    labelKey: "sidebar.general",
    icon: BabblIcon,
    component: GeneralSettings,
    enabled: () => true,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Cog,
    component: AdvancedSettings,
    enabled: () => true,
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    icon: Sparkles,
    component: PostProcessingSettings,
    enabled: (settings) => settings?.post_process_enabled ?? false,
  },
  onlineprovider: {
    labelKey: "sidebar.cloudModels",
    icon: Cloud,
    component: OnlineProviderSettings,
    enabled: (settings) => settings?.use_online_provider ?? false,
  },
  history: {
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled(settings))
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  return (
    <div className="flex flex-col w-44 h-full bg-surface/30 items-center py-4 px-3">
      <img src="/src-tauri/icons/Babbl_extended_logo_original.png" width={100} className="mb-6 opacity-90" alt="Babbl Logo" />
      <div className="flex flex-col w-full items-start gap-0.5">
        {availableSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;

          return (
            <div
              key={section.id}
              className={`flex gap-3 items-center py-2.5 px-3 w-full rounded-md cursor-pointer transition-all duration-150 ${isActive
                ? "bg-background-ui/20 text-background-ui"
                : "text-text/60 hover:text-text/90 hover:bg-white/5"
                }`}
              onClick={() => onSectionChange(section.id)}
            >
              <Icon width={18} height={18} className="shrink-0" />
              <span className="text-sm font-medium">{t(section.labelKey)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
