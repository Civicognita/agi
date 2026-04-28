/**
 * defineProvider — chainable builder for LLMProviderDefinition.
 *
 * LLM providers connect the agent pipeline to AI model APIs
 * (Anthropic, OpenAI, Ollama, Groq, etc.).
 *
 * ## Quick example
 *
 * ```ts
 * const anthropic = defineProvider("anthropic", "Anthropic")
 *   .description("Claude models via the Anthropic API")
 *   .defaultModel("claude-sonnet-4-6")
 *   .envKey("ANTHROPIC_API_KEY")
 *   .requiresApiKey(true)
 *   .model("claude-opus-4-6")
 *   .model("claude-sonnet-4-6")
 *   .model("claude-haiku-4-5-20251001")
 *   .fields([
 *     { id: "apiKey", label: "API Key", type: "password", placeholder: "sk-ant-..." },
 *   ])
 *   .factory((config) => createAnthropicProvider(config))
 *   .build();
 *
 * // In your plugin's activate():
 * api.registerProvider(anthropic);
 * ```
 */

import type { LLMProviderDefinition, LLMProviderFactory, ProviderField } from "@agi/plugins";
export type { ProviderField };

class ProviderBuilder {
  private def: Partial<LLMProviderDefinition> & { id: string; name: string };
  private _fields: ProviderField[] = [];
  private _checkBalance?: (config: Record<string, unknown>) => Promise<number | null>;

  constructor(id: string, name: string) {
    this.def = { id, name, requiresApiKey: true, models: [] };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  defaultModel(model: string): this {
    this.def.defaultModel = model;
    return this;
  }

  envKey(key: string): this {
    this.def.envKey = key;
    return this;
  }

  requiresApiKey(required: boolean): this {
    this.def.requiresApiKey = required;
    return this;
  }

  defaultBaseUrl(url: string): this {
    this.def.defaultBaseUrl = url;
    return this;
  }

  model(modelId: string): this {
    if (!this.def.models) this.def.models = [];
    this.def.models.push(modelId);
    return this;
  }

  fields(fields: ProviderField[]): this {
    this._fields = fields;
    return this;
  }

  factory(fn: LLMProviderFactory): this {
    this.def.factory = fn;
    return this;
  }

  /**
   * Register a function that checks the provider's remaining credit balance.
   * The function receives the provider's saved config (apiKey, adminApiKey, etc.)
   * and returns the USD balance remaining, or null if unavailable/unsupported.
   */
  checkBalance(fn: (config: Record<string, unknown>) => Promise<number | null>): this {
    this._checkBalance = fn;
    return this;
  }

  build(): LLMProviderDefinition {
    if (!this.def.defaultModel) throw new Error("LLMProviderDefinition requires a defaultModel");
    if (!this.def.factory) throw new Error("LLMProviderDefinition requires a factory");
    if (!this.def.envKey && this.def.requiresApiKey) {
      throw new Error("LLMProviderDefinition requires an envKey when requiresApiKey is true");
    }
    if (!this.def.envKey) this.def.envKey = "";
    if (this._fields.length > 0) this.def.fields = this._fields;
    if (this._checkBalance) this.def.checkBalance = this._checkBalance;
    return this.def as LLMProviderDefinition;
  }
}

/**
 * Create an LLM provider definition using a chainable builder.
 *
 * @param id - Unique provider identifier (e.g. "anthropic", "openai", "ollama")
 * @param name - Human-readable name (e.g. "Anthropic")
 */
export function defineProvider(id: string, name: string): ProviderBuilder {
  return new ProviderBuilder(id, name);
}
