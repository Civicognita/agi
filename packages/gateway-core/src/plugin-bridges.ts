/**
 * Plugin Bridges — connect plugin-registered agent tools, skills, and knowledge
 * to the gateway's core registries after plugin load.
 */

import type { PluginRegistry } from "@agi/plugins";
import type { ToolRegistry } from "./tool-registry.js";
import type { SkillRegistry } from "@agi/skills";
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

  // Plugin agent tools are now routed through the unified `invoke_plugin_tool`
  // registered in tools/index.ts. Count them for the log message.
  toolsBridged = deps.pluginRegistry.getAgentTools().length;

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

/**
 * Remove a single plugin's bridged capabilities from core registries.
 * Call before `deactivateSingle()` so we can still read the plugin's registrations.
 */
export function unbridgePluginCapabilities(
  pluginId: string,
  deps: Pick<PluginBridgeDeps, "pluginRegistry" | "skillRegistry" | "logger">,
): { skillsRemoved: number } {
  const log = deps.logger ? createComponentLogger(deps.logger, "plugin-bridge") : undefined;
  let skillsRemoved = 0;

  // Remove skills for this plugin from SkillRegistry's internal map.
  // Skills are named `plugin_${pluginId}_${skill.name}` (see bridgePluginCapabilities).
  const skillMap = (deps.skillRegistry as unknown as { skills: Map<string, unknown> }).skills;
  const prefix = `plugin_${pluginId}_`;
  for (const key of Array.from(skillMap.keys())) {
    if (key.startsWith(prefix)) {
      skillMap.delete(key);
      skillsRemoved++;
    }
  }

  // Agent tools are looked up dynamically from pluginRegistry.getAgentTools() at
  // call time — removing them from the registry array (done by deactivateSingle)
  // is sufficient. No explicit unbridging needed here.

  if (skillsRemoved > 0) log?.info(`unbridged ${String(skillsRemoved)} skills for plugin "${pluginId}"`);

  return { skillsRemoved };
}
