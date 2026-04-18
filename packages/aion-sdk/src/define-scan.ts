/**
 * defineScan — chainable builder for ScanProviderDefinition.
 *
 * ## Example
 *
 * ```ts
 * import { defineScan } from "@agi/sdk";
 *
 * const phpScanner = defineScan("php-sast", "PHP SAST")
 *   .description("Static analysis for PHP projects")
 *   .scanType("sast")
 *   .projectCategories(["web", "app"])
 *   .handler(async (config, ctx) => {
 *     // Scan PHP files, return SecurityFinding[]
 *     return [];
 *   })
 *   .icon("shield")
 *   .build();
 *
 * // In plugin activation:
 * api.registerScanProvider(phpScanner);
 * ```
 */

import type { ScanProviderDefinition, ScanProviderHandler, ScanType } from "@agi/security";

class ScanBuilder {
  private def: Partial<ScanProviderDefinition> & { id: string; name: string };

  constructor(id: string, name: string) {
    this.def = { id, name };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  scanType(type: ScanType): this {
    this.def.scanType = type;
    return this;
  }

  projectCategories(cats: string[]): this {
    this.def.projectCategories = cats;
    return this;
  }

  handler(fn: ScanProviderHandler): this {
    this.def.scan = fn;
    return this;
  }

  icon(icon: string): this {
    this.def.icon = icon;
    return this;
  }

  build(): ScanProviderDefinition {
    if (!this.def.scanType) throw new Error("defineScan: scanType is required");
    if (!this.def.scan) throw new Error("defineScan: handler is required (call .handler())");
    return this.def as ScanProviderDefinition;
  }
}

export function defineScan(id: string, name: string): ScanBuilder {
  return new ScanBuilder(id, name);
}
