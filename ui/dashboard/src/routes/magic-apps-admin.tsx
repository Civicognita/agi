/**
 * MagicApps Admin — manage MApp installs with grid layout.
 * Distinguishes default MApps from custom-built ones.
 */

import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { ContextMenu } from "@particle-academy/react-fancy";
import { fetchMagicApps } from "@/api.js";
import type { MagicAppInfo } from "@/types.js";
import { Button } from "@/components/ui/button.js";
import type { RootContext } from "./root.js";

const DEFAULT_AUTHOR = "civicognita";

export default function MagicAppsAdminPage() {
  const ctx = useOutletContext<RootContext>();
  const navigate = useNavigate();
  const [apps, setApps] = useState<MagicAppInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMagicApps()
      .then(setApps)
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  }, []);

  const defaultApps = apps.filter((a) => a.author === DEFAULT_AUTHOR);
  const customApps = apps.filter((a) => a.author && a.author !== DEFAULT_AUTHOR);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">MagicApps</h1>
          <p className="text-[12px] text-muted-foreground">Manage installed MagicApps</p>
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

      {loading && <div className="text-muted-foreground text-sm">Loading...</div>}

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
                      <span className="text-xl">{app.icon ?? "\u2728"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-foreground truncate">{app.name}</div>
                        <div className="text-[10px] text-muted-foreground">{app.author} &middot; v{app.version}</div>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{app.description}</p>
                    <div className="flex gap-1.5 mt-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{app.category}</span>
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
                  <ContextMenu.Item onClick={() => {
                    ctx.onOpenChatWithMessage(`mapp:${app.id}`, `Tell me about the MApp "${app.name}".`);
                  }}>Talk about this MApp</ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu>
            ))}
          </div>
        </div>
      )}

      {/* Default MApps */}
      {defaultApps.length > 0 && (
        <div className="mb-6">
          <h2 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Built-in</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {defaultApps.map((app) => (
              <div key={app.id} className="rounded-xl border border-border bg-card p-4 opacity-80">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{app.icon ?? "\u2728"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-foreground truncate">{app.name}</div>
                    <div className="text-[10px] text-muted-foreground">{app.author} &middot; v{app.version}</div>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface0 text-muted-foreground">default</span>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2">{app.description}</p>
                <div className="flex gap-1.5 mt-2">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{app.category}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && apps.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No MagicApps installed. Create one with the Editor or Builder.
        </div>
      )}
    </div>
  );
}
