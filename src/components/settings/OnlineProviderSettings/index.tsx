import React, { useState, useEffect, useMemo } from "react";
import { useSettings } from "../../../hooks/useSettings";
import { useTranslation } from "react-i18next";
import { Dropdown, type DropdownOption } from "../../ui/Dropdown";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";

// Online provider configurations (removed SambaNova)
const ONLINE_PROVIDERS: DropdownOption[] = [
    { value: "openai", label: "OpenAI" },
    { value: "groq", label: "Groq" },
    { value: "gemini", label: "Gemini" },
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
};

const DEFAULT_MODELS: Record<string, string> = {
    openai: "whisper-1",
    groq: "whisper-large-v3-turbo",
    gemini: "gemini-2.5-flash",
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

    // Reset local state when provider changes
    useEffect(() => {
        setApiKeyInput(savedApiKey);
        setShowApiKey(false);
    }, [selectedProviderId, savedApiKey]);

    // Get model options for current provider
    const modelOptions = useMemo(() => {
        return PROVIDER_MODELS[selectedProviderId] ?? [];
    }, [selectedProviderId]);

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
        <div className="max-w-3xl w-full mx-auto space-y-6">
            <SettingsGroup title={t("settings.onlineProviders.title", "Online Providers")}>
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
                            className="absolute right-2 p-1 text-text/50 hover:text-logo-primary transition-colors"
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
        </div>
    );
};

export default OnlineProviderSettings;
