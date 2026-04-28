/**
 * definePmProvider — chainable builder for PmProviderDefinition.
 *
 * PM providers back the canonical tynn workflow with arbitrary storage:
 * tynn-the-service (built-in), tynn-lite file-based (built-in), or any
 * plugin-registered alternative (Linear, Jira, GitHub Projects, etc).
 *
 * Storage is pluggable; the workflow shape is canonical. See
 * `agi/docs/agents/tynn-and-related-concepts.md`.
 *
 * ## Quick example
 *
 * ```ts
 * import { definePmProvider, type PmProvider } from "@agi/sdk";
 *
 * const linear = definePmProvider("linear", "Linear")
 *   .description("Linear issue tracker as PM provider")
 *   .fields([
 *     { id: "apiKey", label: "Linear API key", type: "password" },
 *     { id: "teamId", label: "Team id", type: "text" },
 *   ])
 *   .factory((config) => createLinearPmProvider(config))
 *   .build();
 *
 * // In your plugin's activate():
 * api.registerPmProvider(linear);
 * ```
 *
 * The factory's return type is `unknown` at the plugin-API boundary (avoids
 * a circular dep on @agi/sdk from @agi/plugins). Plugin authors should write
 * factories that return objects matching the `PmProvider` interface — the
 * gateway runtime treats the returned object as `PmProvider` at the call site.
 */

import type { PmProviderDefinition, PmProviderFactory, ProviderField } from "@agi/plugins";
export type { PmProviderDefinition, PmProviderFactory };

class PmProviderBuilder {
  private def: Partial<PmProviderDefinition> & { id: string; name: string };
  private _fields: ProviderField[] = [];

  constructor(id: string, name: string) {
    this.def = { id, name };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  fields(fields: ProviderField[]): this {
    this._fields = fields;
    return this;
  }

  factory(fn: PmProviderFactory): this {
    this.def.factory = fn;
    return this;
  }

  build(): PmProviderDefinition {
    if (!this.def.factory) throw new Error("PmProviderDefinition requires a factory");
    if (this._fields.length > 0) this.def.fields = this._fields;
    return this.def as PmProviderDefinition;
  }
}

/**
 * Create a PM provider definition using a chainable builder.
 *
 * @param id - Unique provider identifier (e.g. "linear", "jira", "github-projects").
 *             Must NOT collide with the built-in ids "tynn" or "tynn-lite".
 * @param name - Human-readable name (e.g. "Linear")
 */
export function definePmProvider(id: string, name: string): PmProviderBuilder {
  return new PmProviderBuilder(id, name);
}
