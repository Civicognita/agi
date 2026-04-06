/**
 * MagicApp Detail — individual app info page at /magic-apps/:id.
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { fetchMagicApp, openMagicAppInstance } from "@/api.js";
import type { MagicAppInfo } from "@/types.js";
import { Button } from "@/components/ui/button.js";
import { useOutletContext } from "react-router";
import type { RootContext } from "./root.js";

export default function MagicAppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ctx = useOutletContext<RootContext>();
  const [app, setApp] = useState<MagicAppInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetchMagicApp(id)
      .then(setApp)
      .catch(() => setApp(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!app) return <div className="p-6 text-red">MagicApp not found</div>;

  const handleOpen = async () => {
    try {
      await openMagicAppInstance(app.id, "floating");
      ctx.onRefreshMagicApps?.();
    } catch (err) {
      console.error("Failed to open:", err);
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-start gap-4 mb-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-3xl">
          {app.icon ?? "\u2728"}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">{app.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{app.description}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold">{app.category}</span>
            <span className="text-[10px] text-muted-foreground">v{app.version}</span>
          </div>
        </div>
        <Button onClick={() => void handleOpen()}>Open</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded-xl border border-border bg-card">
          <div className="text-xs text-muted-foreground mb-1">Project Types</div>
          <div className="text-sm font-semibold">{app.projectTypes.join(", ") || "None"}</div>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card">
          <div className="text-xs text-muted-foreground mb-1">Categories</div>
          <div className="text-sm font-semibold">{app.projectCategories.join(", ") || "None"}</div>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card">
          <div className="text-xs text-muted-foreground mb-1">Agent Prompts</div>
          <div className="text-sm font-semibold">{app.agentPromptCount}</div>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card">
          <div className="text-xs text-muted-foreground mb-1">Workflows</div>
          <div className="text-sm font-semibold">{app.workflowCount}</div>
        </div>
      </div>
    </div>
  );
}
