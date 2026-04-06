/**
 * MagicApps Desktop — icon grid index page at /magic-apps.
 *
 * Shows all registered MagicApps as large clickable icons.
 * Clicking an icon opens the app in a floating modal (not navigation).
 */

import { useEffect, useState } from "react";
import { fetchMagicApps } from "@/api.js";
import type { MagicAppInfo } from "@/types.js";
import { useOutletContext } from "react-router";
import type { RootContext } from "./root.js";
import { ProjectPickerDialog } from "@/components/ProjectPickerDialog.js";

const CATEGORY_ICONS: Record<string, string> = {
  reader: "\uD83D\uDCD6",
  gallery: "\uD83D\uDDBC\uFE0F",
  dashboard: "\uD83D\uDCCA",
  viewer: "\uD83D\uDC41\uFE0F",
  editor: "\u270F\uFE0F",
  custom: "\u2728",
};

export default function MagicAppsPage() {
  const ctx = useOutletContext<RootContext>();
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
    <div className="p-6 min-h-[calc(100vh-4rem)]">
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

      {[...grouped.entries()].map(([category, categoryApps]) => (
        <div key={category} className="mb-8">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {category}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {categoryApps.map((app) => (
              <button
                key={app.id}
                onClick={() => handleAppClick(app)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-card hover:bg-accent/10 hover:border-primary/30 transition-all cursor-pointer group"
              >
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                  {CATEGORY_ICONS[app.category] ?? "\u2728"}
                </div>
                <span className="text-sm font-medium text-foreground text-center leading-tight">
                  {app.name}
                </span>
                <span className="text-[10px] text-muted-foreground">v{app.version}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Project picker dialog — shown when user clicks an app icon */}
      <ProjectPickerDialog
        open={pickerApp !== null}
        onSelect={(path) => void handleProjectSelected(path)}
        onClose={() => setPickerApp(null)}
        projects={ctx.projectsHook.projects}
        title={pickerApp ? `Open ${pickerApp.name} for...` : undefined}
      />
    </div>
  );
}
