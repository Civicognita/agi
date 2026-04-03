/**
 * RustDeskConnectionSection — displays RustDesk connection info (readonly).
 */

import { useCallback, useEffect, useState } from "react";
import { fetchRustDeskConnectionInfo } from "../../api.js";
import type { RustDeskConnectionInfo } from "../../types.js";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [value]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="px-2 py-0.5 text-[11px] rounded bg-surface1 hover:bg-surface2 text-muted-foreground transition-colors cursor-pointer border-none"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

interface InfoRowProps {
  label: string;
  value: string;
  copyable?: boolean;
  mono?: boolean;
}

function InfoRow({ label, value, copyable, mono = true }: InfoRowProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-sm text-foreground ${mono ? "font-mono" : ""}`}>{value}</span>
        {copyable && <CopyButton value={value} />}
      </div>
    </div>
  );
}

export function RustDeskConnectionSection() {
  const [info, setInfo] = useState<RustDeskConnectionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRustDeskConnectionInfo()
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  if (error) {
    return <div className="text-sm text-red">{error}</div>;
  }

  if (!info) {
    return <div className="text-sm text-muted-foreground">Loading connection info...</div>;
  }

  return (
    <div>
      <InfoRow label="Server IP" value={info.serverIp} copyable />
      <InfoRow label="Public Key" value={info.publicKey} copyable />
      <InfoRow label="Client ID" value={info.clientId} copyable />
      <InfoRow label="Ports" value={info.ports.join(", ")} />
    </div>
  );
}
