import React, { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../../ui/SettingContainer";
import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { ApiKeyField } from "../PostProcessingSettingsApi/ApiKeyField";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import type { ModelOption } from "../PostProcessingSettingsApi/types";
import type { DropdownOption } from "../../ui/Dropdown";
import { useSettings } from "../../../hooks/useSettings";

const APPLE_PROVIDER_ID = "apple_intelligence";

interface LlmPurposeSettingsProps {
  purpose: "postprocess" | "refine";
}

/** Provider / API key / model picker for one LLM purpose (post-processing or refine). API keys are shared per provider. */
export const LlmPurposeSettings: React.FC<LlmPurposeSettingsProps> = ({ purpose }) => {
  const { t } = useTranslation();
  const {
    settings,
    isUpdating,
    setPostProcessProvider,
    updatePostProcessApiKey,
    updatePostProcessModel,
    fetchPostProcessModels,
    postProcessModelOptions,
    setRefineProvider,
    updateRefineModel,
  } = useSettings();

  const providers = (settings?.post_process_providers || []).filter(
    (p) => purpose === "postprocess" || p.id !== APPLE_PROVIDER_ID,
  );

  const postProviderId = settings?.post_process_provider_id || providers[0]?.id || "openai";
  const selectedProviderId =
    purpose === "refine"
      ? settings?.refine_provider_id?.trim() || postProviderId
      : postProviderId;

  const selectedProvider = providers.find((p) => p.id === selectedProviderId) ?? providers[0];
  const isAppleProvider = selectedProvider?.id === APPLE_PROVIDER_ID;

  const apiKey = settings?.post_process_api_keys?.[selectedProviderId] ?? "";
  const postModel = settings?.post_process_models?.[selectedProviderId] ?? "";
  const model =
    purpose === "refine"
      ? settings?.refine_models?.[selectedProviderId]?.trim() || postModel
      : postModel;

  const providerOptions = useMemo<DropdownOption[]>(
    () => providers.map((p) => ({ value: p.id, label: p.label })),
    [providers],
  );

  const handleProviderSelect = useCallback(
    (providerId: string) => {
      if (providerId === selectedProviderId) return;
      if (purpose === "refine") void setRefineProvider(providerId);
      else void setPostProcessProvider(providerId);
    },
    [purpose, selectedProviderId, setRefineProvider, setPostProcessProvider],
  );

  const handleApiKeyChange = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed !== apiKey) void updatePostProcessApiKey(selectedProviderId, trimmed);
    },
    [apiKey, selectedProviderId, updatePostProcessApiKey],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (purpose === "refine") void updateRefineModel(selectedProviderId, trimmed);
      else void updatePostProcessModel(selectedProviderId, trimmed);
    },
    [purpose, selectedProviderId, updateRefineModel, updatePostProcessModel],
  );

  const handleRefreshModels = useCallback(() => {
    if (isAppleProvider) return;
    void fetchPostProcessModels(selectedProviderId);
  }, [fetchPostProcessModels, isAppleProvider, selectedProviderId]);

  useEffect(() => {
    if (isAppleProvider) return;
    if (apiKey.trim() && !postProcessModelOptions[selectedProviderId]) {
      void fetchPostProcessModels(selectedProviderId);
    }
  }, [selectedProviderId, apiKey, postProcessModelOptions, fetchPostProcessModels, isAppleProvider]);

  const modelOptions = useMemo<ModelOption[]>(() => {
    const seen = new Set<string>();
    const options: ModelOption[] = [];
    for (const candidate of [...(postProcessModelOptions[selectedProviderId] || []), model]) {
      const trimmed = candidate?.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      options.push({ value: trimmed, label: trimmed });
    }
    return options;
  }, [postProcessModelOptions, selectedProviderId, model]);

  const isModelUpdating =
    purpose === "refine"
      ? isUpdating(`refine_model:${selectedProviderId}`)
      : isUpdating(`post_process_model:${selectedProviderId}`);
  const isFetchingModels = isUpdating(`post_process_models_fetch:${selectedProviderId}`);
  const isApiKeyUpdating = isUpdating(`post_process_api_key:${selectedProviderId}`);

  return (
    <>
      <SettingContainer
        title={t("settings.postProcessing.api.provider.title")}
        description={t("settings.postProcessing.api.provider.description")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <ProviderSelect
          options={providerOptions}
          value={selectedProviderId}
          onChange={handleProviderSelect}
        />
      </SettingContainer>

      {!isAppleProvider && (
        <SettingContainer
          title={t("settings.postProcessing.api.apiKey.title")}
          description={t(
            "settings.cloudModels.sharedKey",
            "API keys are shared per provider between post-processing and refine.",
          )}
          descriptionMode="tooltip"
          layout="horizontal"
          grouped={true}
        >
          <ApiKeyField
            value={apiKey}
            onBlur={handleApiKeyChange}
            placeholder={t("settings.postProcessing.api.apiKey.placeholder")}
            disabled={isApiKeyUpdating}
            className="min-w-[320px]"
            providerId={selectedProviderId}
          />
        </SettingContainer>
      )}

      <SettingContainer
        title={t("settings.postProcessing.api.model.title")}
        description={t("settings.postProcessing.api.model.descriptionDefault")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <ModelSelect
          value={model}
          options={modelOptions}
          disabled={isModelUpdating || isAppleProvider}
          isLoading={isFetchingModels}
          placeholder={
            modelOptions.length > 0
              ? t("settings.postProcessing.api.model.placeholderWithOptions")
              : t("settings.postProcessing.api.model.placeholderNoOptions")
          }
          onSelect={handleModelChange}
          onCreate={handleModelChange}
          onBlur={() => {}}
          onRefresh={handleRefreshModels}
          isRefreshing={isFetchingModels}
          className="flex-1 min-w-[320px]"
          providerId={`${purpose}:${selectedProviderId}`}
        />
      </SettingContainer>
    </>
  );
};
