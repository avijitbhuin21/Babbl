import React, { useState, useEffect, useMemo } from "react";
import { useSettings } from "../../../hooks/useSettings";
import { useTranslation } from "react-i18next";
import { Dropdown, type DropdownOption } from "../../ui/Dropdown";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "../../ui/Input";
import { LlmPurposeSettings } from "./LlmPurposeSettings";
import { commands } from "@/bindings";

// Online provider configurations (removed SambaNova)
const ONLINE_PROVIDERS: DropdownOption[] = [
    { value: "openai", label: "OpenAI" },
    { value: "groq", label: "Groq" },
    { value: "gemini", label: "Gemini" },
    { value: "openrouter", label: "OpenRouter" },
];

// Models available for each provider
const PROVIDER_MODELS: Record<string, DropdownOption[]> = {
    openai: [
        { value: "whisper-1", label: "Whisper-1" },
        { value: "gpt-4o-transcribe", label: "GPT-4o Transcribe" },
        { value: "gpt-4o-mini-transcribe", label: "GPT-4o Mini Transcribe" },
    ],
    groq: [
        { value: "whisper-large-v3-turbo", label: "Whisper Large v3 Turbo" },
        { value: "whisper-large-v3", label: "Whisper Large v3" },
    ],
    gemini: [
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
        { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
        { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash-Lite" },
    ],
    openrouter: [
        { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
        { value: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
        { value: "openai/gpt-4o-audio-preview", label: "GPT-4o Audio Preview" },
    ],
};

const DEFAULT_MODELS: Record<string, string> = {
    openai: "whisper-1",
    groq: "whisper-large-v3-turbo",
    gemini: "gemini-2.5-flash",
    openrouter: "google/gemini-2.5-flash",
};

export const OnlineProviderSettings: React.FC = () => {
    const { t } = useTranslation();
    const { settings, updateSetting, isUpdating } = useSettings();

    const selectedProviderId = settings?.online_provider_id ?? "openai";
    const savedApiKey = settings?.online_provider_api_keys?.[selectedProviderId] ?? "";
    const savedModel = settings?.online_provider_models?.[selectedProviderId] ?? DEFAULT_MODELS[selectedProviderId] ?? "";

    // Local state for editing
    const [apiKeyInput, setApiKeyInput] = useState(savedApiKey);
    const [showApiKey, setShowApiKey] = useState(false);

    const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({});

    // Reset local state when provider changes
    useEffect(() => {
        setApiKeyInput(savedApiKey);
        setShowApiKey(false);
    }, [selectedProviderId, savedApiKey]);

    // Providers with a public model catalogue get their audio-capable models listed dynamically.
    useEffect(() => {
        if (selectedProviderId !== "openrouter" || fetchedModels[selectedProviderId]) return;
        let cancelled = false;
        commands.fetchOnlineTranscriptionModels(selectedProviderId).then((result) => {
            if (cancelled) return;
            if (result.status === "ok") {
                setFetchedModels((prev) => ({ ...prev, [selectedProviderId]: result.data }));
            } else {
                console.error("Failed to fetch transcription models:", result.error);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [selectedProviderId, fetchedModels]);

    // Curated models first, then any other audio-capable models from the provider.
    const modelOptions = useMemo(() => {
        const curated = PROVIDER_MODELS[selectedProviderId] ?? [];
        const known = new Set(curated.map((o) => o.value));
        const extra = (fetchedModels[selectedProviderId] ?? [])
            .filter((id) => !known.has(id))
            .map((id) => ({ value: id, label: id }));
        const options = [...curated, ...extra];
        if (savedModel && !options.some((o) => o.value === savedModel)) {
            options.push({ value: savedModel, label: savedModel });
        }
        return options;
    }, [selectedProviderId, fetchedModels, savedModel]);

    const handleProviderChange = async (providerId: string) => {
        await updateSetting("online_provider_id" as any, providerId);
    };

    const handleModelChange = async (modelId: string) => {
        if (!settings) return;
        const updatedModels = {
            ...settings.online_provider_models,
            [selectedProviderId]: modelId,
        };
        await updateSetting("online_provider_models" as any, updatedModels);
    };

    const handleApiKeyBlur = async () => {
        if (!settings) return;
        if (apiKeyInput !== savedApiKey) {
            const updatedKeys = {
                ...settings.online_provider_api_keys,
                [selectedProviderId]: apiKeyInput,
            };
            await updateSetting("online_provider_api_keys" as any, updatedKeys);
        }
    };

    const isProviderUpdating = isUpdating("online_provider_id");
    const isApiKeyUpdating = isUpdating("online_provider_api_keys");
    const isModelUpdating = isUpdating("online_provider_models");

    return (
        <div className="w-full space-y-8">
            <SettingsGroup
                title={t("settings.cloudModels.transcription.title", "Transcription")}
                description={t("settings.cloudModels.transcription.description", "Model used to turn your speech into text.")}
            >
                {/* Provider Selection */}
                <SettingContainer
                    title={t("settings.onlineProviders.provider.title", "Provider")}
                    description={t("settings.onlineProviders.provider.description", "Select an online transcription service provider.")}
                    descriptionMode="tooltip"
                    layout="horizontal"
                    grouped={true}
                >
                    <Dropdown
                        selectedValue={selectedProviderId}
                        options={ONLINE_PROVIDERS}
                        onSelect={handleProviderChange}
                        disabled={isProviderUpdating}
                        className="min-w-[200px]"
                    />
                </SettingContainer>

                {/* Model Selection */}
                <SettingContainer
                    title={t("settings.onlineProviders.model.title", "Model")}
                    description={t("settings.onlineProviders.model.description", "Select the transcription model for the selected provider.")}
                    descriptionMode="tooltip"
                    layout="horizontal"
                    grouped={true}
                >
                    <Dropdown
                        selectedValue={savedModel}
                        options={modelOptions}
                        onSelect={handleModelChange}
                        disabled={isModelUpdating}
                        placeholder={t("settings.onlineProviders.model.placeholder", "Select a model")}
                        className="min-w-[200px]"
                    />
                </SettingContainer>

                {/* API Key Input */}
                <SettingContainer
                    title={t("settings.onlineProviders.apiKey.title", "API Key")}
                    description={t("settings.onlineProviders.apiKey.description", "Your API key for the selected provider.")}
                    descriptionMode="tooltip"
                    layout="horizontal"
                    grouped={true}
                >
                    <div className="relative flex items-center min-w-[200px]">
                        <Input
                            type={showApiKey ? "text" : "password"}
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                            onBlur={handleApiKeyBlur}
                            placeholder={t("settings.onlineProviders.apiKey.placeholder", "Enter your API key")}
                            disabled={isApiKeyUpdating}
                            variant="compact"
                            className="flex-1 pr-10"
                        />
                        <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-2 p-1 text-text/50 hover:text-background-ui transition-colors"
                            title={showApiKey ? "Hide API key" : "Show API key"}
                        >
                            {showApiKey ? (
                                <EyeOff className="w-4 h-4" />
                            ) : (
                                <Eye className="w-4 h-4" />
                            )}
                        </button>
                    </div>
                </SettingContainer>
            </SettingsGroup>

            <SettingsGroup
                title={t("settings.cloudModels.refine.title", "Refine")}
                description={t(
                    "settings.cloudModels.refine.description",
                    "Model that rewrites selected text from your spoken instruction. Defaults to the post-processing choice.",
                )}
            >
                <LlmPurposeSettings purpose="refine" />
            </SettingsGroup>
        </div>
    );
};

export default OnlineProviderSettings;
