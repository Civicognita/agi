/**
 * Cognee Memory Provider — Task #141 (ONLINE mode)
 *
 * Uses Cognee's semantic memory API for entity memory.
 * Only used when STATE === ONLINE.
 *
 * @see https://docs.cognee.ai
 */

import type {
  MemoryProvider,
  MemoryEntry,
  MemoryQueryParams,
  PruneParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CogneeConfig {
  /** Cognee API key. Falls back to COGNEE_API_KEY env var. */
  apiKey?: string;
  /** Cognee API endpoint (default: https://api.cognee.ai/v1). */
  endpoint?: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class CogneeMemoryProvider implements MemoryProvider {
  readonly name = "cognee";
  readonly requiresNetwork = true;

  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(config?: CogneeConfig) {
    this.apiKey = config?.apiKey ?? process.env["COGNEE_API_KEY"] ?? "";
    this.endpoint = config?.endpoint ?? "https://api.cognee.ai/v1";
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  async store(entry: MemoryEntry): Promise<void> {
    await this.apiCall("POST", "/memories", entry);
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    await this.apiCall("POST", "/memories/batch", { entries });
  }

  // ---------------------------------------------------------------------------
  // Query — uses Cognee's semantic search
  // ---------------------------------------------------------------------------

  async query(params: MemoryQueryParams): Promise<MemoryEntry[]> {
    const response = await this.apiCall<{ results: MemoryEntry[] }>(
      "POST",
      "/memories/search",
      {
        entity_id: params.entityId,
        query: params.query ?? "",
        categories: params.categories,
        limit: params.limit ?? 10,
        min_relevance: params.minRelevance ?? 0,
      },
    );

    return response.results;
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  async delete(memoryId: string): Promise<void> {
    await this.apiCall("DELETE", `/memories/${memoryId}`);
  }

  async deleteAllForEntity(entityId: string): Promise<void> {
    await this.apiCall("DELETE", `/memories/entity/${entityId}`);
  }

  // ---------------------------------------------------------------------------
  // Prune
  // ---------------------------------------------------------------------------

  async prune(params: PruneParams): Promise<number> {
    const response = await this.apiCall<{ pruned: number }>(
      "POST",
      "/memories/prune",
      {
        entity_id: params.entityId,
        older_than: params.olderThan,
        access_count_below: params.accessCountBelow,
        max_per_entity: params.maxPerEntity,
      },
    );

    return response.pruned;
  }

  // ---------------------------------------------------------------------------
  // Count / availability
  // ---------------------------------------------------------------------------

  async count(entityId: string): Promise<number> {
    const response = await this.apiCall<{ count: number }>(
      "GET",
      `/memories/entity/${entityId}/count`,
    );
    return response.count;
  }

  async isAvailable(): Promise<boolean> {
    if (this.apiKey === "") return false;

    try {
      await this.apiCall("GET", "/health");
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP client
  // ---------------------------------------------------------------------------

  private async apiCall<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.endpoint}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Cognee API error: ${String(response.status)} ${response.statusText} — ${text}`,
      );
    }

    // DELETE may return no content
    if (response.status === 204) return undefined as T;

    return (await response.json()) as T;
  }
}
