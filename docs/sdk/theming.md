# Theming Guide

This guide covers everything a plugin developer needs to know to create themes that work correctly with the Aionima dashboard, react-fancy components, recharts/react-echarts charts, and the future plugin seal system.

---

## How the Theme System Works

The dashboard uses **CSS custom properties** (variables) for all colors. When a user selects a theme, the `ThemeProvider` sets 21 semantic properties on `document.documentElement`. Every UI element — cards, buttons, text, charts, borders — reads from these variables.

**Runtime flow:**

1. Plugin calls `api.registerTheme(def)` during activation
2. Backend exposes the theme via `GET /api/dashboard/plugin-themes`
3. `ThemeProvider` merges built-in + plugin themes on mount
4. User selects a theme in Settings → Theme picker
5. `ThemeProvider` applies all CSS custom properties to `<html>`
6. `ThemeProvider` sets `color-scheme: dark | light` for native controls
7. `ThemeProvider` toggles `class="dark"` on `<html>` for Tailwind dark mode
8. Selection persists to config via `PUT /api/config` (`ui.theme` field)

---

## Creating a Theme Plugin

```typescript
import { createPlugin, defineTheme } from "@agi/sdk";

export default createPlugin({
  async activate(api) {
    const theme = defineTheme("solarized-dark", "Solarized Dark")
      .description("Solarized dark color scheme by Ethan Schoonover")
      .dark()
      .properties({
        "--color-background":           "#002b36",
        "--color-foreground":           "#839496",
        "--color-card":                 "#073642",
        "--color-card-foreground":      "#839496",
        "--color-popover":              "#073642",
        "--color-popover-foreground":   "#839496",
        "--color-primary":              "#268bd2",
        "--color-primary-foreground":   "#002b36",
        "--color-secondary":            "#073642",
        "--color-secondary-foreground": "#839496",
        "--color-muted":                "#073642",
        "--color-muted-foreground":     "#586e75",
        "--color-accent":               "#073642",
        "--color-accent-foreground":    "#839496",
        "--color-destructive":          "#dc322f",
        "--color-destructive-foreground":"#002b36",
        "--color-border":               "#073642",
        "--color-input":                "#073642",
        "--color-ring":                 "#268bd2",
        "--color-success":              "#859900",
        "--color-warning":              "#b58900",
      })
      .build();

    api.registerTheme(theme);
  },
});
```

**Manifest (`package.json`):**

```json
{
  "aionima": {
    "id": "plugin-theme-solarized",
    "name": "Solarized Theme",
    "version": "1.0.0",
    "description": "Solarized color scheme for the Aionima dashboard",
    "aionimaVersion": ">=0.3.0",
    "permissions": [],
    "entry": "./src/index.ts",
    "provides": ["themes"]
  }
}
```

---

## Required Semantic Properties (21 total)

Every theme **must** define all 21 properties. Omitting any will leave it as whatever the previous theme set, causing visual inconsistency.

### Background & Foreground

| Property | Usage | Example (dark) |
|----------|-------|----------------|
| `--color-background` | Page background, body | `#0f1117` |
| `--color-foreground` | Default text color | `#e1e4ea` |

### Card & Popover Surfaces

| Property | Usage | Example (dark) |
|----------|-------|----------------|
| `--color-card` | Card backgrounds, panels | `#181b23` |
| `--color-card-foreground` | Text inside cards | `#e1e4ea` |
| `--color-popover` | Popover/dropdown backgrounds | `#181b23` |
| `--color-popover-foreground` | Text inside popovers | `#e1e4ea` |

### Brand & Interactive

| Property | Usage | Example (dark) |
|----------|-------|----------------|
| `--color-primary` | Primary buttons, active states, links | `#5b8def` |
| `--color-primary-foreground` | Text on primary backgrounds | `#0f1117` |
| `--color-secondary` | Secondary buttons, subtle backgrounds | `#262a35` |
| `--color-secondary-foreground` | Text on secondary backgrounds | `#e1e4ea` |

### Muted & Accent

| Property | Usage | Example (dark) |
|----------|-------|----------------|
| `--color-muted` | Disabled backgrounds, subtle fills | `#262a35` |
| `--color-muted-foreground` | Secondary text, placeholders, labels | `#8b8fa3` |
| `--color-accent` | Hover backgrounds, focus rings | `#262a35` |
| `--color-accent-foreground` | Text on accent backgrounds | `#e1e4ea` |

### Semantic Status

| Property | Usage | Example (dark) |
|----------|-------|----------------|
| `--color-destructive` | Delete buttons, error text, danger alerts | `#ef4444` |
| `--color-destructive-foreground` | Text on destructive backgrounds | `#0f1117` |
| `--color-success` | Success states, enabled toggles, positive values | `#22c55e` |
| `--color-warning` | Warning alerts, caution states | `#f59e0b` |

### Structural

