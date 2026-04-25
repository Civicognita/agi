/**
 * MagicApp Instance Manager — manages open app lifecycles.
 *
 * Syncs with backend for persistence (survives crash/browser close).
 * Debounced state saves every 5 seconds on change.
 */

import {
  fetchMagicAppInstances,
  openMagicAppInstance,
  saveMagicAppState,
  changeMagicAppMode,
  closeMagicAppInstance,
} from "@/api.js";
import type { MagicAppInstance } from "@/types.js";

export type InstanceMode = "floating" | "docked" | "minimized" | "maximized";

export interface MagicAppInstanceManager {
  instances: MagicAppInstance[];
  openApp(appId: string, projectPath: string): Promise<MagicAppInstance>;
  closeApp(instanceId: string): Promise<void>;
  minimizeApp(instanceId: string): Promise<void>;
  restoreApp(instanceId: string): Promise<void>;
  setMode(instanceId: string, mode: InstanceMode): Promise<void>;
  saveState(instanceId: string, state: Record<string, unknown>): void;
  refresh(): Promise<void>;
}

export function createInstanceManager(
  onChange: (instances: MagicAppInstance[]) => void,
): MagicAppInstanceManager {
  let instances: MagicAppInstance[] = [];
  // Track whether this is the first refresh call, so we only auto-collapse
  // floating/maximized modals on initial page load (story #101 task #357).
  // Subsequent manual refreshes mid-session should respect whatever the
  // user'\\''s explicit setMode actions established.
  let isInitialLoad = true;
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const notify = () => onChange([...instances]);

  const mgr: MagicAppInstanceManager = {
    get instances() { return instances; },

    async openApp(appId: string, projectPath: string) {
      const instance = await openMagicAppInstance(appId, projectPath, "floating");
      instances = [...instances, instance];
      notify();
      return instance;
    },

    async closeApp(instanceId: string) {
      // Clear pending save
      const timer = saveTimers.get(instanceId);
      if (timer) { clearTimeout(timer); saveTimers.delete(instanceId); }

      await closeMagicAppInstance(instanceId);
      instances = instances.filter((i) => i.instanceId !== instanceId);
      notify();
    },

    async minimizeApp(instanceId: string) {
      await changeMagicAppMode(instanceId, "minimized");
      instances = instances.map((i) =>
        i.instanceId === instanceId ? { ...i, mode: "minimized" as const } : i,
      );
      notify();
    },

    async restoreApp(instanceId: string) {
      await changeMagicAppMode(instanceId, "floating");
      instances = instances.map((i) =>
        i.instanceId === instanceId ? { ...i, mode: "floating" as const } : i,
      );
      notify();
    },

    async setMode(instanceId: string, mode: InstanceMode) {
      await changeMagicAppMode(instanceId, mode);
      instances = instances.map((i) =>
        i.instanceId === instanceId ? { ...i, mode } : i,
      );
      notify();
    },

    saveState(instanceId: string, state: Record<string, unknown>) {
      // Update local state immediately
      instances = instances.map((i) =>
        i.instanceId === instanceId ? { ...i, state } : i,
      );

      // Debounced save to backend (5s)
      const existing = saveTimers.get(instanceId);
      if (existing) clearTimeout(existing);
      saveTimers.set(instanceId, setTimeout(() => {
        saveTimers.delete(instanceId);
        void saveMagicAppState(instanceId, state);
      }, 5000));
    },

    async refresh() {
      try {
        const fetched = await fetchMagicAppInstances();
        if (isInitialLoad) {
          // Auto-collapse floating/maximized instances on FIRST load only —
          // page loads shouldn't surprise the user with a stale modal from a
          // previous session (story #101 task #357). The server-side persisted
          // mode is preserved so explicit reopen actions can restore it; the
          // dashboard just doesn't auto-render the modal at session start.
          instances = fetched.map((i) =>
            i.mode === "minimized" ? i : { ...i, mode: "minimized" as const },
          );
          isInitialLoad = false;
        } else {
          // Subsequent refreshes (manual button, after openApp etc.) reflect
          // server state honestly so user actions in this session are
          // preserved.
          instances = fetched;
        }
        notify();
      } catch {
        // Keep existing state on error
      }
    },
  };

  return mgr;
}
