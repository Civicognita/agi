/**
 * LocalModelRuntime — thin wrapper that routes narrative-generation tasks to a
 * small always-available local model.
 *
 * Today: SmolLM2-360M-Instruct (360M params, Apache 2.0, Hugging Face).
 *   - Runs in the existing "general" runtime container (transformers-server).
 *   - Installed via the HF Marketplace flow like any other model.
 *   - Config: `ops.localModel.modelId` in gateway.json (swappable).
 *
 * Used by:
 *   - SafemodeInvestigator to turn collected evidence into a readable report.
 *   - `agi doctor --with-aion` to produce narrative health diagnoses.
 *
 * Auto-install is deliberately NOT implemented here yet: the investigator
 * always writes a report even if the model isn't available (heuristic
 * template fallback), so safemode works on first-ever boot.
 */

import type { InferenceGateway } from "@aionima/model-runtime";
import type { ModelStore } from "@aionima/model-runtime";
import type { ComponentLogger } from "./logger.js";

export const DEFAULT_LOCAL_MODEL_ID = "HuggingFaceTB/SmolLM2-360M-Instruct";

export interface LocalModelConfig {
  /** HF model ID — default: HuggingFaceTB/SmolLM2-360M-Instruct */
  modelId: string;
}

export interface CompleteOptions {
  /** Max tokens to generate. */
  maxTokens?: number;
  /** Temperature (0-1). Default: 0.3 for narrative consistency. */
  temperature?: number;
  /** System prompt prepended to the user prompt. */
  system?: string;
}

export class LocalModelRuntime {
  constructor(
    private readonly modelStore: ModelStore,
    private readonly inferenceGateway: InferenceGateway,
    private readonly config: LocalModelConfig,
    private readonly log: ComponentLogger,
  ) {}

  getModelId(): string {
    return this.config.modelId;
  }

  /**
   * Returns true if the configured local model is installed AND currently
   * running. Investigator uses this to decide between LLM-authored or
   * heuristic reports.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const model = await this.modelStore.getById(this.config.modelId);
      if (model === undefined) return false;
      return model.status === "running";
    } catch (err) {
      this.log.warn(`local model availability check failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Generate a completion from the local model. Returns null if the model
   * isn't available or the call fails — callers should handle that case
   * gracefully (typically by falling back to a heuristic template).
   */
  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string | null> {
    const maxTokens = opts.maxTokens ?? 1024;
    const temperature = opts.temperature ?? 0.3;
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
    if (opts.system !== undefined && opts.system.length > 0) {
      messages.push({ role: "system", content: opts.system });
    }
    messages.push({ role: "user", content: prompt });

    try {
      const resp = await this.inferenceGateway.chatCompletion(this.config.modelId, {
        model: this.config.modelId,
        messages,
        max_tokens: maxTokens,
        temperature,
      });
      const choice = resp.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== "string" || text.length === 0) return null;
      return text;
    } catch (err) {
      this.log.warn(
        `local model complete() failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
