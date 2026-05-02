/**
 * MApp Schema v1.0 (MPx — Mycelium Protocol)
 *
 * The canonical schema for MagicApps (MApps). MApps are standalone,
 * JSON-defined applications — NOT plugins. Plugins extend AGI's
 * capabilities; MApps are task/purpose-specific applications that run
 * inside the Aionima platform.
 *
 * MApps range from simple tools (eReader, transcript analyzer) to full
 * suites (financial management across economic systems). They are:
 * - Declarative (JSON only, no executable code)
 * - Scannable (security scanner validates before install)
 * - Portable (single JSON file, copy to install)
 * - Attributable (author field, COA-tracked as $P resources)
 * - Eventually on-chain (deterministic, compilable)
 *
 * Install path: ~/.agi/mapps/{author}/{slug}.json
 *
 * @module mapp-schema
 * @version 1.0.0
 */

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Current MApp schema version (synced with protocol.json mappSchema). */
export const MAPP_SCHEMA_VERSION = "mapp/1.0" as const;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * MApp categories define the broad purpose of the application.
 *
 * - `viewer` — Content consumption & display (e-readers, galleries, dashboards)
 * - `production` — Asset creation & editing (IDE, mind-mapping, writing suites)
 * - `tool` — Stateless input → output utilities (calculators, analyzers, generators)
 * - `game` — Interactive games and simulations
 * - `custom` — Anything that doesn't fit the above
 */
export type MAppCategory =
  | "viewer"
  | "production"
  | "tool"
  | "game"
  | "custom";

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Permissions that a MApp declares it needs. Users must approve these
 * before the MApp is activated. The security scanner flags dangerous
 * combinations.
 *
 * Known permission IDs:
 * - `container.run` — Run a container (nginx, custom image)
 * - `network.outbound` — Make outbound HTTP requests
 * - `fs.read` — Read files from the project directory
 * - `fs.write` — Write files to the project directory
 * - `agent.prompt` — Inject system prompt context into agent sessions
 * - `agent.tools` — Register agent-callable tools
 * - `workflow.shell` — Execute shell commands in workflows
 * - `workflow.api` — Call external APIs in workflows
 */
export interface MAppPermission {
  /** Permission identifier (e.g. "container.run", "fs.read"). */
  id: string;
  /** Human-readable explanation of why this permission is needed. */
  reason: string;
  /** If false, the MApp works without this permission (degraded mode). */
  required: boolean;
}

// ---------------------------------------------------------------------------
// Container config
// ---------------------------------------------------------------------------

/**
 * Container configuration for MApps that serve content.
 * Not all MApps need containers — tool-type MApps may be UI-only.
 */
export interface MAppContainerConfig {
  /** Container image (e.g. "nginx:alpine"). Must be from a trusted registry. */
  image: string;
  /** Port the container listens on internally. */
  internalPort: number;
  /**
   * Volume mount templates. Use `{projectPath}` for the project directory.
   * Example: `"{projectPath}:/usr/share/nginx/html/content:ro,Z"`
   */
  volumeMounts: string[];
  /** Environment variable templates. */
  env?: Record<string, string>;
  /** Command override. */
  command?: string[];
  /** Health check command inside the container. */
  healthCheck?: string;
}

// ---------------------------------------------------------------------------
// UI Panel
// ---------------------------------------------------------------------------

/**
 * Dashboard panel definition — rendered via WidgetRenderer when the
 * MApp is opened in a modal.
 */
export interface MAppPanel {
  /** Tab label shown in the modal header. */
  label: string;
  /** Declarative widget definitions (iframe, status-display, markdown, etc). */
  widgets: MAppWidget[];
  /** Sort priority (lower = first). */
  position?: number;
}

/**
 * Widget definition for the panel. Matches the PanelWidget union type
 * used by WidgetRenderer.
 */
