/**
 * Marketplace route — browse, install, manage extensions.
 * Three tabs: Browse (search + install), Installed (manage), Sources (add/remove).
 *
 * All plugins come from the marketplace. "Built-in" plugins are pre-installed
 * during onboarding and cannot be uninstalled — but they're still marketplace items.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PageScroll } from "@/components/PageScroll.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  fetchMarketplaceSources,
  addMarketplaceSource,
  removeMarketplaceSource,
  syncMarketplaceSource,
  searchMarketplaceCatalog,
  installMarketplacePlugin,
  uninstallMarketplacePlugin,
  updateMarketplacePlugin,
  fetchMarketplaceInstalled,
  fetchMarketplaceUpdates,
  fetchPluginDetails,
  fetchUninstallPreview,
} from "../api.js";
import type { CleanupResource } from "../api.js";
import type {
  MarketplaceSource,
  MarketplaceCatalogItem,
  MarketplaceInstalledItem,
  MarketplaceUpdate,
  PluginDetails,
} from "../types.js";

type Tab = "browse" | "installed" | "sources";

const tabs: { id: Tab; label: string }[] = [
  { id: "browse", label: "Browse" },
  { id: "installed", label: "Installed" },
  { id: "sources", label: "Sources" },
];

export default function MarketplacePage() {
  const [activeTab, setActiveTab] = useState<Tab>("browse");

  return (
    <PageScroll>
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-[13px] font-medium border-b-2 transition-colors cursor-pointer bg-transparent",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "browse" && <BrowseTab />}
      {activeTab === "installed" && <InstalledTab />}
      {activeTab === "sources" && <SourcesTab />}
    </div>
    </PageScroll>
  );
}

// ---------------------------------------------------------------------------
// Provides taxonomy helpers
// ---------------------------------------------------------------------------

const PROVIDES_COLORS: Record<string, string> = {
  "project-types": "bg-sky/15 text-sky",
  stacks: "bg-flamingo/15 text-flamingo",
  services: "bg-blue/15 text-blue",
  runtimes: "bg-purple/15 text-purple",
  "system-services": "bg-red/15 text-red",
  ux: "bg-green/15 text-green",
  "agent-tools": "bg-teal/15 text-teal",
  skills: "bg-peach/15 text-peach",
  knowledge: "bg-yellow/15 text-yellow",
  themes: "bg-mauve/15 text-mauve",
  workflows: "bg-sapphire/15 text-sapphire",
  channels: "bg-pink/15 text-pink",
};

const PROVIDES_LABELS: Record<string, string> = {
  "project-types": "Project Types",
  stacks: "Stacks",
  services: "Services",
  runtimes: "Runtimes",
  "system-services": "System Services",
  ux: "UX",
  "agent-tools": "Agent Tools",
  skills: "Skills",
  knowledge: "Knowledge",
  themes: "Themes",
  workflows: "Workflows",
  channels: "Channels",
};

// ---------------------------------------------------------------------------
// Plugin Detail Dialog — full registration breakdown
// ---------------------------------------------------------------------------

interface PluginDetailDialogProps {
  plugin: MarketplaceCatalogItem | null;
  sourceName?: string;
  onClose: () => void;
  onAction?: () => void;
  actionLabel?: string;
  actionLoading?: boolean;
}

/** Collapsible section for registration categories */
function DetailSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  if (count === 0) return null;
  return (
    <div>
      <button
        className="flex items-center gap-2 w-full text-left text-[12px] font-medium text-foreground cursor-pointer bg-transparent border-none p-0"
        onClick={() => setOpen(!open)}
      >
        <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
        {title}
        <span className="text-muted-foreground font-normal">({count})</span>
      </button>
      {open && <div className="mt-1 ml-4 space-y-0.5">{children}</div>}
    </div>
  );
}

