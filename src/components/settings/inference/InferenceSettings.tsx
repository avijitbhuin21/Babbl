import React from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { useSettings } from "../../../hooks/useSettings";
import {
  CLOUD_SUPPORTS_STREAMING,
  useCapabilityPrefs,
  type CapabilityFilter,
} from "../../../lib/capabilities";
import { LocalInference } from "./LocalInference";
import { CloudInference } from "./CloudInference";

/** Hook returning the capability filter that applies to the current engine. */
export const useActiveCapabilityFilter = (): CapabilityFilter & { cloud: boolean } => {
  const { getSetting } = useSettings();
  const multilingual = useCapabilityPrefs((s) => s.multilingual);
  const cloud = getSetting("use_online_provider") || false;
  const liveSetting = getSetting("live_transcription") ?? true;
  const live = liveSetting && (!cloud || CLOUD_SUPPORTS_STREAMING);
  return { live, multilingual, cloud };
};

interface ChipProps {
  label: string;
  selected: boolean;
  disabled?: boolean;
  title?: string;
  onToggle: () => void;
}

/** One selectable pill in the capability multi-select. */
const CapabilityChip: React.FC<ChipProps> = ({ label, selected, disabled, title, onToggle }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={selected}
    title={title}
    disabled={disabled}
    onClick={onToggle}
    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
      selected
        ? "border-background-ui/60 bg-background-ui/15 text-background-ui"
        : "border-border/50 text-text/60 hover:border-background-ui/40 hover:text-text/90"
    }`}
  >
    {selected && <Check size={12} />}
    {label}
  </button>
);

/** Wanted capabilities and the matching model for the engine chosen in the side panel. */
export const InferenceSettings: React.FC = () => {
  const { t } = useTranslation();
  const { updateSetting, isUpdating } = useSettings();
  const setMultilingual = useCapabilityPrefs((s) => s.setMultilingual);
  const filter = useActiveCapabilityFilter();
  const liveUnavailable = filter.cloud && !CLOUD_SUPPORTS_STREAMING;

  return (
    <div className="w-full space-y-8">
      <SettingsGroup
        title={t("inference.capabilities.title", "Capabilities")}
        info={t(
          "inference.capabilities.info",
          "Pick what you need. Only models that support every selected capability are offered. Live text shows words while you speak; multilingual models understand more than one language.",
        )}
      >
        <div className="flex flex-wrap gap-2 p-3">
          <CapabilityChip
            label={t("settings.advanced.liveTranscription.label")}
            selected={filter.live}
            disabled={liveUnavailable || isUpdating("live_transcription")}
            title={liveUnavailable ? t("settings.advanced.liveTranscription.descriptionCloud") : undefined}
            onToggle={() => updateSetting("live_transcription", !filter.live)}
          />
          <CapabilityChip
            label={t("inference.capabilities.multilingual.label", "Multilingual")}
            selected={filter.multilingual}
            onToggle={() => setMultilingual(!filter.multilingual)}
          />
        </div>
      </SettingsGroup>

      {filter.cloud ? <CloudInference filter={filter} /> : <LocalInference filter={filter} />}
    </div>
  );
};
