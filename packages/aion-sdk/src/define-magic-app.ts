/**
 * defineMagicApp — chainable builder for MagicAppDefinition.
 *
 * Usage:
 *   defineMagicApp("reader", "Reader")
 *     .description("E-reader for literature projects")
 *     .version("1.0.0")
 *     .category("reader")
 *     .projectTypes(["writing"])
 *     .projectCategories(["literature"])
 *     .container({ image: "nginx:alpine", ... })
 *     .panel("Reader", [{ type: "iframe", ... }])
 *     .build()
 */

import type {
  MagicAppDefinition,
  MagicAppCategory,
  MagicAppContainerConfig,
  MagicAppAgentPrompt,
  MagicAppWorkflow,
  MagicAppTheme,
} from "@aionima/gateway-core";
import type { PanelWidget } from "./types.js";
import type { ProjectTypeTool } from "@aionima/gateway-core";

class MagicAppBuilder {
  private readonly def: Partial<MagicAppDefinition> & { id: string; name: string };

  constructor(id: string, name: string) {
    this.def = { id, name };
  }

  description(desc: string): this { this.def.description = desc; return this; }
  version(v: string): this { this.def.version = v; return this; }
  icon(icon: string): this { this.def.icon = icon; return this; }
  category(cat: MagicAppCategory): this { this.def.category = cat; return this; }
  projectTypes(types: string[]): this { this.def.projectTypes = types; return this; }
  projectCategories(cats: MagicAppDefinition["projectCategories"]): this { this.def.projectCategories = cats; return this; }

  container(config: MagicAppContainerConfig): this {
    this.def.containerConfig = config;
    return this;
  }

  panel(label: string, widgets: PanelWidget[], position?: number): this {
    this.def.panel = { label, widgets, position };
    return this;
  }

  agentPrompt(prompt: MagicAppAgentPrompt): this {
    if (!this.def.agentPrompts) this.def.agentPrompts = [];
    this.def.agentPrompts.push(prompt);
    return this;
  }

  workflow(wf: MagicAppWorkflow): this {
    if (!this.def.workflows) this.def.workflows = [];
    this.def.workflows.push(wf);
    return this;
  }

  tool(t: ProjectTypeTool): this {
    if (!this.def.tools) this.def.tools = [];
    this.def.tools.push(t);
    return this;
  }

  theme(t: MagicAppTheme): this { this.def.theme = t; return this; }

  chain(contentHash?: string, address?: string): this {
    this.def.chain = { contentHash, address };
    return this;
  }

  build(): MagicAppDefinition {
    if (!this.def.description) throw new Error("MagicApp description is required");
    if (!this.def.version) throw new Error("MagicApp version is required");
    if (!this.def.category) throw new Error("MagicApp category is required");
    if (!this.def.projectTypes?.length) throw new Error("MagicApp projectTypes required");
    if (!this.def.projectCategories?.length) throw new Error("MagicApp projectCategories required");
    if (!this.def.containerConfig) throw new Error("MagicApp containerConfig is required");
    if (!this.def.panel) throw new Error("MagicApp panel is required");
    return this.def as MagicAppDefinition;
  }
}

export function defineMagicApp(id: string, name: string): MagicAppBuilder {
  return new MagicAppBuilder(id, name);
}
