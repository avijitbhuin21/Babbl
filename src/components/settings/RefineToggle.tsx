import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface RefineToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/** Toggle for voice-driven rewriting of selected text (refine mode). */
export const RefineToggle: React.FC<RefineToggleProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("refine_enabled") ?? true;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(value) => updateSetting("refine_enabled", value)}
        isUpdating={isUpdating("refine_enabled")}
        label={t("settings.general.refineToggle.label", "Refine selected text with voice")}
        description={t(
          "settings.general.refineToggle.description",
          "When text is selected and you press the shortcut, your speech becomes an instruction and the selection is rewritten by the post-processing model. Uses a brief Ctrl+C to read the selection.",
        )}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
