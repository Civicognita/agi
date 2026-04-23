/**
 * LocalModelRuntime — thin wrapper that routes narrative-generation tasks to a
 * small always-available local model.
 *
 * Primary: SmolLM2-360M-Instruct via HF Marketplace container.
 * Fallback: Aion-Micro (SmolLM2-135M-Instruct, self-contained container).
 *
 * Used by:
 *   - SafemodeInvestigator to turn collected evidence into a readable report.
 *   - `agi doctor --with-aion` to produce narrative health diagnoses.
 */

import type { InferenceGateway } from "@agi/model-runtime";
import type { ModelStore } from "@agi/model-runtime";
import type { ComponentLogger } from "./logger.js";
import type { AionMicroManager } from "./aion-micro-manager.js";

export const DEFAULT_LOCAL_MODEL_ID = "HuggingFaceTB/SmolLM2-360M-Instruct";

export interface LocalModelConfig {
  modelId: string;
}

export interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

export class LocalModelRuntime {
  constructor(
    private readonly modelStore: ModelStore,
    private readonly inferenceGateway: InferenceGateway,
    private readonly config: LocalModelConfig,
    private readonly log: ComponentLogger,
    private readonly aionMicro?: AionMicroManager,
  ) {}

  getModelId(): string {
    return this.config.modelId;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const model = await this.modelStore.getById(this.config.modelId);
      if (model?.status === "running") return true;
    } catch {
      // fall through to aion-micro check
    }

    if (this.aionMicro?.isEnabled()) {
      return await this.aionMicro.ensureAvailable();
    }
    return false;
  }

  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string | null> {
    const maxTokens = opts.maxTokens ?? 1024;
    const temperature = opts.temperature ?? 0.3;
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
    if (opts.system !== undefined && opts.system.length > 0) {
      messages.push({ role: "system", content: opts.system });
    }
    messages.push({ role: "user", content: prompt });

    // Try primary model first
    try {
      const resp = await this.inferenceGateway.chatCompletion(this.config.modelId, {
        model: this.config.modelId,
        messages,
        max_tokens: maxTokens,
        temperature,
      });
      const text = resp.choices?.[0]?.message?.content;
      if (typeof text === "string" && text.length > 0) return text;
    } catch {
      // fall through to aion-micro
    }

    // Fallback: aion-micro (Lemonade-backed since K.4)
    if (this.aionMicro?.isEnabled()) {
      try {
        const text = await this.aionMicro.complete({
          system: opts.system,
          prompt,
          maxTokens,
          temperature,
        });
        if (typeof text === "string" && text.length > 0) return text;
      } catch (err) {
        this.log.warn(`aion-micro fallback failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return null;
  }
}
