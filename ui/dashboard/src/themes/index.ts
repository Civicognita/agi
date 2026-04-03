/**
 * Built-in theme registry — 5 themes shipping with the dashboard.
 *
 * Each theme provides a complete set of semantic CSS custom properties.
 * Plugin themes (via defineTheme()) are merged at runtime by ThemeProvider.
 */

export interface BuiltInTheme {
  id: string;
  name: string;
  dark: boolean;
  properties: Record<string, string>;
}

/**
 * All 19 semantic properties every theme must define.
 * ThemeProvider sets these on document.documentElement when switching themes.
 */
const SEMANTIC_KEYS = [
  "--color-background",
  "--color-foreground",
  "--color-card",
  "--color-card-foreground",
  "--color-popover",
  "--color-popover-foreground",
  "--color-primary",
  "--color-primary-foreground",
  "--color-secondary",
  "--color-secondary-foreground",
  "--color-muted",
  "--color-muted-foreground",
  "--color-accent",
  "--color-accent-foreground",
  "--color-destructive",
  "--color-destructive-foreground",
  "--color-border",
  "--color-input",
  "--color-ring",
  "--color-success",
  "--color-warning",
] as const;

export { SEMANTIC_KEYS };

export const builtInThemes: BuiltInTheme[] = [
  // -------------------------------------------------------------------------
  // Aionima Dark — default enterprise-grade dark theme
  // -------------------------------------------------------------------------
  {
    id: "aionima-dark",
    name: "Aionima Dark",
    dark: true,
    properties: {
      "--color-background": "#0f1117",
      "--color-foreground": "#e1e4ea",
      "--color-card": "#181b23",
      "--color-card-foreground": "#e1e4ea",
      "--color-popover": "#181b23",
      "--color-popover-foreground": "#e1e4ea",
      "--color-primary": "#5b8def",
      "--color-primary-foreground": "#0f1117",
      "--color-secondary": "#262a35",
      "--color-secondary-foreground": "#e1e4ea",
      "--color-muted": "#262a35",
      "--color-muted-foreground": "#8b8fa3",
      "--color-accent": "#262a35",
      "--color-accent-foreground": "#e1e4ea",
      "--color-destructive": "#ef4444",
      "--color-destructive-foreground": "#0f1117",
      "--color-border": "#262a35",
      "--color-input": "#262a35",
      "--color-ring": "#5b8def",
      "--color-success": "#22c55e",
      "--color-warning": "#f59e0b",
    },
  },

  // -------------------------------------------------------------------------
  // Aionima Light — professional light theme
  // -------------------------------------------------------------------------
  {
    id: "aionima-light",
    name: "Aionima Light",
    dark: false,
    properties: {
      "--color-background": "#f8f9fb",
      "--color-foreground": "#1a1d27",
      "--color-card": "#ffffff",
      "--color-card-foreground": "#1a1d27",
      "--color-popover": "#ffffff",
      "--color-popover-foreground": "#1a1d27",
      "--color-primary": "#3b6fdf",
      "--color-primary-foreground": "#ffffff",
      "--color-secondary": "#e8eaef",
      "--color-secondary-foreground": "#1a1d27",
      "--color-muted": "#e8eaef",
      "--color-muted-foreground": "#6b7089",
      "--color-accent": "#e8eaef",
      "--color-accent-foreground": "#1a1d27",
      "--color-destructive": "#dc2626",
      "--color-destructive-foreground": "#ffffff",
      "--color-border": "#dfe1e8",
      "--color-input": "#dfe1e8",
      "--color-ring": "#3b6fdf",
      "--color-success": "#16a34a",
      "--color-warning": "#d97706",
    },
  },

  // -------------------------------------------------------------------------
  // Catppuccin Mocha — original dark theme preserved
  // -------------------------------------------------------------------------
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    dark: true,
    properties: {
      "--color-background": "#11111b",
      "--color-foreground": "#cdd6f4",
      "--color-card": "#1e1e2e",
      "--color-card-foreground": "#cdd6f4",
      "--color-popover": "#1e1e2e",
      "--color-popover-foreground": "#cdd6f4",
      "--color-primary": "#89b4fa",
      "--color-primary-foreground": "#11111b",
      "--color-secondary": "#313244",
      "--color-secondary-foreground": "#cdd6f4",
      "--color-muted": "#313244",
      "--color-muted-foreground": "#a6adc8",
      "--color-accent": "#313244",
      "--color-accent-foreground": "#cdd6f4",
      "--color-destructive": "#f38ba8",
      "--color-destructive-foreground": "#11111b",
      "--color-border": "#313244",
      "--color-input": "#313244",
      "--color-ring": "#89b4fa",
      "--color-success": "#a6e3a1",
      "--color-warning": "#fab387",
    },
  },

  // -------------------------------------------------------------------------
  // Catppuccin Latte — original light theme preserved
  // -------------------------------------------------------------------------
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    dark: false,
    properties: {
      "--color-background": "#eff1f5",
      "--color-foreground": "#4c4f69",
      "--color-card": "#ffffff",
      "--color-card-foreground": "#4c4f69",
      "--color-popover": "#ffffff",
      "--color-popover-foreground": "#4c4f69",
      "--color-primary": "#1e66f5",
      "--color-primary-foreground": "#ffffff",
      "--color-secondary": "#ccd0da",
      "--color-secondary-foreground": "#4c4f69",
      "--color-muted": "#e6e9ef",
      "--color-muted-foreground": "#6c6f85",
      "--color-accent": "#e6e9ef",
      "--color-accent-foreground": "#4c4f69",
      "--color-destructive": "#d20f39",
      "--color-destructive-foreground": "#ffffff",
      "--color-border": "#ccd0da",
      "--color-input": "#ccd0da",
      "--color-ring": "#1e66f5",
      "--color-success": "#40a02b",
      "--color-warning": "#fe640b",
    },
  },

  // -------------------------------------------------------------------------
  // Midnight — true black OLED theme with vibrant accents
  // -------------------------------------------------------------------------
  {
    id: "midnight",
    name: "Midnight",
    dark: true,
    properties: {
      "--color-background": "#000000",
      "--color-foreground": "#e4e4e7",
      "--color-card": "#0a0a0c",
      "--color-card-foreground": "#e4e4e7",
      "--color-popover": "#0a0a0c",
      "--color-popover-foreground": "#e4e4e7",
      "--color-primary": "#818cf8",
      "--color-primary-foreground": "#000000",
      "--color-secondary": "#18181b",
      "--color-secondary-foreground": "#e4e4e7",
      "--color-muted": "#18181b",
      "--color-muted-foreground": "#71717a",
      "--color-accent": "#18181b",
      "--color-accent-foreground": "#e4e4e7",
      "--color-destructive": "#f87171",
      "--color-destructive-foreground": "#000000",
      "--color-border": "#27272a",
      "--color-input": "#27272a",
      "--color-ring": "#818cf8",
      "--color-success": "#34d399",
      "--color-warning": "#fbbf24",
    },
  },
];
