import type { ChannelOutboundAdapter, OutboundContent } from "@agi/channel-sdk";
import type { COAChainLogger } from "@agi/coa-chain";
import type { VoicePipeline } from "@agi/voice";
import type { VoiceGatewayState } from "@agi/voice";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Route + result types
// ---------------------------------------------------------------------------

/** Describes a single outbound message to be dispatched to a channel. */
export interface OutboundRoute {
  /** Target channel identifier. */
  channelId: string;
  /** Target user within the channel. */
  channelUserId: string;
  /** Message content in channel-sdk format. */
  content: OutboundContent;
  /** Resolved entity ID for COA logging. */
  entityId: string;
  /** Optional: original inbound message ID this is replying to. */
  inReplyTo?: string;
  /** If true and voicePipeline is configured, synthesize text to audio before sending. */
  voiceReply?: boolean;
}

/** Result returned after a successful single dispatch. */
export interface OutboundResult {
  channelId: string;
  channelUserId: string;
  /** COA fingerprint written for this dispatch. */
  coaFingerprint: string;
  /** ISO timestamp at moment of delivery. */
  deliveredAt: string;
}

/** Error record for a failed dispatch within a batch. */
export interface OutboundError {
  channelId: string;
  channelUserId: string;
  error: string;
}

/** Aggregate result for a batch dispatch. */
export interface OutboundBatchResult {
  results: Array<OutboundResult | OutboundError>;
  successCount: number;
  failureCount: number;
}

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

/** Dependencies for {@link OutboundDispatcher}, injected at construction time. */
export interface OutboundDispatcherDeps {
  /** Look up a channel's outbound adapter by ID. Returns undefined if not registered. */
  getChannelAdapter: (channelId: string) => ChannelOutboundAdapter | undefined;
  /** Synchronous COA chain logger (SQLite-backed). */
  coaLogger: COAChainLogger;
  /** Resolve entity ULID to COA alias (e.g. "#E0"). */
  resolveCoaAlias: (entityId: string) => string;
  /** Gateway resource ID used in COA records (e.g. "$A0"). */
  resourceId: string;
  /** Gateway node ID used in COA records (e.g. "@A0"). */
  nodeId: string;
  /** Optional voice pipeline for TTS synthesis on outbound voice replies. */
  voicePipeline?: VoicePipeline;
  /** Returns the current gateway state for voice provider selection. */
  getGatewayState?: () => VoiceGatewayState;
  /** Optional logger instance. */
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// OutboundDispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatches outbound messages to channel adapters, writing a COA record
 * for each delivery.
 *
 * @example
 * const dispatcher = new OutboundDispatcher({
 *   getChannelAdapter: registry.getOutbound.bind(registry),
 *   coaLogger,
 *   resourceId: "$A0",
 *   nodeId: "@A0",
 * });
 * const result = await dispatcher.dispatch(route);
 */
export class OutboundDispatcher {
  private readonly getChannelAdapter: (channelId: string) => ChannelOutboundAdapter | undefined;
  private readonly resolveCoaAlias: (entityId: string) => string;
  private readonly resourceId: string;
  private readonly nodeId: string;
  private readonly voicePipeline: VoicePipeline | undefined;
  private readonly getGatewayState: (() => VoiceGatewayState) | undefined;
  private readonly log: ComponentLogger;

  constructor(deps: OutboundDispatcherDeps) {
    this.getChannelAdapter = deps.getChannelAdapter;
    this.resolveCoaAlias = deps.resolveCoaAlias;
    this.resourceId = deps.resourceId;
    this.nodeId = deps.nodeId;
    this.voicePipeline = deps.voicePipeline;
    this.getGatewayState = deps.getGatewayState;
    this.log = createComponentLogger(deps.logger, "outbound");
  }

  // ---------------------------------------------------------------------------
  // Single dispatch
  // ---------------------------------------------------------------------------

  /**
   * Dispatch a single outbound route.
   *
   * Steps:
   * 1. Resolve the channel adapter by ID — throws if not found.
   * 2. (Optional) If voiceReply is true and voicePipeline is configured, synthesize text to audio.
   * 3. Log a COA record for the outbound event (synchronous).
   * 4. Deliver via the adapter's send method.
   *
   * @throws {Error} If no adapter is registered for `route.channelId`.
   */
  async dispatch(route: OutboundRoute): Promise<OutboundResult> {
    const adapter = this.getChannelAdapter(route.channelId);
    if (adapter === undefined) {
      throw new Error(`Channel not found: ${route.channelId}`);
    }

    // Step 2 — TTS synthesis (optional, graceful degradation)
    let content = route.content;
    if (
      route.voiceReply === true &&
      this.voicePipeline !== undefined &&
      content.type === "text"
    ) {
      try {
        const state = this.getGatewayState?.() ?? "ONLINE";
        const ttsResult = await this.voicePipeline.synthesize({
          text: content.text,
          entityId: route.entityId,
          state,
        });

        content = {
          type: "voice",
          audioBuffer: ttsResult.audio.buffer,
          format: ttsResult.audio.format,
        };

        this.log.info(
          `TTS synthesis: ${String(ttsResult.characterCount)} chars → audio (provider=${ttsResult.provider})`,
        );
      } catch (err) {
        // Graceful degradation: log and continue sending text
        this.log.warn(
          `TTS synthesis failed, sending text as-is: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // COA entry is created at invocation DONE (agent-invoker), not per outbound message.
    const coaFingerprint = `${this.resourceId}.${this.resolveCoaAlias(route.entityId)}.${this.nodeId}.delivered`;

    await adapter.send(route.channelUserId, content);

    return {
      channelId: route.channelId,
      channelUserId: route.channelUserId,
      coaFingerprint,
      deliveredAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Batch dispatch
  // ---------------------------------------------------------------------------

  /**
   * Dispatch multiple routes, collecting all results without short-circuiting
   * on individual failures.
   */
  async dispatchBatch(routes: OutboundRoute[]): Promise<OutboundBatchResult> {
    const settled = await Promise.allSettled(
      routes.map((route) => this.dispatch(route)),
    );

    const results: Array<OutboundResult | OutboundError> = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      const route = routes[i];

      // Both arrays are always the same length — indices always align.
      // Non-null assertions satisfy noUncheckedIndexedAccess.
      if (outcome === undefined || route === undefined) {
        continue;
      }

      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
        successCount += 1;
      } else {
        const error =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);

        results.push({
          channelId: route.channelId,
          channelUserId: route.channelUserId,
          error,
        });
        failureCount += 1;
      }
    }

    return { results, successCount, failureCount };
  }
}
