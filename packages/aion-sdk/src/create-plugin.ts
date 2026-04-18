/**
 * createPlugin — factory for type-safe plugin creation.
 */

import type { AionimaPlugin, AionimaPluginAPI, CleanupManifest } from "@agi/plugins";
import { validatePluginId } from "@agi/plugins";

export interface PluginOptions {
  /** Optional plugin ID — validated at definition time if provided. */
  id?: string;
  activate(api: AionimaPluginAPI): Promise<void>;
  deactivate?(): Promise<void>;
  /** Return cleanup resources for the uninstall preview dialog. */
  cleanup?(): Promise<CleanupManifest>;
}

export function createPlugin(options: PluginOptions): AionimaPlugin {
  if (options.id !== undefined && !validatePluginId(options.id)) {
    throw new Error(`Invalid plugin ID "${options.id}" — must be lowercase kebab-case (e.g. "my-plugin")`);
  }

  return {
    activate: options.activate,
    deactivate: options.deactivate,
    cleanup: options.cleanup,
  };
}
