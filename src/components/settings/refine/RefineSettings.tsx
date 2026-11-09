import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { RefineToggle } from "../RefineToggle";
import { BabblShortcut } from "../BabblShortcut";
import { LlmPurposeSettings } from "../OnlineProviderSettings/LlmPurposeSettings";
import { useSettings } from "../../../hooks/useSettings";

/** Refine selection: on/off, its shortcut, and the LLM that rewrites the text. */
export const RefineSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const refineEnabled = getSetting("refine_enabled") ?? true;

  return (
    <div className="w-full space-y-8">
      <SettingsGroup title={t("settings.general.refine.title", "Refine selection")}>
        <RefineToggle descriptionMode="tooltip" grouped />
        <BabblShortcut shortcutId="refine" grouped disabled={!refineEnabled} />
      </SettingsGroup>
      {refineEnabled && (
        <SettingsGroup
          title={t("refine.model.title", "Model")}
          info={t(
            "refine.model.info",
            "Model that rewrites selected text from your spoken instruction. Add the provider's API key to load its model list.",
          )}
        >
          <LlmPurposeSettings purpose="refine" />
        </SettingsGroup>
      )}
    </div>
  );
};