export type MAppWidget = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/** Visual customization for the MApp's serving SPA. */
export interface MAppTheme {
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  /** CSS custom properties applied to the SPA container. */
  cssProperties?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Agent integration
// ---------------------------------------------------------------------------

/**
 * Agent prompt — injected into the AI's system prompt when working
 * with a project that has this MApp active.
 */
export interface MAppAgentPrompt {
  id: string;
  label: string;
  description?: string;
  /** System prompt text. Keep focused and relevant to the MApp's purpose. */
  systemPrompt: string;
  /** Tool names the agent can use in this context. */
  allowedTools?: string[];
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

/** Workflow step types. */
export type MAppWorkflowStepType = "shell" | "api" | "agent" | "file-transform" | "model-inference";

/**
 * Configuration for a `model-inference` workflow step.
 * The step calls an endpoint on a locally-running model container.
 */
export interface MAppModelInferenceConfig {
  /** HuggingFace model ID to call (must be installed and running). */
  modelId: string;
  /** Path on the model container (e.g. "/predict", "/v1/chat/completions"). */
  endpoint: string;
  /** HTTP method (default "POST"). */
  method?: "GET" | "POST";
  /**
   * JSON body template. Values may contain {{variableName}} placeholders
   * which are resolved against the current workflow context before sending.
   */
  inputTemplate?: Record<string, unknown>;
  /** Key in the workflow context where the response is stored. */
  outputKey: string;
}

/** A single step in a workflow. */
export interface MAppWorkflowStep {
  id: string;
  type: MAppWorkflowStepType;
  label: string;
  /** Step-specific config (command for shell, endpoint for api, prompt for agent). */
  config: Record<string, unknown>;
  /** IDs of steps that must complete before this one runs. */
  dependsOn?: string[];
}

/** Multi-step automation triggered manually, on file change, or on schedule. */
export interface MAppWorkflow {
  id: string;
  name: string;
  description?: string;
  trigger: "manual" | "on-file-change" | "scheduled";
  steps: MAppWorkflowStep[];
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** Tool surfaced in the project toolbar when this MApp is active. */
export interface MAppTool {
  id: string;
  label: string;
  description: string;
  action: "shell" | "api" | "ui";
  command?: string;
  endpoint?: string;
}

// ---------------------------------------------------------------------------
// Form system — pages, fields, formulas, constants
// ---------------------------------------------------------------------------

/**
 * Field types supported in MApp forms.
 *
 * - Text: `text`, `textarea`
 * - Numbers: `number`, `int`, `currency`, `percentage`, `number_range`
 * - Date/Time: `date`, `date_range`, `time`, `duration`
 * - Contact: `email`, `phone`, `url`
 * - Boolean: `bool`
 * - Selection: `select`, `multiselect`
 * - Upload: `file`
 * - Display: `info` (read-only text, not an input)
 */
export type MAppFieldType =
  | "text" | "textarea" | "number" | "int" | "currency"
  | "percentage" | "number_range" | "date" | "date_range"
  | "time" | "duration" | "email" | "phone" | "url"
  | "bool" | "select" | "multiselect" | "file" | "info";

/** Condition for showing/hiding a field or page. */
export interface MAppCondition {
  showIf: {
    source: "inputs" | "process_page" | "context";
    field: string;
    operator: "equals" | "not_equals" | "greater_than" | "less_than"
            | "contains" | "in" | "not_in" | "not_empty" | "is_empty";
    value?: unknown;
    page?: string;
  };
}

/**
 * A field in a form page (A-column in the cell reference system).
 * Cell refs are auto-assigned: A1, A2, A3...
 */
export interface MAppField {
  key: string;
  /** Cell reference (A1, A2...). Auto-assigned in order of appearance. */
  cell: string;
  type: MAppFieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  /** Options for select/multiselect fields. */
  options?: string[];
  min?: number;
  max?: number;
  /** Conditional visibility. */
  conditions?: MAppCondition;
}

/**
 * A calculated formula (B-column). Expressions MUST use cell refs, not field keys.
 * Right: `A1 * C1`. Wrong: `amount * tax_rate`.
 */
export interface MAppFormula {
  /** Cell reference (B1, B2...). */
  cell: string;
  label: string;
  /** Expression using cell refs. Supports: +, -, *, /, ^, IF(), SUM(), etc. */
  expression: string;
  format: "number" | "currency" | "percent" | "text";
  /** Whether to show the result to the user. Hidden formulas are for internal use. */
  visible: boolean;
}

/**
 * A constant value (C-column). Used in formulas. Auto-assigned: C1, C2...
 */
export interface MAppConstant {
  key: string;
  cell: string;
  label: string;
  value: number | string;
  format: "number" | "currency" | "percent";
  visibility: "always" | "hidden" | "conditional";
}

/**
 * Page types:
 * - `standard` — User fills predefined fields
 * - `magic` — AI generates fields at runtime (can't be page 1, needs prior processPage)
 * - `embedded` — Display-only iframe (YouTube, external tools)
 * - `canvas` — Free-form widget layout (charts, diagrams, rich content) — unique to MApps
 */
export type MAppPageType = "standard" | "magic" | "embedded" | "canvas";

/** A page in a multi-step MApp form. */
export interface MAppPage {
  key: string;
  title: string;
  pageType: MAppPageType;
  visibility: "always" | "conditional" | "auto" | "hidden";
  /** Fields for standard + magic pages (A-column). */
  fields?: MAppField[];
  /** Formulas for standard pages (B-column). */
  formulas?: MAppFormula[];
  /** Conditional visibility config. */
  conditions?: MAppCondition;
  /** AI prompt run after page completion — returns prepopulate/visibility/dynamicInputs. */
  processPage?: string;
  /** URL for embedded pages. */
  url?: string;
  /** Widgets for canvas pages — rendered via WidgetRenderer. */
  widgets?: MAppWidget[];
}

/**
 * AI model dependency declared by a MApp.
 * Displayed as status cards in the dashboard when the MApp is opened.
 */
export interface MAppModelDependency {
  /** HuggingFace model ID (e.g. "NeoQuasar/Kronos-base"). */
  modelId: string;
  /** Human-readable label for display (e.g. "Kronos Forecasting Model"). */
  label: string;
  /** Whether the MApp can function without this model running. Defaults to false. */
  required?: boolean;
  /** Expected pipeline tag for validation (e.g. "text-generation"). */
  pipelineTag?: string;
}

/**
 * Output configuration — what happens after all pages are collected.
 */
export interface MAppOutput {
  /** Whether to generate a downloadable file. */
  producesFile?: boolean;
  /** File type if producesFile is true. */
  fileType?: "text" | "doc" | "csv" | "spreadsheet";
  /** AI instruction for generating the final output from collected data. */
  processingPrompt?: string;
}

// ---------------------------------------------------------------------------
// MApp Definition — the complete JSON file
// ---------------------------------------------------------------------------

/**
 * Complete MApp definition. This is the shape of a `.json` file at
 * `~/.agi/mapps/{author}/{slug}.json`.
 *
 * @example
 * ```json
 * {
 *   "$schema": "mapp/1.0",
 *   "id": "reader",
 *   "name": "Reader",
 *   "author": "civicognita",
 *   "version": "1.0.0",
 *   "description": "E-reader for literature projects",
 *   "category": "viewer",
 *   "permissions": [
 *     { "id": "container.run", "reason": "Serves content via nginx", "required": true },
 *     { "id": "fs.read", "reason": "Reads project files", "required": true }
 *   ],
 *   "container": {
 *     "image": "nginx:alpine",
 *     "internalPort": 80,
 *     "volumeMounts": ["{projectPath}:/usr/share/nginx/html/content:ro,Z"]
 *   },
 *   "panel": {
 *     "label": "Reader",
 *     "widgets": [
 *       { "type": "iframe", "src": "https://{projectHostname}.ai.on", "height": "600px" }
 *     ]
 *   }
 * }
 * ```
 */
// ---------------------------------------------------------------------------
// Screens primitive (s146 Phase A.1, owner-confirmed cycle 181)
// ---------------------------------------------------------------------------

/** Coarse type for a screen's input prop. */
export type MAppScreenInputType =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "select"
  | "object";

/** Filled-state qualifier — owner's primitive 2026-05-02. */
export type MAppScreenInputQualifier = "required" | "prefilled" | "optional";

/** Where input values can come from. Symmetric — user OR agent OR either. */
export type MAppScreenInputSource = "user" | "agent" | "either";

/** A typed input prop on a screen. */
export interface MAppScreenInput {
  /** Stable identifier (referenced as `$input.key` in element bindings). */
  key: string;
  /** Display label. */
  label: string;
  /** Coarse type. */
  type: MAppScreenInputType;
  /** Filled-state qualifier. */
  qualifier: MAppScreenInputQualifier;
  /** Where values can come from. Defaults to "either". */
  source?: MAppScreenInputSource;
  /** Default value. Required when qualifier="prefilled". */
  default?: unknown;
  /** Description shown to user OR included in agent context. */
  description?: string;
  /** Allowed options when type="select". */
  options?: string[];
}

/** A PAx component placement on a screen. */
export interface MAppScreenElement {
  /** Stable identifier within the screen (used by wirings to target it). */
  id: string;
  /** Reference to a PAx component as "<package>:<ComponentName>" — e.g.
   *  "react-fancy:Card", "fancy-code:Editor", "fancy-echarts:Chart". */
  componentRef: string;
  /** Component-specific props. Forwarded to the PAx component verbatim. */
  props?: Record<string, unknown>;
  /** Nested children for container components (Card, Tabs, etc.). */
  children?: unknown[];
}

/** A screen in a MApp. */
export interface MAppScreen {
  /** Stable identifier within the MApp. Pattern: `^[a-z0-9][a-z0-9_-]*$`. */
  id: string;
  /** Display label. */
  label: string;
  /** Static = composition fixed at author time; dynamic = composition can
   *  change at runtime (Phase D defines the mechanism). Default static. */
  interface?: "static" | "dynamic";
  /** Typed input props consumed by the screen's elements + mini-agent. */
  inputs?: MAppScreenInput[];
  /** Composed elements drawn from PAx components. */
  elements: MAppScreenElement[];
}

// ---------------------------------------------------------------------------

export interface MAppDefinition {
  /** Schema version. Must be "mapp/1.0". */
  $schema: typeof MAPP_SCHEMA_VERSION;

