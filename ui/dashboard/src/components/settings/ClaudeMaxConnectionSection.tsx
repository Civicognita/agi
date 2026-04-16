/**
 * ClaudeMaxConnectionSection — custom settings section for the Claude Max
 * provider plugin. Shows connection status + connect/disconnect buttons.
 * No text boxes, no manual config. Mirrors the Cloudflare tunnel auth UX.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface ClaudeMaxStatus {
  connected: boolean;
  expired?: boolean;
  subscriptionType?: string;
  rateLimitTier?: string;
  expiresAt?: number;
  expiresInHours?: number;
  scopes?: string[];
}

export function ClaudeMaxConnectionSection() {
  const [status, setStatus] = useState<ClaudeMaxStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/providers/claude-max/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json() as ClaudeMaxStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Poll while connecting
  useEffect(() => {
    if (!connecting) return;
    const interval = setInterval(() => {
      void loadStatus().then(() => {
        // Stop polling when connected
        if (status?.connected) {
          setConnecting(false);
        }
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [connecting, loadStatus, status?.connected]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/providers/claude-max/connect", { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : "Connection failed");
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/providers/claude-max/disconnect", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }, [loadStatus]);

  if (error && !status) {
    return <div className="text-sm text-red">{error}</div>;
  }

  if (!status) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  if (!status.connected) {
    return (
      <div className="space-y-4">
        {status.expired && (
          <div className="px-3 py-2 rounded-md bg-yellow/10 border border-yellow/30 text-[12px] text-yellow">
            OAuth token expired. Reconnect to refresh it.
          </div>
        )}
        <p className="text-[13px] text-muted-foreground">
          Use your Claude Max subscription to power Aion instead of API credits.
          Clicking connect will open the Anthropic authentication page in your browser.
        </p>
        <Button
          onClick={() => void handleConnect()}
          disabled={connecting}
          className="w-full"
        >
          {connecting ? "Waiting for authentication..." : "Connect to Claude Max"}
        </Button>
        {connecting && (
          <p className="text-[11px] text-muted-foreground text-center">
            Complete the login in the browser window that opened. This page will update automatically.
          </p>
        )}
        {error && <div className="text-[12px] text-red">{error}</div>}
      </div>
    );
  }

  // Connected state
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-green" />
        <span className="text-[13px] font-medium text-green">Connected</span>
      </div>

      <div className="space-y-1">
        <InfoRow label="Subscription" value={status.subscriptionType ?? "unknown"} />
        <InfoRow label="Rate Limit Tier" value={status.rateLimitTier ?? "unknown"} />
        <InfoRow label="Token Expires" value={status.expiresInHours !== undefined ? `~${String(status.expiresInHours)} hours` : "unknown"} />
        {status.scopes && status.scopes.length > 0 && (
          <InfoRow label="Scopes" value={status.scopes.join(", ")} />
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Set the LLM Provider to "Claude Max" in Gateway settings to use this connection. The token refreshes automatically when Claude Code is running.
      </p>

      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleDisconnect()}
        disabled={disconnecting}
        className="text-red border-red/30 hover:bg-red/10"
      >
        {disconnecting ? "Disconnecting..." : "Disconnect"}
      </Button>

      {error && <div className="text-[12px] text-red mt-2">{error}</div>}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-b-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[12px] text-foreground font-mono">{value}</span>
    </div>
  );
}
