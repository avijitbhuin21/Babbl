import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Laptop, MonitorSmartphone, Plus, Send } from "lucide-react";
import { commands, type SyncConfig, type SyncStatus, type Result } from "@/bindings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { Dropdown } from "../../ui/Dropdown";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { useSyncStatus } from "../clipboard/useSyncStatus";
import { AddMachineModal } from "./AddMachineModal";
import { MachinePage } from "./MachinePage";

type Run = (action: () => Promise<Result<SyncStatus, string>>) => Promise<boolean>;
type Peer = SyncStatus["peers"][number];

/** "2 min ago" style label for a millisecond timestamp. */
function ago(ms: number, t: (k: string, o?: any) => string) {
  if (!ms) return t("sync.never", "never");
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return t("sync.justNow", "just now");
  if (mins < 60) return t("sync.minsAgo", { defaultValue: "{{count}} min ago", count: mins });
  const hours = Math.round(mins / 60);
  if (hours < 48) return t("sync.hoursAgo", { defaultValue: "{{count}} h ago", count: hours });
  return new Date(ms).toLocaleDateString();
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-surface/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium cursor-pointer"
      >
        {title}
        <ChevronDown className={`w-4 h-4 text-text/50 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="divide-y divide-border/30 border-t border-border/30">{children}</div>}
    </div>
  );
}

function ClipboardOptions({ status, run }: { status: SyncStatus; run: Run }) {
  const { t } = useTranslation();
  const c = status.config;
  const [maxMb, setMaxMb] = useState(String(c.max_file_mb));
  const [sending, setSending] = useState(false);
  useEffect(() => setMaxMb(String(c.max_file_mb)), [c.max_file_mb]);
  const update = (patch: Partial<SyncConfig>) => run(() => commands.clipboardSyncSetConfig({ ...c, ...patch }));
  const targets = status.peers.filter((p) => p.connected && p.clipboard).length;

  const sendNow = async () => {
    setSending(true);
    const r = await commands.clipboardSyncSendNow();
    setSending(false);
    if (r.status === "ok") toast.success(t("sync.sent", { defaultValue: "Sent: {{what}}", what: r.data }));
    else toast.error(r.error);
  };

  return (
    <Collapsible title={t("sync.clipboardOptions", "Clipboard options")}>
      <SettingContainer
        title={t("sync.mode", "When to sync")}
        description={t("sync.modeDesc", "Sync every copy automatically, or only when you press Send.")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped
      >
        <Dropdown
          className="min-w-[220px]"
          selectedValue={c.auto_send ? "auto" : "manual"}
          options={[
            { value: "auto", label: t("sync.modeAuto", "Every copy (automatic)") },
            { value: "manual", label: t("sync.modeManual", "Only when I choose") },
          ]}
          onSelect={(v) => update({ auto_send: v === "auto" })}
        />
      </SettingContainer>
      <SettingContainer
        title={t("sync.sendNow", "Send clipboard now")}
        description={t("sync.sendNowDesc", "Sends what's on your clipboard to the online machines with clipboard sync on. Also in the tray menu.")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped
      >
        <Button size="sm" onClick={sendNow} disabled={sending || targets === 0}>
          <span className="inline-flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5" />
            {targets === 0
              ? t("sync.noTargets", "No machine online")
              : t("sync.sendTo", { defaultValue: "Send to {{count}}", count: targets })}
          </span>
        </Button>
      </SettingContainer>
      <ToggleSwitch label={t("sync.text", "Text")} description={t("sync.textDesc", "Plain text you copy.")} checked={c.sync_text} onChange={(v) => update({ sync_text: v })} grouped />
      <ToggleSwitch label={t("sync.images", "Images")} description={t("sync.imagesDesc", "Screenshots and copied images (up to 10 MB).")} checked={c.sync_images} onChange={(v) => update({ sync_images: v })} grouped />
      <ToggleSwitch
        label={t("sync.copiedFiles", "Copied files")}
        description={t("sync.copiedFilesDesc", "Files copied in Explorer / Finder. Received ones go to Downloads/Babbl Clipboard.")}
        checked={c.sync_files}
        onChange={(v) => update({ sync_files: v })}
        grouped
      />
      <SettingContainer
        title={t("sync.maxSize", "Copied file size limit")}
        description={t("sync.maxSizeDesc", "Largest total size per copy (1–100 MB). Files you drop on a machine have no limit.")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped
      >
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={100}
            variant="compact"
            className="w-20"
            value={maxMb}
            onChange={(e) => setMaxMb(e.target.value)}
            onBlur={() => {
              const n = Math.min(100, Math.max(1, parseInt(maxMb, 10) || 50));
              setMaxMb(String(n));
              if (n !== c.max_file_mb) update({ max_file_mb: n });
            }}
          />
          <span className="text-sm text-text/70">{t("sync.mb", "MB")}</span>
        </div>
      </SettingContainer>
      {status.last_activity && (
        <div className="px-4 py-2 text-xs text-text/60">
          {`${t("sync.last", "Last")}: ${status.last_activity.direction} · ${status.last_activity.summary}${
            status.last_activity.peer ? ` · ${status.last_activity.peer}` : ""
          } · ${new Date(status.last_activity.at_ms).toLocaleTimeString()}`}
        </div>
      )}
    </Collapsible>
  );
}

function ConnectionSettings({ status, run }: { status: SyncStatus; run: Run }) {
  const { t } = useTranslation();
  const c = status.config;
  const update = (patch: Partial<SyncConfig>) => run(() => commands.clipboardSyncSetConfig({ ...c, ...patch }));
  return (
    <Collapsible title={t("sync.advanced", "Connection settings")}>
      <ToggleSwitch
        label={t("sync.lan", "Local network")}
        description={t("sync.lanDesc", "Find and connect to machines on the same network.")}
        checked={c.lan}
        onChange={(v) => update({ lan: v })}
        grouped
      />
      <ToggleSwitch
        label={t("sync.relay", "Babbl relay")}
        description={t("sync.relayDesc", "Connect over the internet through the relay server.")}
        checked={c.relay}
        onChange={(v) => update({ relay: v })}
        grouped
      />
      <ToggleSwitch
        label={t("sync.tunnel", "Cloudflare Tunnel")}
        description={t("sync.tunnelDesc", "Give this machine a public URL (changes when Babbl restarts).")}
        checked={c.tunnel}
        onChange={(v) => update({ tunnel: v })}
        grouped
      />
      {status.in_group && (
        <div className="px-4 py-3">
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (window.confirm(t("sync.leaveConfirm", "Disconnect from all machines? This machine stops syncing until you add a machine again.")))
                run(() => commands.clipboardSyncLeaveGroup());
            }}
          >
            {t("sync.leave", "Disconnect from all machines")}
          </Button>
        </div>
      )}
    </Collapsible>
  );
}

function MachineCard({ peer, sharedCount, onOpen }: { peer: Peer; sharedCount: number; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-lg border border-mid-gray/25 bg-mid-gray/5 hover:border-background-ui/60 hover:bg-background-ui/5 p-3 flex items-center gap-3 cursor-pointer transition-colors"
    >
      <Laptop className="w-6 h-6 text-text/50 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{peer.name}</div>
        <div className="flex items-center gap-1.5 text-xs text-text/50">
          <span className={`w-2 h-2 rounded-full ${peer.connected ? "bg-green-500" : "bg-mid-gray/50"}`} />
          {peer.connected
            ? `${t("sync.online", "Online")} · ${peer.via.join(" + ")}`
            : `${t("sync.offline", "Offline")} · ${ago(peer.last_seen_ms, t)}`}
        </div>
        {sharedCount > 0 && (
          <div className="text-xs text-text/40 mt-0.5">
            {t("sync.sharedCount", { defaultValue: "{{count}} shared file(s)", count: sharedCount })}
          </div>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-text/40 shrink-0" />
    </button>
  );
}

export const SyncSettings: React.FC = () => {
  const { t } = useTranslation();
  const { status, run } = useSyncStatus();
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  useEffect(() => {
    if (status) setDeviceName(status.device_name);
  }, [status?.device_name]);

  if (!status) return <div className="text-sm text-text/60">{t("sync.loading", "Loading…")}</div>;
  const c = status.config;
  const open = openId ? status.peers.find((p) => p.device_id === openId) : undefined;

  if (c.enabled && open) {
    return <MachinePage peer={open} status={status} run={run} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="w-full space-y-6">
      <SettingsGroup>
        <ToggleSwitch
          label={t("sync.enable", "Sync with other machines")}
          description={t(
            "sync.enableDesc",
            "Share your clipboard and files between your computers. Everything is end-to-end encrypted between paired machines.",
          )}
          checked={c.enabled}
          onChange={(enabled) => run(() => commands.clipboardSyncSetConfig({ ...c, enabled }))}
          grouped
        />
        {c.enabled && (
          <SettingContainer
            title={t("sync.thisMachine", "This machine's name")}
            description={t("sync.thisMachineDesc", "How this computer appears on your other machines.")}
            descriptionMode="tooltip"
            layout="horizontal"
            grouped
          >
            <Input
              variant="compact"
              className="min-w-[200px]"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              onBlur={() =>
                deviceName.trim() &&
                deviceName !== status.device_name &&
                run(() => commands.clipboardSyncSetDeviceName(deviceName))
              }
            />
          </SettingContainer>
        )}
      </SettingsGroup>

      {c.enabled && (
        <>
          <div className="space-y-3">
            <ClipboardOptions status={status} run={run} />
            <ConnectionSettings status={status} run={run} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-semibold text-text/50 uppercase tracking-wider">
                {t("sync.machines", "Machines")}
              </h2>
              {status.peers.length > 0 && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <span className="inline-flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" />
                    {t("sync.addMachine", "Add machine")}
                  </span>
                </Button>
              )}
            </div>
            {status.peers.length === 0 ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full rounded-xl border-2 border-dashed border-mid-gray/30 hover:border-background-ui/60 hover:bg-background-ui/5 py-10 flex flex-col items-center gap-2 cursor-pointer transition-colors"
              >
                <MonitorSmartphone className="w-8 h-8 text-text/40" />
                <span className="text-sm font-medium">{t("sync.addFirst", "Add a new machine")}</span>
                <span className="text-xs text-text/50">
                  {t("sync.addFirstHint", "Pair another computer on your network or over the internet.")}
                </span>
              </button>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {status.peers.map((p) => (
                  <MachineCard
                    key={p.device_id}
                    peer={p}
                    sharedCount={status.shares
                      .filter((s) => s.peer_ids.includes(p.device_id))
                      .reduce((n, s) => n + s.files.length, 0)}
                    onOpen={() => setOpenId(p.device_id)}
                  />
                ))}
              </div>
            )}
          </div>
          <AddMachineModal open={adding} onClose={() => setAdding(false)} status={status} run={run} />
        </>
      )}
    </div>
  );
};

export default SyncSettings;
