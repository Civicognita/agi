/**
 * Composite Memory Adapter — Task #141
 *
 * STATE-gated provider selection:
 * - ONLINE: Cognee (with file sync on restore)
 * - LIMBO/OFFLINE: File adapter only
 * - UNKNOWN: File adapter (log-only mode)
 *
 * Memory written at session close, MINT ceremony, and verification events.
 * NOT per-message — intentionally batched for performance.
 */

import type { GatewayState } from "@agi/gateway-core";

import type {
  MemoryProvider,
  MemoryEntry,
  MemoryQueryParams,
  PruneParams,
  MemoryConfig,
} from "./types.js";
import { DEFAULT_MEMORY_CONFIG } from "./types.js";
import { CogneeMemoryProvider } from "./cognee-adapter.js";
import { FileMemoryProvider } from "./file-adapter.js";

// ---------------------------------------------------------------------------
// Composite adapter
// ---------------------------------------------------------------------------

export class CompositeMemoryAdapter implements MemoryProvider {
  readonly name = "composite-memory";
  readonly requiresNetwork = false; // file fallback always works

  private readonly cognee: CogneeMemoryProvider;
  private readonly file: FileMemoryProvider;
  private readonly getState: () => GatewayState;
  private readonly config: MemoryConfig;

  constructor(config: Pick<MemoryConfig, "getState" | "localMemDir"> & Partial<MemoryConfig>) {
    this.getState = config.getState;
    this.config = {
      ...DEFAULT_MEMORY_CONFIG,
      ...config,
    };

    this.cognee = new CogneeMemoryProvider({
      apiKey: this.config.cogneeApiKey,
      endpoint: this.config.cogneeEndpoint,
    });

    this.file = new FileMemoryProvider(this.config.localMemDir);
  }

  // ---------------------------------------------------------------------------
  // Provider selection
  // ---------------------------------------------------------------------------

  private activeProvider(): MemoryProvider {
    const state = this.getState();
    if (state === "ONLINE") return this.cognee;
    return this.file;
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  async store(entry: MemoryEntry): Promise<void> {
    const state = this.getState();

    if (state === "ONLINE") {
      try {
        await this.cognee.store(entry);
        return;
      } catch {
        // Fall back to file on Cognee failure
      }
    }

    // Always write to file (serves as backup and pending sync)
    await this.file.store(entry);
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    const state = this.getState();

    if (state === "ONLINE") {
      try {
        await this.cognee.storeBatch(entries);
        return;
      } catch {
        // Fall back to file
      }
    }

    await this.file.storeBatch(entries);
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  async query(params: MemoryQueryParams): Promise<MemoryEntry[]> {
    return this.activeProvider().query(params);
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  async delete(memoryId: string): Promise<void> {
    const state = this.getState();

    if (state === "ONLINE") {
      await this.cognee.delete(memoryId);
    }

    // Always delete from file too
    await this.file.delete(memoryId);
  }

  async deleteAllForEntity(entityId: string): Promise<void> {
    const state = this.getState();

    if (state === "ONLINE") {
      await this.cognee.deleteAllForEntity(entityId);
    }

    await this.file.deleteAllForEntity(entityId);
  }

  // ---------------------------------------------------------------------------
  // Prune
  // ---------------------------------------------------------------------------

  async prune(params: PruneParams): Promise<number> {
    return this.activeProvider().prune(params);
  }

  // ---------------------------------------------------------------------------
  // Count / availability
  // ---------------------------------------------------------------------------

  async count(entityId: string): Promise<number> {
    return this.activeProvider().count(entityId);
  }

  async isAvailable(): Promise<boolean> {
    return this.activeProvider().isAvailable();
  }

  // ---------------------------------------------------------------------------
  // Sync — restore file memories to Cognee when ONLINE resumes
  // ---------------------------------------------------------------------------

  /**
   * Sync pending file memories to Cognee.
   * Called when STATE transitions from LIMBO/OFFLINE back to ONLINE.
   *
   * @returns Number of entries synced.
   */
  async syncPendingToCognee(): Promise<number> {
    const state = this.getState();
    if (state !== "ONLINE") return 0;

    const cogneeAvailable = await this.cognee.isAvailable();
    if (!cogneeAvailable) return 0;

    const pending = this.file.getAllPending();
    if (pending.length === 0) return 0;

    try {
      await this.cognee.storeBatch(pending);

      // Clear synced file entries
      for (const entry of pending) {
        await this.file.delete(entry.id);
      }

      return pending.length;
    } catch {
      // Sync failed — entries remain in file store for next attempt
      return 0;
    }
  }

  /** Get count of file entries pending sync to Cognee. */
  getPendingSyncCount(): number {
    return this.file.getPendingSyncCount();
  }

  /** Get memory configuration values. */
  getConfig(): Readonly<MemoryConfig> {
    return this.config;
  }
}