function PluginDetailDialog({
  plugin,
  sourceName,
  onClose,
  onAction,
  actionLabel,
  actionLoading,
}: PluginDetailDialogProps) {
  const [details, setDetails] = useState<PluginDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    if (!plugin) { setDetails(null); return; }
    setLoadingDetails(true);
    fetchPluginDetails(plugin.name)
      .then(setDetails)
      .catch(() => setDetails(null))
      .finally(() => setLoadingDetails(false));
  }, [plugin]);

  if (!plugin) return null;

  const provides = details?.manifest.provides ?? plugin.provides ?? [];
  const depends = details?.manifest.depends ?? plugin.depends ?? [];
  const permissions = details?.manifest.permissions ?? [];
  const reg = details?.registrations;

  return (
    <Dialog open={!!plugin} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {plugin.name}
            <Badge variant="outline" className="text-[10px]">
              {plugin.type ?? "plugin"}
            </Badge>
            {(details?.builtIn ?? plugin.builtIn) && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-mauve/15 text-mauve">
                Built-in
              </span>
            )}
          </DialogTitle>
          {plugin.description && (
            <DialogDescription>{plugin.description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {/* Metadata grid */}
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
            {plugin.version && (
              <>
                <span className="text-muted-foreground">Version</span>
                <span>v{plugin.version}</span>
              </>
            )}
            {plugin.author && (
              <>
                <span className="text-muted-foreground">Author</span>
                <span>{plugin.author.name}</span>
              </>
            )}
            {(details?.manifest.category ?? plugin.category) && (
              <>
                <span className="text-muted-foreground">Category</span>
                <span>{details?.manifest.category ?? plugin.category}</span>
              </>
            )}
            {sourceName && (
              <>
                <span className="text-muted-foreground">Source</span>
                <span>{sourceName}</span>
              </>
            )}
            {plugin.license && (
              <>
                <span className="text-muted-foreground">License</span>
                <span>{plugin.license}</span>
              </>
            )}
            {plugin.homepage && (
              <>
                <span className="text-muted-foreground">Homepage</span>
                <span className="truncate">{plugin.homepage}</span>
              </>
            )}
            {details !== null && (
              <>
                <span className="text-muted-foreground">Status</span>
                <span className="flex items-center gap-2">
                  <span className={details.active ? "text-green" : "text-muted-foreground"}>
                    {details.active ? "Active" : "Inactive"}
                  </span>
                  <span>{details.enabled ? "Enabled" : "Disabled"}</span>
                </span>
              </>
            )}
          </div>

          {/* Provides */}
          {provides.length > 0 && (
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">Provides</span>
              <div className="flex flex-wrap gap-1.5">
                {provides.map((p) => (
                  <span
                    key={p}
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-medium",
                      PROVIDES_COLORS[p] ?? "bg-surface1 text-muted-foreground",
                    )}
                  >
                    {PROVIDES_LABELS[p] ?? p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Dependencies */}
          {depends.length > 0 && (
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">Dependencies</span>
              <p className="text-[12px]">{depends.join(", ")}</p>
            </div>
          )}

          {/* Permissions */}
          {permissions.length > 0 && (
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">Permissions</span>
              <div className="flex flex-wrap gap-1.5">
                {permissions.map((p) => (
                  <span key={p} className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-red/10 text-red">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Registration breakdown — only for active plugins */}
          {loadingDetails && (
            <p className="text-[11px] text-muted-foreground">Loading details...</p>
          )}

          {reg && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <span className="text-[11px] text-muted-foreground font-medium block">
                Registrations
              </span>

              <DetailSection title="HTTP Routes" count={reg.routes.length}>
                {reg.routes.map((r) => (
                  <p key={`${r.method}-${r.path}`} className="text-[11px] font-mono text-muted-foreground">
                    <span className="text-foreground">{r.method.toUpperCase()}</span> {r.path}
                  </p>
                ))}
              </DetailSection>

              <DetailSection title="System Services" count={reg.systemServices.length}>
                {reg.systemServices.map((s) => (
                  <div key={s.id} className="text-[11px]">
                    <span className="text-foreground font-medium">{s.name}</span>
                    {s.unitName && <span className="text-muted-foreground ml-1">({s.unitName})</span>}
                    {s.description && <p className="text-muted-foreground">{s.description}</p>}
                  </div>
                ))}
              </DetailSection>

              <DetailSection title="Agent Tools" count={reg.agentTools.length}>
                {reg.agentTools.map((t) => (
                  <div key={t.name} className="text-[11px]">
                    <span className="text-foreground font-medium font-mono">{t.name}</span>
                    <p className="text-muted-foreground">{t.description}</p>
                  </div>
                ))}
              </DetailSection>

              <DetailSection title="Settings Pages" count={reg.settingsPages.length}>
                {reg.settingsPages.map((p) => (
                  <p key={p.id} className="text-[11px] text-foreground">{p.label}</p>
                ))}
              </DetailSection>

              <DetailSection title="Dashboard Pages" count={reg.dashboardPages.length}>
                {reg.dashboardPages.map((p) => (
                  <p key={p.id} className="text-[11px]">
                    <span className="text-foreground">{p.label}</span>
                    <span className="text-muted-foreground ml-1">({p.domain})</span>
                  </p>
                ))}
              </DetailSection>

              <DetailSection title="Skills" count={reg.skills.length}>
                {reg.skills.map((s) => (
                  <div key={s.name} className="text-[11px]">
                    <span className="text-foreground font-medium">{s.name}</span>
                    <span className="text-muted-foreground ml-1">[{s.domain}]</span>
                    {s.description && <p className="text-muted-foreground">{s.description}</p>}
                  </div>
                ))}
              </DetailSection>

              <DetailSection title="Knowledge" count={reg.knowledge.length}>
                {reg.knowledge.map((k) => (
                  <p key={k.id} className="text-[11px]">
                    <span className="text-foreground">{k.label}</span>
                    <span className="text-muted-foreground ml-1">({k.topicCount} topics)</span>
                  </p>
                ))}
              </DetailSection>

              <DetailSection title="Themes" count={reg.themes.length}>
                {reg.themes.map((t) => (
                  <p key={t.id} className="text-[11px] text-foreground">{t.name}</p>
                ))}
              </DetailSection>

              <DetailSection title="Workflows" count={reg.workflows.length}>
                {reg.workflows.map((w) => (
                  <p key={w.id} className="text-[11px] text-foreground">{w.name}</p>
                ))}
              </DetailSection>

              <DetailSection title="Scheduled Tasks" count={reg.scheduledTasks.length}>
                {reg.scheduledTasks.map((t) => (
                  <p key={t.id} className="text-[11px]">
                    <span className="text-foreground">{t.name}</span>
                    {t.cron && <span className="text-muted-foreground font-mono ml-1">{t.cron}</span>}
                  </p>
                ))}
              </DetailSection>

              <DetailSection title="Sidebar Sections" count={reg.sidebarSections.length}>
                {reg.sidebarSections.map((s) => (
                  <p key={s.id} className="text-[11px]">
                    <span className="text-foreground">{s.title}</span>
                    <span className="text-muted-foreground ml-1">({s.itemCount} items)</span>
                  </p>
                ))}
              </DetailSection>

              <DetailSection title="Stacks" count={reg.stacks.length}>
                {reg.stacks.map((s) => (
                  <p key={s.id} className="text-[11px] text-foreground">{s.label}</p>
                ))}
              </DetailSection>
            </div>
          )}

          {/* Unloaded plugin — no registrations available */}
          {details && !reg && !loadingDetails && (
            <p className="text-[11px] text-muted-foreground italic pt-2 border-t border-border/50">
              Install and enable this plugin to see its full registrations (routes, services, tools, etc.)
            </p>
          )}
        </div>

        <DialogFooter showCloseButton>
          {onAction && actionLabel && (
            <Button
              variant={actionLabel === "Uninstall" ? "destructive" : "default"}
              disabled={actionLoading}
              onClick={onAction}
            >
              {actionLoading ? "..." : actionLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Browse Tab
// ---------------------------------------------------------------------------

function BrowseTab() {
  const [query, setQuery] = useState("");
  const [providesFilter, setProvidesFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<number | "">("");
  const [sources, setSources] = useState<MarketplaceSource[]>([]);
  const [items, setItems] = useState<MarketplaceCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installNotice, setInstallNotice] = useState<string | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<MarketplaceCatalogItem | null>(null);

  useEffect(() => {
    fetchMarketplaceSources().then(setSources).catch(() => {});
  }, []);

  const sourceMap = Object.fromEntries(sources.map((s) => [s.id, s.name]));

  const doSearch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await searchMarketplaceCatalog({
        q: query || undefined,
        provides: providesFilter || undefined,
      });
      let filtered = result.filter((item) => !item.installed);
      if (sourceFilter !== "") {
        filtered = filtered.filter((item) => item.sourceId === sourceFilter);
      }
      setItems(filtered.sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [query, providesFilter, sourceFilter]);

  useEffect(() => { void doSearch(); }, [doSearch]);

  const handleInstall = useCallback(async (item: MarketplaceCatalogItem) => {
    setActing(item.name);
    setInstallError(null);
    setInstallNotice(null);
    try {
      const result = await installMarketplacePlugin(item.name, item.sourceId);
      if (result.autoInstalled && result.autoInstalled.length > 0) {
        setInstallNotice(`Installed ${item.name} + dependencies: ${result.autoInstalled.join(", ")}`);
      }
      window.location.reload();
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Install failed");
    } finally { setActing(null); }
  }, [doSearch]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder="Search extensions..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1"
        />
        <select
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm cursor-pointer"
          value={providesFilter}
          onChange={(e) => setProvidesFilter(e.target.value)}
        >
          <option value="">All capabilities</option>
          {Object.entries(PROVIDES_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm cursor-pointer"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value === "" ? "" : Number(e.target.value))}
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {installError && (
        <div className="rounded-lg bg-red/10 border border-red/30 px-4 py-3 text-sm text-red">
          {installError}
        </div>
      )}

      {installNotice && (
        <div className="rounded-lg bg-green/10 border border-green/30 px-4 py-3 text-sm text-green">
          {installNotice}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Searching...</p>
      ) : items.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            No extensions found. The marketplace is syncing — try refreshing in a moment.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((item) => {
            const provides = item.provides ?? [];

            return (
              <Card
                key={`${item.name}-${item.sourceId}`}
                className="p-4 flex flex-col cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => setSelectedPlugin(item)}
              >
                {/* Top: name + type badge + trust tier */}
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="font-medium text-foreground text-[13px]">{item.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {item.type ?? "plugin"}
                  </Badge>
                  {item.trustTier === "official" && (
                    <Badge className="text-[10px] bg-green/15 text-green border-green/30">Official</Badge>
                  )}
                  {item.trustTier === "verified" && (
                    <Badge className="text-[10px] bg-blue/15 text-blue border-blue/30">Verified</Badge>
                  )}
                  {item.trustTier === "community" && (
                    <Badge className="text-[10px] bg-muted text-muted-foreground">Community</Badge>
                  )}
                  {item.builtIn && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-mauve/15 text-mauve">
                      Built-in
                    </span>
                  )}
                </div>

                {/* Description (2-line clamp) */}
                {item.description && (
                  <p className="text-[12px] text-muted-foreground line-clamp-2 mb-1">
                    {item.description}
                  </p>
                )}

                {/* Dependencies */}
                {item.depends && item.depends.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mb-1">
                    Requires: {item.depends.join(", ")}
                  </p>
                )}

                {/* Provides badges */}
                {provides.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {provides.map((p) => (
                      <span
                        key={p}
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium",
                          PROVIDES_COLORS[p] ?? "bg-surface1 text-muted-foreground",
                        )}
                      >
                        {PROVIDES_LABELS[p] ?? p}
                      </span>
                    ))}
                  </div>
                )}

                {/* Spacer to push footer down */}
                {!provides.length && !(item.depends && item.depends.length > 0) && <div className="mb-auto" />}
                {(provides.length > 0 || (item.depends && item.depends.length > 0)) && <div className="mb-auto" />}

                {/* Footer: author + version | Install button */}
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {item.author && <span>by {item.author.name}</span>}
                    {item.version && <span>v{item.version}</span>}
                  </div>

                  <div className="shrink-0">
                    <Button
                      size="sm"
                      disabled={acting === item.name}
                      onClick={(e) => { e.stopPropagation(); void handleInstall(item); }}
                    >
                      {acting === item.name ? "Installing..." : "Install"}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <PluginDetailDialog
        plugin={selectedPlugin}
        sourceName={selectedPlugin ? sourceMap[selectedPlugin.sourceId] : undefined}
        onClose={() => setSelectedPlugin(null)}
        onAction={selectedPlugin ? () => void handleInstall(selectedPlugin) : undefined}
        actionLabel="Install"
        actionLoading={acting === selectedPlugin?.name}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installed Tab
// ---------------------------------------------------------------------------

function InstalledTab() {
  const [items, setItems] = useState<MarketplaceInstalledItem[]>([]);
  const [updates, setUpdates] = useState<MarketplaceUpdate[]>([]);
  const [catalog, setCatalog] = useState<MarketplaceCatalogItem[]>([]);
  const [sources, setSources] = useState<MarketplaceSource[]>([]);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<MarketplaceCatalogItem | null>(null);

  // Cleanup preview state
  const [cleanupTarget, setCleanupTarget] = useState<string | null>(null);
  const [cleanupResources, setCleanupResources] = useState<CleanupResource[]>([]);
  const [selectedCleanupIds, setSelectedCleanupIds] = useState<Set<string>>(new Set());
  const [loadingPreview, setLoadingPreview] = useState(false);

  const load = useCallback(async () => {
    const [installed, avail, catalogItems, srcs] = await Promise.all([
      fetchMarketplaceInstalled().catch(() => [] as MarketplaceInstalledItem[]),
      fetchMarketplaceUpdates().catch(() => [] as MarketplaceUpdate[]),
      searchMarketplaceCatalog().catch(() => [] as MarketplaceCatalogItem[]),
      fetchMarketplaceSources().catch(() => [] as MarketplaceSource[]),
    ]);
    setItems(installed.sort((a, b) => a.name.localeCompare(b.name)));
    setUpdates(avail);
    setCatalog(catalogItems);
    setSources(srcs);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sourceMap = Object.fromEntries(sources.map((s) => [s.id, s.name]));

  // Two-step uninstall: preview cleanup resources, then confirm
  const handleUninstallRequest = useCallback(async (name: string) => {
    setLoadingPreview(true);
    try {
      const preview = await fetchUninstallPreview(name);
      if (preview.resources.length > 0) {
        setCleanupTarget(name);
        setCleanupResources(preview.resources);
        setSelectedCleanupIds(new Set());
        return; // Show dialog instead of uninstalling immediately
      }
    } catch { /* no cleanup available — proceed directly */ }
    finally { setLoadingPreview(false); }

    // No cleanup resources — uninstall directly
    setUninstalling(name);
    try {
      const result = await uninstallMarketplacePlugin(name);
      if (!result.ok) {
        console.error("Uninstall rejected:", result.error);
        window.alert(result.error ?? "Uninstall failed");
        return;
      }
      window.location.reload();
    } catch (err) {
      console.error("Uninstall failed:", err);
      window.alert(err instanceof Error ? err.message : String(err));
    } finally { setUninstalling(null); }
  }, [load]);

  const handleConfirmUninstall = useCallback(async () => {
    if (!cleanupTarget) return;
    const name = cleanupTarget;
    setCleanupTarget(null);
    setUninstalling(name);
    try {
      const ids = selectedCleanupIds.size > 0 ? [...selectedCleanupIds] : undefined;
      const result = await uninstallMarketplacePlugin(name, ids);
      if (!result.ok) {
        console.error("Uninstall rejected:", result.error);
        window.alert(result.error ?? "Uninstall failed");
        return;
      }
      window.location.reload();
    } catch (err) {
      console.error("Uninstall failed:", err);
      window.alert(err instanceof Error ? err.message : String(err));
    } finally { setUninstalling(null); }
  }, [cleanupTarget, selectedCleanupIds, load]);

  const handleUpdate = useCallback(async (pluginName: string, sourceId: number) => {
    setUpdating(pluginName);
    try {
      await updateMarketplacePlugin(pluginName, sourceId);
      void load();
    } catch { /* ignore */ }
    finally { setUpdating(null); }
  }, [load]);

  if (items.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">No extensions installed from marketplace.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {updates.length > 0 && (
        <Card className="p-4 border-blue/30 bg-blue/5">
          <p className="text-sm font-medium text-foreground">
            {updates.length} update{updates.length > 1 ? "s" : ""} available
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((item) => {
          const update = updates.find((u) => u.pluginName === item.name);
          const catalogItem = catalog.find((c) => c.name === item.name);
          const provides = catalogItem?.provides ?? [];
          const depends = catalogItem?.depends ?? [];

          return (
            <Card
              key={item.name}
              className="p-4 flex flex-col cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => {
                if (catalogItem) setSelectedPlugin(catalogItem);
              }}
            >
              {/* Top: name + type badge */}
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="font-medium text-foreground text-[13px]">{item.name}</span>
                <Badge variant="outline" className="text-[10px]">{item.type}</Badge>
                {update && (
                  <Badge className="text-[10px] bg-blue/20 text-blue border-blue/30">
                    v{update.availableVersion} available
                  </Badge>
                )}
              </div>

              {/* Description (2-line clamp) */}
              {catalogItem?.description && (
                <p className="text-[12px] text-muted-foreground line-clamp-2 mb-1">
                  {catalogItem.description}
                </p>
              )}

              {/* Dependencies */}
              {depends.length > 0 && (
                <p className="text-[11px] text-muted-foreground mb-1">
                  Requires: {depends.join(", ")}
                </p>
              )}

              {/* Provides badges */}
              {provides.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {provides.map((p) => (
                    <span
                      key={p}
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-medium",
                        PROVIDES_COLORS[p] ?? "bg-surface1 text-muted-foreground",
                      )}
                    >
                      {PROVIDES_LABELS[p] ?? p}
                    </span>
                  ))}
                </div>
              )}

              {/* Spacer */}
              <div className="mb-auto" />

              {/* Footer: source + installed date + version | Uninstall */}
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{sourceMap[item.sourceId] ?? `Source #${item.sourceId}`}</span>
                  <span>v{item.version}</span>
                  <span>{new Date(item.installedAt).toLocaleDateString()}</span>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {update && (
                    <Button
                      size="sm"
                      variant="default"
                      disabled={updating === item.name}
                      onClick={(e) => { e.stopPropagation(); void handleUpdate(item.name, item.sourceId); }}
                    >
                      {updating === item.name ? "Updating..." : "Update"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={uninstalling === item.name}
                    onClick={(e) => { e.stopPropagation(); void handleUninstallRequest(item.name); }}
                  >
                    {uninstalling === item.name ? "Removing..." : "Uninstall"}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <PluginDetailDialog
        plugin={selectedPlugin}
        sourceName={selectedPlugin ? sourceMap[selectedPlugin.sourceId] : undefined}
        onClose={() => setSelectedPlugin(null)}
        onAction={selectedPlugin ? () => void handleUninstallRequest(selectedPlugin.name) : undefined}
        actionLabel="Uninstall"
        actionLoading={uninstalling === selectedPlugin?.name || loadingPreview}
      />

      {/* Cleanup confirmation dialog */}
      <Dialog open={cleanupTarget !== null} onOpenChange={(open) => { if (!open) setCleanupTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uninstall {cleanupTarget}</DialogTitle>
            <DialogDescription>
              This plugin has system resources that can be cleaned up. Select which resources to remove:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {cleanupResources.map((r) => (
              <label key={r.id} className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selectedCleanupIds.has(r.id)}
                  onChange={(e) => {
                    setSelectedCleanupIds((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      return next;
                    });
                  }}
                />
                <div>
                  <span className="font-medium">{r.label}</span>
                  {r.shared && (
                    <Badge variant="outline" className="ml-2 text-[10px]">shared</Badge>
                  )}
                  <p className="text-xs text-muted-foreground">{r.type}</p>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCleanupTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleConfirmUninstall()}>
              Uninstall{selectedCleanupIds.size > 0 ? ` & Clean ${selectedCleanupIds.size} resource${selectedCleanupIds.size > 1 ? "s" : ""}` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources Tab
// ---------------------------------------------------------------------------

function SourcesTab() {
  const [sources, setSources] = useState<MarketplaceSource[]>([]);
  const [newRef, setNewRef] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);

  const load = useCallback(async () => {
    const s = await fetchMarketplaceSources().catch(() => [] as MarketplaceSource[]);
    setSources(s);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = useCallback(async () => {
    if (!newRef) return;
    setAdding(true);
    try {
      await addMarketplaceSource(newRef, newName || undefined);
      setNewRef("");
      setNewName("");
      void load();
    } catch { /* ignore */ }
    finally { setAdding(false); }
  }, [newRef, newName, load]);

  const handleSync = useCallback(async (id: number) => {
    setSyncing(id);
    try {
      await syncMarketplaceSource(id);
      void load();
    } catch { /* ignore */ }
    finally { setSyncing(null); }
  }, [load]);

  const handleRemove = useCallback(async (id: number) => {
    try {
      await removeMarketplaceSource(id);
      void load();
    } catch { /* ignore */ }
  }, [load]);

  return (
    <div className="space-y-4">
      {/* Add source form */}
      <Card className="p-4">
        <p className="text-sm font-medium text-foreground mb-1">Add marketplace</p>
        <p className="text-[11px] text-muted-foreground mb-3">
          GitHub repo (owner/repo), git URL, or direct marketplace.json URL
        </p>
        <div className="flex gap-3">
          <Input
            placeholder="e.g. owner/repo or https://..."
            value={newRef}
            onChange={(e) => setNewRef(e.target.value)}
            className="flex-1"
          />
          <Input
            placeholder="Name (optional)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-48"
          />
          <Button onClick={() => void handleAdd()} disabled={adding || !newRef}>
            {adding ? "Adding..." : "Add"}
          </Button>
        </div>
      </Card>

      {/* Source list */}
      {sources.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">No marketplace sources configured.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {sources.map((source) => (
            <Card key={source.id} className="p-4 flex-row items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{source.name}</span>
                  <Badge variant="outline" className="text-[10px]">{source.sourceType}</Badge>
                  <span className="text-[11px] text-muted-foreground">{source.pluginCount} plugins</span>
                </div>
                <p className="text-[11px] text-muted-foreground font-mono mt-1">{source.ref}</p>
                {source.lastSyncedAt && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Last synced: {new Date(source.lastSyncedAt).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={syncing === source.id}
                  onClick={() => void handleSync(source.id)}
                >
                  {syncing === source.id ? "Syncing..." : "Sync"}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void handleRemove(source.id)}
                >
                  Remove
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
