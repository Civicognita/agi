/**
 * MagicApp Detail — individual app info page at /magic-apps/:id.
 *
 * CHN-H (s169): adds Channel Triggers section showing ChannelWorkflowBindings
 * for this MApp — list, add, and remove bindings via /api/channels/workflow-bindings.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import {
  fetchMagicApp,
  openMagicAppInstance,
  listWorkflowBindings,
  addWorkflowBinding,
  deleteWorkflowBinding,
  type ChannelWorkflowBinding,
} from "@/api.js";
import type { MagicAppInfo } from "@/types.js";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { Input } from "@/components/ui/input.js";
import { PageScroll } from "@/components/PageScroll.js";
import { useOutletContext } from "react-router";
import type { RootContext } from "./root.js";

// ---------------------------------------------------------------------------
// Channel Triggers section (CHN-H s169)
// ---------------------------------------------------------------------------

function ChannelTriggersSection({ mappId }: { mappId: string }) {
  const [bindings, setBindings] = useState<ChannelWorkflowBinding[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ channelId: "", roomId: "", messagePattern: "", label: "" });

  const loadBindings = useCallback(async () => {
    try {
      const all = await listWorkflowBindings();
      setBindings(all.filter((b) => b.mappId === mappId));
      setLoadError(null);
    } catch {
      setLoadError("Failed to load channel bindings.");
    }
  }, [mappId]);

  useEffect(() => { void loadBindings(); }, [loadBindings]);

  const handleAdd = async () => {
    if (!form.channelId.trim()) return;
    setAdding(true);
    try {
      await addWorkflowBinding({
        channelId: form.channelId.trim(),
        roomId: form.roomId.trim() || undefined,
        messagePattern: form.messagePattern.trim() || undefined,
        label: form.label.trim() || undefined,
        mappId,
      });
      setForm({ channelId: "", roomId: "", messagePattern: "", label: "" });
      setShowAdd(false);
      await loadBindings();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to add binding.");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkflowBinding(id);
      await loadBindings();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to remove binding.");
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Channel Triggers</h2>
          <p className="text-[11px] text-muted-foreground">
            Bind a channel + room to auto-trigger this MApp when a message arrives.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="text-[11px] h-7"
          onClick={() => setShowAdd((v) => !v)}
          data-testid="mapp-channel-trigger-add-btn"
        >
          {showAdd ? "Cancel" : "+ Add binding"}
        </Button>
      </div>

      {loadError && (
        <p className="text-[11px] text-destructive mb-2" data-testid="mapp-channel-trigger-error">{loadError}</p>
      )}

      {showAdd && (
        <Card className="p-3 mb-3 space-y-2" data-testid="mapp-channel-trigger-form">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">
                Channel ID <span className="text-destructive">*</span>
              </label>
              <Input
                value={form.channelId}
                onChange={(e) => setForm((f) => ({ ...f, channelId: e.target.value }))}
                placeholder="discord, slack, telegram…"
                className="h-7 text-[11px]"
                data-testid="mapp-channel-trigger-channel-input"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">Room ID (optional)</label>
              <Input
                value={form.roomId}
                onChange={(e) => setForm((f) => ({ ...f, roomId: e.target.value }))}
                placeholder="leave blank for any room"
                className="h-7 text-[11px]"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">
                Message pattern (optional regex)
              </label>
              <Input
                value={form.messagePattern}
                onChange={(e) => setForm((f) => ({ ...f, messagePattern: e.target.value }))}
                placeholder="e.g. ^!deploy"
                className="h-7 text-[11px]"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">Label (optional)</label>
              <Input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. deploy trigger"
                className="h-7 text-[11px]"
              />
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              className="text-[11px] h-7"
              onClick={() => void handleAdd()}
              disabled={adding || !form.channelId.trim()}
              data-testid="mapp-channel-trigger-save-btn"
            >
              {adding ? "Saving…" : "Save binding"}
            </Button>
          </div>
        </Card>
      )}

      {bindings.length === 0 ? (
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground italic">
            No channel bindings yet. Add one above to trigger this MApp from incoming messages.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {bindings.map((b) => (
            <Card
              key={b.id}
              className="p-3 flex items-start gap-3"
              data-testid={`mapp-channel-trigger-row-${b.id}`}
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-[12px] font-medium text-foreground">
                  {b.label ?? `${b.channelId} trigger`}
                </p>
                <p className="text-[11px] text-muted-foreground font-mono">
                  {b.channelId}
                  {b.roomId ? ` · room: ${b.roomId}` : " · any room"}
                  {b.messagePattern ? ` · pattern: ${b.messagePattern}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-[11px] h-6 text-destructive hover:text-destructive shrink-0"
                onClick={() => void handleDelete(b.id)}
                data-testid={`mapp-channel-trigger-delete-${b.id}`}
              >
                Remove
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

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

  if (loading) return <PageScroll><div className="text-muted-foreground">Loading...</div></PageScroll>;
  if (!app) return <PageScroll><div className="text-red">MagicApp not found</div></PageScroll>;

  const handleOpen = async () => {
    try {
      await openMagicAppInstance(app.id, "floating");
      ctx.onRefreshMagicApps?.();
    } catch (err) {
      console.error("Failed to open:", err);
    }
  };

  return (
    <PageScroll>
    <div className="max-w-3xl">
      <div className="flex items-start gap-4 mb-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-3xl">
          {app.icon ?? "✨"}
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
        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Project Types</div>
          <div className="text-sm font-semibold">{(app.projectTypes ?? []).join(", ") || "None"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Categories</div>
          <div className="text-sm font-semibold">{(app.projectCategories ?? []).join(", ") || "None"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Agent Prompts</div>
          <div className="text-sm font-semibold">{app.agentPromptCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Workflows</div>
          <div className="text-sm font-semibold">{app.workflowCount}</div>
        </Card>
      </div>

      {/* CHN-H (s169) — channel trigger bindings for this MApp */}
      <ChannelTriggersSection mappId={app.id} />
    </div>
    </PageScroll>
  );
}
