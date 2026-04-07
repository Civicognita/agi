/**
 * MagicAppPicker — MagicApps tab content for project detail.
 *
 * Shows attached apps, viewer selector (non-dev), and "Add App" picker.
 * Available for ALL project types.
 */

import { useEffect, useState } from "react";
import { fetchMagicApps, setProjectViewer, attachMagicApp, detachMagicApp } from "@/api.js";
import type { MagicAppInfo, ProjectInfo } from "@/types.js";
import { Button } from "@/components/ui/button.js";

export interface MagicAppPickerProps {
  project: ProjectInfo;
  onOpenApp: (appId: string, projectPath: string) => void;
  onRefresh: () => void;
}

/** Check if a MApp is compatible with a project's type and category. */
function isCompatible(app: MagicAppInfo, project: ProjectInfo): boolean {
  if (app.projectTypes?.length && !app.projectTypes.includes(project.projectType?.id ?? "")) return false;
  if (app.projectCategories?.length && !app.projectCategories.includes(project.category ?? project.projectType?.category ?? "")) return false;
  return true;
}

export function MagicAppPicker({ project, onOpenApp, onRefresh }: MagicAppPickerProps) {
  const [allApps, setAllApps] = useState<MagicAppInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMagicApps()
      .then(setAllApps)
      .catch(() => setAllApps([]))
      .finally(() => setLoading(false));
  }, []);

  const attachedIds = new Set(project.magicApps ?? []);
  const viewerId = project.hosting?.viewer;
  const isCodeProject = project.projectType?.hasCode === true;

  const handleSetViewer = async (appId: string) => {
    try {
      await setProjectViewer(project.path, appId || null);
      onRefresh();
    } catch (err) {
      console.error("Failed to set viewer:", err);
    }
  };

  const handleAttach = async (appId: string) => {
    try {
      await attachMagicApp(project.path, appId);
      onRefresh();
    } catch (err) {
      console.error("Failed to attach app:", err);
    }
  };

  const handleDetach = async (appId: string) => {
    try {
      await detachMagicApp(project.path, appId);
      onRefresh();
    } catch (err) {
      console.error("Failed to detach app:", err);
    }
  };

  if (loading) return <div className="text-muted-foreground text-sm">Loading apps...</div>;

  const compatibleApps = allApps.filter((a) => isCompatible(a, project));

  return (
    <div className="space-y-4">
      {/* Viewer setting — non-dev projects only */}
      {!isCodeProject && (
        <div className="p-3 rounded-lg border border-border bg-mantle">
          <h4 className="text-[12px] font-semibold text-foreground mb-2">Content Viewer</h4>
          <p className="text-[11px] text-muted-foreground mb-2">
            Choose which MagicApp serves this project's content at <strong>{project.hosting?.hostname}.ai.on</strong>
          </p>
          <select
            value={viewerId ?? ""}
            onChange={(e) => void handleSetViewer(e.target.value)}
            className="w-full h-8 px-2 rounded-md border border-border bg-background text-foreground text-[12px]"
          >
            <option value="">None (no viewer)</option>
            {compatibleApps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.category})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Attached apps */}
      <div>
        <h4 className="text-[12px] font-semibold text-foreground mb-2">Attached Apps</h4>
        {attachedIds.size === 0 ? (
          <div className="text-[11px] text-muted-foreground py-3 text-center">
            No MagicApps attached to this project yet.
          </div>
        ) : (
          <div className="space-y-2">
            {allApps.filter((a) => attachedIds.has(a.id)).map((app) => (
              <div key={app.id} className="flex items-center justify-between p-2 rounded-lg border border-border bg-card">
                <div>
                  <span className="text-[12px] font-medium text-foreground">{app.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{app.category}</span>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => onOpenApp(app.id, project.path)}>
                    Open
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleDetach(app.id)}>
                    Detach
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Available apps to attach */}
      <div>
        <h4 className="text-[12px] font-semibold text-foreground mb-2">Available Apps</h4>
        <div className="grid grid-cols-2 gap-2">
          {compatibleApps.filter((a) => !attachedIds.has(a.id)).map((app) => (
            <div
              key={app.id}
              className="p-2 rounded-lg border border-border bg-card hover:border-primary/30 text-left transition-colors"
            >
              <div className="text-[11px] font-medium text-foreground">{app.name}</div>
              <div className="text-[10px] text-muted-foreground mb-2">{app.description}</div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="text-[10px] h-6 px-2" onClick={() => onOpenApp(app.id, project.path)}>
                  Open
                </Button>
                <Button size="sm" variant="ghost" className="text-[10px] h-6 px-2" onClick={() => void handleAttach(app.id)}>
                  Attach
                </Button>
              </div>
            </div>
          ))}
        </div>
        {compatibleApps.filter((a) => !attachedIds.has(a.id)).length === 0 && (
          <div className="text-[11px] text-muted-foreground py-3 text-center">
            No compatible apps available for this project type.
          </div>
        )}
      </div>
    </div>
  );
}
