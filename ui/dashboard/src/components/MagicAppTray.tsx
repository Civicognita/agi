/**
 * MagicAppTray — footer taskbar for minimized MagicApp instances.
 *
 * Shows only when at least 1 app is minimized.
 * Click a card to restore the app to its previous mode.
 */

import type { MagicAppInfo, MagicAppInstance } from "@/types.js";

export interface MagicAppTrayProps {
  instances: MagicAppInstance[];
  apps: MagicAppInfo[];
  onRestore: (instanceId: string) => void;
  onClose: (instanceId: string) => void;
}

export function MagicAppTray({ instances, apps, onRestore, onClose }: MagicAppTrayProps) {
  const minimized = instances.filter((i) => i.mode === "minimized");
  if (minimized.length === 0) return null;

  const getApp = (appId: string) => apps.find((a) => a.id === appId);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[130] bg-mantle border-t border-border px-3 py-1.5 flex items-center gap-2">
      {minimized.map((inst) => {
        const app = getApp(inst.appId);
        return (
          <div
            key={inst.instanceId}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card border border-border hover:border-primary/30 cursor-pointer transition-colors group"
            onClick={() => onRestore(inst.instanceId)}
          >
            <span className="text-xs">{app?.icon ?? "\u2728"}</span>
            <span className="text-[11px] font-medium text-foreground">{app?.name ?? inst.appId}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(inst.instanceId); }}
              className="text-[9px] text-muted-foreground hover:text-red ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              {"\u2715"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
