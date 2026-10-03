import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";
import { useModels } from "../../hooks/useModels";

interface LiveTranscriptionProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const LiveTranscription: React.FC<LiveTranscriptionProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const { currentModel, loadCurrentModel, models } = useModels();

    const enabled = getSetting("live_transcription") ?? true;
    const useOnlineProvider = getSetting("use_online_provider") || false;
    const localModel = models.find((model) => model.id === currentModel);
    const modelCannotStream = !!localModel && !localModel.supports_streaming;
    const disabled = useOnlineProvider || modelCannotStream;

    let description = t("settings.advanced.liveTranscription.description");
    if (useOnlineProvider) {
      description = t("settings.advanced.liveTranscription.descriptionCloud");
    } else if (modelCannotStream) {
      description = t("settings.advanced.liveTranscription.descriptionUnsupported", {
        model: localModel.name,
      });
    }

    useEffect(() => {
      const unlisten = listen("model-state-changed", () => {
        loadCurrentModel();
      });
      return () => {
        unlisten.then((fn) => fn());
      };
    }, [loadCurrentModel]);

    return (
      <ToggleSwitch
        checked={enabled && !disabled}
        onChange={(value) => updateSetting("live_transcription", value)}
        isUpdating={isUpdating("live_transcription")}
        disabled={disabled}
        label={t("settings.advanced.liveTranscription.label")}
        description={description}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
