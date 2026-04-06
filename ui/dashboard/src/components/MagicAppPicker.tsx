/**
 * MagicAppPicker — MagicApps tab content for project detail.
 *
 * Shows attached apps, viewer selector (non-dev), and "Add App" picker.
 * Available for ALL project types.
 */

import { useEffect, useState } from "react";
import { fetchMagicApps, configureHosting } from "@/api.js";
import type { MagicAppInfo, ProjectInfo } from "@/types.js";
import { Button } from "@/components/ui/button.js";

export interface MagicAppPickerProps {
  project: ProjectInfo;
  onOpenApp: (appId: string, projectPath: string) => void;
  onRefresh: () => void;
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
      await configureHosting({ path: project.path, type: project.hosting?.type });
      // TODO: Add viewer field to configureHosting API — for now just log
      console.log("Set viewer:", appId);
      onRefresh();
    } catch (err) {
      console.error("Failed to set viewer:", err);
    }
  };

  if (loading) return <div className="text-muted-foreground text-sm">Loading apps...</div>;

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
            {allApps
              .filter((a) => a.projectCategories.includes(project.category ?? project.projectType?.category ?? ""))
              .map((a) => (
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
                <Button size="sm" variant="outline" onClick={() => onOpenApp(app.id, project.path)}>
                  Open
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Available apps to attach */}
      <div>
        <h4 className="text-[12px] font-semibold text-foreground mb-2">Available Apps</h4>
        <div className="grid grid-cols-2 gap-2">
          {allApps.filter((a) => !attachedIds.has(a.id)).map((app) => (
            <button
              key={app.id}
              onClick={() => onOpenApp(app.id, project.path)}
              className="p-2 rounded-lg border border-border bg-card hover:border-primary/30 text-left transition-colors"
            >
              <div className="text-[11px] font-medium text-foreground">{app.name}</div>
              <div className="text-[10px] text-muted-foreground">{app.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
