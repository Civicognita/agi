/**
 * Plugin Tool Proxy — invoke_plugin_tool
 *
 * Single agent tool that routes to any plugin-registered agent tool.
 * Replaces the N individual `plugin_{id}_{name}` tool registrations
 * with one unified router.
 */

import type { ToolHandler } from "../tool-registry.js";
import type { PluginRegistry } from "@aionima/plugins";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PluginToolProxyConfig {
  pluginRegistry?: PluginRegistry;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function createInvokePluginToolHandler(config: PluginToolProxyConfig): ToolHandler {
  return async (input: Record<string, unknown>, ctx): Promise<string> => {
    const reg = config.pluginRegistry;
    if (!reg) return JSON.stringify({ error: "Plugin registry not available" });

    const pluginId = input.plugin_id ? String(input.plugin_id) : "";
    const toolName = input.tool_name ? String(input.tool_name) : "";

    if (!pluginId || !toolName) {
      // List available plugin tools
      const tools = reg.getAgentTools();
      const available = tools.map(({ pluginId: pid, tool }) => ({
        plugin_id: pid,
        tool_name: tool.name,
        description: tool.description,
      }));
      return JSON.stringify({
        error: "plugin_id and tool_name are required",
        available_tools: available,
      });
    }

    // Find the matching plugin tool
    const tools = reg.getAgentTools();
    const match = tools.find(
      (t) => t.pluginId === pluginId && t.tool.name === toolName,
    );

    if (!match) {
      const available = tools
        .filter((t) => t.pluginId === pluginId)
        .map((t) => t.tool.name);
      return JSON.stringify({
        error: `Tool "${toolName}" not found in plugin "${pluginId}"`,
        available_tools_for_plugin: available.length > 0 ? available : undefined,
        hint: available.length === 0 ? `No tools registered by plugin "${pluginId}"` : undefined,
      });
    }

    // Invoke the plugin tool handler
    try {
      const toolInput = (input.input as Record<string, unknown>) ?? {};
      const result = await match.tool.handler(toolInput, {
        sessionId: ctx?.coaChainBase ?? "unknown",
        entityId: ctx?.entityId ?? "unknown",
      });
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (err) {
      return JSON.stringify({
        error: `Plugin tool "${pluginId}/${toolName}" failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Dynamic description builder
// ---------------------------------------------------------------------------

export function buildPluginToolDescription(pluginRegistry?: PluginRegistry): string {
  const base =
    "Invoke a plugin-provided agent tool. Provide plugin_id and tool_name to route to the correct handler. " +
    "Pass the tool's input object in the input field.";

  if (!pluginRegistry) return base;

  const tools = pluginRegistry.getAgentTools();
  if (tools.length === 0) return base + " No plugin tools currently registered.";

  const listing = tools
    .map(({ pluginId, tool }) => `  - ${pluginId}/${tool.name}: ${tool.description}`)
    .join("\n");

  return `${base}\n\nAvailable plugin tools:\n${listing}`;
}

// ---------------------------------------------------------------------------
// Manifest + Input Schema
// ---------------------------------------------------------------------------

export const INVOKE_PLUGIN_TOOL_MANIFEST = {
  name: "invoke_plugin_tool",
  description: "Invoke a plugin-provided agent tool (call without args to list available tools).",
  requiresState: ["ONLINE" as const],
  requiresTier: ["unverified" as const, "verified" as const, "sealed" as const],
};

export const INVOKE_PLUGIN_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    plugin_id: {
      type: "string",
      description: "Plugin ID that provides the tool",
    },
    tool_name: {
      type: "string",
      description: "Name of the tool within the plugin",
    },
    input: {
      type: "object",
      description: "Input object to pass to the plugin tool handler",
    },
  },
  required: [],
};
