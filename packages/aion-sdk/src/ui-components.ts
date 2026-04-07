/**
 * ADF UI Component Catalog (MPx 1.0)
 *
 * Documents all UI components available to MApps and plugins in the
 * Aionima dashboard. Components come from three libraries:
 *
 * - `@particle-academy/react-fancy` — UI component library (60+ components)
 * - `@particle-academy/react-echarts` — Chart library (20+ chart types)
 * - `@particle-academy/fancy-code` — Lightweight embedded code editor
 *
 * MApps use these via WidgetRenderer widget types.
 * Plugins use these via direct import in dashboard pages/panels.
 *
 * @module ui-components
 */

// ---------------------------------------------------------------------------
// Component catalog — grouped by purpose
// ---------------------------------------------------------------------------

/**
 * All available UI components organized by category.
 *
 * Use this catalog to discover what's available for MApp widgets
 * and plugin dashboard UIs.
 */
export const UI_COMPONENTS = {
  /** Layout containers and structure */
  layout: [
    "Card", "Separator", "Tabs", "Accordion", "Sidebar", "Modal", "Portal",
  ],

  /**
   * Content rendering and display.
   *
   * `ContentRenderer` is the primary component for rendering markdown
   * and HTML content. It supports custom tag extensions, auto-detection
   * of format, and adjustable line spacing. Use it instead of raw
   * ReactMarkdown for consistent rendering across the platform.
   */
  content: [
    "ContentRenderer", "Heading", "Text", "Callout", "Badge", "Icon",
    "Emoji", "EmojiSelect", "Profile", "Brand",
  ],

  /** Form inputs and controls */
  forms: [
    "Input", "Textarea", "Select", "MultiSwitch", "Checkbox", "CheckboxGroup",
    "RadioGroup", "Switch", "Slider", "ColorPicker", "DatePicker", "TimePicker",
    "EmojiSelect", "Field", "FileUpload", "OtpInput", "Autocomplete",
  ],

  /** Data display and visualization */
  data: [
    "Table", "Chart", "Diagram", "Timeline", "Kanban", "Progress", "Skeleton",
  ],

  /** Navigation components */
  navigation: [
    "Navbar", "MobileMenu", "Breadcrumbs", "Pagination", "Menu", "ContextMenu",
    "TreeNav",
  ],

  /** Overlay and popup components */
  overlay: [
    "Modal", "Popover", "Dropdown", "Tooltip", "Toast", "Command",
  ],

  /** Media and rich content */
  media: [
    "Avatar", "Carousel", "Canvas", "Composer", "Editor",
  ],

  /**
   * Code editing (from @particle-academy/fancy-code).
   *
   * `CodeEditor` is a lightweight embedded code editor with syntax
   * highlighting and extensible language/theme registries. Only depends
   * on `@particle-academy/react-fancy`.
   *
   * Pair with `TreeNav` (from react-fancy) for IDE-style file navigation.
   *
   * Usage: `<CodeEditor><CodeEditor.Toolbar /><CodeEditor.Panel /><CodeEditor.StatusBar /></CodeEditor>`
   *
   * Import styles: `import "@particle-academy/fancy-code/styles.css";`
   *
   * Built-in languages: JavaScript, TypeScript, HTML, PHP.
   * Custom languages via `registerLanguage()`, custom themes via `registerTheme()`.
   */
  code: [
    "CodeEditor", "CodeEditor.Toolbar", "CodeEditor.Panel", "CodeEditor.StatusBar",
    "useCodeEditor",
  ],

  /** Action buttons and triggers */
  actions: [
    "Action", "Pillbox",
  ],

  /**
   * ECharts chart types (from @particle-academy/react-echarts).
   *
   * Use `EChart` as the base component with chart-specific series configs,
   * or import individual chart types for type-safe props.
   */
  charts: [
    "EChart", "EChart3D", "EChartGraphic",
    "BarChart", "LineChart", "PieChart", "RadarChart", "ScatterChart",
    "HeatmapChart", "TreemapChart", "SunburstChart", "GaugeChart",
    "FunnelChart", "SankeyChart", "GraphChart", "BoxplotChart",
    "CandlestickChart", "MapChart", "ParallelChart",
    "EffectScatterChart", "PictorialBarChart", "CustomChart", "ThemeRiverChart",
  ],
} as const;

// ---------------------------------------------------------------------------
// ContentRenderer — primary content rendering component
// ---------------------------------------------------------------------------

/**
 * ContentRenderer renders markdown or HTML content with support for
 * custom tag extensions. This is the recommended way to display
 * formatted content in MApps and plugin panels.
 *
 * @example
 * ```tsx
 * import { ContentRenderer } from "@particle-academy/react-fancy";
 *
 * <ContentRenderer
 *   value="## Hello\n\nThis is **markdown** content."
 *   format="markdown"
 * />
 * ```
 *
 * Props:
 * - `value: string` — Content to render (required)
 * - `format: "markdown" | "html" | "auto"` — Format detection (default: "auto")
 * - `lineSpacing: number` — Line height multiplier
 * - `className: string` — CSS class
 * - `extensions: RenderExtension[]` — Custom tag renderers
 *
 * Custom tag extensions allow rendering special blocks:
 * ```tsx
 * const extensions = [{
 *   tag: "questions",
 *   component: QuestionBlockRenderer,
 *   block: true,
 * }];
 * ```
 */
export interface ContentRendererConfig {
  value: string;
  format?: "markdown" | "html" | "auto";
  lineSpacing?: number;
  className?: string;
}

// ---------------------------------------------------------------------------
// Widget type mapping — how UI components map to MApp widget types
// ---------------------------------------------------------------------------

/**
 * Maps MApp widget types to their underlying UI components.
 *
 * When a MApp defines `panel.widgets`, each widget type is rendered
 * by WidgetRenderer using the corresponding component.
 */
export const WIDGET_COMPONENT_MAP = {
  "markdown": "ContentRenderer",
  "iframe": "iframe (native)",
  "status-display": "fetch + Card grid",
  "field-group": "Field + Input",
  "action-bar": "Action buttons",
  "table": "Table",
  "metric": "Card + fetch",
  "chart": "EChart",
  "log-stream": "fetch + pre",
  "timeline": "Timeline",
  "kanban": "Kanban",
  "editor": "Editor",
  "diagram": "Diagram",
  "code-editor": "CodeEditor (@particle-academy/fancy-code)",
  "tree-nav": "TreeNav (@particle-academy/react-fancy)",
} as const;

/**
 * All widget types available for MApp panel definitions.
 */
export type MAppWidgetType = keyof typeof WIDGET_COMPONENT_MAP;
