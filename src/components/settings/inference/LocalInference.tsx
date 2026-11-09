import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Download, Loader2, Search, Trash2, X } from "lucide-react";
import { commands, type ModelInfo } from "@/bindings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { Button } from "../../ui/Button";
import { ProgressBar } from "../../shared";
import { useModels } from "../../../hooks/useModels";
import { formatModelSize } from "../../../lib/utils/format";
import { localModelMatches, type CapabilityFilter } from "../../../lib/capabilities";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "../../../lib/utils/modelTranslation";
import { ModelBadges } from "../models/ModelBadges";

/** Tiny labelled bar for a 0..1 score. */
const Meter: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <span className="flex items-center gap-1.5">
    <span>{label}</span>
    <span className="h-1.5 w-12 overflow-hidden rounded-full bg-mid-gray/20">
      <span className="block h-full rounded-full bg-background-ui" style={{ width: `${value * 100}%` }} />
    </span>
  </span>
);

/** Local model catalogue filtered by capabilities and name, with use / download / delete actions. */
export const LocalInference: React.FC<{ filter: CapabilityFilter }> = ({ filter }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const {
    models,
    currentModel,
    error,
    downloadProgress,
    selectModel,
    downloadModel,
    deleteModel,
    isModelDownloading,
    isModelExtracting,
  } = useModels();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter(
      (m) =>
        localModelMatches(m, filter) &&
        (!q || getTranslatedModelName(m, t).toLowerCase().includes(q) || m.id.toLowerCase().includes(q)),
    );
  }, [models, filter, query, t]);
  const downloaded = visible.filter((m) => m.is_downloaded);
  const available = visible.filter((m) => !m.is_downloaded);
  const active = models.find((m) => m.id === currentModel);
  const activeMismatch = !!active && !localModelMatches(active, filter);

  const renderRow = (model: ModelInfo) => {
    const isActive = model.id === currentModel;
    const downloading = isModelDownloading(model.id) || downloadProgress.has(model.id);
    const extracting = isModelExtracting(model.id);
    const progress = downloadProgress.get(model.id);

    return (
      <div key={model.id} className={`px-4 py-3 ${isActive ? "bg-background-ui/10" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-sm font-medium ${isActive ? "text-background-ui" : "text-text/90"}`}>
                {getTranslatedModelName(model, t)}
              </span>
              <ModelBadges model={model} />
            </div>
            <p className="mt-0.5 text-xs text-text/50">{getTranslatedModelDescription(model, t)}</p>
            <div className="mt-1.5 flex items-center gap-3 text-[11px] text-text/40 tabular-nums">
              <span>{formatModelSize(Number(model.size_mb))}</span>
              <Meter label={t("onboarding.modelCard.accuracy")} value={model.accuracy_score} />
              <Meter label={t("onboarding.modelCard.speed")} value={model.speed_score} />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {extracting ? (
              <span className="flex items-center gap-1 text-xs text-text/60">
                <Loader2 size={13} className="animate-spin" />
                {t("models.extracting", "Preparing")}
              </span>
            ) : downloading ? (
              <>
                <span className="text-xs text-background-ui tabular-nums">
                  {progress ? `${Math.max(0, Math.min(100, Math.round(progress.percentage)))}%` : "…"}
                </span>
                <Button variant="ghost" size="sm" title={t("modelSelector.cancelDownload", "Cancel")} onClick={() => commands.cancelDownload(model.id)}>
                  <X size={13} />
                </Button>
              </>
            ) : model.is_downloaded ? (
              isActive ? (
                <span className="flex items-center gap-1 text-xs text-background-ui">
                  <Check size={13} />
                  {t("modelSelector.active")}
                </span>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => selectModel(model.id)}>
                    {t("models.use", "Use")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-300"
                    title={t("modelSelector.deleteModel", { modelName: getTranslatedModelName(model, t) })}
                    onClick={() => deleteModel(model.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </>
              )
            ) : (
              <Button variant="secondary" size="sm" className="flex items-center gap-1.5" onClick={() => downloadModel(model.id)}>
                <Download size={13} />
                {Number(model.partial_size) > 0 ? t("modelSelector.resume", "Resume") : t("modelSelector.download")}
              </Button>
            )}
          </div>
        </div>

        {downloading && progress && (
          <div className="mt-2">
            <ProgressBar progress={[{ id: model.id, percentage: progress.percentage, label: model.name }]} size="small" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full space-y-6">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text/40" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("inference.local.search", "Search models by name")}
          className="w-full rounded-lg border border-mid-gray/40 bg-surface/50 py-2 pl-9 pr-8 text-sm text-text placeholder:text-text/40 focus:border-background-ui/60 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            title={t("common.clear", "Clear")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text/40 hover:text-text/80 cursor-pointer"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {activeMismatch && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-400/5 px-4 py-3 text-xs text-amber-400/90">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {t("inference.local.mismatch", {
              defaultValue: "{{model}} is active but doesn't support everything selected above. Pick another model.",
              model: getTranslatedModelName(active, t),
            })}
          </span>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <SettingsGroup
        title={t("models.downloaded", "Downloaded")}
        info={t("inference.local.info", "Models run on this computer. Pick the one that transcribes your speech.")}
      >
        {downloaded.length > 0 ? (
          downloaded.map(renderRow)
        ) : (
          <div className="px-4 py-4 text-sm text-text/60">
            {t("inference.local.none", "No downloaded model matches these capabilities yet.")}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("models.available", "Available to download")}>
        {available.length > 0 ? (
          available.map(renderRow)
        ) : (
          <div className="px-4 py-4 text-sm text-text/60">
            {query
              ? t("inference.local.noSearchMatch", "No model matches your search.")
              : t("models.noneAvailable", "Every matching model is already downloaded.")}
          </div>
        )}
      </SettingsGroup>
    </div>
  );
};