| Property | Usage | Example (dark) |
|----------|-------|----------------|
| `--color-border` | Card borders, dividers, table lines | `#262a35` |
| `--color-input` | Input field borders and backgrounds | `#262a35` |
| `--color-ring` | Focus ring around interactive elements | `#5b8def` |

---

## Dark Mode Requirements

The dashboard uses **two dark mode mechanisms** simultaneously. Your theme must work with both:

### 1. CSS Custom Properties (our system)

Your 21 properties control all Aionima-authored UI — cards, text, charts, settings panels, sidebar. This works for any theme, dark or light.

### 2. Tailwind `dark:` Class Variant (react-fancy)

The `@particle-academy/react-fancy` component library uses Tailwind's class-based dark mode. When `ThemeProvider` applies a dark theme, it adds `class="dark"` to `<html>`. When it applies a light theme, it removes it.

**What this means for your theme:**

- If `dark: true` → react-fancy components use their dark variants (`dark:bg-zinc-900`, `dark:text-white`, etc.)
- If `dark: false` → react-fancy components use their light variants (`bg-white`, `text-gray-900`, etc.)
- The dashboard's `index.css` globally overrides react-fancy's built-in backgrounds using `data-react-fancy-*` attribute selectors (e.g., `[data-react-fancy-card] { background-color: var(--color-card) }`). This means your theme's semantic CSS vars automatically apply to all react-fancy components — Card, Modal, Dropdown, Popover, Tooltip, Command palette, and Toast

**Always set `dark` correctly** in your theme definition. A dark theme with `dark: false` will render react-fancy components in light mode while your custom properties show dark backgrounds — a jarring mismatch.

```typescript
// CORRECT: dark theme with dark: true
defineTheme("my-dark", "My Dark Theme")
  .dark()           // ← sets dark: true, triggers class="dark" on <html>
  .properties({ "--color-background": "#1a1a2e", ... })
  .build();

// CORRECT: light theme without .dark()
defineTheme("my-light", "My Light Theme")
  // dark defaults to false → no class="dark" on <html>
  .properties({ "--color-background": "#f8f9fb", ... })
  .build();

// WRONG: dark colors but dark: false
defineTheme("broken", "Broken Theme")
  // Missing .dark() → react-fancy renders white cards on your dark background
  .properties({ "--color-background": "#1a1a2e", ... })
  .build();
```

---

## Chart Integration

### Recharts

The dashboard's built-in charts (BreakdownChart, TimelineChart, ResourceUsage) reference CSS variables directly in their style props:

```tsx
<CartesianGrid stroke="var(--color-border)" />
<XAxis tick={{ fill: "var(--color-muted-foreground)" }} />
<Tooltip contentStyle={{
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
}} />
```

Your theme's `--color-card`, `--color-border`, and `--color-muted-foreground` automatically apply to all recharts instances. No extra work needed.

### react-echarts (`@particle-academy/react-echarts`)

For plugin-provided charts using react-echarts, read CSS custom properties at render time and pass them as echarts theme options:

```typescript
function useThemeColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    background:  style.getPropertyValue("--color-card").trim(),
    text:        style.getPropertyValue("--color-foreground").trim(),
    primary:     style.getPropertyValue("--color-primary").trim(),
    success:     style.getPropertyValue("--color-success").trim(),
    warning:     style.getPropertyValue("--color-warning").trim(),
    destructive: style.getPropertyValue("--color-destructive").trim(),
    border:      style.getPropertyValue("--color-border").trim(),
    muted:       style.getPropertyValue("--color-muted-foreground").trim(),
  };
}
```

Apply to echarts options:

```typescript
const colors = useThemeColors();

const option = {
  backgroundColor: colors.background,
  textStyle: { color: colors.text },
  legend: { textStyle: { color: colors.muted } },
  xAxis: { axisLine: { lineStyle: { color: colors.border } } },
  yAxis: { axisLine: { lineStyle: { color: colors.border } } },
  series: [{
    type: "bar",
    itemStyle: { color: colors.primary },
  }],
};
```

### react-fancy Charts (`Chart.*`)

The `WidgetRenderer` uses react-fancy chart components (`Chart.Bar`, `Chart.Line`, `Chart.Pie`, etc.) for plugin-provided chart widgets. These components inherit colors from the Tailwind theme — which means they respond to `class="dark"` on `<html>` and your `--color-primary` / `--color-success` / etc. variables.

---

## Structural Color Aliases

The CSS has backward-compatible aliases for legacy Tailwind utility classes used throughout the dashboard:

| Legacy Class | Maps To | Semantic Property |
|--------------|---------|-------------------|
| `bg-surface0` | `var(--color-secondary)` | `--color-secondary` |
| `bg-surface1` | `var(--color-muted)` | `--color-muted` |
| `bg-surface2` | `var(--color-muted-foreground)` | `--color-muted-foreground` |
| `bg-mantle` | `var(--color-card)` | `--color-card` |

