/**
 * defineScript — chainable builder for ScriptDefinition.
 *
 * MApp authors use this to declare Starlark scripts in their manifest's
 * `scripts` array (mapp/1.1 schema). Each script is scoped to the MApp
 * and is deny-by-default (must be explicitly enabled before execution).
 *
 * @example
 * ```ts
 * const packer = defineScript("coa-packer", "COA Packer")
 *   .description("Converts raw COA objects to 0REALTALK wire format")
 *   .source(`
 *     def pack(input):
 *       return {"packed": input["data"]}
 *   `)
 *   .packer()
 *   .deterministic()
 *   .build();
 * ```
 */

import type { MAppScriptDefinition } from "./mapp-schema.js";

class ScriptBuilder {
  private readonly def: MAppScriptDefinition;

  constructor(id: string, name: string) {
    this.def = { id, name, language: "starlark" };
  }

  description(d: string): this {
    this.def.description = d;
    return this;
  }

  source(s: string): this {
    this.def.source = s;
    return this;
  }

  /** Mark this script as a 0REALTALK packer — enforces deterministic mode. */
  packer(isPacker = true): this {
    this.def.isPacker = isPacker;
    return this;
  }

  /** Wall-clock timeout in milliseconds (default: 1000). */
  timeout(ms: number): this {
    this.def.timeoutMs = ms;
    return this;
  }

  /** Max linear memory in 64 KB pages (default: 256 = 16 MB). */
  maxMemory(pages: number): this {
    this.def.maxMemoryPages = pages;
    return this;
  }

  /**
   * Freeze clock and seed PRNG for reproducible execution.
   * 0REALTALK packers MUST use deterministic mode; it is on by default for
   * scripts marked `packer()`.
   */
  deterministic(enabled = true): this {
    this.def.deterministic = enabled;
    return this;
  }

  build(): MAppScriptDefinition {
    return { ...this.def };
  }
}

export function defineScript(id: string, name: string): ScriptBuilder {
  return new ScriptBuilder(id, name);
}

export type { MAppScriptDefinition as ScriptDefinition };
