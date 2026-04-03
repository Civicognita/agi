/**
 * PluginManager — displays installed plugins with status, toggle, category badges, and metadata.
 * Groups plugins by category with section headers.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchPlugins, updatePluginEnabled } from "../api.js";
import type { PluginInfo } from "../types.js";

const CATEGORY_COLORS: Record<string, string> = {
  runtime: "bg-purple/15 text-purple",
  service: "bg-blue/15 text-blue",
  tool: "bg-green/15 text-green",
  editor: "bg-peach/15 text-peach",
  integration: "bg-teal/15 text-teal",
  project: "bg-sky/15 text-sky",
  system: "bg-red/15 text-red",
  stack: "bg-flamingo/15 text-flamingo",
};

const CATEGORY_ORDER = ["runtime", "service", "editor", "project", "system", "tool", "integration", "stack"];

function groupByCategory(plugins: PluginInfo[]): [string, PluginInfo[]][] {
  const groups = new Map<string, PluginInfo[]>();
  for (const p of plugins) {
    const cat = p.category ?? "tool";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(p);
  }
  // Sort groups by CATEGORY_ORDER
  return CATEGORY_ORDER
    .filter(cat => groups.has(cat))
    .map(cat => [cat, groups.get(cat)!] as [string, PluginInfo[]])
    .concat(
      Array.from(groups.entries()).filter(([cat]) => !CATEGORY_ORDER.includes(cat)),
    );
}

export function PluginManager() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);

  useEffect(() => {
    fetchPlugins()
      .then(setPlugins)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(plugin: PluginInfo) {
    setToggling(plugin.id);
    try {
      const result = await updatePluginEnabled(plugin.id, !plugin.enabled);
      setPlugins((prev) =>
        prev.map((p) => (p.id === plugin.id ? { ...p, enabled: !p.enabled } : p)),
      );
      if (result.requiresRestart) {
        setRestartNeeded(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(null);
    }
  }

  if (loading) {
    return <div className="text-[12px] text-muted-foreground py-8">Loading plugins...</div>;
  }

  if (error) {
    return <div className="text-[12px] text-red py-8">Failed to load plugins: {error}</div>;
  }

  if (plugins.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-[13px] text-muted-foreground mb-2">No plugins installed</div>
        <div className="text-[11px] text-muted-foreground">
          Place plugins in <code className="text-foreground">.plugins/</code> and restart.
        </div>
      </div>
    );
  }

  const grouped = groupByCategory(plugins);

  return (
    <div className="space-y-3">
      {restartNeeded && (
        <div className="rounded-xl bg-yellow/10 border border-yellow/30 px-4 py-3 text-[12px] text-yellow">
          Plugin changes require a gateway restart to take effect.
        </div>
      )}
      {grouped.map(([category, categoryPlugins]) => (
        <div key={category}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1 pt-3 pb-1.5">
            {category}
          </div>
          <div className="grid gap-3">
            {categoryPlugins.map((plugin) => (
              <div
                key={plugin.id}
                className={cn(
                  "rounded-xl bg-card border border-border p-4 transition-opacity",
                  !plugin.enabled && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-block w-2 h-2 rounded-full", plugin.active ? "bg-green" : "bg-muted-foreground")} />
                    <span className="text-[13px] font-semibold text-foreground">{plugin.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface1 text-muted-foreground font-mono">
                      v{plugin.version}
                    </span>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", CATEGORY_COLORS[plugin.category ?? "tool"] ?? "bg-surface1 text-muted-foreground")}>
                      {plugin.category ?? "tool"}
                    </span>
                    {plugin.bakedIn && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-mauve/15 text-mauve font-medium">
                        Built-in
                      </span>
                    )}
                  </div>
                  {/* Hide toggle for non-disableable baked-in plugins */}
                  {!(plugin.bakedIn && !plugin.disableable) && (
                    <button
                      type="button"
                      disabled={toggling === plugin.id}
                      onClick={() => void handleToggle(plugin)}
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60",
                        plugin.enabled ? "bg-green" : "bg-muted-foreground/30",
                      )}
                      role="switch"
                      aria-checked={plugin.enabled}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          plugin.enabled ? "translate-x-4" : "translate-x-0",
                        )}
                      />
                    </button>
                  )}
                </div>
                <div className="text-[12px] text-muted-foreground mb-2">{plugin.description}</div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  {plugin.author && <span>by {plugin.author}</span>}
                  {plugin.permissions.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {plugin.permissions.map((perm) => (
                        <span
                          key={perm}
                          className="px-1.5 py-0.5 rounded bg-surface1 text-[10px] font-mono"
                        >
                          {perm}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
