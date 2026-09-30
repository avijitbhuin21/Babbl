import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, Link2, Wifi, Globe, Laptop, Send, X } from "lucide-react";
import { commands, type SyncConfig } from "@/bindings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { Dropdown } from "../../ui/Dropdown";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { useSyncStatus } from "./useSyncStatus";

function StateBadge({ state, detail }: { state: string; detail?: string | null }) {
  const color =
    state === "running"
      ? "bg-green-500"
      : state === "error"
        ? "bg-red-500"
        : state === "off"
          ? "bg-mid-gray/50"
          : "bg-amber-400 animate-pulse";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text/60" title={detail ?? undefined}>
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {state}
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      className="p-1 rounded hover:bg-background-ui/15 text-text/60 hover:text-text cursor-pointer"
      title="Copy"
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast.success("Copied");
      }}
    >
      <Copy className="w-3.5 h-3.5" />
    </button>
  );
}

function useCountdown(targetMs: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!targetMs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  if (!targetMs) return null;
  const left = Math.max(0, Math.floor((targetMs - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

/** Inline "PIN + Connect" form used for LAN devices, addresses and URLs. */
function JoinForm({
  method,
  target,
  placeholder,
  pinOptional = false,
  onDone,
}: {
  method: "lan" | "url" | "relay";
  target?: string;
  placeholder?: string;
  pinOptional?: boolean;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const needsAddress = method === "url" && !target;

  const submit = async () => {
    const tgt = target ?? address;
    setBusy(true);
    try {
      if (method === "url" && pinOptional && !code.trim()) {
        const r = await commands.clipboardSyncAddUrl(tgt);
        if (r.status === "ok") toast.success(t("clipboard.urlAdded", "Device URL added"));
        else toast.error(r.error);
      } else {
        const r = await commands.clipboardSyncJoin(method, tgt, code);
        if (r.status === "ok") {
          toast.success(t("clipboard.paired", { defaultValue: "Paired with {{name}}", name: r.data }));
          setCode("");
          setAddress("");
          onDone?.();
        } else toast.error(r.error);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {needsAddress && (
        <Input
          variant="compact"
          className="flex-1 min-w-[220px]"
          placeholder={placeholder}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      )}
      <Input
        variant="compact"
        className={method === "relay" ? "flex-1 min-w-[220px] tracking-widest uppercase" : "w-28 tracking-widest"}
        placeholder={
          method === "relay"
            ? "ABC234-123456"
            : pinOptional
              ? t("clipboard.pinOptional", "PIN (optional)")
              : t("clipboard.pin", "PIN")
        }
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <Button size="sm" onClick={submit} disabled={busy || (needsAddress && !address.trim()) || (!pinOptional && !code.trim())}>
        {busy ? t("clipboard.connecting", "Connecting…") : t("clipboard.connect", "Connect")}
      </Button>
    </div>
  );
}

export const ClipboardSettings: React.FC = () => {
  const { t } = useTranslation();
  const { status, run } = useSyncStatus();
  const [deviceName, setDeviceName] = useState("");
  const [relayUrl, setRelayUrl] = useState("");
  const [maxMb, setMaxMb] = useState("50");
  const [pairingWith, setPairingWith] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const countdown = useCountdown(status?.pairing?.expires_ms ?? null);

  useEffect(() => {
    if (!status) return;
    setDeviceName(status.device_name);
    setRelayUrl(status.config.relay_url);
    setMaxMb(String(status.config.max_file_mb));
    // Only re-sync inputs when the saved values change, not on every status tick.
  }, [status?.device_name, status?.config.relay_url, status?.config.max_file_mb]);

  if (!status) {
    return <div className="text-sm text-text/60">{t("clipboard.loading", "Loading…")}</div>;
  }
  const c = status.config;
  const update = (patch: Partial<SyncConfig>) =>
    run(() => commands.clipboardSyncSetConfig({ ...c, ...patch }));

  const sendNow = async () => {
    setSending(true);
    const r = await commands.clipboardSyncSendNow();
    setSending(false);
    if (r.status === "ok") toast.success(t("clipboard.sent", { defaultValue: "Sent: {{what}}", what: r.data }));
    else toast.error(r.error);
  };

  const connectedCount = status.peers.filter((p) => p.connected && p.clipboard).length;

  return (
    <div className="w-full space-y-8">
      <SettingsGroup
        title={t("clipboard.title", "Clipboard sync")}
        description={t(
          "clipboard.description",
          "Copy on one computer, paste on another. Everything is end-to-end encrypted between your paired devices.",
        )}
      >
        <ToggleSwitch
          label={t("clipboard.enable", "Sync clipboard")}
          description={t("clipboard.enableDesc", "Share text, images and files you copy with your paired devices.")}
          checked={c.enabled}
          onChange={(enabled) => update({ enabled })}
          grouped
        />
        {c.enabled && (
          <>
            <SettingContainer
              title={t("clipboard.mode", "When to sync")}
              description={t("clipboard.modeDesc", "Sync every copy automatically, or only when you press Send.")}
              descriptionMode="tooltip"
              layout="horizontal"
              grouped
            >
              <Dropdown
                className="min-w-[220px]"
                selectedValue={c.auto_send ? "auto" : "manual"}
                options={[
                  { value: "auto", label: t("clipboard.modeAuto", "Every copy (automatic)") },
                  { value: "manual", label: t("clipboard.modeManual", "Only when I choose") },
                ]}
                onSelect={(v) => update({ auto_send: v === "auto" })}
              />
            </SettingContainer>
            <SettingContainer
              title={t("clipboard.sendNow", "Send clipboard now")}
              description={t(
                "clipboard.sendNowDesc",
                "Sends what's on your clipboard to the connected devices you sync with. Also available from the tray menu.",
              )}
              descriptionMode="tooltip"
              layout="horizontal"
              grouped
            >
              <Button size="sm" onClick={sendNow} disabled={sending || connectedCount === 0}>
                <span className="inline-flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" />
                  {connectedCount === 0
                    ? t("clipboard.noDevices", "No devices connected")
                    : t("clipboard.sendTo", { defaultValue: "Send to {{count}} device(s)", count: connectedCount })}
                </span>
              </Button>
            </SettingContainer>
            {status.last_activity && (
              <div className="px-4 py-2 text-xs text-text/60">
                {t("clipboard.last", "Last")}: {status.last_activity.direction} · {status.last_activity.summary}
                {status.last_activity.peer ? ` · ${status.last_activity.peer}` : ""} ·{" "}
                {new Date(status.last_activity.at_ms).toLocaleTimeString()}
              </div>
            )}
            {status.transfers.map((tr) => (
              <div key={tr.id} className="px-4 py-2 text-xs text-text/70">
                {t("clipboard.receiving", "Receiving")} {tr.summary} ·{" "}
                {tr.total > 0 ? Math.round((tr.received / tr.total) * 100) : 0}%
                <div className="mt-1 h-1 rounded bg-mid-gray/20 overflow-hidden">
                  <div
                    className="h-full bg-background-ui"
                    style={{ width: `${tr.total > 0 ? (tr.received / tr.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </>
        )}
      </SettingsGroup>

      {c.enabled && (
        <>
          <SettingsGroup title={t("clipboard.what", "What to sync")}>
            <ToggleSwitch label={t("clipboard.text", "Text")} description={t("clipboard.textDesc", "Plain text you copy.")} checked={c.sync_text} onChange={(v) => update({ sync_text: v })} grouped />
            <ToggleSwitch label={t("clipboard.images", "Images")} description={t("clipboard.imagesDesc", "Screenshots and copied images (up to 10 MB).")} checked={c.sync_images} onChange={(v) => update({ sync_images: v })} grouped />
            <ToggleSwitch label={t("clipboard.files", "Files")} description={t("clipboard.filesDesc", "Files copied in Explorer / Finder. Received files are saved to Downloads/Babbl Clipboard.")} checked={c.sync_files} onChange={(v) => update({ sync_files: v })} grouped />
            <SettingContainer
              title={t("clipboard.maxSize", "File size limit")}
              description={t("clipboard.maxSizeDesc", "Largest total size of files per copy (1–100 MB).")}
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
                <span className="text-sm text-text/70">MB</span>
              </div>
            </SettingContainer>
          </SettingsGroup>

          <SettingsGroup
            title={t("clipboard.thisDevice", "This device")}
            description={
              status.in_group
                ? t("clipboard.inGroup", "Paired. Devices you pair share one encrypted group.")
                : t("clipboard.noGroup", "Not paired yet. Click \"Pair a device\" here, then enter the PIN on the other device.")
            }
          >
            <SettingContainer title={t("clipboard.deviceName", "Device name")} description={t("clipboard.deviceNameDesc", "How this computer appears on your other devices.")} descriptionMode="tooltip" layout="horizontal" grouped>
              <Input
                variant="compact"
                className="min-w-[200px]"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                onBlur={() => deviceName.trim() && deviceName !== status.device_name && run(() => commands.clipboardSyncSetDeviceName(deviceName))}
              />
            </SettingContainer>
            <div className="px-4 py-3 space-y-3">
              {status.pairing ? (
                <div className="rounded-lg border border-background-ui/40 bg-background-ui/10 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text/60">
                      {t("clipboard.pinPrompt", "Enter this PIN on the other device")} · {countdown}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => run(() => commands.clipboardSyncStopPairing())}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="text-3xl font-bold tracking-[0.3em] tabular-nums">{status.pairing.pin}</div>
                  {status.pairing.invite_code && (
                    <div className="text-xs text-text/70 flex items-center gap-1">
                      {t("clipboard.inviteCode", "Internet invite code")}: <code className="font-semibold">{status.pairing.invite_code}</code>
                      <CopyButton value={status.pairing.invite_code} />
                    </div>
                  )}
                  {status.tunnel_url && (
                    <div className="text-xs text-text/70 flex items-center gap-1 break-all">
                      {t("clipboard.tunnelAddress", "Tunnel URL")}: <code>{status.tunnel_url}</code>
                      <CopyButton value={status.tunnel_url} />
                    </div>
                  )}
                </div>
              ) : (
                <Button size="sm" onClick={() => run(() => commands.clipboardSyncStartPairing())}>
                  {t("clipboard.pairDevice", "Pair a device")}
                </Button>
              )}
            </div>
          </SettingsGroup>

          <SettingsGroup
            title={t("clipboard.devices", "Paired devices")}
            description={t(
              "clipboard.devicesDesc",
              "Untick a device to stop syncing clipboards with it in both directions. File sharing (Share section) still works.",
            )}
          >
            {status.peers.length === 0 && (
              <div className="px-4 py-3 text-sm text-text/50">{t("clipboard.noPeers", "No paired devices yet.")}</div>
            )}
            {status.peers.map((p) => (
              <div key={p.device_id} className="px-4 py-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-background-ui cursor-pointer shrink-0"
                    title={t("clipboard.syncWith", "Sync clipboard with this device")}
                    checked={p.clipboard}
                    onChange={(e) => run(() => commands.clipboardSyncSetPeerClipboard(p.device_id, e.target.checked))}
                  />
                  <Laptop className="w-4 h-4 text-text/50 shrink-0" />
                  <span className="text-sm truncate">{p.name}</span>
                  <span className={`w-2 h-2 rounded-full ${p.connected ? "bg-green-500" : "bg-mid-gray/50"}`} />
                  <span className="text-xs text-text/50">
                    {p.connected ? p.via.join(" + ") : t("clipboard.offline", "offline")}
                  </span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => run(() => commands.clipboardSyncForgetDevice(p.device_id))}>
                  {t("clipboard.forget", "Forget")}
                </Button>
              </div>
            ))}
            {status.in_group && (
              <div className="px-4 py-3">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (window.confirm(t("clipboard.leaveConfirm", "Leave the sync group? This device stops syncing until you pair it again."))) {
                      run(() => commands.clipboardSyncLeaveGroup());
                    }
                  }}
                >
                  {t("clipboard.leave", "Leave group")}
                </Button>
              </div>
            )}
          </SettingsGroup>

          <SettingsGroup title={t("clipboard.lan", "Local network")}>
            <ToggleSwitch
              label={t("clipboard.lanEnable", "Sync over local network")}
              description={t("clipboard.lanEnableDesc", "Find other Babbl devices on the same Wi-Fi / LAN. Windows may ask to allow network access.")}
              checked={c.lan}
              onChange={(v) => update({ lan: v })}
              grouped
            />
            {c.lan && (
              <div className="px-4 py-3 space-y-3">
                <div className="flex items-center gap-2 text-xs text-text/60">
                  <Wifi className="w-3.5 h-3.5" />
                  <StateBadge state={status.lan.state} detail={status.lan.detail} />
                  {status.lan_port && <span>· port {status.lan_port}</span>}
                  {status.lan.detail && <span className="text-red-400">{status.lan.detail}</span>}
                </div>
                {status.discovered.length === 0 ? (
                  <div className="text-sm text-text/50">{t("clipboard.scanning", "Looking for Babbl devices on your network…")}</div>
                ) : (
                  status.discovered.map((d) => {
                    const connected = status.peers.some((p) => p.device_id === d.device_id && p.connected);
                    return (
                      <div key={d.device_id} className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm">
                            {d.name} <span className="text-xs text-text/40">{d.address}</span>
                          </span>
                          {connected ? (
                            <span className="text-xs text-green-500">{t("clipboard.connected", "Connected")}</span>
                          ) : d.same_group ? (
                            <span className="text-xs text-text/50">{t("clipboard.sameGroup", "In your group")}</span>
                          ) : (
                            <Button size="sm" variant="secondary" onClick={() => setPairingWith(pairingWith === d.device_id ? null : d.device_id)}>
                              {t("clipboard.pair", "Pair")}
                            </Button>
                          )}
                        </div>
                        {pairingWith === d.device_id && (
                          <JoinForm method="lan" target={d.device_id} onDone={() => setPairingWith(null)} />
                        )}
                      </div>
                    );
                  })
                )}
                <div className="pt-2 space-y-1">
                  <div className="text-xs text-text/60">{t("clipboard.addByAddress", "Not listed? Pair by address (IP of the other device):")}</div>
                  <JoinForm method="url" placeholder="192.168.1.20" />
                </div>
              </div>
            )}
          </SettingsGroup>

          <SettingsGroup
            title={t("clipboard.internet", "Internet")}
            description={t("clipboard.internetDesc", "Sync with devices on other networks. Data stays end-to-end encrypted.")}
          >
            <ToggleSwitch
              label={t("clipboard.relay", "Babbl relay")}
              description={t("clipboard.relayDesc", "Connect through a relay server (e.g. your Railway deployment). Works even when devices go offline and come back.")}
              checked={c.relay}
              onChange={(v) => update({ relay: v })}
              grouped
            />
            {c.relay && (
              <div className="px-4 py-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-text/60" />
                  <Input
                    variant="compact"
                    className="flex-1"
                    placeholder="https://relay-production-fea1.up.railway.app"
                    value={relayUrl}
                    onChange={(e) => setRelayUrl(e.target.value)}
                    onBlur={() => relayUrl !== c.relay_url && update({ relay_url: relayUrl })}
                  />
                  <StateBadge state={status.relay.state} detail={status.relay.detail} />
                </div>
                {status.relay.detail && status.relay.state === "error" && (
                  <div className="text-xs text-red-400">{status.relay.detail}</div>
                )}
                <div className="space-y-1">
                  <div className="text-xs text-text/60">{t("clipboard.joinInvite", "Join with an invite code from another device:")}</div>
                  <JoinForm method="relay" />
                </div>
              </div>
            )}
            <ToggleSwitch
              label={t("clipboard.tunnel", "Cloudflare Tunnel")}
              description={t("clipboard.tunnelDesc", "Give this device a public https URL (downloads Cloudflare's cloudflared on first use). The URL changes when Babbl restarts.")}
              checked={c.tunnel}
              onChange={(v) => update({ tunnel: v })}
              grouped
            />
            {c.tunnel && (
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-center gap-2 text-xs text-text/60">
                  <Link2 className="w-3.5 h-3.5" />
                  <StateBadge state={status.tunnel.state} detail={status.tunnel.detail} />
                  {status.tunnel_url ? (
                    <>
                      <code className="text-text/80 break-all">{status.tunnel_url}</code>
                      <CopyButton value={status.tunnel_url} />
                    </>
                  ) : (
                    status.tunnel.detail && <span>{status.tunnel.detail}</span>
                  )}
                </div>
              </div>
            )}
            <div className="px-4 py-3 space-y-2">
              <div className="text-xs text-text/60">
                {t("clipboard.connectUrl", "Connect to another device's tunnel URL (enter its PIN to pair; leave empty if already paired):")}
              </div>
              <JoinForm method="url" placeholder="https://example.trycloudflare.com" pinOptional />
              {status.remote_urls.map((u) => (
                <div key={u.url} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${u.connected ? "bg-green-500" : "bg-mid-gray/50"}`} />
                    <span className="truncate">{u.url}</span>
                    {u.error && !u.connected && <span className="text-text/40 truncate">({u.error})</span>}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => run(() => commands.clipboardSyncRemoveUrl(u.url))}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </SettingsGroup>
        </>
      )}
    </div>
  );
};

export default ClipboardSettings;