  // --- Identity ---
  /** Unique slug identifier (e.g. "reader", "wealth-suite"). */
  id: string;
  /** Display name. */
  name: string;
  /** Creator identifier (e.g. "civicognita", "wishborn"). */
  author: string;
  /** Semver version string. */
  version: string;
  /** What this MApp does. */
  description: string;
  /** Icon identifier or emoji. */
  icon?: string;
  /** License identifier (e.g. "MIT", "proprietary"). */
  license?: string;

  // --- Classification ---
  /** Application category. */
  category: MAppCategory;
  /** Project types this MApp works with (empty = all types). */
  projectTypes?: string[];
  /** Project categories this MApp is compatible with. */
  projectCategories?: string[];

  // --- Security ---
  /** Permissions this MApp requires. Shown to user before activation. */
  permissions: MAppPermission[];

  // --- Container ---
  /** Container config for MApps that serve content. Omit for UI-only MApps. */
  container?: MAppContainerConfig;

  // --- UI ---
  /** Dashboard panel definition (for viewer/dashboard MApps). */
  panel: MAppPanel;
  /** Visual theme overrides. */
  theme?: MAppTheme;
  /** Whether this MApp supports docking to the left panel (default: true). */
  dockable?: boolean;

  // --- Forms ---
  /** Multi-step form pages (for tool/suite MApps). */
  pages?: MAppPage[];
  /** Screens primitive (s146 Phase A.1, owner-confirmed cycle 181) — coexists
   *  with `pages` for legacy form-and-formula MApps. New iframe-rendered
   *  MApps use this: each screen is a PAx-component composition with typed
   *  input props (required/prefilled/optional, user/agent source) and a
   *  per-screen mini-agent (mini-agent shape gated on owner judgment, see
   *  s146 open questions). */
  screens?: MAppScreen[];
  /** Constants used in formulas (C-column). */
  constants?: MAppConstant[];
  /** Output configuration (what happens after form submission). */
  output?: MAppOutput;

