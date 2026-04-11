/**
 * MagicApps Desktop — icon grid index page at /magic-apps.
 *
 * Shows all registered MagicApps organized into category Cards
 * with clickable icon buttons (Android-style app drawer).
 * Clicking an icon opens the app in a floating modal (not navigation).
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { PageScroll } from "@/components/PageScroll.js";
import { ContextMenu } from "@particle-academy/react-fancy";
import { fetchMagicApps } from "@/api.js";
import type { MagicAppInfo } from "@/types.js";
import { useOutletContext } from "react-router";
import type { RootContext } from "./root.js";
import { ProjectPickerDialog } from "@/components/ProjectPickerDialog.js";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card.js";

const DEFAULT_AUTHOR = "civicognita";

const CATEGORY_ICONS: Record<string, string> = {
  viewer: "\uD83D\uDC41\uFE0F",
  production: "\u2692\uFE0F",
  tool: "\uD83D\uDD27",
  game: "\uD83C\uDFAE",
  custom: "\u2728",
};

const CATEGORY_LABELS: Record<string, string> = {
  viewer: "Viewer",
  production: "Production",
  tool: "Tools",
  game: "Games",
  custom: "Custom",
};

/** Canonical display order for categories. */
const CATEGORY_ORDER = ["viewer", "production", "tool", "game", "custom"];

export default function MagicAppsPage() {
  const ctx = useOutletContext<RootContext>();
  const navigate = useNavigate();
  const [apps, setApps] = useState<MagicAppInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [pickerApp, setPickerApp] = useState<MagicAppInfo | null>(null); // app waiting for project selection

  useEffect(() => {
    fetchMagicApps()
      .then(setApps)
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter
    ? apps.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()) || a.category.includes(filter.toLowerCase()))
    : apps;

  const grouped = new Map<string, MagicAppInfo[]>();
  for (const app of filtered) {
    const cat = app.category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(app);
  }

  // Sort categories by canonical order, unknown categories at the end
  const sortedCategories = [...grouped.keys()].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  // Step 1: User clicks app icon → show project picker
  const handleAppClick = (app: MagicAppInfo) => {
    setPickerApp(app);
  };

  // Step 2: User selects project → open app instance anchored to that project
  const handleProjectSelected = async (projectPath: string) => {
    if (!pickerApp) return;
    setPickerApp(null);
    try {
      await ctx.onOpenMagicApp?.(pickerApp.id, projectPath);
      // Instance created — root layout will render the modal via instance list refresh
      // Trigger a re-fetch of instances in root
      ctx.onRefreshMagicApps?.();
    } catch (err) {
      console.error("Failed to open MagicApp:", err);
    }
  };

  return (
    <PageScroll>
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">MagicApps</h1>
        <input
          type="text"
          placeholder="Search apps..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm w-64"
        />
      </div>

      {loading && (
        <div className="text-muted-foreground text-sm">Loading apps...</div>
      )}

      {!loading && apps.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <div className="text-4xl mb-4">{"\u2728"}</div>
          <div className="text-lg font-semibold mb-2">No MagicApps installed</div>
          <div className="text-sm">Install MagicApps from the marketplace or create one with BuilderChat.</div>
        </div>
      )}

      {sortedCategories.map((category) => {
        const categoryApps = grouped.get(category)!;
        return (
          <Card key={category} className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="text-lg">{CATEGORY_ICONS[category] ?? "\u2728"}</span>
                <span>{CATEGORY_LABELS[category] ?? category}</span>
                <span className="ml-1 text-[10px] text-muted-foreground font-normal px-1.5 py-0.5 rounded-full bg-muted">
                  {categoryApps.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {categoryApps.map((app) => {
                  const isEditable = app.author && app.author !== DEFAULT_AUTHOR;
                  return (
                    <ContextMenu key={app.id}>
                      <ContextMenu.Trigger>
                        <button
                          onClick={() => handleAppClick(app)}
                          className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-card hover:bg-accent/10 hover:border-primary/30 transition-all cursor-pointer group w-full"
                        >
                          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                            {app.icon ?? CATEGORY_ICONS[app.category] ?? "\u2728"}
                          </div>
                          <span className="text-sm font-medium text-foreground text-center leading-tight">
                            {app.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">v{app.version}</span>
                        </button>
                      </ContextMenu.Trigger>
                      <ContextMenu.Content>
                        <ContextMenu.Item onClick={() => handleAppClick(app)}>Open</ContextMenu.Item>
                        <ContextMenu.Item onClick={() => navigate(`/magic-apps/${app.id}`)}>Details</ContextMenu.Item>
                        {isEditable && (
                          <>
                            <ContextMenu.Separator />
                            <ContextMenu.Item onClick={() => navigate(`/magic-apps/editor/${app.id}`)}>
                              Edit in Editor
                            </ContextMenu.Item>
                            <ContextMenu.Item onClick={() => {
                              ctx.onOpenChatWithMessage(
                                `builder:update`,
                                `I want to update the MApp "${app.name}" (${app.id}). Load it and help me make changes.`,
                              );
                            }}>
                              Edit with Builder
                            </ContextMenu.Item>
                          </>
                        )}
                        {isEditable && (
                          <>
                            <ContextMenu.Separator />
                            <ContextMenu.Item onClick={() => {
                              ctx.onOpenChatWithMessage(
                                `mapp:${app.id}`,
                                `Tell me about the MApp "${app.name}".`,
                              );
                            }}>
                              Talk about this MApp
                            </ContextMenu.Item>
                          </>
                        )}
                      </ContextMenu.Content>
                    </ContextMenu>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Project picker dialog — shown when user clicks an app icon */}
      <ProjectPickerDialog
        open={pickerApp !== null}
        onSelect={(path) => void handleProjectSelected(path)}
        onClose={() => setPickerApp(null)}
        projects={ctx.projectsHook.projects}
        title={pickerApp ? `Open ${pickerApp.name} for...` : undefined}
        app={pickerApp}
      />
    </div>
    </PageScroll>
  );
}
