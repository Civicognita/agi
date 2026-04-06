/**
 * Builder Tools — designer agent tools for BuilderChat.
 *
 * These tools create and manage MApps (MagicApps). They use the
 * standalone MAppRegistry and MApp schema — NOT the plugin system.
 */

import type { ToolHandler } from "../tool-registry.js";
import type { MAppRegistry } from "../mapp-registry.js";
import { MAppDefinitionSchema } from "@aionima/config";
import { serializeMApp } from "@aionima/sdk";
import type { MAppDefinition } from "@aionima/sdk";

export interface BuilderToolsConfig {
  mappRegistry?: MAppRegistry;
}

// ---------------------------------------------------------------------------
// validate_magic_app — validate against MApp schema v1.0
// ---------------------------------------------------------------------------

export function createValidateMagicAppHandler(_config: BuilderToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const definition = input.definition as Record<string, unknown> | undefined;
    if (!definition) {
      return JSON.stringify({ error: "definition (object) is required" });
    }
    const result = MAppDefinitionSchema.safeParse(definition);
    if (result.success) {
      return JSON.stringify({ valid: true, data: result.data });
    }
    return JSON.stringify({
      valid: false,
      errors: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  };
}

export const VALIDATE_MAGIC_APP_MANIFEST = {
  name: "validate_magic_app",
  description: "Validate a MApp JSON definition against the mapp/1.0 schema. Returns validation errors if invalid.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const VALIDATE_MAGIC_APP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    definition: { type: "object", description: "The MApp JSON definition to validate (must include $schema, author, permissions)" },
  },
  required: ["definition"],
};

// ---------------------------------------------------------------------------
// list_magic_apps — list all registered MApps
// ---------------------------------------------------------------------------

export function createListMagicAppsHandler(config: BuilderToolsConfig): ToolHandler {
  return async (): Promise<string> => {
    if (!config.mappRegistry) return JSON.stringify({ apps: [] });
    return JSON.stringify({ apps: config.mappRegistry.getAll().map(serializeMApp) });
  };
}

export const LIST_MAGIC_APPS_MANIFEST = {
  name: "list_magic_apps",
  description: "List all registered MApps with their metadata.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const LIST_MAGIC_APPS_INPUT_SCHEMA = { type: "object", properties: {} };

// ---------------------------------------------------------------------------
// get_magic_app — get details of a specific MApp
// ---------------------------------------------------------------------------

export function createGetMagicAppHandler(config: BuilderToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const id = input.id ? String(input.id) : "";
    if (!id) return JSON.stringify({ error: "id is required" });
    if (!config.mappRegistry) return JSON.stringify({ error: "MApp registry not available" });
    const def = config.mappRegistry.get(id);
    if (!def) return JSON.stringify({ error: `MApp "${id}" not found` });
    return JSON.stringify({ app: serializeMApp(def) });
  };
}

export const GET_MAGIC_APP_MANIFEST = {
  name: "get_magic_app",
  description: "Get details of a specific MApp by ID.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const GET_MAGIC_APP_INPUT_SCHEMA = {
  type: "object",
  properties: { id: { type: "string", description: "MApp ID" } },
  required: ["id"],
};

// ---------------------------------------------------------------------------
// create_magic_app — persist + register immediately (no restart needed)
// ---------------------------------------------------------------------------

export function createCreateMagicAppHandler(config: BuilderToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const definition = input.definition as Record<string, unknown> | undefined;
    if (!definition) return JSON.stringify({ error: "definition (object) is required" });

    // Validate against mapp/1.0 schema
    const result = MAppDefinitionSchema.safeParse(definition);
    if (!result.success) {
      return JSON.stringify({
        error: "Invalid MApp definition",
        issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        hint: 'Make sure $schema is "mapp/1.0" and author + permissions are included.',
      });
    }

    const data = result.data;

    // Security scan
    const { scanMApp } = await import("../mapp-security-scanner.js");
    const scanResult = scanMApp(definition);
    if (!scanResult.safe) {
      return JSON.stringify({
        error: "MApp failed security scan",
        score: scanResult.score,
        findings: scanResult.findings,
        recommendation: scanResult.recommendation,
      });
    }

    // Persist to ~/.agi/mapps/{author}/{id}.json
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = join(homedir(), ".agi", "mapps", data.author);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${data.id}.json`);
    writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");

    // Register in live registry immediately — no restart needed
    if (config.mappRegistry) {
      config.mappRegistry.register(data as MAppDefinition);
    }

    return JSON.stringify({
      ok: true,
      id: data.id,
      name: data.name,
      author: data.author,
      path: filePath,
      scan: { score: scanResult.score, recommendation: scanResult.recommendation },
      message: `MApp "${data.name}" created and available immediately.`,
    });
  };
}

export const CREATE_MAGIC_APP_MANIFEST = {
  name: "create_magic_app",
  description: "Create a new MApp: validates schema, runs security scan, persists to ~/.agi/mapps/{author}/{id}.json, and registers immediately (no restart needed).",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const CREATE_MAGIC_APP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    definition: { type: "object", description: "Complete MApp JSON definition (must include $schema, author, permissions)" },
  },
  required: ["definition"],
};

// ---------------------------------------------------------------------------
// render_mockup — validate and return preview
// ---------------------------------------------------------------------------

export function createRenderMockupHandler(_config: BuilderToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const definition = input.definition as Record<string, unknown> | undefined;
    if (!definition) return JSON.stringify({ error: "definition (object) is required" });

    const result = MAppDefinitionSchema.safeParse(definition);
    if (!result.success) {
      return JSON.stringify({
        valid: false,
        errors: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }

    return JSON.stringify({
      valid: true,
      mockup: {
        name: result.data.name,
        author: result.data.author,
        category: result.data.category,
        projectTypes: result.data.projectTypes,
        permissions: result.data.permissions,
        panel: result.data.panel,
        prompts: result.data.prompts ?? [],
        workflows: result.data.workflows ?? [],
        tools: result.data.tools ?? [],
      },
    });
  };
}

export const RENDER_MOCKUP_MANIFEST = {
  name: "render_mockup",
  description: "Validate and return a structured MApp mockup preview for visual confirmation before creating.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const RENDER_MOCKUP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    definition: { type: "object", description: "MApp JSON definition to preview" },
  },
  required: ["definition"],
};

// ---------------------------------------------------------------------------
// Manifest collection
// ---------------------------------------------------------------------------

export const BUILDER_TOOLS = [
  { manifest: VALIDATE_MAGIC_APP_MANIFEST, schema: VALIDATE_MAGIC_APP_INPUT_SCHEMA, createHandler: createValidateMagicAppHandler },
  { manifest: LIST_MAGIC_APPS_MANIFEST, schema: LIST_MAGIC_APPS_INPUT_SCHEMA, createHandler: createListMagicAppsHandler },
  { manifest: GET_MAGIC_APP_MANIFEST, schema: GET_MAGIC_APP_INPUT_SCHEMA, createHandler: createGetMagicAppHandler },
  { manifest: CREATE_MAGIC_APP_MANIFEST, schema: CREATE_MAGIC_APP_INPUT_SCHEMA, createHandler: createCreateMagicAppHandler },
  { manifest: RENDER_MOCKUP_MANIFEST, schema: RENDER_MOCKUP_INPUT_SCHEMA, createHandler: createRenderMockupHandler },
] as const;
