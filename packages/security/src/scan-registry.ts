/**
 * ScanProviderRegistry — extensible registry of security scan providers.
 * Mirrors the pattern from PluginRegistry.
 */

import type { ScanProviderDefinition, ScanType } from "./types.js";

export interface RegisteredScanProvider {
  pluginId: string;
  provider: ScanProviderDefinition;
}

export class ScanProviderRegistry {
  private readonly providers = new Map<string, RegisteredScanProvider>();

  add(pluginId: string, provider: ScanProviderDefinition): void {
    if (this.providers.has(provider.id)) return;
    this.providers.set(provider.id, { pluginId, provider });
  }

  get(id: string): RegisteredScanProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): RegisteredScanProvider[] {
    return [...this.providers.values()];
  }

  getByType(scanType: ScanType): RegisteredScanProvider[] {
    return this.getAll().filter(p => p.provider.scanType === scanType);
  }

  getForProject(categories: string[]): RegisteredScanProvider[] {
    return this.getAll().filter(p => {
      if (!p.provider.projectCategories || p.provider.projectCategories.length === 0) return true;
      return p.provider.projectCategories.some(c => categories.includes(c));
    });
  }

  remove(id: string): boolean {
    return this.providers.delete(id);
  }

  clear(): void {
    this.providers.clear();
  }
}
