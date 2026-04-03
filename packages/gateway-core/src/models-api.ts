/**
 * Models API Routes — lists available models from AI provider APIs.
 *
 * GET /api/models?provider=anthropic|openai|ollama
 *
 * Resolves API key/baseUrl from:
 *   providers[provider] → env var fallback.
 * Gated to private network only.
 */

import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Helpers (shared pattern with comms-api / hosting-api)
// ---------------------------------------------------------------------------

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function isPrivateNetwork(ip: string): boolean {
  if (isLoopback(ip)) return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  if (ip.startsWith("fe80:")) return true;
  return false;
}

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0];
    return first !== undefined ? first.trim() : "unknown";
  }
  return req.socket.remoteAddress ?? "unknown";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProviderType = "anthropic" | "openai" | "ollama";

interface ModelEntry {
  id: string;
  name: string;
}

interface ProviderCredential {
  apiKey?: string;
  baseUrl?: string;
}

export interface ModelsRouteDeps {
  /** Path to aionima.json — read at request time for fresh credentials. */
  configPath: string;
}

// ---------------------------------------------------------------------------
// Env key map
// ---------------------------------------------------------------------------

const ENV_KEYS: Record<ProviderType, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  ollama: "",
};

// ---------------------------------------------------------------------------
// Provider-specific model fetchers
// ---------------------------------------------------------------------------

async function fetchAnthropicModels(apiKey: string, baseUrl?: string): Promise<ModelEntry[]> {
  const base = baseUrl ?? "https://api.anthropic.com";
  const res = await fetch(`${base}/v1/models`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
  return (body.data ?? []).map((m) => ({
    id: m.id,
    name: m.display_name ?? m.id,
  }));
}

async function fetchOpenAIModels(apiKey: string, baseUrl?: string): Promise<ModelEntry[]> {
  const base = baseUrl ?? "https://api.openai.com";
  const res = await fetch(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return (body.data ?? []).map((m) => ({
    id: m.id,
    name: m.id,
  }));
}

async function fetchOllamaModels(baseUrl?: string): Promise<ModelEntry[]> {
  const base = baseUrl ?? "http://127.0.0.1:11434";
  const res = await fetch(`${base}/api/tags`);
  if (!res.ok) {
    throw new Error(`Ollama API ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { models?: Array<{ name: string }> };
  return (body.models ?? []).map((m) => ({
    id: m.name,
    name: m.name,
  }));
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerModelsRoutes(
  fastify: FastifyInstance,
  deps: ModelsRouteDeps,
): void {
  function readProviderCred(provider: ProviderType): ProviderCredential {
    try {
      const raw = readFileSync(deps.configPath, "utf-8");
      const config = JSON.parse(raw) as { providers?: Record<string, ProviderCredential> };
      return config.providers?.[provider] ?? {};
    } catch {
      return {};
    }
  }

  function resolveApiKey(provider: ProviderType): string | undefined {
    const cred = readProviderCred(provider);
    if (cred.apiKey) return cred.apiKey;
    const envKey = ENV_KEYS[provider];
    return envKey ? process.env[envKey] : undefined;
  }

  function resolveBaseUrl(provider: ProviderType): string | undefined {
    return readProviderCred(provider).baseUrl;
  }

  fastify.get<{
    Querystring: { provider?: string };
  }>("/api/models", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Models API only allowed from private network" });
    }

    const provider = request.query.provider as ProviderType | undefined;
    if (!provider || !["anthropic", "openai", "ollama"].includes(provider)) {
      return reply.code(400).send({ error: "Query parameter 'provider' must be one of: anthropic, openai, ollama" });
    }

    try {
      let models: ModelEntry[];
      const baseUrl = resolveBaseUrl(provider);

      switch (provider) {
        case "anthropic": {
          const key = resolveApiKey("anthropic");
          if (!key) return reply.code(422).send({ error: "No Anthropic API key configured" });
          models = await fetchAnthropicModels(key, baseUrl);
          break;
        }
        case "openai": {
          const key = resolveApiKey("openai");
          if (!key) return reply.code(422).send({ error: "No OpenAI API key configured" });
          models = await fetchOpenAIModels(key, baseUrl);
          break;
        }
        case "ollama": {
          models = await fetchOllamaModels(baseUrl);
          break;
        }
      }

      return reply.send({ provider, models });
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
