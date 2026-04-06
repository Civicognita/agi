/**
 * defineMagicApp — chainable builder for MAppDefinition.
 *
 * Usage:
 *   defineMagicApp("reader", "Reader", "civicognita")
 *     .description("E-reader for literature projects")
 *     .version("1.0.0")
 *     .category("reader")
 *     .projectTypes(["writing"])
 *     .permission("container.run", "Serves content via nginx", true)
 *     .container({ image: "nginx:alpine", internalPort: 80, volumeMounts: [...] })
 *     .panel("Reader", [{ type: "iframe", ... }])
 *     .build()
 */

import type {
  MAppDefinition,
  MAppCategory,
  MAppContainerConfig,
  MAppAgentPrompt,
  MAppWorkflow,
  MAppTheme,
  MAppTool,
  MAppWidget,
  MAppPermission,
} from "./mapp-schema.js";
import { MAPP_SCHEMA_VERSION } from "./mapp-schema.js";

class MAppBuilder {
  private readonly def: Partial<MAppDefinition> & { $schema: typeof MAPP_SCHEMA_VERSION; id: string; name: string; author: string; permissions: MAppPermission[] };

  constructor(id: string, name: string, author: string) {
    this.def = { $schema: MAPP_SCHEMA_VERSION, id, name, author, permissions: [] };
  }

  description(desc: string): this { this.def.description = desc; return this; }
  version(v: string): this { this.def.version = v; return this; }
  icon(icon: string): this { this.def.icon = icon; return this; }
  license(lic: string): this { this.def.license = lic; return this; }
  category(cat: MAppCategory): this { this.def.category = cat; return this; }
  projectTypes(types: string[]): this { this.def.projectTypes = types; return this; }
  projectCategories(cats: string[]): this { this.def.projectCategories = cats; return this; }

  permission(id: string, reason: string, required = true): this {
    this.def.permissions.push({ id, reason, required });
    return this;
  }

  container(config: MAppContainerConfig): this {
    this.def.container = config;
    return this;
  }

  panel(label: string, widgets: MAppWidget[], position?: number): this {
    this.def.panel = { label, widgets, position };
    return this;
  }

  prompt(p: MAppAgentPrompt): this {
    if (!this.def.prompts) this.def.prompts = [];
    this.def.prompts.push(p);
    return this;
  }

  workflow(wf: MAppWorkflow): this {
    if (!this.def.workflows) this.def.workflows = [];
    this.def.workflows.push(wf);
    return this;
  }

  tool(t: MAppTool): this {
    if (!this.def.tools) this.def.tools = [];
    this.def.tools.push(t);
    return this;
  }

  theme(t: MAppTheme): this { this.def.theme = t; return this; }

  chain(contentHash?: string, address?: string): this {
    this.def.chain = { contentHash, address };
    return this;
  }

  build(): MAppDefinition {
    if (!this.def.description) throw new Error("MApp description is required");
    if (!this.def.version) throw new Error("MApp version is required");
    if (!this.def.category) throw new Error("MApp category is required");
    if (!this.def.panel) throw new Error("MApp panel is required");
    return this.def as MAppDefinition;
  }
}

/**
 * Create a new MApp definition using the chainable builder.
 *
 * @param id — Unique slug (e.g. "reader", "wealth-suite")
 * @param name — Display name
 * @param author — Creator identifier (e.g. "civicognita")
 */
export function defineMagicApp(id: string, name: string, author: string): MAppBuilder {
  return new MAppBuilder(id, name, author);
}
