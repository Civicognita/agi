/**
 * FailoverProvider — Task #55
 *
 * Wraps multiple LLMProvider instances. On transient errors (429, 500, 503)
 * falls through to the next provider. Implements a simple circuit breaker:
 * mark a provider unhealthy for COOLDOWN_MS on failure, skip it until healed.
 */

import type { LLMProvider } from "./provider.js";
import type {
  LLMInvokeParams,
  LLMResponse,
  LLMToolContinuationParams,
} from "./types.js";
import { createComponentLogger } from "../logger.js";
import type { Logger, ComponentLogger } from "../logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COOLDOWN_MS = 60_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);

// ---------------------------------------------------------------------------
// Health tracking
// ---------------------------------------------------------------------------

interface ProviderHealth {
  provider: LLMProvider;
  label: string;
  unhealthySince: number | null;
}

function isHealthy(h: ProviderHealth, now: number): boolean {
  return h.unhealthySince === null || now - h.unhealthySince >= COOLDOWN_MS;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    // Check for HTTP status codes in error messages
    for (const code of RETRYABLE_STATUS_CODES) {
      if (msg.includes(String(code))) return true;
    }
    // Check for common transient error patterns
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed") || msg.includes("timeout")) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// FailoverProvider
// ---------------------------------------------------------------------------

export class FailoverProvider implements LLMProvider {
  private readonly providers: ProviderHealth[];
  private readonly log: ComponentLogger;

  constructor(providers: Array<{ provider: LLMProvider; label: string }>, logger?: Logger) {
    if (providers.length === 0) {
      throw new Error("FailoverProvider requires at least one provider");
    }
    this.providers = providers.map((p) => ({
      ...p,
      unhealthySince: null,
    }));
    this.log = createComponentLogger(logger, "failover");
  }

  async invoke(params: LLMInvokeParams): Promise<LLMResponse> {
    return this.tryAll((p) => p.invoke(params));
  }

  async continueWithToolResults(params: LLMToolContinuationParams): Promise<LLMResponse> {
    return this.tryAll((p) => p.continueWithToolResults(params));
  }

  async summarize(text: string, prompt: string): Promise<string> {
    return this.tryAll((p) => p.summarize(text, prompt));
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async tryAll<T>(fn: (provider: LLMProvider) => Promise<T>): Promise<T> {
    const now = Date.now();
    let lastError: unknown;

    for (const entry of this.providers) {
      if (!isHealthy(entry, now)) continue;

      try {
        const result = await fn(entry.provider);
        // Success — mark healthy
        entry.unhealthySince = null;
        return result;
      } catch (err) {
        lastError = err;
        if (isRetryable(err)) {
          this.log.warn(`${entry.label} failed with retryable error, trying next provider`);
          entry.unhealthySince = Date.now();
          continue;
        }
        // Non-retryable error — don't try other providers
        throw err;
      }
    }

    // All providers exhausted
    throw lastError ?? new Error("All providers are unhealthy");
  }
}
