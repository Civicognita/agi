/**
 * MagicApps Admin — browse marketplace, install/uninstall MApps.
 * Two sections: Marketplace (browse + install) and Installed (manage).
 */

import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { PageScroll } from "@/components/PageScroll.js";
import { ContextMenu } from "@particle-academy/react-fancy";
import { fetchMagicApps, fetchMAppCatalog, installMApp, uninstallMApp, fetchMAppSources, addMAppSource, removeMAppSource, pullMAppMarketplace } from "@/api.js";
import type { MagicAppInfo, MAppCatalogEntry } from "@/types.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card.js";
import type { RootContext } from "./root.js";

const DEFAULT_AUTHOR = "civicognita";

const CATEGORY_LABELS: Record<string, string> = {
  viewer: "Viewer",
  production: "Production",
  tool: "Tools",
  game: "Games",
  custom: "Custom",
};

export default function MagicAppsAdminPage() {
  const ctx = useOutletContext<RootContext>();
  const navigate = useNavigate();
  const [installed, setInstalled] = useState<MagicAppInfo[]>([]);
  const [catalog, setCatalog] = useState<MAppCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [tab, setTab] = useState<"marketplace" | "installed">("marketplace");
  const [sources, setSources] = useState<Array<{ id: number; ref: string; name: string; lastSyncedAt: string | null; mappCount: number }>>([]);
  const [newSourceRef, setNewSourceRef] = useState("");
  const [pulling, setPulling] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [apps, cat, srcs] = await Promise.all([fetchMagicApps(), fetchMAppCatalog(), fetchMAppSources()]);
      setInstalled(apps);
      setCatalog(cat.apps);
      setSources(srcs);
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const installedIds = new Set(installed.map((a) => a.id));

  const handleInstall = async (entry: MAppCatalogEntry) => {
    setInstalling(entry.definition.id);
    try {
      const sourceId = (entry as unknown as { sourceId?: number }).sourceId ?? sources[0]?.id ?? 1;
      await installMApp(entry.definition.id, sourceId);
      await load();
    } catch (err) {
      console.error("Install failed:", err);
    } finally {
      setInstalling(null);
    }
  };

  const handleAddSource = async () => {
    if (!newSourceRef.trim()) return;
    try {
      await addMAppSource(newSourceRef.trim());
      setNewSourceRef("");
      await load();
    } catch (err) {
      console.error("Add source failed:", err);
    }
  };

  const handleRemoveSource = async (id: number) => {
    await removeMAppSource(id);
    await load();
  };

  const handlePull = async () => {
    setPulling(true);
    try {
      await pullMAppMarketplace();
      await load();
    } catch (err) {
      console.error("Pull failed:", err);
    } finally {
      setPulling(false);
    }
  };

  const handleUninstall = async (appId: string) => {
    try {
      await uninstallMApp(appId);
      await load();
    } catch (err) {
      console.error("Uninstall failed:", err);
    }
  };

  const customApps = installed.filter((a) => a.author && a.author !== DEFAULT_AUTHOR);
  const defaultApps = installed.filter((a) => a.author === DEFAULT_AUTHOR);

  return (
    <PageScroll>
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">MagicApps</h1>
          <p className="text-[12px] text-muted-foreground">Browse, install, and manage MagicApps</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/magic-apps/editor")}>
            Create Visually
          </Button>
          <Button size="sm" onClick={() => {
            ctx.onOpenChatWithMessage("builder:create", "I want to create a new MagicApp. Help me design it.");
          }}>
            Create with AI
          </Button>
        </div>
      </div>

      {/* Sources section */}
      <div className="mb-4 p-3 rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Sources</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void handlePull()} disabled={pulling}>
            {pulling ? "Checking..." : "Check for Updates"}
          </Button>
        </div>
        {sources.map((s) => (
          <div key={s.id} className="flex items-center justify-between py-1.5 text-[11px]">
            <div>
              <span className="text-foreground font-medium">{s.name}</span>
              <span className="text-muted-foreground ml-2">{s.ref}</span>
              {s.lastSyncedAt && <span className="text-muted-foreground ml-2">({s.mappCount} MApps)</span>}
            </div>
            {sources.length > 1 && (
              <button onClick={() => void handleRemoveSource(s.id)} className="text-[10px] text-red hover:underline">Remove</button>
            )}
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            value={newSourceRef}
            onChange={(e) => setNewSourceRef(e.target.value)}
            placeholder="owner/repo (e.g. myorg/my-mapps)"
            className="flex-1 h-7 px-2 rounded border border-border bg-background text-foreground text-[11px]"
            onKeyDown={(e) => { if (e.key === "Enter") void handleAddSource(); }}
          />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void handleAddSource()} disabled={!newSourceRef.trim()}>
            Add Source
          </Button>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setTab("marketplace")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "marketplace"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Marketplace
          {catalog.length > 0 && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {catalog.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("installed")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "installed"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Installed
          {installed.length > 0 && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {installed.length}
            </span>
          )}
        </button>
      </div>

      {loading && <div className="text-muted-foreground text-sm">Loading...</div>}

      {/* Marketplace tab */}
      {!loading && tab === "marketplace" && (
        <>
          {catalog.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <div className="text-3xl mb-3">📦</div>
              <div className="text-sm font-medium mb-1">No MApps available</div>
              <div className="text-xs">The official MApp marketplace is empty or not yet deployed. MApps will appear here once the marketplace repo is available.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {catalog.map((entry) => {
                const app = entry.definition;
                const isInstalled = installedIds.has(app.id);
                const isInstalling = installing === app.id;
                return (
                  <Card key={app.id}>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <span className="text-xl">{app.icon ?? "✨"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{app.name}</div>
                          <div className="text-[10px] text-muted-foreground font-normal">{app.author} · v{app.version}</div>
                        </div>
                        {isInstalled ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green/10 text-green font-medium shrink-0">
                            Installed
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            className="shrink-0 h-7 text-xs"
                            disabled={isInstalling}
                            onClick={() => void handleInstall(entry)}
                          >
                            {isInstalling ? "Installing..." : "Install"}
                          </Button>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-[11px] text-muted-foreground mb-2 line-clamp-2">{app.description}</p>
                      <div className="flex flex-wrap gap-1">
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          {CATEGORY_LABELS[app.category] ?? app.category}
                        </span>
                        {app.projectCategories?.map((pc) => (
                          <span key={pc} className="text-[9px] px-1.5 py-0.5 rounded bg-surface0 text-muted-foreground">
                            {pc}
                          </span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Installed tab */}
      {!loading && tab === "installed" && (
        <>
          {/* Custom MApps */}
          {customApps.length > 0 && (
            <div className="mb-6">
              <h2 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Your MApps</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {customApps.map((app) => (
                  <ContextMenu key={app.id}>
                    <ContextMenu.Trigger>
                      <div className="rounded-xl border border-border bg-card p-4 hover:border-primary/30 transition-colors cursor-pointer">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xl">{app.icon ?? "✨"}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold text-foreground truncate">{app.name}</div>
                            <div className="text-[10px] text-muted-foreground">{app.author} · v{app.version}</div>
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2">{app.description}</p>
                        <div className="flex gap-1.5 mt-2">
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{CATEGORY_LABELS[app.category] ?? app.category}</span>
                        </div>
                      </div>
                    </ContextMenu.Trigger>
                    <ContextMenu.Content>
                      <ContextMenu.Item onClick={() => navigate(`/magic-apps/${app.id}`)}>Details</ContextMenu.Item>
                      <ContextMenu.Item onClick={() => navigate(`/magic-apps/editor/${app.id}`)}>Edit in Editor</ContextMenu.Item>
                      <ContextMenu.Item onClick={() => {
                        ctx.onOpenChatWithMessage("builder:update", `I want to update the MApp "${app.name}" (${app.id}). Load it and help me make changes.`);
                      }}>Edit with Builder</ContextMenu.Item>
                      <ContextMenu.Separator />
                      <ContextMenu.Item onClick={() => void handleUninstall(app.id)}>Uninstall</ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu>
                ))}
              </div>
            </div>
          )}

          {/* Default MApps */}
          {defaultApps.length > 0 && (
            <div className="mb-6">
              <h2 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Default ({DEFAULT_AUTHOR})
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {defaultApps.map((app) => (
                  <div key={app.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">{app.icon ?? "✨"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-foreground truncate">{app.name}</div>
                        <div className="text-[10px] text-muted-foreground">{app.author} · v{app.version}</div>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{app.description}</p>
                    <div className="flex gap-1.5 mt-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{CATEGORY_LABELS[app.category] ?? app.category}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {installed.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No MagicApps installed. Browse the Marketplace tab or create one with the Editor or Builder.
            </div>
          )}
        </>
      )}
    </div>
    </PageScroll>
  );
}
