import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";
import { useModels } from "../../hooks/useModels";

interface TranslateToEnglishProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const unsupportedTranslationModels = [
  "parakeet-tdt-0.6b-v2",
  "parakeet-tdt-0.6b-v3",
  "turbo",
];

// Default models for each online provider
const DEFAULT_ONLINE_MODELS: Record<string, string> = {
  openai: "whisper-1",
  groq: "whisper-large-v3-turbo",
  gemini: "gemini-2.5-flash",
};

export const TranslateToEnglish: React.FC<TranslateToEnglishProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating, settings } = useSettings();
    const { currentModel, loadCurrentModel, models } = useModels();

    const translateToEnglish = getSetting("translate_to_english") || false;
    const useOnlineProvider = getSetting("use_online_provider") || false;

    // Get the selected online model for display
    const onlineProviderId = settings?.online_provider_id ?? "openai";
    const onlineModel = settings?.online_provider_models?.[onlineProviderId] ?? DEFAULT_ONLINE_MODELS[onlineProviderId] ?? "";

    // Check if the online model is a Whisper model (supports native translation)
    const isWhisperModel = onlineModel.toLowerCase().includes("whisper");

    // Translation is supported when using online providers, regardless of local model
    const isDisabledTranslation =
      !useOnlineProvider && unsupportedTranslationModels.includes(currentModel);

    const description = useMemo(() => {
      if (isDisabledTranslation) {
        const currentModelDisplayName = models.find(
          (model) => model.id === currentModel,
        )?.name;
        return t(
          "settings.advanced.translateToEnglish.descriptionUnsupported",
          {
            model: currentModelDisplayName,
          },
        );
      }

      if (useOnlineProvider) {
        if (isWhisperModel) {
          return t("settings.advanced.translateToEnglish.descriptionOnlineWhisper", {
            model: onlineModel,
            defaultValue: `Using ${onlineModel} with native translation support. Audio will be translated directly to English.`,
          });
        } else {
          return t("settings.advanced.translateToEnglish.descriptionOnlineOther", {
            model: onlineModel,
            defaultValue: `Using ${onlineModel}. Translation is prompt-based and may vary in quality.`,
          });
        }
      }

      return t("settings.advanced.translateToEnglish.description");
    }, [t, models, currentModel, isDisabledTranslation, useOnlineProvider, onlineModel, isWhisperModel]);

    // Listen for model state changes to update UI reactively
    useEffect(() => {
      const modelStateUnlisten = listen("model-state-changed", () => {
        loadCurrentModel();
      });

      return () => {
        modelStateUnlisten.then((fn) => fn());
      };
    }, [loadCurrentModel]);

    return (
      <ToggleSwitch
        checked={translateToEnglish}
        onChange={(enabled) => updateSetting("translate_to_english", enabled)}
        isUpdating={isUpdating("translate_to_english")}
        disabled={isDisabledTranslation}
        label={t("settings.advanced.translateToEnglish.label")}
        description={description}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
