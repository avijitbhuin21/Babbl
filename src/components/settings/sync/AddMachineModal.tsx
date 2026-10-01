import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Laptop, Link2, Wifi, X } from "lucide-react";
import { commands, type SyncConfig, type SyncStatus, type Result } from "@/bindings";
import { Modal } from "../../ui/Modal";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { InfoTip } from "../../ui/InfoTip";
import { CopyValue, JoinForm, Panel, StateBadge, useCountdown } from "./parts";

type Run = (action: () => Promise<Result<SyncStatus, string>>) => Promise<boolean>;

/** Shows this machine's PIN (and optional invite code / URL) so another machine can join it. */
function InvitePanel({ status, run, extra }: { status: SyncStatus; run: Run; extra?: React.ReactNode }) {
  const { t } = useTranslation();
  const countdown = useCountdown(status.pairing?.expires_ms ?? null);
  return (
    <Panel
      title={t("sync.add.inviteTitle", "Let another machine join this one")}
      hint={t(
        "sync.add.inviteHint",
        "Show a PIN here, then enter it on the other machine. It expires after 5 minutes.",
      )}
    >
      {extra}
      {status.pairing ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-background-ui/10 border border-background-ui/30 px-3 py-2">
          <div>
            <div className="text-xs text-text/60">
              {t("sync.add.pinLabel", "PIN")} · {countdown}
            </div>
            <div className="text-2xl font-bold tracking-[0.3em] tabular-nums">{status.pairing.pin}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => run(() => commands.clipboardSyncStopPairing())}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <Button size="sm" onClick={() => run(() => commands.clipboardSyncStartPairing())}>
          {t("sync.add.showPin", "Show PIN")}
        </Button>
      )}
    </Panel>
  );
}

/** Warns that joining moves this machine into the other machine's group. */
function GroupNote({ status }: { status: SyncStatus }) {
  const { t } = useTranslation();
  if (!status.in_group || status.peers.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs rounded-md border border-amber-400/40 bg-amber-400/10 text-text/80 px-3 py-1.5">
      {t("sync.add.groupShort", {
        defaultValue: "Already connected to {{count}} machine(s)",
        count: status.peers.length,
      })}
      <InfoTip
        position="bottom"
        text={t(
          "sync.add.groupNote",
          "To add another machine, show a PIN here and enter it on the new machine. Joining a different machine instead moves this one into that machine's group and drops its current connections.",
        )}
      />
    </div>
  );
}

