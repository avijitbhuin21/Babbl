import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
import { ProgressBar } from "../shared";
import { useSettings } from "../../hooks/useSettings";

interface UpdateCheckerProps {
  className?: string;
}

/** Turns an updater exception into a short, user-readable cause. */
const describeUpdateError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();
  if (lower.includes("404") || lower.includes("not found")) return "no release published";
  if (lower.includes("signature") || lower.includes("pubkey") || lower.includes("minisign"))
    return "signature mismatch";
  if (
    lower.includes("dns") ||
    lower.includes("connect") ||
    lower.includes("network") ||
    lower.includes("timed out") ||
    lower.includes("offline")
  )
    return "offline";
  return raw.length > 60 ? `${raw.slice(0, 57)}...` : raw || "unknown error";
};

const UpdateChecker: React.FC<UpdateCheckerProps> = ({ className = "" }) => {
  const { t } = useTranslation();
  // Update checking state
  const [isChecking, setIsChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showUpToDate, setShowUpToDate] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);

  const { settings, isLoading } = useSettings();
  const settingsLoaded = !isLoading && settings !== null;
  const updateChecksEnabled = settings?.update_checks_enabled ?? false;

  const upToDateTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isManualCheckRef = useRef(false);
  const downloadedBytesRef = useRef(0);
  const contentLengthRef = useRef(0);

  const LAST_CHECK_KEY = "babbl.lastUpdateCheck";
  const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

  /** Returns true if the last automatic check happened less than 24h ago. */
  const checkedRecently = () => {
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
    return Number.isFinite(last) && Date.now() - last < AUTO_CHECK_INTERVAL_MS;
  };

  useEffect(() => {
    // Wait for settings to load before doing anything
    if (!settingsLoaded) return;

    if (!updateChecksEnabled) {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
      }
      setIsChecking(false);
      setUpdateAvailable(false);
      setShowUpToDate(false);
      setErrorText(null);
      return;
    }

    if (!checkedRecently()) {
      checkForUpdates();
    }

    // Listen for update check events
    const updateUnlisten = listen("check-for-updates", () => {
      handleManualUpdateCheck();
    });

    return () => {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
      }
      updateUnlisten.then((fn) => fn());
    };
  }, [settingsLoaded, updateChecksEnabled]);

  // Update checking functions
  const checkForUpdates = async () => {
    if (!updateChecksEnabled || isChecking) return;

    try {
      setIsChecking(true);
      setErrorText(null);
      const update = await check();
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

      if (update) {
        setUpdateAvailable(true);
        setAvailableVersion(update.version);
        setShowUpToDate(false);
      } else {
        setUpdateAvailable(false);
        setAvailableVersion(null);

        if (isManualCheckRef.current) {
          setShowUpToDate(true);
          if (upToDateTimeoutRef.current) {
            clearTimeout(upToDateTimeoutRef.current);
          }
          upToDateTimeoutRef.current = setTimeout(() => {
            setShowUpToDate(false);
          }, 3000);
        }
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
      setErrorText(describeUpdateError(error));
    } finally {
      setIsChecking(false);
      isManualCheckRef.current = false;
    }
  };

  const handleManualUpdateCheck = () => {
    if (!updateChecksEnabled) return;
    isManualCheckRef.current = true;
    checkForUpdates();
  };

  const installUpdate = async () => {
    if (!updateChecksEnabled) return;
    try {
      setIsInstalling(true);
      setDownloadProgress(0);
      downloadedBytesRef.current = 0;
      contentLengthRef.current = 0;
      const update = await check();

      if (!update) {
        console.log("No update available during install attempt");
        return;
      }

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            downloadedBytesRef.current = 0;
            contentLengthRef.current = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloadedBytesRef.current += event.data.chunkLength;
            const progress =
              contentLengthRef.current > 0
                ? Math.round(
                  (downloadedBytesRef.current / contentLengthRef.current) *
                  100,
                )
                : 0;
            setDownloadProgress(Math.min(progress, 100));
            break;
        }
      });
      await relaunch();
    } catch (error) {
      console.error("Failed to install update:", error);
    } finally {
      setIsInstalling(false);
      setDownloadProgress(0);
      downloadedBytesRef.current = 0;
      contentLengthRef.current = 0;
    }
  };

  // Update status functions
  const getUpdateStatusText = () => {
    if (!updateChecksEnabled) {
      return t("footer.updateCheckingDisabled");
    }
    if (isInstalling) {
      return downloadProgress > 0 && downloadProgress < 100
        ? t("footer.downloading", {
          progress: downloadProgress.toString().padStart(3),
        })
        : downloadProgress === 100
          ? t("footer.installing")
          : t("footer.preparing");
    }
    if (isChecking) return t("footer.checkingUpdates");
    if (errorText) return t("footer.updateError", { error: errorText, defaultValue: "Update check failed: {{error}}" });
    if (showUpToDate) return t("footer.upToDate");
    if (updateAvailable)
      return availableVersion
        ? t("footer.updateAvailableVersion", { version: availableVersion, defaultValue: "Update to v{{version}}" })
        : t("footer.updateAvailableShort");
    return t("footer.checkForUpdates");
  };

  const getUpdateStatusAction = () => {
    if (!updateChecksEnabled) return undefined;
    if (updateAvailable && !isInstalling) return installUpdate;
    if (!isChecking && !isInstalling && !updateAvailable)
      return handleManualUpdateCheck;
    return undefined;
  };

  const isUpdateDisabled = !updateChecksEnabled || isChecking || isInstalling;
  const isUpdateClickable =
    !isUpdateDisabled && (updateAvailable || errorText !== null || (!isChecking && !showUpToDate));

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {isUpdateClickable ? (
        <button
          onClick={getUpdateStatusAction()}
          disabled={isUpdateDisabled}
          title={errorText ?? undefined}
          className={`transition-colors disabled:opacity-50 tabular-nums ${updateAvailable
              ? "text-background-ui hover:text-background-ui/80 font-medium"
              : errorText
                ? "text-red-400 hover:text-red-300"
                : "text-text/60 hover:text-text/80"
            }`}
        >
          {getUpdateStatusText()}
        </button>
      ) : (
        <span className="text-text/60 tabular-nums">
          {getUpdateStatusText()}
        </span>
      )}

      {isInstalling && downloadProgress > 0 && downloadProgress < 100 && (
        <ProgressBar
          progress={[
            {
              id: "update",
              percentage: downloadProgress,
            },
          ]}
          size="large"
        />
      )}
    </div>
  );
};

export default UpdateChecker;
