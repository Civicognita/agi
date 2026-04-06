/**
 * MagicApps Admin — manage app installs, open BuilderChat.
 * Backend perspective page at /magic-apps/admin.
 */

import { useEffect, useState } from "react";
import { fetchMagicApps } from "@/api.js";
import type { MagicAppInfo } from "@/types.js";
import { Button } from "@/components/ui/button.js";

export default function MagicAppsAdminPage() {
  const [apps, setApps] = useState<MagicAppInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMagicApps()
      .then(setApps)
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">MagicApps Admin</h1>
        <Button variant="default" onClick={() => {
          // TODO: Open BuilderChat session
          alert("BuilderChat coming in Phase 1E");
        }}>
          Create New
        </Button>
      </div>

      {loading && <div className="text-muted-foreground text-sm">Loading...</div>}

      <div className="space-y-3">
        {apps.map((app) => (
          <div key={app.id} className="p-4 rounded-xl border border-border bg-card flex items-center justify-between">
            <div>
              <div className="font-semibold text-foreground">{app.name}</div>
              <div className="text-xs text-muted-foreground">{app.description}</div>
              <div className="flex gap-2 mt-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{app.category}</span>
                <span className="text-[10px] text-muted-foreground">v{app.version}</span>
                {app.pluginId && (
                  <span className="text-[10px] text-muted-foreground">plugin: {app.pluginId}</span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <span className="text-[10px] px-2 py-1 rounded bg-green/15 text-green font-semibold">installed</span>
            </div>
          </div>
        ))}
      </div>

      {!loading && apps.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No MagicApps registered. Use BuilderChat to create one.
        </div>
      )}
    </div>
  );
}
