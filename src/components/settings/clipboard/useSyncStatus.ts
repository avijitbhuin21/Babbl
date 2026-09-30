import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { commands, type SyncStatus, type Result } from "@/bindings";

const STATUS_EVENT = "clipboard-sync-status";

/** Subscribes to clipboard sync status and exposes a helper that runs commands returning status. */
export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    commands.clipboardSyncGetStatus().then((r) => r.status === "ok" && setStatus(r.data));
    const unlisten = listen<SyncStatus>(STATUS_EVENT, (e) => setStatus(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const run = useCallback(async (action: () => Promise<Result<SyncStatus, string>>) => {
    const r = await action();
    if (r.status === "ok") {
      setStatus(r.data);
      return true;
    }
    toast.error(r.error);
    return false;
  }, []);

  return { status, run };
}
