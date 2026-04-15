/**
 * StackRegistry — central store for stack definitions registered by plugins.
 */

import type { ProjectCategory } from "./project-types.js";
import type { StackDefinition, StackInfo, StackCategory } from "./stack-types.js";

export class StackRegistry {
  private readonly stacks = new Map<string, StackDefinition>();

  register(def: StackDefinition): void {
    this.stacks.set(def.id, def);
  }

  get(id: string): StackDefinition | undefined {
    return this.stacks.get(id);
  }

  has(id: string): boolean {
    return this.stacks.has(id);
  }

  unregister(id: string): boolean {
    return this.stacks.delete(id);
  }

  getAll(): StackDefinition[] {
    return Array.from(this.stacks.values());
  }

  getForCategory(category: ProjectCategory): StackDefinition[] {
    return this.getAll().filter((s) => s.projectCategories.includes(category));
  }

  getByStackCategory(category: StackCategory): StackDefinition[] {
    return this.getAll().filter((s) => s.category === category);
  }

  /** Serialize for API responses — strips functions from container/db config. */
  toJSON(filter?: { projectCategory?: ProjectCategory; stackCategory?: StackCategory }): StackInfo[] {
    let stacks = this.getAll();
    if (filter?.projectCategory) {
      stacks = stacks.filter((s) => s.projectCategories.includes(filter.projectCategory!));
    }
    if (filter?.stackCategory) {
      stacks = stacks.filter((s) => s.category === filter.stackCategory);
    }
    return stacks.map(serializeStack);
  }
}

function serializeStack(def: StackDefinition): StackInfo {
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    category: def.category,
    projectCategories: def.projectCategories,
    requirements: def.requirements,
    guides: def.guides,
    hasContainer: !!def.containerConfig,
    hasDatabase: !!def.databaseConfig,
    hasScaffolding: !!def.scaffolding,
    installActions: def.installActions,
    devCommands: def.devCommands,
    tools: def.tools,
    icon: def.icon,
    compatibleLanguages: def.compatibleLanguages,
    logSources: def.logSources,
  };
}
