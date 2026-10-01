import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Download,
  ExternalLink,
  FileUp,
  FolderOpen,
  Laptop,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { commands, type SyncStatus, type Result } from "@/bindings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { Button } from "../../ui/Button";

type Run = (action: () => Promise<Result<SyncStatus, string>>) => Promise<boolean>;
type Peer = SyncStatus["peers"][number];
type Filter = "all" | "sent" | "received";

/** Formats a byte count for display. */
function formatBytes(n: number) {
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

interface FileRow {
  key: string;
  name: string;
  path: string | null;
  direction: string;
  state: string;
  error: string | null;
  atMs: number;
}

/** Page for one paired machine: clipboard switch, send area and the files shared with it. */
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
  const [filter, setFilter] = useState<Filter>("all");
  const [dragging, setDragging] = useState(false);
  const peerRef = useRef(peer);
  peerRef.current = peer;

  const send = async (paths: string[]) => {
    const p = peerRef.current;
    if (!p.connected) {
      toast.error(t("machine.offlineSend", { defaultValue: "{{name}} is offline", name: p.name }));
      return;
    }
    const r = await commands.shareSendFiles(paths, [p.device_id]);
    if (r.status === "ok") toast.success(t("machine.sending", { defaultValue: "Sending {{what}}", what: r.data }));
    else toast.error(r.error);
  };

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") setDragging(true);
      else if (p.type === "leave") setDragging(false);
      else if (p.type === "drop") {
        setDragging(false);
        if (p.paths.length > 0) send(p.paths);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const pick = async () => {
    const r = await commands.sharePickFiles();
    if (r.status !== "ok") return toast.error(r.error);
    if (r.data.length > 0) send(r.data);
  };

  const records = status.shares.filter((s) => s.peer_ids.includes(peer.device_id));
  const rows: FileRow[] = records
    .filter((s) => filter === "all" || s.direction === filter)
    .flatMap((s) =>
      s.files.map((name, i) => ({
        key: `${s.id}:${i}`,
        name,
        path: s.paths?.[i] ?? null,
        direction: s.direction,
        state: s.state,
        error: s.error,
        atMs: s.at_ms,
      })),
    );
  const transfers = status.transfers.filter(
    (tr) => tr.kind === "share" && tr.peer.split(", ").includes(peer.name),
  );

  const stateLabel = (row: FileRow) => {
    if (row.direction === "received") return t("machine.received", "Received");
    switch (row.state) {
      case "sending":
        return t("machine.stateSending", "Sending…");
      case "delivered":
        return t("machine.stateDelivered", "Delivered");
      case "failed":
        return t("machine.stateFailed", "Failed");
      default:
        return t("machine.stateSent", "Sent");
    }
  };

  const filterClass = (active: boolean) =>
    `px-3 py-1 text-xs rounded-md cursor-pointer transition-colors ${
      active ? "bg-background-ui text-white" : "text-text/70 hover:bg-mid-gray/15"
    }`;

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
            {peer.connected
              ? `${t("sync.online", "Online")} · ${peer.via.join(" + ")}`
              : t("sync.offline", "Offline")}
          </div>
        </div>
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

      <SettingsGroup>
        <ToggleSwitch
          label={t("machine.syncClipboard", "Sync clipboard")}
          description={t("machine.syncClipboardDesc", "Copy on one machine, paste on the other (both directions).")}
          checked={peer.clipboard}
          onChange={(v) => run(() => commands.clipboardSyncSetPeerClipboard(peer.device_id, v))}
          grouped
        />
      </SettingsGroup>

      {!peer.files ? (
        <SettingsGroup>
          <div className="px-4 py-4 flex items-center justify-between gap-3">
            <span className="text-sm text-text/60">
              {t("machine.filesOff", "File sharing with this machine is turned off.")}
            </span>
            <Button size="sm" onClick={() => run(() => commands.clipboardSyncSetPeerFiles(peer.device_id, true))}>
              {t("machine.filesOn", "Turn on")}
            </Button>
          </div>
        </SettingsGroup>
      ) : (
        <div
          className={`rounded-xl border-2 border-dashed px-6 py-8 flex flex-col items-center gap-3 text-center transition-colors ${
            dragging ? "border-background-ui bg-background-ui/10" : "border-mid-gray/30"
          }`}
        >
          <UploadCloud className="w-8 h-8 text-text/40" />
          <div className="text-sm">
            {dragging
              ? t("machine.dropNow", { defaultValue: "Drop to send to {{name}}", name: peer.name })
              : t("machine.dropHint", { defaultValue: "Drag files here to send them to {{name}}", name: peer.name })}
          </div>
          <Button size="sm" onClick={pick} disabled={!peer.connected}>
            <span className="inline-flex items-center gap-1.5">
              <FileUp className="w-3.5 h-3.5" />
              {t("machine.choose", "Choose files")}
            </span>
          </Button>
          {!peer.connected && (
            <div className="text-xs text-text/50">
              {t("machine.offlineHint", "This machine is offline. Files can be sent once it's back online.")}
            </div>
          )}
        </div>
      )}

      {transfers.length > 0 && (
        <SettingsGroup title={t("machine.inProgress", "In progress")}>
          {transfers.map((tr) => {
            const pct = tr.total > 0 ? (tr.received / tr.total) * 100 : 0;
            return (
              <div key={tr.id + tr.direction} className="px-4 py-2 text-xs text-text/70">
                <div className="flex items-center gap-1.5">
                  {tr.direction === "out" ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                  <span className="truncate flex-1">{tr.summary}</span>
                  <span className="tabular-nums">
                    {`${formatBytes(tr.received)} / ${formatBytes(tr.total)} · ${Math.round(pct)}%`}
                  </span>
                </div>
                <div className="mt-1 h-1 rounded bg-mid-gray/20 overflow-hidden">
                  <div className="h-full bg-background-ui" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </SettingsGroup>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold text-text/50 uppercase tracking-wider">
            {t("machine.sharedFiles", "Shared files")}
          </h2>
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-mid-gray/10">
            <button type="button" className={filterClass(filter === "all")} onClick={() => setFilter("all")}>
              {t("machine.filterAll", "All")}
            </button>
            <button type="button" className={filterClass(filter === "sent")} onClick={() => setFilter("sent")}>
              {t("machine.filterSent", "Sent")}
            </button>
            <button type="button" className={filterClass(filter === "received")} onClick={() => setFilter("received")}>
              {t("machine.filterReceived", "Received")}
            </button>
          </div>
        </div>
        <SettingsGroup>
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-text/50 text-center">
              {filter === "received"
                ? t("machine.noneReceived", "Nothing received from this machine yet.")
                : filter === "sent"
                  ? t("machine.noneSent", "Nothing sent to this machine yet.")
                  : t("machine.none", "No files shared with this machine yet.")}
            </div>
          ) : (
            rows.map((row) => (
              <div key={row.key} className="px-4 py-2 flex items-center gap-3">
                {row.direction === "sent" ? (
                  <ArrowUpRight className="w-4 h-4 text-text/50 shrink-0" />
                ) : (
                  <ArrowDownLeft className="w-4 h-4 text-green-500 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate" title={row.path ?? row.name}>
                    {row.name}
                  </div>
                  <div
                    className={`text-xs truncate ${row.state === "failed" ? "text-red-400" : "text-text/50"}`}
                    title={row.error ?? undefined}
                  >
                    {`${stateLabel(row)} · ${new Date(row.atMs).toLocaleString()}`}
                  </div>
                </div>
                {row.path && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button size="sm" variant="ghost" title={t("machine.open", "Open")} onClick={() => act(commands.shareOpenPath(row.path!))}>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t("machine.reveal", "Show in folder")}
                      onClick={() => act(commands.shareRevealPath(row.path!))}
                    >
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
            ))
          )}
        </SettingsGroup>
        {records.length > 0 && (
          <div className="px-1">
            <Button
              size="sm"
              variant="ghost"
              title={t("machine.clearHint", "Removes the entries from this list. The files stay on disk.")}
              onClick={() => run(() => commands.shareClearHistory(peer.device_id))}
            >
              {t("machine.clear", "Clear list")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
