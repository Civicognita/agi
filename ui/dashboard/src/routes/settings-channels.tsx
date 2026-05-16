/**
 * Settings → Channels route
 *
 * One tab per installed channel plugin (derived from discoveredPlugins, fully
 * plugin-driven — no hardcoded channel list). Each tab shows:
 *   - Connection status + start / stop / restart controls
 *   - Config form (fields derived from the plugin's getDefaults() template,
 *     populated with values from gateway.json)
 *   - Enabled toggle
 *
 * Config is persisted via PATCH /api/channels/:id/config → gateway.json.
 * Hot-reload applies without a gateway restart; a channel restart is offered
 * when the channel is currently running so new credentials take effect.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { DevNote } from "@/components/ui/dev-notes";
import {
  fetchChannels,
  fetchChannelDetail,
  fetchChannelConfig,
  updateChannelConfig,
  startChannel,
  stopChannel,
  restartChannel,
  type ChannelListEntry,
  type ChannelConfigResponse,
} from "@/api.js";
import type { ChannelDetail } from "@/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  if (status === "running") return "bg-emerald-500";
  if (status === "error") return "bg-red-500";
  if (status === "starting" || status === "stopping") return "bg-amber-400";
  return "bg-secondary";
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Derive a human label from a camelCase / snake_case config field name. */
function fieldLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Mask sensitive fields — show as password inputs. */
function isSensitive(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes("token") || k.includes("secret") || k.includes("password") || k.includes("key");
}

/** Strip trailing " Channel" suffix from plugin display name. */
function shortName(name: string): string {
  return name.replace(/\s+Channel$/i, "");
}

// ---------------------------------------------------------------------------
// ChannelTab — config + controls for one channel
// ---------------------------------------------------------------------------

interface ChannelTabProps {
  id: string;
  initialEnabled: boolean;
}