  // --- Agent ---
  /** Agent prompts injected when this MApp is active on a project. */
  prompts?: MAppAgentPrompt[];
  /** Multi-step workflow automations. */
  workflows?: MAppWorkflow[];
  /** Project toolbar tools. */
  tools?: MAppTool[];

  // --- AI Model Dependencies ---
  /** AI model dependencies this MApp requires. Shown as status cards in the dashboard. */
  modelDependencies?: MAppModelDependency[];

  // --- Chain (future) ---
  /** On-chain metadata for blockchain compilation. */
  chain?: {
    contentHash?: string;
    address?: string;
  };
}

// ---------------------------------------------------------------------------
// Serialized info (API-safe, no container functions)
// ---------------------------------------------------------------------------

/** MApp metadata for API responses and UI display. */
export interface MAppInfo {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  icon?: string;
  category: MAppCategory;
  projectTypes?: string[];
  projectCategories?: string[];
  permissions: MAppPermission[];
  hasContainer: boolean;
  panelLabel: string;
  promptCount: number;
  workflowCount: number;
  toolCount: number;
  /** Security scan status (set after install). */
  scanStatus?: "passed" | "review" | "failed" | "pending";
}

/** Serialize a MAppDefinition for API responses. */
export function serializeMApp(def: MAppDefinition): MAppInfo {
  return {
    id: def.id,
    name: def.name,
    author: def.author,
    version: def.version,
    description: def.description,
    icon: def.icon,
    category: def.category,
    projectTypes: def.projectTypes,
    projectCategories: def.projectCategories,
    permissions: def.permissions,
    hasContainer: !!def.container,
    panelLabel: def.panel.label,
    promptCount: def.prompts?.length ?? 0,
    workflowCount: def.workflows?.length ?? 0,
    toolCount: def.tools?.length ?? 0,
  };
}
