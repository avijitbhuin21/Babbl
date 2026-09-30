import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";
import { commands } from "@/bindings";

interface UseGpuProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const UseGpu: React.FC<UseGpuProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const [device, setDevice] = useState<string | null>(null);

    const enabled = getSetting("use_gpu") ?? true;

    useEffect(() => {
      const refresh = async () => {
        const result = await commands.getTranscriptionDevice();
        if (result.status === "ok") setDevice(result.data);
      };
      refresh();
      const unlisten = listen("model-state-changed", refresh);
      return () => {
        unlisten.then((fn) => fn());
      };
    }, []);

    const description = device
      ? `${t("settings.advanced.useGpu.description")} ${t("settings.advanced.useGpu.runningOn", { device })}`
      : t("settings.advanced.useGpu.description");

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(value) => updateSetting("use_gpu", value)}
        isUpdating={isUpdating("use_gpu")}
        label={t("settings.advanced.useGpu.label")}
        description={description}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
