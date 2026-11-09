import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";
import { commands } from "@/bindings";
import { useSettings } from "../../../hooks/useSettings";
import { Dropdown, type DropdownOption } from "../../ui/Dropdown";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { Input } from "../../ui/Input";
import {
  CLOUD_PROVIDERS,
  cloudModelMatches,
  formatCloudPrice,
  type CapabilityFilter,
  type CloudModel,
} from "../../../lib/capabilities";

/** Cloud provider, API key and a transcription model filtered by the capability filter. */
export const CloudInference: React.FC<{ filter: CapabilityFilter }> = ({ filter }) => {
  const { t } = useTranslation();
  const { settings, updateSetting, isUpdating } = useSettings();

  const providerId = settings?.online_provider_id ?? "openai";
  const provider = CLOUD_PROVIDERS.find((p) => p.value === providerId) ?? CLOUD_PROVIDERS[0];
  const savedApiKey = settings?.online_provider_api_keys?.[providerId] ?? "";
  const savedModel = settings?.online_provider_models?.[providerId] ?? provider.defaultModel;

  const [apiKeyInput, setApiKeyInput] = useState(savedApiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setApiKeyInput(savedApiKey);
    setShowApiKey(false);
  }, [providerId, savedApiKey]);

  // OpenRouter has a public catalogue; list its other audio-capable models too.
  useEffect(() => {
    if (providerId !== "openrouter" || fetchedModels[providerId]) return;
    let cancelled = false;
    commands.fetchOnlineTranscriptionModels(providerId).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") setFetchedModels((prev) => ({ ...prev, [providerId]: result.data }));
      else console.error("Failed to fetch transcription models:", result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [providerId, fetchedModels]);

  const allModels = useMemo<CloudModel[]>(() => {
    const known = new Set(provider.models.map((m) => m.value));
    const extra = (fetchedModels[providerId] ?? [])
      .filter((id) => !known.has(id))
      .map((id) => ({ value: id, label: id, streaming: false, multilingual: true }));
    return [...provider.models, ...extra];
  }, [provider, providerId, fetchedModels]);

  const matching = allModels.filter((m) => cloudModelMatches(m, filter));
  const withPrice = (m: CloudModel) => {
    const price = formatCloudPrice(m);
    return price ? `${m.label} · ${price}` : m.label;
  };
  const modelOptions: DropdownOption[] = matching.map((m) => ({ value: m.value, label: withPrice(m) }));
  const savedMatches = matching.some((m) => m.value === savedModel);
  if (!savedMatches && savedModel) modelOptions.push({ value: savedModel, label: savedModel });
  const selectedModel = allModels.find((m) => m.value === savedModel);
  const selectedPrice = selectedModel ? formatCloudPrice(selectedModel) : null;

  const providerOptions: DropdownOption[] = CLOUD_PROVIDERS.map((p) => ({ value: p.value, label: p.label }));

  const handleModelChange = async (modelId: string) => {
    if (!settings) return;
    await updateSetting("online_provider_models" as any, { ...settings.online_provider_models, [providerId]: modelId });
  };

  const handleApiKeyBlur = async () => {
    if (!settings || apiKeyInput === savedApiKey) return;
    await updateSetting("online_provider_api_keys" as any, { ...settings.online_provider_api_keys, [providerId]: apiKeyInput });
  };

  return (
    <SettingsGroup
      title={t("inference.cloud.title", "Cloud model")}
      info={t(
        "inference.cloud.info",
        "Audio is sent to the provider with your API key. Speech-to-text models only transcribe; audio-chat models can also translate.",
      )}
    >
      <SettingContainer
        title={t("settings.onlineProviders.provider.title", "Provider")}
        description={t("settings.onlineProviders.provider.description", "Select an online transcription service provider.")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped
      >
        <Dropdown
          selectedValue={providerId}
          options={providerOptions}
          onSelect={(id) => updateSetting("online_provider_id" as any, id)}
          disabled={isUpdating("online_provider_id")}
          className="min-w-[200px]"
        />
      </SettingContainer>

      <SettingContainer
        title={t("settings.onlineProviders.model.title", "Model")}
        description={t("settings.onlineProviders.model.description", "Select the transcription model for the selected provider.")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped
      >
        <Dropdown
          selectedValue={savedModel}
          options={modelOptions}
          onSelect={handleModelChange}
          disabled={isUpdating("online_provider_models")}
          placeholder={t("settings.onlineProviders.model.placeholder", "Select a model")}
          searchable
          searchPlaceholder={t("inference.cloud.searchModels", "Type to search models")}
          className="min-w-[200px]"
        />
      </SettingContainer>

      {selectedModel?.pricePerMin != null && (
        <div className="px-4 py-2 text-xs text-text/50">
          {t("inference.cloud.cost", {
            defaultValue: "{{price}} · about ${{hour}} per hour of audio. List price, billed by the provider.",
            price: selectedPrice,
            hour: (selectedModel.pricePerMin * 60).toFixed(2),
          })}
        </div>
      )}

      {!savedMatches && savedModel && (
        <div className="flex items-start gap-2 px-4 py-3 text-xs text-amber-400/90">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{t("inference.cloud.mismatch", "The selected model doesn't support everything selected above.")}</span>
        </div>
      )}

      <SettingContainer
        title={t("settings.onlineProviders.apiKey.title", "API Key")}
        description={t("settings.onlineProviders.apiKey.description", "Your API key for the selected provider.")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped
      >
        <div className="relative flex items-center min-w-[200px]">
          <Input
            type={showApiKey ? "text" : "password"}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onBlur={handleApiKeyBlur}
            placeholder={t("settings.onlineProviders.apiKey.placeholder", "Enter your API key")}
            disabled={isUpdating("online_provider_api_keys")}
            variant="compact"
            className="flex-1 pr-10"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-2 p-1 text-text/50 hover:text-background-ui transition-colors"
            title={showApiKey ? t("inference.cloud.hideKey", "Hide API key") : t("inference.cloud.showKey", "Show API key")}
          >
            {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </SettingContainer>
    </SettingsGroup>
  );
};
