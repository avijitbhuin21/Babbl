import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ArrowDownLeft,
  ArrowUpRight,
  FileUp,
  FolderOpen,
  HardDrive,
  Laptop,
  Upload,
} from "lucide-react";
import { commands, type SyncStatus } from "@/bindings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { useSyncStatus } from "../clipboard/useSyncStatus";

type Peer = SyncStatus["peers"][number];

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

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

/** Sends files and reports the result as a toast. */
async function sendFiles(paths: string[], deviceIds: string[]) {
  const r = await commands.shareSendFiles(paths, deviceIds);
  if (r.status === "ok") toast.success(`Sharing ${r.data}`);
  else toast.error(r.error);
  return r.status === "ok";
}

/** Finds the device card under a drag position reported by the webview. */
function deviceAt(x: number, y: number): string | null {
  const ratio = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(x / ratio, y / ratio);
  return el?.closest<HTMLElement>("[data-share-device]")?.dataset.shareDevice ?? null;
}

function RecipientModal({
  paths,
  peers,
  onClose,
}: {
  paths: string[] | null;
  peers: Peer[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const online = peers.filter((p) => p.connected);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (paths) setSelected(online.length === 1 ? [online[0].device_id] : []);
    // Reset the selection each time the dialog opens with a new set of files.
  }, [paths]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Modal isOpen={!!paths} onClose={onClose} title={t("share.chooseRecipients", "Share with…")}>
      {paths && (
        <div className="space-y-4">
          <div className="max-h-28 overflow-y-auto text-sm text-text/80 space-y-0.5">
            {paths.map((p) => (
              <div key={p} className="truncate" title={p}>
                {baseName(p)}
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-text/60">
              <span>{t("share.devices", "Devices")}</span>
              {online.length > 1 && (
                <button
                  type="button"
                  className="hover:text-text cursor-pointer"
                  onClick={() =>
                    setSelected(selected.length === online.length ? [] : online.map((p) => p.device_id))
                  }
                >
                  {selected.length === online.length
                    ? t("share.selectNone", "Select none")
                    : t("share.selectAll", "Select all")}
                </button>
              )}
            </div>
            {peers.map((p) => (
              <label
                key={p.device_id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded ${p.connected ? "cursor-pointer hover:bg-mid-gray/10" : "opacity-50"}`}
              >
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-background-ui"
                  disabled={!p.connected}
                  checked={selected.includes(p.device_id)}
                  onChange={() => toggle(p.device_id)}
                />
                <Laptop className="w-4 h-4 text-text/50" />
                <span className="text-sm flex-1 truncate">{p.name}</span>
                {!p.connected && <span className="text-xs text-text/50">{t("share.offline", "offline")}</span>}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t("share.cancel", "Cancel")}
            </Button>
            <Button
              size="sm"
              disabled={busy || selected.length === 0}
              onClick={async () => {
                setBusy(true);
                const ok = await sendFiles(paths, selected);
                setBusy(false);
                if (ok) onClose();
              }}
            >
              {selected.length > 1
                ? t("share.sendToMany", { defaultValue: "Send to {{count}} devices", count: selected.length })
                : t("share.send", "Send")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export const ShareSettings: React.FC = () => {
  const { t } = useTranslation();
  const { status, run } = useSyncStatus();
  const [pending, setPending] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverDevice, setHoverDevice] = useState<string | null>(null);
  const peersRef = useRef<Peer[]>([]);
  peersRef.current = status?.peers ?? [];

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter") {
        setDragging(true);
        setHoverDevice(deviceAt(p.position.x, p.position.y));
      } else if (p.type === "over") {
        setHoverDevice(deviceAt(p.position.x, p.position.y));
      } else if (p.type === "leave") {
        setDragging(false);
        setHoverDevice(null);
      } else if (p.type === "drop") {
        setDragging(false);
        setHoverDevice(null);
        if (p.paths.length === 0) return;
        const target = deviceAt(p.position.x, p.position.y);
        const peer = peersRef.current.find((x) => x.device_id === target);
        if (peer) {
          if (peer.connected) sendFiles(p.paths, [peer.device_id]);
          else toast.error(t("share.deviceOffline", { defaultValue: "{{name}} is offline", name: peer.name }));
        } else {
          setPending(p.paths);
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  if (!status) {
    return <div className="text-sm text-text/60">{t("share.loading", "Loading…")}</div>;
  }

  if (!status.config.enabled || !status.in_group) {
    return (
      <SettingsGroup
        title={t("share.title", "Share files")}
        description={t(
          "share.setup",
          "Turn on sync and pair a device in the Clipboard section first. Shared files use the same encrypted connection.",
        )}
      >
        <div className="px-4 py-3 text-sm text-text/50">{t("share.noGroup", "No paired devices yet.")}</div>
      </SettingsGroup>
    );
  }

  const pick = async (deviceId?: string) => {
    const r = await commands.sharePickFiles();
    if (r.status !== "ok") return toast.error(r.error);
    if (r.data.length === 0) return;
    if (deviceId) sendFiles(r.data, [deviceId]);
    else setPending(r.data);
  };
  const openFolder = async (which: string, deviceId: string | null = null) => {
    const r = await commands.shareOpenFolder(which, deviceId);
    if (r.status !== "ok") toast.error(r.error);
  };
  const transfers = status.transfers.filter((x) => x.kind === "share");

  return (
    <div className="w-full space-y-8">
      <SettingsGroup
        title={t("share.title", "Share files")}
        description={t(
          "share.description",
          "Send files to your paired devices over the same end-to-end encrypted connection as clipboard sync. Drop files on a device, or anywhere here to choose several.",
        )}
      >
        <div className="px-4 py-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => pick()}>
            <span className="inline-flex items-center gap-1.5">
              <FileUp className="w-3.5 h-3.5" />
              {t("share.shareFiles", "Share files…")}
            </span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => openFolder("received")}>
            <span className="inline-flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5" />
              {t("share.openReceived", "Received files")}
            </span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openFolder("root")}>
            <span className="inline-flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5" />
              {t("share.openStorage", "Storage folder")}
            </span>
          </Button>
        </div>
        <div
          className={`mx-4 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg transition-colors ${dragging && !hoverDevice ? "outline-2 outline-dashed outline-background-ui/60 outline-offset-4" : ""}`}
        >
          {status.peers.length === 0 && (
            <div className="text-sm text-text/50">{t("share.noPeers", "No paired devices yet.")}</div>
          )}
          {status.peers.map((p) => (
            <div
              key={p.device_id}
              data-share-device={p.device_id}
              className={`rounded-lg border p-3 space-y-2 transition-colors ${
                hoverDevice === p.device_id
                  ? p.connected
                    ? "border-background-ui bg-background-ui/15"
                    : "border-red-500/60 bg-red-500/10"
                  : "border-mid-gray/30 bg-mid-gray/5"
              } ${p.connected ? "" : "opacity-60"}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Laptop className="w-4 h-4 text-text/50 shrink-0" />
                <span className="text-sm font-medium truncate flex-1">{p.name}</span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${p.connected ? "bg-green-500" : "bg-mid-gray/50"}`} />
                <span className="text-xs text-text/50">
                  {p.connected ? p.via.join(" + ") : t("share.offline", "offline")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={!p.connected} onClick={() => pick(p.device_id)}>
                  <span className="inline-flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    {t("share.sendFiles", "Send files")}
                  </span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title={t("share.outboxHint", "Files you put in this folder are sent to this device when it's online")}
                  onClick={() => openFolder("outbox", p.device_id)}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
              </div>
              {hoverDevice === p.device_id && (
                <div className="text-xs text-text/70">
                  {p.connected
                    ? t("share.dropToSend", { defaultValue: "Drop to send to {{name}}", name: p.name })
                    : t("share.deviceOffline", { defaultValue: "{{name}} is offline", name: p.name })}
                </div>
              )}
            </div>
          ))}
        </div>
      </SettingsGroup>

      {transfers.length > 0 && (
        <SettingsGroup title={t("share.transfers", "Transfers")}>
          {transfers.map((tr) => {
            const pct = tr.total > 0 ? (tr.received / tr.total) * 100 : 0;
            return (
              <div key={tr.id + tr.direction} className="px-4 py-2 text-xs text-text/70">
                <div className="flex items-center gap-1.5">
                  {tr.direction === "out" ? (
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  ) : (
                    <ArrowDownLeft className="w-3.5 h-3.5" />
                  )}
                  <span className="truncate flex-1">
                    {tr.summary} · {tr.direction === "out" ? "→" : "←"} {tr.peer}
                  </span>
                  <span className="tabular-nums">
                    {formatBytes(tr.received)} / {formatBytes(tr.total)} · {Math.round(pct)}%
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

      <SettingsGroup title={t("share.recent", "Recent")}>
        {status.shares.length === 0 ? (
          <div className="px-4 py-3 text-sm text-text/50">{t("share.nothingYet", "Nothing shared yet.")}</div>
        ) : (
          <>
            {status.shares.map((s) => (
              <div key={s.id + s.direction} className="px-4 py-2 flex items-center gap-2 text-sm">
                {s.direction === "sent" ? (
                  <ArrowUpRight className="w-4 h-4 text-text/50 shrink-0" />
                ) : (
                  <ArrowDownLeft className="w-4 h-4 text-green-500 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate" title={s.files.join("\n")}>
                    {s.summary}
                  </div>
                  <div className="text-xs text-text/50 truncate" title={s.error ?? undefined}>
                    {s.direction === "sent"
                      ? `${t("share.to", "To")} ${s.peers.join(", ")} · ${shareState(s, t)}`
                      : `${t("share.from", "From")} ${s.peers[0] ?? ""}`}
                    {" · "}
                    {new Date(s.at_ms).toLocaleTimeString()}
                  </div>
                </div>
                {s.direction === "received" && (
                  <Button size="sm" variant="ghost" onClick={() => openFolder("received")}>
                    <FolderOpen className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
            <div className="px-4 py-2">
              <Button size="sm" variant="ghost" onClick={() => run(() => commands.shareClearHistory())}>
                {t("share.clear", "Clear list")}
              </Button>
            </div>
          </>
        )}
      </SettingsGroup>

      <SettingsGroup
        title={t("share.storage", "Storage folder")}
        description={t(
          "share.storageDesc",
          "Put files in \"Send to <device>\" (or \"Send to everyone\") and Babbl sends them automatically once that device is online, then moves them to \"Sent\". Received files go to \"Received/<device>\".",
        )}
      >
        <div className="px-4 py-3 flex items-center gap-2 text-xs text-text/60">
          <code className="break-all flex-1">{status.storage_dir}</code>
          <Button size="sm" variant="ghost" onClick={() => openFolder("outbox", null)}>
            {t("share.openEveryone", "Send to everyone")}
          </Button>
        </div>
      </SettingsGroup>

      <RecipientModal paths={pending} peers={status.peers} onClose={() => setPending(null)} />
    </div>
  );
};

/** Human-readable delivery state of a sent share. */
function shareState(s: SyncStatus["shares"][number], t: (k: string, d: string) => string) {
  switch (s.state) {
    case "sending":
      return t("share.stateSending", "sending…");
    case "delivered":
      return t("share.stateDelivered", "delivered");
    case "failed":
      return `${t("share.stateFailed", "failed")}${s.error ? `: ${s.error}` : ""}`;
    default:
      return s.delivered_to.length > 0
        ? `${t("share.stateDeliveredTo", "delivered to")} ${s.delivered_to.join(", ")}`
        : t("share.stateSent", "sent");
  }
}
