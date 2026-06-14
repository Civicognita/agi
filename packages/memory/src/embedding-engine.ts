/**
 * EmbeddingEngine — Ollama-backed local semantic embeddings (s112 Phase 2).
 *
 * Generates Float32Array embeddings for memory events and doc chunks.
 * Falls back to null (caller uses FTS5 BM25) when Ollama is unavailable.
 *
 * Supported models (configured via gateway.json memory.embeddingModel):
 *   nomic-embed-text  — 768 dims, Apache 2.0, good quality, default
 *   all-minilm:l6-v2  — 384 dims, smaller/faster
 *
 * Cosine reranking after FTS5 pre-filter is done in GraphMemoryAdapter.
 */

export interface EmbeddingEngineConfig {
  /** Ollama base URL (default: http://localhost:11434). */
  ollamaUrl?: string;
  /** Embedding model name (default: nomic-embed-text). */
  model?: string;
}

export class EmbeddingEngine {
  private readonly ollamaUrl: string;
  readonly model: string;
  private _available: boolean | null = null;

  constructor(config: EmbeddingEngineConfig = {}) {
    this.ollamaUrl = config.ollamaUrl ?? "http://localhost:11434";
    this.model = config.model ?? "nomic-embed-text";
  }

  /** Returns true if Ollama is reachable and the model is loaded. */
  isAvailable(): boolean {
    return this._available === true;
  }

  /** Check health (async — must be called at startup or before first use). */
  async checkAvailability(): Promise<boolean> {
    try {
      const res = await fetch(`${this.ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) {
        this._available = false;
        return false;
      }
      const data = (await res.json()) as { models?: { name: string }[] };
      const loaded =
        data.models?.some((m) => m.name.startsWith(this.model)) ?? false;
      this._available = loaded;
      return loaded;
    } catch {
      this._available = false;
      return false;
    }
  }

  /**
   * Embed a text string.
   * @returns Float32Array of embedding dims, or null if Ollama unavailable.
   */
  async embed(text: string): Promise<Float32Array | null> {
    if (!this._available) {
      // Lazy check on first call if never explicitly checked
      if (this._available === null) {
        await this.checkAvailability();
      }
      if (!this._available) return null;
    }

    try {
      const res = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as { embedding?: number[] };
      if (!data.embedding?.length) return null;

      return new Float32Array(data.embedding);
    } catch {
      this._available = false;
      return null;
    }
  }

  /**
   * Batch embed multiple strings.
   * Returns an array of equal length, with null entries where embedding failed.
   */
  async embedBatch(texts: string[]): Promise<(Float32Array | null)[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

/**
 * Cosine similarity between two Float32Arrays of equal length.
 * Returns -1..1; higher is more similar.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! ** 2;
    nb += b[i]! ** 2;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
