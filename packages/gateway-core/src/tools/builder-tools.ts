/**
 * Builder Tools — designer agent tools for BuilderChat.
 *
 * These tools are available to the AI during MagicApp creation/editing
 * sessions. They follow the MagicTools designer-chat pattern: focused,
 * narrow tools that handle discrete operations.
 */

import type { ToolHandler } from "../tool-registry.js";
import type { PluginRegistry } from "@aionima/plugins";
import { MagicAppJsonSchema } from "@aionima/config";
import { serializeMagicApp } from "../magic-app-types.js";

export interface BuilderToolsConfig {
  pluginRegistry?: PluginRegistry;
}

// ---------------------------------------------------------------------------
// validate_magic_app — validate a MagicApp JSON definition
// ---------------------------------------------------------------------------

export function createValidateMagicAppHandler(_config: BuilderToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const definition = input.definition as Record<string, unknown> | undefined;
    if (!definition) {
      return JSON.stringify({ error: "definition (object) is required" });
    }
    const result = MagicAppJsonSchema.safeParse(definition);
    if (result.success) {
      return JSON.stringify({ valid: true, data: result.data });
    }
    const errors = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    return JSON.stringify({ valid: false, errors });
  };
}

export const VALIDATE_MAGIC_APP_MANIFEST = {
  name: "validate_magic_app",
  description: "Validate a MagicApp JSON definition against the schema. Returns validation errors if invalid.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const VALIDATE_MAGIC_APP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    definition: { type: "object", description: "The MagicApp JSON definition to validate" },
  },
  required: ["definition"],
};

// ---------------------------------------------------------------------------
// list_magic_apps — list all registered MagicApps
// ---------------------------------------------------------------------------

export function createListMagicAppsHandler(config: BuilderToolsConfig): ToolHandler {
  return async (): Promise<string> => {
    const reg = config.pluginRegistry;
    if (!reg || !("getMagicApps" in reg)) {
      return JSON.stringify({ apps: [] });
    }
    const apps = (reg as { getMagicApps(): Array<{ pluginId: string; magicApp: import("../magic-app-types.js").MagicAppDefinition }> }).getMagicApps();
    return JSON.stringify({
      apps: apps.map(({ pluginId, magicApp }) => ({
        ...serializeMagicApp(magicApp),
        pluginId,
      })),
    });
  };
}

export const LIST_MAGIC_APPS_MANIFEST = {
  name: "list_magic_apps",
  description: "List all registered MagicApps with their metadata.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const LIST_MAGIC_APPS_INPUT_SCHEMA = {
  type: "object",
  properties: {},
};

// ---------------------------------------------------------------------------
// get_magic_app — get details of a specific MagicApp
// ---------------------------------------------------------------------------

export function createGetMagicAppHandler(config: BuilderToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const id = input.id ? String(input.id) : "";
    if (!id) return JSON.stringify({ error: "id is required" });

    const reg = config.pluginRegistry;
    if (!reg || !("getMagicApp" in reg)) {
      return JSON.stringify({ error: "MagicApp registry not available" });
    }
    const def = (reg as { getMagicApp(id: string): import("../magic-app-types.js").MagicAppDefinition | undefined }).getMagicApp(id);
    if (!def) return JSON.stringify({ error: `MagicApp "${id}" not found` });
    return JSON.stringify({ app: serializeMagicApp(def) });
  };
}

export const GET_MAGIC_APP_MANIFEST = {
  name: "get_magic_app",
  description: "Get details of a specific MagicApp by ID.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const GET_MAGIC_APP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "MagicApp ID" },
  },
  required: ["id"],
};

// ---------------------------------------------------------------------------
// create_magic_app — create and persist a new MagicApp
// ---------------------------------------------------------------------------

export function createCreateMagicAppHandler(_config: BuilderToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const definition = input.definition as Record<string, unknown> | undefined;
    if (!definition) return JSON.stringify({ error: "definition (object) is required" });

    // Validate first
    const result = MagicAppJsonSchema.safeParse(definition);
    if (!result.success) {
      return JSON.stringify({
        error: "Invalid MagicApp definition",
        issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }

    // Persist to ~/.agi/magic-apps/{id}.json
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = join(homedir(), ".agi", "magic-apps");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${result.data.id}.json`);
    writeFileSync(filePath, JSON.stringify(result.data, null, 2) + "\n", "utf-8");

    return JSON.stringify({
      ok: true,
      id: result.data.id,
      name: result.data.name,
      path: filePath,
      message: `MagicApp "${result.data.name}" created. Restart the gateway to load it.`,
    });
  };
}

export const CREATE_MAGIC_APP_MANIFEST = {
  name: "create_magic_app",
  description: "Create a new MagicApp by persisting its JSON definition. Validates before saving. Requires gateway restart to load.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const CREATE_MAGIC_APP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    definition: { type: "object", description: "Complete MagicApp JSON definition" },
  },
  required: ["definition"],
};

// ---------------------------------------------------------------------------
// render_mockup — return a structured mockup preview for the chat
// ---------------------------------------------------------------------------

export function createRenderMockupHandler(_config: BuilderToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const definition = input.definition as Record<string, unknown> | undefined;
    if (!definition) return JSON.stringify({ error: "definition (object) is required" });

    // Validate
    const result = MagicAppJsonSchema.safeParse(definition);
    if (!result.success) {
      return JSON.stringify({
        valid: false,
        errors: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }

    // Return the validated definition as a mockup preview
    return JSON.stringify({
      valid: true,
      mockup: {
        name: result.data.name,
        category: result.data.category,
        projectTypes: result.data.projectTypes,
        panel: result.data.panel,
        agentPrompts: result.data.agentPrompts ?? [],
        workflows: result.data.workflows ?? [],
        tools: result.data.tools ?? [],
      },
    });
  };
}

export const RENDER_MOCKUP_MANIFEST = {
  name: "render_mockup",
  description: "Validate and return a structured MagicApp mockup preview for visual confirmation before creating.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const RENDER_MOCKUP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    definition: { type: "object", description: "MagicApp JSON definition to preview" },
  },
  required: ["definition"],
};

// ---------------------------------------------------------------------------
// Manifest collection for registration
// ---------------------------------------------------------------------------

export const BUILDER_TOOLS = [
  { manifest: VALIDATE_MAGIC_APP_MANIFEST, schema: VALIDATE_MAGIC_APP_INPUT_SCHEMA, createHandler: createValidateMagicAppHandler },
  { manifest: LIST_MAGIC_APPS_MANIFEST, schema: LIST_MAGIC_APPS_INPUT_SCHEMA, createHandler: createListMagicAppsHandler },
  { manifest: GET_MAGIC_APP_MANIFEST, schema: GET_MAGIC_APP_INPUT_SCHEMA, createHandler: createGetMagicAppHandler },
  { manifest: CREATE_MAGIC_APP_MANIFEST, schema: CREATE_MAGIC_APP_INPUT_SCHEMA, createHandler: createCreateMagicAppHandler },
  { manifest: RENDER_MOCKUP_MANIFEST, schema: RENDER_MOCKUP_INPUT_SCHEMA, createHandler: createRenderMockupHandler },
] as const;
