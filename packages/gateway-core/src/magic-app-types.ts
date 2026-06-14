/**
 * MagicApp type definitions — JSON-defined packaged apps that bundle
 * UI, container serving, and agentic capabilities.
 *
 * A MagicApp sits between Stacks (knowledge/UI, no containers) and
 * Runtimes (language containers for dev projects). MagicApps provide
 * self-contained serving for non-dev project types (readers, galleries,
 * dashboards, viewers, editors).
 *
 * Reader and Gallery are the first two MagicApps.
 */

import type { PanelWidget } from "@agi/plugins";
import type { ProjectCategory, ProjectTypeTool } from "./project-types.js";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type MagicAppCategory = "viewer" | "production" | "tool" | "game" | "custom";

// ---------------------------------------------------------------------------
// Container config — how the MagicApp serves content
// ---------------------------------------------------------------------------

export interface MagicAppContainerContext {
  projectPath: string;
  projectHostname: string;
  allocatedPort: number;
  mode: "production" | "development";
}

export interface MagicAppContainerConfig {
  /** Container image (e.g. "nginx:alpine"). */
  image: string;
  /** Internal port the container listens on. */
  internalPort: number;
  /** Volume mounts — functions for runtime context. */
  volumeMounts: (ctx: MagicAppContainerContext) => string[];
  /** Environment variables. */
  env: (ctx: MagicAppContainerContext) => Record<string, string>;
  /** Optional command override. */
  command?: (ctx: MagicAppContainerContext) => string[] | null;
  /** Health check command inside container. */
  healthCheck?: string;
}

// ---------------------------------------------------------------------------
// Agentic prompts — AI context for this app type
// ---------------------------------------------------------------------------

export interface MagicAppAgentPrompt {
  id: string;
  label: string;
  description?: string;
  /** System prompt snippet injected into agent context for this project type. */
  systemPrompt: string;
  /** Tool names the agent can use when working with this app type. */
  allowedTools?: string[];
}

// ---------------------------------------------------------------------------
// Workflows — multi-step automations
// ---------------------------------------------------------------------------

export type MagicAppWorkflowStepType = "shell" | "api" | "agent" | "file-transform";

export interface MagicAppWorkflowStep {
  id: string;
  type: MagicAppWorkflowStepType;
  label: string;
  config: Record<string, unknown>;
  dependsOn?: string[];
}

/**
 * Channel-message trigger config — scopes this workflow to specific
 * channel/room/pattern combinations. All fields optional; absent means
 * "match any". Used when trigger === "channel-message".
 *
 * CHN-H (s169): wired by the gateway's onWorkflowMatch dispatcher when
 * a ChannelWorkflowBinding fires for this MApp.
 */
export interface MagicAppChannelTrigger {
  /** Restrict to a specific channel id ("discord", "slack", "telegram", …). */
  channelId?: string;
  /** Restrict to a specific room. Undefined = any room on the channel. */
  roomId?: string;
  /**
   * ECMAScript regex tested against message text (case-insensitive).
   * Undefined / empty = match all messages passing the other filters.
   */
  messagePattern?: string;
}

export interface MagicAppWorkflow {
  id: string;
  name: string;
  description?: string;
  /**
   * What event fires this workflow.
   * - "manual"          — owner triggers explicitly via UI or API.
   * - "on-file-change"  — file-watcher fires on project file changes.
   * - "scheduled"       — cron-based schedule.
   * - "channel-message" — inbound channel message matching a
   *   ChannelWorkflowBinding fires this workflow. CHN-H (s169).
   */
  trigger: "manual" | "on-file-change" | "scheduled" | "channel-message";
  /**
   * Channel-trigger scope declaration. Only meaningful when
   * trigger === "channel-message". The gateway dispatcher uses the
   * ChannelWorkflowBinding match result; this field is informational
   * (documents which channels the MApp author intended to receive).
   */
  channelTrigger?: MagicAppChannelTrigger;
  steps: MagicAppWorkflowStep[];
}

// ---------------------------------------------------------------------------
// Theme — visual customization for the serving SPA
// ---------------------------------------------------------------------------

export interface MagicAppTheme {
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  cssProperties?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// MagicApp definition — the full unit
// ---------------------------------------------------------------------------

export interface MagicAppDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  icon?: string;
  category: MagicAppCategory;
  /** Project types this MagicApp serves (e.g. ["writing"]). */
  projectTypes: string[];
  /** Project categories this MagicApp is compatible with. */
  projectCategories: ProjectCategory[];
  /** Container config for serving the app's content. */
  containerConfig: MagicAppContainerConfig;
  /** Dashboard panel — auto-registered as a project tab. */
  panel: {
    label: string;
    widgets: PanelWidget[];
    position?: number;
  };
  /** Agentic prompts for AI interaction with this project type. */
  agentPrompts?: MagicAppAgentPrompt[];
  /** Multi-step workflows (manual, file-triggered, or scheduled). */
  workflows?: MagicAppWorkflow[];
  /** Tools surfaced in the project toolbar. */
  tools?: ProjectTypeTool[];
  /** App-specific theme overrides for the serving SPA. */
  theme?: MagicAppTheme;
  /** On-chain metadata (future — blockchain compilation). */
  chain?: {
    contentHash?: string;
    address?: string;
  };
}

// ---------------------------------------------------------------------------
// Serialized info — safe for API responses (no functions)
// ---------------------------------------------------------------------------

export interface MagicAppInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  icon?: string;
  category: MagicAppCategory;
  projectTypes: string[];
  projectCategories: ProjectCategory[];
  hasContainer: boolean;
  panelLabel: string;
  agentPromptCount: number;
  workflowCount: number;
  toolCount: number;
}

/** Serialize a MagicAppDefinition for API responses. */
export function serializeMagicApp(def: MagicAppDefinition): MagicAppInfo {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    version: def.version,
    icon: def.icon,
    category: def.category,
    projectTypes: def.projectTypes,
    projectCategories: def.projectCategories,
    hasContainer: !!def.containerConfig,
    panelLabel: def.panel.label,
    agentPromptCount: def.agentPrompts?.length ?? 0,
    workflowCount: def.workflows?.length ?? 0,
    toolCount: def.tools?.length ?? 0,
  };
}
