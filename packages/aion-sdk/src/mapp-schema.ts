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
 * - `reader` — Content viewers (e-readers, document viewers)
 * - `gallery` — Media viewers (image galleries, video players)
 * - `tool` — Input → processing → output (calculators, analyzers, converters)
 * - `suite` — Full-featured application suites (finance, project management)
 * - `editor` — Content creation and editing
 * - `viewer` — Data visualization and dashboards
 * - `game` — Interactive games and simulations
 * - `custom` — Anything that doesn't fit the above
 */
export type MAppCategory =
  | "reader"
  | "gallery"
  | "tool"
  | "suite"
  | "editor"
  | "viewer"
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
export type MAppWorkflowStepType = "shell" | "api" | "agent" | "file-transform";

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
 *   "category": "reader",
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
  /** Dashboard panel definition. */
  panel: MAppPanel;
  /** Visual theme overrides. */
  theme?: MAppTheme;

  // --- Agent ---
  /** Agent prompts injected when this MApp is active on a project. */
  prompts?: MAppAgentPrompt[];
  /** Multi-step workflow automations. */
  workflows?: MAppWorkflow[];
  /** Project toolbar tools. */
  tools?: MAppTool[];

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
