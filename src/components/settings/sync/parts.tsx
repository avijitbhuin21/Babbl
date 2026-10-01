import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { commands } from "@/bindings";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { InfoTip } from "../../ui/InfoTip";

/** Coloured dot plus state word for a sync service (LAN, relay, tunnel). */
export function StateBadge({ state, detail }: { state: string; detail?: string | null }) {
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

/** Small icon button that copies `value` to the clipboard. */
export function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="p-1 rounded hover:bg-background-ui/15 text-text/60 hover:text-text cursor-pointer"
      title={t("sync.copy", "Copy")}
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast.success(t("sync.copied", "Copied"));
      }}
    >
      <Copy className="w-3.5 h-3.5" />
    </button>
  );
}

/** A value shown in monospace with a copy button, e.g. an address, URL or invite code. */
export function CopyValue({ value, large = false }: { value: string; large?: boolean }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <code className={`break-all ${large ? "text-lg font-semibold tracking-wide" : "text-sm"}`}>{value}</code>
      <CopyButton value={value} />
    </div>
  );
}

/** Live "m:ss" countdown to `targetMs`, or null when there is no target. */
export function useCountdown(targetMs: number | null) {
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

/** "PIN + Connect" form for joining a LAN device, an address/URL, or a relay invite code. */
export function JoinForm({
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
        if (r.status === "ok") toast.success(t("sync.urlAdded", "Address saved, connecting…"));
        else toast.error(r.error);
      } else {
        const r = await commands.clipboardSyncJoin(method, tgt, code);
        if (r.status === "ok") {
          toast.success(t("sync.paired", { defaultValue: "Connected to {{name}}", name: r.data }));
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
          className="flex-1 min-w-[200px]"
          placeholder={placeholder}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      )}
      <Input
        variant="compact"
        className={method === "relay" ? "flex-1 min-w-[200px] tracking-widest uppercase" : "w-32 tracking-widest"}
        placeholder={
          method === "relay"
            ? "ABC234-123456"
            : pinOptional
              ? t("sync.pinOptional", "PIN (optional)")
              : t("sync.pin", "PIN")
        }
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <Button
        size="sm"
        onClick={submit}
        disabled={busy || (needsAddress && !address.trim()) || (!pinOptional && !code.trim())}
      >
        {busy ? t("sync.connecting", "Connecting…") : t("sync.connect", "Connect")}
      </Button>
    </div>
  );
}

/** Rounded panel used to group one step inside the Add machine dialog; `hint` sits behind an "i". */
export function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-mid-gray/25 p-3 space-y-2.5">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {title}
        {hint && <InfoTip text={hint} position="bottom" />}
      </div>
      {children}
    </div>
  );
}