These aliases follow your theme's semantic properties automatically. You don't need to define them — they're derived from your 21 required properties.

---

## Plugin Seal & Theme Compliance (Future)

The upcoming Aionima ID service plugin seal system will include automated theme compliance checks as part of the verification process. Plugins that register themes will be validated against these criteria:

### Seal Requirements (Planned)

1. **Completeness** — All 21 semantic properties must be defined. Missing properties fail the seal check.

2. **Contrast ratios** — WCAG AA minimum contrast ratios will be enforced:
   - `foreground` on `background`: ≥ 4.5:1
   - `card-foreground` on `card`: ≥ 4.5:1
   - `primary-foreground` on `primary`: ≥ 4.5:1
   - `destructive-foreground` on `destructive`: ≥ 4.5:1

3. **Dark mode correctness** — The `dark` boolean must match the actual luminance of `--color-background`:
   - `dark: true` → background luminance < 0.2
   - `dark: false` → background luminance > 0.5

4. **react-fancy compatibility** — Themes must not conflict with react-fancy's Tailwind `dark:` variants. The seal will render a test page with all react-fancy components and verify no white-on-white or black-on-black rendering.

5. **Chart readability** — The seal will verify that `--color-success`, `--color-warning`, and `--color-destructive` are visually distinct from each other and from `--color-primary` (minimum ΔE of 20 in CIELAB space).

### Building for Seal Compliance Now

Even before the seal system is implemented, following these guidelines ensures your theme will pass:

- Define all 21 properties with hex values (not `var()` references to other properties)
- Set `dark` correctly based on your background luminance
- Ensure readable contrast between foreground/background pairs
- Use distinct hues for status colors (success, warning, destructive)
- Test your theme with the Settings page, Marketplace page, and any chart-heavy page

---

## Testing Your Theme

### Manual Testing

Apply your theme and verify these pages:

1. **Overview** — Cards, activity feed, charts render with correct backgrounds
2. **Marketplace** — Plugin cards, badges, trust tier badges legible
3. **Settings** — Theme picker shows your theme tile with correct swatches
4. **COA Explorer** — Table rows, borders, and chart tooltips are readable
5. **Projects** — Card backgrounds, status badges, and toolbar buttons

### Automated Testing

The e2e test suite includes `dark-mode.spec.ts` which verifies:

- `<html>` has `class="dark"` when dark theme is active
- Cards don't render with white backgrounds
- `color-scheme` CSS property is set correctly
- Theme CSS custom properties are applied

Run with: `pnpm test:e2e:ui`

### Using the Mock API

```typescript
import { testActivate } from "@agi/sdk/testing";
import * as plugin from "./index.js";

const regs = await testActivate(plugin);

// Verify theme was registered
expect(regs.themes).toHaveLength(1);
expect(regs.themes[0].dark).toBe(true);

// Verify all 21 properties are defined
const REQUIRED_KEYS = [
  "--color-background", "--color-foreground",
  "--color-card", "--color-card-foreground",
  "--color-popover", "--color-popover-foreground",
  "--color-primary", "--color-primary-foreground",
  "--color-secondary", "--color-secondary-foreground",
  "--color-muted", "--color-muted-foreground",
  "--color-accent", "--color-accent-foreground",
  "--color-destructive", "--color-destructive-foreground",
  "--color-border", "--color-input", "--color-ring",
  "--color-success", "--color-warning",
];

for (const key of REQUIRED_KEYS) {
  expect(regs.themes[0].properties[key]).toBeDefined();
}
```

---

## Reference: Built-in Themes

| ID | Name | Dark | Character |
|----|------|------|-----------|
| `aionima-dark` | Aionima Dark | Yes | **Default** — slate/zinc base, blue accent |
| `aionima-light` | Aionima Light | No | White/gray, high contrast |
| `catppuccin-mocha` | Catppuccin Mocha | Yes | Warm pastel dark palette |
| `catppuccin-latte` | Catppuccin Latte | No | Warm pastel light palette |
| `midnight` | Midnight | Yes | True black OLED, indigo accents |

---

## `defineTheme()` Builder Reference

```typescript
defineTheme(id: string, name: string): ThemeBuilder
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.description(desc)` | `string` | Human-readable theme description |
| `.dark(isDark?)` | `boolean` | Whether this is a dark theme. Default: `false`. Controls `class="dark"` on `<html>` and `color-scheme` |
| `.property(key, value)` | `string, string` | Set a single CSS custom property |
| `.properties(props)` | `Record<string, string>` | Set multiple CSS custom properties at once |
| `.build()` | — | Validate and return the `ThemeDefinition` |

**TypeScript type:**

```typescript
interface ThemeDefinition {
  id: string;
  name: string;
  description?: string;
  dark: boolean;
  properties: Record<string, string>;
}
```
