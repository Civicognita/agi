/**
 * AppearanceProvider — runtime UI customization (Wave 5). Sibling to
 * ThemeProvider: reads ui.appearance from gateway.json on mount and applies
 * documentElement CSS vars that the design system already consumes:
 *   --radius-scale   (Wave 0c — multiplies every --radius-* via calc)
 *   --duration-fast/base/slow  (transition speed)
 *   --space-scale    (density multiplier)
 *   .reduce-motion class (kills transitions/animations)
 * Changes apply live and persist via PATCH /api/config { key:"ui.appearance" }.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export interface Appearance {
  /** Corner roundness: 1 = Subtle, 0.6 = Sharp, 0.15 = Near-square. */
  radiusScale: number;
  motion: "snappy" | "default" | "relaxed";
  reduceMotion: boolean;
  density: "compact" | "comfortable" | "spacious";
}

export const APPEARANCE_DEFAULTS: Appearance = {
  radiusScale: 1,
  motion: "default",
  reduceMotion: false,
  density: "comfortable",
};

const MOTION_MS: Record<Appearance["motion"], [number, number, number]> = {
  snappy: [80, 140, 220],
  default: [120, 200, 320],
  relaxed: [180, 300, 480],
};

const DENSITY_SCALE: Record<Appearance["density"], number> = {
  compact: 0.85,
  comfortable: 1,
  spacious: 1.15,
};

function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  root.style.setProperty("--radius-scale", String(a.radiusScale));
  const [fast, base, slow] = MOTION_MS[a.motion];
  root.style.setProperty("--duration-fast", `${String(fast)}ms`);
  root.style.setProperty("--duration-base", `${String(base)}ms`);
  root.style.setProperty("--duration-slow", `${String(slow)}ms`);
  root.style.setProperty("--space-scale", String(DENSITY_SCALE[a.density]));
  root.classList.toggle("reduce-motion", a.reduceMotion);
}

const AppearanceContext = createContext<{ appearance: Appearance; update: (p: Partial<Appearance>) => void } | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(APPEARANCE_DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/config")
      .then((r) => (r.ok ? r.json() : {}))
      .then((cfg: unknown) => {
        if (cancelled) return;
        const stored = (cfg as { ui?: { appearance?: Partial<Appearance> } }).ui?.appearance ?? {};
        const a: Appearance = { ...APPEARANCE_DEFAULTS, ...stored };
        setAppearance(a);
        applyAppearance(a);
      })
      .catch(() => applyAppearance(APPEARANCE_DEFAULTS));
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((p: Partial<Appearance>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...p };
      applyAppearance(next);
      void fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "ui.appearance", value: next }),
      }).catch(() => { /* persistence best-effort; live state already applied */ });
      return next;
    });
  }, []);

  return <AppearanceContext.Provider value={{ appearance, update }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (ctx === null) throw new Error("useAppearance must be used within <AppearanceProvider>");
  return ctx;
}
