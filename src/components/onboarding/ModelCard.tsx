import React from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import type { ModelInfo } from "@/bindings";
import { formatModelSize } from "../../lib/utils/format";
import {
  getTranslatedModelName,
  getTranslatedModelDescription,
} from "../../lib/utils/modelTranslation";
import Badge from "../ui/Badge";

interface ModelCardProps {
  model: ModelInfo;
  variant?: "default" | "featured";
  disabled?: boolean;
  className?: string;
  onSelect: (modelId: string) => void;
}

const ModelCard: React.FC<ModelCardProps> = ({
  model,
  variant = "default",
  disabled = false,
  className = "",
  onSelect,
}) => {
  const { t } = useTranslation();
  const isFeatured = variant === "featured";

  // Get translated model name and description
  const displayName = getTranslatedModelName(model, t);
  const displayDescription = getTranslatedModelDescription(model, t);

  const baseButtonClasses =
    "flex justify-between items-center rounded-xl p-3 px-4 text-left transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-background-ui/30 active:scale-[0.98] cursor-pointer group";

  const variantClasses = isFeatured
    ? "border-2 border-background-ui/30 bg-background-ui/8 hover:border-background-ui/50 hover:bg-background-ui/12 hover:shadow-md hover:scale-[1.01] disabled:hover:border-background-ui/30 disabled:hover:bg-background-ui/8 disabled:hover:shadow-none disabled:hover:scale-100"
    : "border-2 border-border/60 hover:border-background-ui/50 hover:bg-background-ui/8 hover:shadow-md hover:scale-[1.01] disabled:hover:border-border/60 disabled:hover:bg-transparent disabled:hover:shadow-none disabled:hover:scale-100";

  return (
    <button
      onClick={() => onSelect(model.id)}
      disabled={disabled}
      className={[baseButtonClasses, variantClasses, className]
        .filter(Boolean)
        .join(" ")}
      type="button"
    >
      <div className="flex flex-col items-ce">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-text group-hover:text-background-ui transition-colors">
            {displayName}
          </h3>
          <DownloadSize sizeMb={Number(model.size_mb)} />
          {isFeatured && (
            <Badge variant="primary">{t("onboarding.recommended")}</Badge>
          )}
        </div>
        <p className="text-text/60 text-sm leading-relaxed">
          {displayDescription}
        </p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-xs text-text/70 w-16 text-right">
            {t("onboarding.modelCard.accuracy")}
          </p>
          <div className="w-20 h-2 bg-mid-gray/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-background-ui rounded-full transition-all duration-300"
              style={{ width: `${model.accuracy_score * 100}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-text/70 w-16 text-right">
            {t("onboarding.modelCard.speed")}
          </p>
          <div className="w-20 h-2 bg-mid-gray/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-background-ui rounded-full transition-all duration-300"
              style={{ width: `${model.speed_score * 100}%` }}
            />
          </div>
        </div>
      </div>
    </button>
  );
};

const DownloadSize = ({ sizeMb }: { sizeMb: number }) => {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1.5 text-xs text-text/60 tabular-nums">
      <Download
        aria-hidden="true"
        className="h-3.5 w-3.5 text-text/45"
        strokeWidth={1.75}
      />
      <span className="sr-only">{t("modelSelector.downloadSize")}</span>
      <span className="font-medium text-text/70">
        {formatModelSize(sizeMb)}
      </span>
    </div>
  );
};

export default ModelCard;
