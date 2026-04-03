/**
 * ThemeProvider — runtime theme switching via CSS custom properties.
 *
 * On mount, reads the active theme from config (GET /api/config → ui.theme).
 * Fetches plugin themes from GET /api/dashboard/plugin-themes and merges them
 * with built-in themes. Applies by setting CSS custom properties on <html>.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { builtInThemes, SEMANTIC_KEYS } from "../themes/index.js";
import type { BuiltInTheme } from "../themes/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThemeEntry {
  id: string;
  name: string;
  dark: boolean;
  properties: Record<string, string>;
  source: "built-in" | "plugin";
}

interface ThemeContextValue {
  themeId: string;
  setTheme: (id: string) => void;
  themes: ThemeEntry[];
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeContext = createContext<ThemeContextValue>({
  themeId: "aionima-dark",
  setTheme: () => {},
  themes: [],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyTheme(theme: ThemeEntry) {
  const root = document.documentElement;

  // Set all semantic properties
  for (const key of SEMANTIC_KEYS) {
    const value = theme.properties[key];
    if (value) {
      root.style.setProperty(key, value);
    }
  }

  // Set color-scheme for native form controls
  root.style.colorScheme = theme.dark ? "dark" : "light";

  // Toggle dark class for Tailwind's class-based dark mode (used by react-fancy)
  root.classList.toggle("dark", theme.dark);
}

async function fetchConfig(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return {};
    return await res.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function fetchPluginThemes(): Promise<ThemeEntry[]> {
  try {
    const res = await fetch("/api/dashboard/plugin-themes");
    if (!res.ok) return [];
    const data = await res.json() as Array<{
      id: string;
      name: string;
      dark?: boolean;
      properties?: Record<string, string>;
    }>;
    return data.map((t) => ({
      id: t.id,
      name: t.name,
      dark: t.dark ?? true,
      properties: t.properties ?? {},
      source: "plugin" as const,
    }));
  } catch {
    return [];
  }
}

async function persistTheme(themeId: string): Promise<void> {
  try {
    const config = await fetchConfig();
    const ui = (config.ui as Record<string, unknown>) ?? {};
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...config, ui: { ...ui, theme: themeId } }),
    });
  } catch {
    // Non-critical — theme still applied in memory
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DEFAULT_THEME = "aionima-dark";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState(DEFAULT_THEME);
  const [pluginThemes, setPluginThemes] = useState<ThemeEntry[]>([]);

  // Merge built-in + plugin themes
  const themes = useMemo<ThemeEntry[]>(() => {
    const builtIn: ThemeEntry[] = builtInThemes.map((t) => ({
      ...t,
      source: "built-in" as const,
    }));
    return [...builtIn, ...pluginThemes];
  }, [pluginThemes]);

  // Load saved theme + plugin themes on mount
  useEffect(() => {
    Promise.all([fetchConfig(), fetchPluginThemes()]).then(([config, pThemes]) => {
      setPluginThemes(pThemes);

      const ui = config.ui as Record<string, unknown> | undefined;
      const saved = ui?.theme as string | undefined;
      const allThemes: ThemeEntry[] = [
        ...builtInThemes.map((t): ThemeEntry => ({ ...t, source: "built-in" })),
        ...pThemes,
      ];

      const resolvedId = saved && allThemes.find((t) => t.id === saved) ? saved : DEFAULT_THEME;
      setThemeIdState(resolvedId);

      const theme = allThemes.find((t) => t.id === resolvedId) ?? allThemes[0]!;
      applyTheme(theme);
    }).catch(() => {
      // Fallback: apply default built-in theme
      const fallback = builtInThemes[0]!;
      applyTheme({ ...fallback, source: "built-in" });
    });
  }, []);

  // Switch theme
  const setTheme = useCallback(
    (id: string) => {
      const allThemes: ThemeEntry[] = [
        ...builtInThemes.map((t): ThemeEntry => ({ ...t, source: "built-in" })),
        ...pluginThemes,
      ];
      const theme = allThemes.find((t) => t.id === id);
      if (!theme) return;

      setThemeIdState(id);
      applyTheme(theme);
      void persistTheme(id);
    },
    [pluginThemes],
  );

  const value = useMemo(() => ({ themeId, setTheme, themes }), [themeId, setTheme, themes]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
