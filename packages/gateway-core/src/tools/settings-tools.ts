/**
 * Settings Tools — manage_settings
 *
 * Consolidated tool merging manage_config + manage_plugins.
 * All operations go through SystemConfigService (validated I/O).
 */

import type { ToolHandler } from "../tool-registry.js";
import type { SystemConfigService } from "../system-config-service.js";
import type { PluginRegistry } from "@aionima/plugins";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SettingsToolConfig {
  systemConfigService?: SystemConfigService;
  pluginRegistry?: PluginRegistry;
  pluginPrefs?: Record<string, { enabled?: boolean; priority?: number }>;
  discoveredPlugins?: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    category: string;
    provides?: string[];
    depends?: string[];
    basePath: string;
    bakedIn: boolean;
    disableable: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function createManageSettingsHandler(config: SettingsToolConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const action = String(input.action ?? "");

    // --- Config operations ---

    if (action === "config_read") {
      const svc = config.systemConfigService;
      if (!svc) return JSON.stringify({ error: "Config service not available" });

      try {
        if (input.key && typeof input.key === "string") {
          const value = svc.readKey(input.key);
          return JSON.stringify({ key: input.key, value });
        }
        return JSON.stringify(svc.read());
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (action === "config_patch") {
      const svc = config.systemConfigService;
      if (!svc) return JSON.stringify({ error: "Config service not available" });

      if (typeof input.key !== "string" || input.key === "") {
        return JSON.stringify({ error: "key (string) is required for config_patch" });
      }
      try {
        svc.patch(input.key, input.value);
        return JSON.stringify({ ok: true, message: `Config key "${input.key}" updated.` });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    // --- Plugin operations ---

    if (action === "plugin_list") {
      const loadedPlugins = config.pluginRegistry?.getAll() ?? [];
      const allDiscovered = config.discoveredPlugins ?? [];
      const prefs = config.pluginPrefs;

      const plugins = allDiscovered.length > 0
        ? allDiscovered.map((d) => {
            const active = loadedPlugins.some((l) => l.manifest.id === d.id);
            return {
              id: d.id,
              name: d.name,
              version: d.version,
              description: d.description,
              category: d.category,
              active,
              enabled: prefs?.[d.id]?.enabled !== false,
              bakedIn: d.bakedIn,
              disableable: d.disableable,
            };
          })
        : loadedPlugins.map((p) => ({
            id: p.manifest.id,
            name: p.manifest.name,
            version: p.manifest.version,
            description: p.manifest.description,
            category: p.manifest.category ?? "tool",
            active: true,
            enabled: true,
            bakedIn: p.manifest.bakedIn ?? false,
            disableable: p.manifest.disableable ?? true,
          }));

      return JSON.stringify({ plugins });
    }

    if (action === "plugin_enable" || action === "plugin_disable") {
      const pluginId = input.pluginId ? String(input.pluginId) : "";
      if (!pluginId) return JSON.stringify({ error: "pluginId is required" });

      const svc = config.systemConfigService;
      if (!svc) return JSON.stringify({ error: "Config service not available" });

      const enabled = action === "plugin_enable";

      // Reject disabling non-disableable baked-in plugins
      if (!enabled) {
        const target = config.discoveredPlugins?.find((d) => d.id === pluginId);
        if (target?.bakedIn && !target.disableable) {
          return JSON.stringify({ error: "This plugin cannot be disabled" });
        }
      }

      try {
        svc.patch(`plugins.${pluginId}.enabled`, enabled);
        return JSON.stringify({ ok: true, pluginId, enabled, requiresRestart: true });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    return JSON.stringify({
      error: `Unknown action: ${action}. Use "config_read", "config_patch", "plugin_list", "plugin_enable", or "plugin_disable".`,
    });
  };
}

// ---------------------------------------------------------------------------
// Manifest + Input Schema
// ---------------------------------------------------------------------------

export const MANAGE_SETTINGS_MANIFEST = {
  name: "manage_settings",
  description:
    "Manage system settings and plugins. Actions: config_read (full config or specific key), " +
    "config_patch (update a single key via dot-notation), plugin_list (all plugins with status), " +
    "plugin_enable (activate a plugin), plugin_disable (deactivate a plugin). " +
    "Aion-only: workers cannot mutate system settings and must request changes via taskmaster_handoff.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
  agentOnly: true as const,
};

export const MANAGE_SETTINGS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["config_read", "config_patch", "plugin_list", "plugin_enable", "plugin_disable"],
      description: "Settings operation to perform",
    },
    key: {
      type: "string",
      description: "Dot-notation config key (for config_read/config_patch)",
    },
    value: {
      description: "Value to set (for config_patch). Can be any JSON type.",
    },
    pluginId: {
      type: "string",
      description: "Plugin ID (for plugin_enable/plugin_disable)",
    },
  },
  required: ["action"],
};
