import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowDownLeft,
  ArrowLeft,
  Download,
  ExternalLink,
  EyeOff,
  FolderOpen,
  Laptop,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { commands, type SyncStatus, type Result } from "@/bindings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { Button } from "../../ui/Button";

type Run = (action: () => Promise<Result<SyncStatus, string>>) => Promise<boolean>;
type Peer = SyncStatus["peers"][number];

/** Formats a byte count for display. */
export function formatBytes(n: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${n} B` : `${v.toFixed(1)} ${units[i]}`;
}

/** Runs a command that returns a plain Result and shows its error as a toast. */
async function act(p: Promise<Result<unknown, string>>) {
  const r = await p;
  if (r.status !== "ok") toast.error(r.error);
  return r;
}

/** Page for one paired machine: browse and download its shared files. */
export function MachinePage({
  peer,
  status,
  run,
  onBack,
}: {
  peer: Peer;
  status: SyncStatus;
  run: Run;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const library = status.remote_libraries.find((l) => l.device_id === peer.device_id);

  const refresh = () => {
    if (peer.connected) commands.libraryBrowse(peer.device_id);
  };
  useEffect(refresh, [peer.device_id, peer.connected]);

  const download = async (name: string) => {
    const r = await act(commands.libraryFetch(peer.device_id, name));
    if (r.status === "ok") setRequested((s) => new Set(s).add(name));
  };

  const transfers = status.transfers.filter((tr) => tr.kind === "share" && tr.direction === "in" && tr.peer === peer.name);
  const received = status.shares
    .filter((s) => s.direction === "received" && s.peer_ids.includes(peer.device_id))
    .flatMap((s) => s.files.map((name, i) => ({ key: `${s.id}:${i}`, name, path: s.paths?.[i] ?? null, at: s.at_ms })));

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onBack} title={t("machine.back", "Back to machines")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Laptop className="w-6 h-6 text-text/50" />
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold truncate">{peer.name}</div>
          <div className="flex items-center gap-1.5 text-xs text-text/50">
            <span className={`w-2 h-2 rounded-full ${peer.connected ? "bg-green-500" : "bg-mid-gray/50"}`} />
            {peer.connected ? `${t("sync.online", "Online")} · ${peer.via.join(" + ")}` : t("sync.offline", "Offline")}
          </div>
        </div>
        <Button size="sm" variant="ghost" title={t("library.refresh", "Refresh")} onClick={refresh} disabled={!peer.connected}>
          <RefreshCw className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title={t("sync.forget", "Forget this machine")}
          onClick={async () => {
            if (window.confirm(t("sync.forgetConfirm", { defaultValue: "Forget {{name}}?", name: peer.name }))) {
              if (await run(() => commands.clipboardSyncForgetDevice(peer.device_id))) onBack();
            }
          }}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-3">
        <h2 className="px-1 text-xs font-semibold text-text/50 uppercase tracking-wider">
          {t("library.theirs", { defaultValue: "{{name}}'s shared files", name: peer.name })}
        </h2>
        <SettingsGroup>
          {!library ? (
            <div className="px-4 py-6 text-sm text-text/50 text-center">
              {peer.connected
                ? t("library.loading", "Asking for the file list…")
                : t("library.offline", "This machine is offline. Its files appear when it's back online.")}
            </div>
          ) : !library.allowed ? (
            <div className="px-4 py-6 text-sm text-text/50 flex flex-col items-center gap-2 text-center">
              <EyeOff className="w-5 h-5" />
              {t("library.hidden", { defaultValue: "{{name}} isn't sharing its files with this machine.", name: peer.name })}
            </div>
          ) : library.files.length === 0 ? (
            <div className="px-4 py-6 text-sm text-text/50 text-center">
              {t("library.empty", { defaultValue: "{{name}} hasn't shared any files yet.", name: peer.name })}
            </div>
          ) : (
            library.files.map((f) => (
              <div key={f.name} className="px-4 py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate" title={f.name}>
                    {f.name}
                  </div>
                  <div className="text-xs text-text/50">
                    {`${formatBytes(f.size)} · ${new Date(f.modified_ms).toLocaleString()}`}
                  </div>
                </div>
                <Button size="sm" onClick={() => download(f.name)} disabled={!peer.connected}>
                  <span className="inline-flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" />
                    {requested.has(f.name) ? t("library.again", "Again") : t("library.download", "Download")}
                  </span>
                </Button>
              </div>
            ))
          )}
        </SettingsGroup>
        {library && !peer.connected && (
          <div className="px-1 text-xs text-text/50">{t("library.stale", "Last known list. Downloads need the machine online.")}</div>
        )}
      </div>

      {transfers.length > 0 && (
        <SettingsGroup title={t("machine.inProgress", "In progress")}>
          {transfers.map((tr) => {
            const pct = tr.total > 0 ? (tr.received / tr.total) * 100 : 0;
            return (
              <div key={tr.id} className="px-4 py-2 text-xs text-text/70">
                <div className="flex items-center gap-1.5">
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  <span className="truncate flex-1">{tr.summary}</span>
                  <span className="tabular-nums">{`${formatBytes(tr.received)} / ${formatBytes(tr.total)} · ${Math.round(pct)}%`}</span>
                </div>
                <div className="mt-1 h-1 rounded bg-mid-gray/20 overflow-hidden">
                  <div className="h-full bg-background-ui" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </SettingsGroup>
      )}

      {received.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-text/50 uppercase tracking-wider">
              {t("library.downloaded", "Downloaded")}
            </h2>
            <Button size="sm" variant="ghost" onClick={() => run(() => commands.shareClearHistory(peer.device_id))}>
              {t("machine.clear", "Clear list")}
            </Button>
          </div>
          <SettingsGroup>
            {received.map((row) => (
              <div key={row.key} className="px-4 py-2 flex items-center gap-3">
                <ArrowDownLeft className="w-4 h-4 text-green-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate" title={row.path ?? row.name}>
                    {row.name}
                  </div>
                  <div className="text-xs text-text/50">{new Date(row.at).toLocaleString()}</div>
                </div>
                {row.path && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button size="sm" variant="ghost" title={t("machine.open", "Open")} onClick={() => act(commands.shareOpenPath(row.path!))}>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" title={t("machine.reveal", "Show in folder")} onClick={() => act(commands.shareRevealPath(row.path!))}>
                      <FolderOpen className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t("machine.saveAs", "Save a copy…")}
                      onClick={async () => {
                        const r = await act(commands.shareSaveAs(row.path!));
                        if (r.status === "ok" && r.data) toast.success(t("machine.saved", "Saved"));
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </SettingsGroup>
        </div>
      )}
    </div>
  );
}
