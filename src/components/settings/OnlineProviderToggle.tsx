import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface OnlineProviderToggleProps {
    descriptionMode?: "inline" | "tooltip";
    grouped?: boolean;
}

export const OnlineProviderToggle: React.FC<OnlineProviderToggleProps> =
    React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
        const { t } = useTranslation();
        const { getSetting, updateSetting, isUpdating } = useSettings();

        const enabled = getSetting("use_online_provider") || false;

        return (
            <ToggleSwitch
                checked={enabled}
                onChange={(enabled) => updateSetting("use_online_provider", enabled)}
                isUpdating={isUpdating("use_online_provider")}
                label={t("settings.onlineProvider.toggle.label", "Use Cloud Models")}
                description={t("settings.onlineProvider.toggle.description", "Use cloud APIs for transcription instead of local models")}
                descriptionMode={descriptionMode}
                grouped={grouped}
            />
        );
    });
