/**
 * Security settings — encryption, MFA, backup configuration.
 */

import { useCallback, useState } from "react";
import { useOutletContext } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AionimaConfig } from "../types.js";

interface SettingsContext {
  configHook: {
    data: AionimaConfig | null;
    saving: boolean;
    saveMessage: string | null;
    save: (config: AionimaConfig) => Promise<unknown>;
  };
}

export default function SecuritySettingsPage() {
  const { configHook } = useOutletContext<SettingsContext>();
  const config = configHook.data;
  const [draft, setDraft] = useState<AionimaConfig | null>(null);
  const [dirty, setDirty] = useState(false);

  const current = draft ?? config;
  if (!current) return null;

  const compliance = (current as Record<string, unknown>).compliance as { encryptionAtRest?: boolean; encryptionKey?: string; requireMfa?: boolean } | undefined;
  const backup = (current as Record<string, unknown>).backup as { enabled?: boolean; retentionDays?: number } | undefined;
  const logging = (current as Record<string, unknown>).logging as { retentionDays?: number; hotRetentionDays?: number } | undefined;

  const update = useCallback((fn: (prev: AionimaConfig) => AionimaConfig) => {
    setDraft((prev) => {
      const base = prev ?? config;
      if (!base) return null;
      const next = fn(base);
      setDirty(true);
      return next;
    });
  }, [config]);

  const setNested = useCallback((path: string, value: unknown) => {
    update((prev) => {
      const result = { ...prev } as Record<string, unknown>;
      const parts = path.split(".");
      let cur = result;
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]!] = { ...(cur[parts[i]!] as Record<string, unknown>) };
        cur = cur[parts[i]!] as Record<string, unknown>;
      }
      cur[parts[parts.length - 1]!] = value;
      return result as AionimaConfig;
    });
  }, [update]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    await configHook.save(draft);
    setDirty(false);
  }, [draft, configHook]);

  return (
    <div className="space-y-6">
      {/* Encryption at Rest */}
      <div className="rounded-xl bg-card border border-border p-4">
        <h3 className="text-[14px] font-bold text-foreground mb-1">Encryption at Rest</h3>
        <p className="text-[12px] text-muted-foreground mb-3">
          Encrypt sensitive entity data (PII/PHI) in the database using AES-256-GCM. Required for HIPAA and PCI DSS compliance.
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-foreground">Enable encryption</span>
            <button
              type="button"
              onClick={() => setNested("compliance.encryptionAtRest", !compliance?.encryptionAtRest)}
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                compliance?.encryptionAtRest ? "bg-green" : "bg-surface1",
              )}
            >
              <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform", compliance?.encryptionAtRest ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>
          {compliance?.encryptionAtRest && (
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Encryption Key</label>
              <Input
                type="password"
                value={compliance.encryptionKey ?? ""}
                onChange={(e) => setNested("compliance.encryptionKey", e.target.value)}
                placeholder="64-character hex key (openssl rand -hex 32)"
                className="font-mono text-[12px]"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Use $ENV{"{ENCRYPTION_KEY}"} to reference an environment variable.</p>
            </div>
          )}
        </div>
      </div>

      {/* MFA */}
      <div className="rounded-xl bg-card border border-border p-4">
        <h3 className="text-[14px] font-bold text-foreground mb-1">Multi-Factor Authentication</h3>
        <p className="text-[12px] text-muted-foreground mb-3">
          Require TOTP-based two-factor authentication for dashboard access. Required for PCI DSS and recommended for SOC 2.
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-foreground">Require MFA</span>
          <button
            type="button"
            onClick={() => setNested("compliance.requireMfa", !compliance?.requireMfa)}
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
              compliance?.requireMfa ? "bg-green" : "bg-surface1",
            )}
          >
            <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform", compliance?.requireMfa ? "translate-x-4" : "translate-x-0.5")} />
          </button>
        </div>
      </div>

      {/* Backups */}
      <div className="rounded-xl bg-card border border-border p-4">
        <h3 className="text-[14px] font-bold text-foreground mb-1">Automated Backups</h3>
        <p className="text-[12px] text-muted-foreground mb-3">
          Daily database backups with configurable retention. Required for GDPR Art 32 (restore capability) and SOC 2 availability.
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-foreground">Enable backups</span>
            <button
              type="button"
              onClick={() => setNested("backup.enabled", !(backup?.enabled !== false))}
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                (backup?.enabled !== false) ? "bg-green" : "bg-surface1",
              )}
            >
              <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform", (backup?.enabled !== false) ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Retention (days)</label>
            <Input
              type="number"
              value={backup?.retentionDays ?? 30}
              onChange={(e) => setNested("backup.retentionDays", Number(e.target.value))}
              className="w-32 text-[13px]"
            />
          </div>
        </div>
      </div>

      {/* Log Retention */}
      <div className="rounded-xl bg-card border border-border p-4">
        <h3 className="text-[14px] font-bold text-foreground mb-1">Audit Log Retention</h3>
        <p className="text-[12px] text-muted-foreground mb-3">
          PCI DSS requires 12 months total retention with 3 months immediately available.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Total retention (days)</label>
            <Input
              type="number"
              value={logging?.retentionDays ?? 365}
              onChange={(e) => setNested("logging.retentionDays", Number(e.target.value))}
              className="text-[13px]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Hot retention (days)</label>
            <Input
              type="number"
              value={logging?.hotRetentionDays ?? 90}
              onChange={(e) => setNested("logging.hotRetentionDays", Number(e.target.value))}
              className="text-[13px]"
            />
          </div>
        </div>
      </div>

      {/* Save bar */}
      {dirty && (
        <div className="sticky bottom-4 rounded-xl bg-card border border-border p-3 flex items-center justify-between shadow-lg">
          <span className="text-sm text-yellow font-semibold">Unsaved changes</span>
          <Button size="sm" onClick={() => void handleSave()} disabled={configHook.saving}>
            {configHook.saving ? "Saving..." : "Save"}
          </Button>
        </div>
      )}
      {configHook.saveMessage && !dirty && (
        <div className="text-sm text-green">{configHook.saveMessage}</div>
      )}
    </div>
  );
}
