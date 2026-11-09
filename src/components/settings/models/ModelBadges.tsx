import React from "react";
import { useTranslation } from "react-i18next";
import type { ModelInfo } from "@/bindings";
import { isMultilingual } from "../../../lib/capabilities";

const chip = "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide";

/** Small capability chips (live, languages, translate) for a local model. */
export const ModelBadges: React.FC<{ model: ModelInfo }> = ({ model }) => {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap items-center gap-1">
      {model.supports_streaming && (
        <span className={`${chip} bg-background-ui/20 text-background-ui`}>{t("modelSelector.live", "Live")}</span>
      )}
      <span className={`${chip} bg-white/5 text-text/60`}>
        {isMultilingual(model)
          ? t("models.badge.languages", { defaultValue: "{{count}} languages", count: model.languages.length })
          : (model.languages[0] ?? "").toUpperCase()}
      </span>
      {model.supports_translate && (
        <span className={`${chip} bg-white/5 text-text/60`}>{t("models.badge.translate", "Translate")}</span>
      )}
    </span>
  );
};
