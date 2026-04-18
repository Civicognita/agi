/**
 * MAppRegistry — standalone registry for MagicApps.
 *
 * Completely independent of PluginRegistry. MApps are discovered
 * from ~/.agi/mapps/{author}/{slug}.json at boot, not through plugins.
 */

import type { MAppDefinition, MAppInfo } from "@agi/sdk";
import { serializeMApp } from "@agi/sdk";

export class MAppRegistry {
  private readonly mapps = new Map<string, MAppDefinition>();

  register(def: MAppDefinition): void {
    this.mapps.set(def.id, def);
  }

  unregister(id: string): void {
    this.mapps.delete(id);
  }

  get(id: string): MAppDefinition | undefined {
    return this.mapps.get(id);
  }

  has(id: string): boolean {
    return this.mapps.has(id);
  }

  getAll(): MAppDefinition[] {
    return Array.from(this.mapps.values());
  }

  getAllSerialized(): MAppInfo[] {
    return this.getAll().map(serializeMApp);
  }

  getForType(projectType: string): MAppDefinition[] {
    return this.getAll().filter(
      (m) => !m.projectTypes || m.projectTypes.length === 0 || m.projectTypes.includes(projectType),
    );
  }

  getForCategory(category: string): MAppDefinition[] {
    return this.getAll().filter(
      (m) => !m.projectCategories || m.projectCategories.length === 0 || m.projectCategories.includes(category),
    );
  }

  get size(): number {
    return this.mapps.size;
  }
}
