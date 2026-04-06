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

export type InstanceMode = "floating" | "docked" | "minimized";

export interface MagicAppInstanceManager {
  instances: MagicAppInstance[];
  openApp(appId: string): Promise<MagicAppInstance>;
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
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const notify = () => onChange([...instances]);

  const mgr: MagicAppInstanceManager = {
    get instances() { return instances; },

    async openApp(appId: string) {
      const instance = await openMagicAppInstance(appId, "floating");
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
        instances = await fetchMagicAppInstances();
        notify();
      } catch {
        // Keep existing state on error
      }
    },
  };

  return mgr;
}