function LocalTab({ status, run, update }: { status: SyncStatus; run: Run; update: (p: Partial<SyncConfig>) => void }) {
  const { t } = useTranslation();
  const [pairingWith, setPairingWith] = useState<string | null>(null);
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const modeClass = (active: boolean) =>
    `px-3 py-1 text-xs rounded cursor-pointer transition-colors ${
      active ? "bg-background-ui text-white" : "text-text/70 hover:bg-mid-gray/15"
    }`;
  const c = status.config;

  if (!c.lan) {
    return (
      <Panel
        title={t("sync.add.lanOff", "Local network is off")}
        hint={t("sync.add.lanOffHint", "Find machines on the same Wi-Fi or wired network. Windows may ask to allow network access.")}
      >
        <Button size="sm" onClick={() => update({ lan: true })}>
          {t("sync.add.lanOn", "Turn on local network")}
        </Button>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-text/60">
        <Wifi className="w-3.5 h-3.5" />
        <StateBadge state={status.lan.state} detail={status.lan.detail} />
        {status.lan.detail && <span className="text-red-400">{status.lan.detail}</span>}
      </div>

      <InvitePanel
        status={status}
        run={run}
        extra={
          <div className="space-y-1">
            <div className="text-xs text-text/60">{t("sync.add.thisAddress", "This machine's address")}</div>
            {status.lan_addresses.length === 0 ? (
              <div className="text-xs text-text/50">{t("sync.add.noAddress", "Starting…")}</div>
            ) : (
              status.lan_addresses.map((a) => <CopyValue key={a} value={a} />)
            )}
          </div>
        }
      />

      <Panel
        title={t("sync.add.joinTitle", "Join another machine")}
        hint={t(
          "sync.add.joinLanHint",
          "Scan finds Babbl on your network. If the other machine doesn't show up, switch to Manual and type the address it shows under \"Let another machine join\", plus its PIN.",
        )}
      >
        <GroupNote status={status} />
        <div className="flex gap-1 p-0.5 rounded-md bg-mid-gray/10 w-fit">
          <button type="button" className={modeClass(mode === "scan")} onClick={() => setMode("scan")}>
            {t("sync.add.scan", "Scan")}
          </button>
          <button type="button" className={modeClass(mode === "manual")} onClick={() => setMode("manual")}>
            {t("sync.add.manual", "Manual")}
          </button>
        </div>
        {mode === "scan" ? (
          <>
            {status.discovered.length === 0 ? (
              <div className="text-xs text-text/50">{t("sync.add.scanning", "Looking for Babbl on your network…")}</div>
            ) : (
              <div className="space-y-2">
                {status.discovered.map((d) => {
                  const peer = status.peers.find((p) => p.device_id === d.device_id);
                  return (
                    <div key={d.device_id} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 min-w-0 text-sm">
                          <Laptop className="w-4 h-4 text-text/50 shrink-0" />
                          <span className="truncate">{d.name}</span>
                          <span className="text-xs text-text/40">{d.address}</span>
                        </span>
                        {peer?.connected ? (
                          <span className="text-xs text-green-500">{t("sync.connected", "Connected")}</span>
                        ) : d.same_group ? (
                          <span className="text-xs text-text/50">{t("sync.add.paired", "Paired")}</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setPairingWith(pairingWith === d.device_id ? null : d.device_id)}
                          >
                            {t("sync.add.pair", "Pair")}
                          </Button>
                        )}
                      </div>
                      {pairingWith === d.device_id && (
                        <JoinForm method="lan" target={d.device_id} onDone={() => setPairingWith(null)} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-text/50">
              <button
                type="button"
                className="underline hover:text-text cursor-pointer"
                onClick={() => setMode("manual")}
              >
                {t("sync.add.notFound", "Can't find it? Enter it manually")}
              </button>
              <InfoTip
                position="bottom"
                text={t(
                  "sync.add.lanTrouble",
                  "Seen from one machine but not the other? The machine that can't see is usually blocking incoming traffic: set its network to Private in Windows settings and allow Babbl in Windows Firewall. Some routers also block discovery between Wi-Fi and wired devices; Manual still works.",
                )}
              />
            </div>
          </>
        ) : (
          <JoinForm method="url" placeholder="192.168.1.20:47821" />
        )}
      </Panel>
    </div>
  );
}

function RelayPane({ status, run, update }: { status: SyncStatus; run: Run; update: (p: Partial<SyncConfig>) => void }) {
  const { t } = useTranslation();
  const c = status.config;
  const [relayUrl, setRelayUrl] = useState(c.relay_url);
  const [showServer, setShowServer] = useState(false);

  if (!c.relay) {
    return (
      <Panel
        title={t("sync.add.relayOff", "Babbl relay")}
        hint={t(
          "sync.add.relayOffHint",
          "Connect machines on different networks through Babbl's relay server. Everything stays end-to-end encrypted; the relay only forwards scrambled data.",
        )}
      >
        <Button size="sm" onClick={() => update({ relay: true })}>
          {t("sync.add.relayOn", "Use Babbl relay")}
        </Button>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-text/60">
        <Globe className="w-3.5 h-3.5" />
        <StateBadge state={status.relay.state} detail={status.relay.detail} />
        {status.relay.detail && status.relay.state === "error" && (
          <span className="text-red-400">{status.relay.detail}</span>
        )}
      </div>
      <InvitePanel
        status={status}
        run={run}
        extra={
          status.pairing?.invite_code ? (
            <div className="space-y-1">
              <div className="text-xs text-text/60">{t("sync.add.inviteCode", "Invite code (enter it on the other machine)")}</div>
              <CopyValue value={status.pairing.invite_code} large />
            </div>
          ) : null
        }
      />
      <Panel
        title={t("sync.add.joinTitle", "Join another machine")}
        hint={t("sync.add.joinRelayHint", "Enter the invite code shown on the other machine.")}
      >
        <GroupNote status={status} />
        <JoinForm method="relay" />
      </Panel>
      <button
        type="button"
        className="text-xs text-text/50 hover:text-text cursor-pointer"
        onClick={() => setShowServer(!showServer)}
      >
        {showServer ? t("sync.add.hideServer", "Hide relay server") : t("sync.add.showServer", "Relay server…")}
      </button>
      {showServer && (
        <div className="flex items-center gap-2">
          <Input
            variant="compact"
            className="flex-1"
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
            onBlur={() => relayUrl !== c.relay_url && update({ relay_url: relayUrl })}
          />
          <Button size="sm" variant="ghost" onClick={() => update({ relay: false })}>
            {t("sync.add.relayStop", "Turn off")}
          </Button>
        </div>
      )}
    </div>
  );
}

function TunnelPane({ status, run, update }: { status: SyncStatus; run: Run; update: (p: Partial<SyncConfig>) => void }) {
  const { t } = useTranslation();
  const c = status.config;

  if (!c.tunnel) {
    return (
      <Panel
        title={t("sync.add.tunnelOff", "Cloudflare Tunnel")}
        hint={t(
          "sync.add.tunnelOffHint",
          "Give this machine a public https URL with Cloudflare's free tunnel (downloads cloudflared the first time). The URL changes each time Babbl restarts.",
        )}
      >
        <Button size="sm" onClick={() => update({ tunnel: true })}>
          {t("sync.add.tunnelOn", "Start tunnel")}
        </Button>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-text/60">
        <Link2 className="w-3.5 h-3.5" />
        <StateBadge state={status.tunnel.state} detail={status.tunnel.detail} />
        {!status.tunnel_url && status.tunnel.detail && <span>{status.tunnel.detail}</span>}
      </div>
      <InvitePanel
        status={status}
        run={run}
        extra={
          <div className="space-y-1">
            <div className="text-xs text-text/60">{t("sync.add.thisUrl", "This machine's URL")}</div>
            {status.tunnel_url ? (
              <CopyValue value={status.tunnel_url} />
            ) : (
              <div className="text-xs text-text/50">{t("sync.add.waitingUrl", "Waiting for the tunnel…")}</div>
            )}
          </div>
        }
      />
      <Panel
        title={t("sync.add.joinTitle", "Join another machine")}
        hint={t(
          "sync.add.joinTunnelHint",
          "Enter the other machine's tunnel URL and the PIN it shows. Already paired? Leave the PIN empty to just reconnect.",
        )}
      >
        <GroupNote status={status} />
        <JoinForm method="url" placeholder="https://example.trycloudflare.com" pinOptional />
        {status.remote_urls.map((u) => (
          <div key={u.url} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${u.connected ? "bg-green-500" : "bg-mid-gray/50"}`} />
              <span className="truncate">{u.url}</span>
              {u.error && !u.connected && <span className="text-text/40 truncate">{`(${u.error})`}</span>}
            </span>
            <Button size="sm" variant="ghost" onClick={() => run(() => commands.clipboardSyncRemoveUrl(u.url))}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </Panel>
      <Button size="sm" variant="ghost" onClick={() => update({ tunnel: false })}>
        {t("sync.add.tunnelStop", "Stop tunnel")}
      </Button>
    </div>
  );
}

/** Dialog for connecting a new machine over the local network or the internet. */
export function AddMachineModal({
  open,
  onClose,
  status,
  run,
}: {
  open: boolean;
  onClose: () => void;
  status: SyncStatus;
  run: Run;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"local" | "internet">("local");
  const [method, setMethod] = useState<"relay" | "tunnel">("relay");
  const update = (patch: Partial<SyncConfig>) =>
    run(() => commands.clipboardSyncSetConfig({ ...status.config, ...patch }));

  const tabClass = (active: boolean) =>
    `flex-1 px-3 py-1.5 text-sm rounded-md cursor-pointer transition-colors ${
      active ? "bg-background-ui text-white" : "text-text/70 hover:bg-mid-gray/15"
    }`;

  return (
    <Modal isOpen={open} onClose={onClose} title={t("sync.add.title", "Add a machine")} wide>
      <div className="space-y-4">
        <div className="flex gap-1 p-1 rounded-lg bg-mid-gray/10">
          <button type="button" className={tabClass(tab === "local")} onClick={() => setTab("local")}>
            {t("sync.add.local", "Local network")}
          </button>
          <button type="button" className={tabClass(tab === "internet")} onClick={() => setTab("internet")}>
            {t("sync.add.internet", "Internet")}
          </button>
        </div>

        {tab === "local" ? (
          <LocalTab status={status} run={run} update={update} />
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              {(["relay", "tunnel"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-left cursor-pointer transition-colors ${
                    method === m ? "border-background-ui bg-background-ui/10" : "border-mid-gray/25 hover:bg-mid-gray/10"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {m === "relay" ? t("sync.add.relay", "Babbl relay") : t("sync.add.tunnel", "Cloudflare Tunnel")}
                    <InfoTip
                      position="bottom"
                      text={
                        m === "relay"
                          ? t("sync.add.relayShort", "Easiest. Machines on different networks pair with an invite code through Babbl's relay; data stays end-to-end encrypted.")
                          : t("sync.add.tunnelShort", "Gives this machine its own public URL through Cloudflare. The URL changes each time Babbl restarts.")
                      }
                    />
                  </div>
                </button>
              ))}
            </div>
            {method === "relay" ? (
              <RelayPane status={status} run={run} update={update} />
            ) : (
              <TunnelPane status={status} run={run} update={update} />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
