import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ExternalLink, FileUp, FolderOpen, Loader2, Trash2, UploadCloud } from "lucide-react";
import { commands, type SyncStatus, type Result } from "@/bindings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { Button } from "../../ui/Button";
import { formatBytes } from "./MachinePage";

type Run = (action: () => Promise<Result<SyncStatus, string>>) => Promise<boolean>;

/** Joins the storage folder with a shared file name using the platform's separator. */
function sharedPath(status: SyncStatus, name: string) {
  const sep = status.storage_dir.includes("\\") ? "\\" : "/";
  return `${status.storage_dir}${sep}Shared${sep}${name}`;
}

/** This machine's shared files: drop zone, list, and who can see them. */
export function MyFiles({ status, run }: { status: SyncStatus; run: Run }) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);

  const add = async (paths: string[]) => {
    if (paths.length === 0) return;
    setAdding(true);
    const ok = await run(() => commands.libraryAdd(paths));
    setAdding(false);
    if (ok) toast.success(t("library.added", { defaultValue: "Shared {{count}} item(s)", count: paths.length }));
  };

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") setDragging(true);
      else if (p.type === "leave") setDragging(false);
      else if (p.type === "drop") {
        setDragging(false);
        add(p.paths);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const pick = async () => {
    const r = await commands.sharePickFiles();
    if (r.status !== "ok") return toast.error(r.error);
    add(r.data);
  };

  const open = async (p: Promise<Result<unknown, string>>) => {
    const r = await p;
    if (r.status !== "ok") toast.error(r.error);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold text-text/50 uppercase tracking-wider">
          {t("library.mine", "My shared files")}
        </h2>
        <Button size="sm" variant="ghost" onClick={() => open(commands.shareOpenFolder("shared"))}>
          <span className="inline-flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5" />
            {t("library.openFolder", "Open folder")}
          </span>
        </Button>
      </div>

      <div
        className={`rounded-xl border-2 border-dashed px-6 py-6 flex flex-col items-center gap-2 text-center transition-colors ${
          dragging ? "border-background-ui bg-background-ui/10" : "border-mid-gray/30"
        }`}
      >
        {adding ? (
          <Loader2 className="w-7 h-7 text-text/40 animate-spin" />
        ) : (
          <UploadCloud className="w-7 h-7 text-text/40" />
        )}
        <div className="text-sm">
          {dragging
            ? t("library.dropNow", "Drop to share")
            : t("library.dropHint", "Drag files or folders here to share them with your machines")}
        </div>
        <div className="text-xs text-text/50">
          {t("library.dropSub", "Babbl keeps a copy, and folders are zipped. Machines that can see your files download them when they need them.")}
        </div>
        <Button size="sm" onClick={pick} disabled={adding}>
          <span className="inline-flex items-center gap-1.5">
            <FileUp className="w-3.5 h-3.5" />
            {t("library.choose", "Choose files")}
          </span>
        </Button>
      </div>

      {status.library.length > 0 && (
        <SettingsGroup>
          {status.library.map((f) => {
            const path = sharedPath(status, f.name);
            return (
              <div key={f.name} className="px-4 py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate" title={f.name}>
                    {f.name}
                  </div>
                  <div className="text-xs text-text/50">
                    {`${formatBytes(f.size)} · ${new Date(f.modified_ms).toLocaleString()}`}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button size="sm" variant="ghost" title={t("machine.open", "Open")} onClick={() => open(commands.shareOpenPath(path))}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" title={t("machine.reveal", "Show in folder")} onClick={() => open(commands.shareRevealPath(path))}>
                    <FolderOpen className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t("library.remove", "Stop sharing (deletes Babbl's copy)")}
                    onClick={() => run(() => commands.libraryRemove(f.name))}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </SettingsGroup>
      )}

      {status.peers.length > 0 && (
        <SettingsGroup title={t("library.whoCanSee", "Who can see my files")}>
          {status.peers.map((p) => (
            <ToggleSwitch
              key={p.device_id}
              label={p.name}
              description={t("library.canSeeDesc", "Can browse and download your shared files.")}
              checked={p.files}
              onChange={(v) => run(() => commands.clipboardSyncSetPeerFiles(p.device_id, v))}
              grouped
            />
          ))}
        </SettingsGroup>
      )}
    </div>
  );
}
