/**
 * Plugin Bridges — connect plugin-registered agent tools, skills, and knowledge
 * to the gateway's core registries after plugin load.
 */

import type { PluginRegistry } from "@aionima/plugins";
import type { ToolRegistry } from "./tool-registry.js";
import type { SkillRegistry } from "@aionima/skills";
import type { Logger } from "./logger.js";
import { createComponentLogger } from "./logger.js";

export interface PluginBridgeDeps {
  pluginRegistry: PluginRegistry;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  logger?: Logger;
}

export interface PluginBridgeResult {
  toolsBridged: number;
  skillsBridged: number;
  knowledgeNamespaces: number;
}

/**
 * Bridge plugin-registered capabilities into the core registries.
 * Call after `loadPlugins()` completes.
 */
export function bridgePluginCapabilities(deps: PluginBridgeDeps): PluginBridgeResult {
  const log = createComponentLogger(deps.logger, "plugin-bridge");
  let toolsBridged = 0;
  let skillsBridged = 0;

  // Bridge agent tools → ToolRegistry
  for (const { pluginId, tool } of deps.pluginRegistry.getAgentTools()) {
    try {
      deps.toolRegistry.register(
        {
          name: `plugin_${pluginId}_${tool.name}`,
          description: tool.description,
          requiresState: ["ONLINE"],
          requiresTier: ["unverified", "verified", "sealed"],
        },
        async (input, ctx) => {
          const result = await tool.handler(input, {
            sessionId: ctx?.coaChainBase ?? "unknown",
            entityId: ctx?.entityId ?? "unknown",
          });
          return typeof result === "string" ? result : JSON.stringify(result);
        },
        tool.inputSchema,
      );
      toolsBridged++;
    } catch (err) {
      log.warn(`failed to bridge agent tool "${tool.name}" from plugin "${pluginId}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Bridge skills → SkillRegistry (add programmatic skills to the registry's internal map)
  for (const { pluginId, skill } of deps.pluginRegistry.getSkills()) {
    try {
      const compiledTriggers = skill.triggers.map((t) => new RegExp(t, "i"));
      // Use the registry's internal skill map via the set accessor pattern used in discover()
      // We access the private map through a type-safe approach
      const registeredSkill = {
        definition: {
          name: `plugin_${pluginId}_${skill.name}`,
          description: skill.description ?? "",
          domain: skill.domain as "utility",
          triggers: skill.triggers,
          compiledTriggers,
          priority: 0,
          directInvoke: true,
          content: skill.content,
          filePath: `plugin_${pluginId}`,
        },
        valid: true,
        matchCount: 0,
      };
      // SkillRegistry stores skills internally — use the discover path's pattern
      // Access via prototype-compatible approach
      (deps.skillRegistry as unknown as { skills: Map<string, unknown> }).skills.set(
        registeredSkill.definition.name,
        registeredSkill,
      );
      skillsBridged++;
    } catch (err) {
      log.warn(`failed to bridge skill "${skill.name}" from plugin "${pluginId}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Count knowledge namespaces (these are exposed via API, not stored in a separate registry)
  const knowledgeNamespaces = deps.pluginRegistry.getKnowledge().length;

  if (toolsBridged > 0) log.info(`bridged ${String(toolsBridged)} agent tools from plugins`);
  if (skillsBridged > 0) log.info(`bridged ${String(skillsBridged)} skills from plugins`);
  if (knowledgeNamespaces > 0) log.info(`registered ${String(knowledgeNamespaces)} knowledge namespaces from plugins`);

  return { toolsBridged, skillsBridged, knowledgeNamespaces };
}