function ChannelTab({ id, initialEnabled }: ChannelTabProps) {
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [cfgResponse, setCfgResponse] = useState<ChannelConfigResponse | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [controlling, setControlling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [det, cfg] = await Promise.all([
        fetchChannelDetail(id),
        fetchChannelConfig(id),
      ]);
      setDetail(det);
      setCfgResponse(cfg);
      setEnabled(cfg.enabled);
      // Merge defaults with current values for form initialisation
      const merged: Record<string, string> = {};
      for (const key of Object.keys(cfg.defaults)) {
        const val = cfg.config[key];
        merged[key] = val !== undefined && val !== null ? String(val) : "";
      }
      // Also include any keys in current config not present in defaults
      for (const key of Object.keys(cfg.config)) {
        if (!(key in merged)) {
          const val = cfg.config[key];
          merged[key] = val !== undefined && val !== null ? String(val) : "";
        }
      }
      setForm(merged);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    loadData();
    pollRef.current = setInterval(() => {
      fetchChannelDetail(id).then(setDetail).catch(() => {});
    }, 5_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id, loadData]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const config: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) {
        config[k] = v;
      }
      await updateChannelConfig(id, { enabled, config });
      setSaveMsg("Saved.");
      if (detail?.status === "running") {
        await restartChannel(id);
        setSaveMsg("Saved and restarted.");
        loadData();
      }
    } catch (err) {
      setSaveMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleControl = async (action: "start" | "stop" | "restart") => {
    setControlling(true);
    try {
      if (action === "start") await startChannel(id);
      else if (action === "stop") await stopChannel(id);
      else await restartChannel(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setControlling(false);
    }
  };

  const currentStatus = detail?.status ?? "stopped";
  const fieldKeys = cfgResponse
    ? [...new Set([...Object.keys(cfgResponse.defaults), ...Object.keys(cfgResponse.config)])]
    : [];

  return (
    <div className="space-y-5">
      {/* Status + controls */}
      <Card className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${statusColor(currentStatus)}`} />
            <span className="text-[13px] font-medium">{statusLabel(currentStatus)}</span>
          </div>
          {detail?.error && (
            <span className="text-[12px] text-destructive truncate max-w-xs">{detail.error}</span>
          )}
          {error && (
            <span className="text-[12px] text-destructive truncate max-w-xs">{error}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => handleControl("start")}
              disabled={controlling || currentStatus === "running"}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Start
            </button>
            <button
              onClick={() => handleControl("stop")}
              disabled={controlling || currentStatus !== "running"}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-secondary text-foreground hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Stop
            </button>
            <button
              onClick={() => handleControl("restart")}
              disabled={controlling || currentStatus !== "running"}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-secondary text-foreground hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Restart
            </button>
          </div>
        </div>
      </Card>

      {/* Config form */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[13px] font-semibold text-foreground">Configuration</h3>
          {/* Enabled toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${enabled ? "bg-emerald-500" : "bg-secondary"}`}
              aria-label="Toggle channel enabled"
            >
              <span
                className={`absolute top-0.5 ${enabled ? "left-[18px] bg-white" : "left-0.5 bg-muted-foreground"} w-4 h-4 rounded-full transition-all`}
              />
            </button>
            <span className="text-[12px] text-muted-foreground">{enabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>

        {cfgResponse === null ? (
          <p className="text-[13px] text-muted-foreground">Loading configuration…</p>
        ) : fieldKeys.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No configuration fields for this channel.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {fieldKeys.map((key) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-[12px] font-medium text-muted-foreground">{fieldLabel(key)}</label>
                <input
                  type={isSensitive(key) ? "password" : "text"}
                  value={form[key] ?? ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  autoComplete="off"
                  className="h-8 px-3 rounded-lg border border-input bg-background text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder={isSensitive(key) ? "••••••••" : ""}
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saveMsg && (
            <span className={`text-[12px] ${saveMsg.startsWith("Error") ? "text-destructive" : "text-emerald-400"}`}>
              {saveMsg}
            </span>
          )}
          {currentStatus === "running" && !saveMsg && (
            <span className="text-[11px] text-muted-foreground">
              Saving will restart the channel to apply new credentials.
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsChannelsPage() {
  const [channels, setChannels] = useState<ChannelListEntry[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    fetchChannels()
      .then(setChannels)
      .catch((err) => setFetchError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Channel Settings</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Configure authentication and options for each communication channel plugin.
        </p>
      </div>

      <DevNote title="Channels">
        <DevNote.Item kind="info" heading="Cycle 223 — Settings page">
          Channels moved from the Comms hub to a dedicated settings page. Each installed
          channel plugin gets its own tab. Channel list is fully plugin-driven (no hardcoded
          IDs) — derived from discoveredPlugins. Config persists to gateway.json via PATCH
          /api/channels/:id/config; a running channel is automatically restarted on save
          so new credentials take effect immediately.
        </DevNote.Item>
      </DevNote>

      {fetchError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-[13px] text-destructive">
          {fetchError}
        </div>
      ) : channels === null ? (
        <div className="text-[13px] text-muted-foreground">Loading channels…</div>
      ) : channels.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[14px] font-medium text-foreground">No channel plugins installed</p>
          <p className="text-[13px] text-muted-foreground mt-1">
            Install a channel plugin from the Plugin Marketplace to get started.
          </p>
        </Card>
      ) : (
        <Tabs defaultValue={channels[0].id}>
          <TabsList className="mb-4">
            {channels.map((ch) => (
              <TabsTrigger key={ch.id} value={ch.id}>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${ch.status === "running" ? "bg-emerald-500" : ch.status === "error" ? "bg-red-500" : "bg-secondary"}`}
                  />
                  {ch.name ? shortName(ch.name) : ch.id}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {channels.map((ch) => (
            <TabsContent key={ch.id} value={ch.id}>
              <ChannelTab id={ch.id} initialEnabled={ch.enabled} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
