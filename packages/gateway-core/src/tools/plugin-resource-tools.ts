/**
 * Plugin Resource Tools — query_plugin_resources
 *
 * Single read-only agent tool for discovering what plugins provide:
 * stacks, runtimes, services, themes, knowledge, project types, providers, etc.
 */

import type { ToolHandler } from "../tool-registry.js";
import type { PluginRegistry } from "@agi/plugins";
import type { StackRegistry } from "../stack-registry.js";
import type { ProjectTypeRegistry } from "../project-types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PluginResourceToolConfig {
  pluginRegistry?: PluginRegistry;
  stackRegistry?: StackRegistry;
  projectTypeRegistry?: ProjectTypeRegistry;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function createQueryPluginResourcesHandler(config: PluginResourceToolConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const reg = config.pluginRegistry;
    const stackReg = config.stackRegistry;
    const ptReg = config.projectTypeRegistry;
    const resourceType = String(input.resource_type ?? "");

    if (resourceType === "stacks") {
      if (!stackReg) return JSON.stringify({ error: "Stack registry not available" });
      return JSON.stringify({ stacks: stackReg.toJSON() });
    }

    if (resourceType === "runtimes") {
      if (!reg) return JSON.stringify({ error: "Plugin registry not available" });
      // getRuntimes() returns RuntimeDefinition[] (unwrapped)
      const runtimes = reg.getRuntimes().map((r) => ({
        id: r.id,
        label: r.label,
        language: r.language,
        version: r.version,
        containerImage: r.containerImage,
      }));
      return JSON.stringify({ runtimes });
    }

    if (resourceType === "services") {
      if (!reg) return JSON.stringify({ error: "Plugin registry not available" });
      // getServices() returns ServiceDefinition[] (unwrapped)
      const services = reg.getServices().map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      }));
      return JSON.stringify({ services });
    }

    if (resourceType === "system_services") {
      if (!reg) return JSON.stringify({ error: "Plugin registry not available" });
      // getSystemServices() returns RegisteredSystemService[] (wrapped)
      const systemServices = reg.getSystemServices().map((s) => ({
        id: s.service.id,
        pluginId: s.pluginId,
        name: s.service.name,
        description: s.service.description,
      }));
      return JSON.stringify({ systemServices });
    }

    if (resourceType === "themes") {
      if (!reg) return JSON.stringify({ error: "Plugin registry not available" });
      // getThemes() returns RegisteredTheme[] (wrapped)
      const themes = reg.getThemes().map((t) => ({
        id: t.theme.id,
        pluginId: t.pluginId,
        name: t.theme.name,
      }));
      return JSON.stringify({ themes });
    }

    if (resourceType === "knowledge") {
      if (!reg) return JSON.stringify({ error: "Plugin registry not available" });
      // getKnowledge() returns RegisteredKnowledge[] (wrapped, uses .namespace)
      const knowledge = reg.getKnowledge().map((k) => ({
        id: k.namespace.id,
        pluginId: k.pluginId,
        label: k.namespace.label,
        description: k.namespace.description,
      }));
      return JSON.stringify({ knowledge });
    }

    if (resourceType === "project_types") {
      if (!ptReg) return JSON.stringify({ error: "Project type registry not available" });
      return JSON.stringify({ projectTypes: ptReg.toJSON() });
    }

    if (resourceType === "providers") {
      if (!reg) return JSON.stringify({ error: "Plugin registry not available" });
      // getProviders() returns RegisteredProvider[] (wrapped)
      const providers = reg.getProviders().map((p) => ({
        id: p.provider.id,
        pluginId: p.pluginId,
        name: p.provider.name,
        defaultModel: p.provider.defaultModel,
      }));
      return JSON.stringify({ providers });
    }

    if (resourceType === "capabilities") {
      if (!reg) return JSON.stringify({ error: "Plugin registry not available" });
      const allPlugins = reg.getAll();
      const capabilities = allPlugins.map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        provides: reg.getPluginProvides(p.manifest.id),
      }));
      return JSON.stringify({ capabilities });
    }

    // No resource type specified — list all available types
    return JSON.stringify({
      error: resourceType.length > 0
        ? `Unknown resource_type: "${resourceType}"`
        : "resource_type is required",
      available_types: [
        "stacks", "runtimes", "services", "system_services",
        "themes", "knowledge", "project_types", "providers", "capabilities",
      ],
    });
  };
}

// ---------------------------------------------------------------------------
// Manifest + Input Schema
// ---------------------------------------------------------------------------

export const QUERY_PLUGIN_RESOURCES_MANIFEST = {
  name: "query_plugin_resources",
  description:
    "Query plugin-provided resources. Discover available stacks, runtimes, services, themes, " +
    "knowledge namespaces, project types, LLM providers, and per-plugin capability summaries.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["unverified" as const, "verified" as const, "sealed" as const],
};

export const QUERY_PLUGIN_RESOURCES_INPUT_SCHEMA = {
  type: "object",
  properties: {
    resource_type: {
      type: "string",
      enum: [
        "stacks", "runtimes", "services", "system_services",
        "themes", "knowledge", "project_types", "providers", "capabilities",
      ],
      description: "Type of plugin resource to query",
    },
  },
  required: ["resource_type"],
};
