import { useEffect, useState } from "react";
import type { RuntimeMode } from "../types";

/**
 * Fetch + cache the gateway's runtime mode. Used to gate features that
 * don't make sense in test-VM (s118 t122 / s122): nested test-VM spawn,
 * contributing toggle, upgrade buttons, aionima-collection tiles.
 *
 * Mode is stable per gateway lifetime — fetched once on mount, cached.
 * On 403/error returns "production" as the safe default (no extra hiding).
 */
export function useRuntimeMode(): RuntimeMode {
  const [mode, setMode] = useState<RuntimeMode>("production");

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const res = await fetch("/api/system/runtime-mode");
        if (!res.ok) return;
        const data = (await res.json()) as { mode: RuntimeMode };
        if (!cancelled && (data.mode === "production" || data.mode === "test-vm" || data.mode === "dev")) {
          setMode(data.mode);
        }
      } catch {
        /* default "production" stays */
      }
    })();
    return (): void => { cancelled = true; };
  }, []);

  return mode;
}

/**
 * Convenience predicate — returns true when the gateway is running inside
 * the test VM. Most callers want this binary check rather than the full
 * tri-state (test-vm vs production+dev).
 */
export function useIsTestVm(): boolean {
  return useRuntimeMode() === "test-vm";
}
