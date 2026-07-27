import type { AionimaMessage, OutboundContent } from "@agi/plugins";
import type { EntityStore, MessageQueue, CommsLog } from "@agi/entity-model";
import type { COAChainLogger } from "@agi/coa-chain";
import type { VoicePipeline, VoiceGatewayState, AudioFormat } from "@agi/voice";
import type { OwnerConfig } from "@agi/config";
import type { ChannelEventDispatcher } from "./channel-event-dispatcher.js";
import type { PendingApprovalStore } from "./pending-approval-store.js";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback to send a message to a user via outbound dispatcher. */
export type OutboundSender = (channelId: string, channelUserId: string, content: OutboundContent) => Promise<void>;

/** Dependency injection contract for InboundRouter. */
export interface InboundRouterDeps {
  entityStore: EntityStore;
  messageQueue: MessageQueue;
  coaLogger: COAChainLogger;
  /** The gateway's resource ID, e.g. "$A0". */
  resourceId: string;
  /** The gateway's node ID, e.g. "@A0". */
  nodeId: string;
  /** Optional voice pipeline for STT transcription of audio messages. */
  voicePipeline?: VoicePipeline;
  /** Returns the current gateway state for voice provider selection. */
  getGatewayState?: () => VoiceGatewayState;
  /** Owner config — if provided, enables owner recognition and pairing gate. */
  ownerConfig?: OwnerConfig;
  /** Owner entity ID — resolved at boot and used for owner notification routing. */
  ownerEntityId?: string;
  /** Optional CommsLog instance for logging inbound messages. */
  commsLog?: CommsLog;
  /**
   * Optional channel-event dispatcher. When set + a message arrives
   * carrying `metadata.roomId`, the router asks the dispatcher whether
   * a project binds (channelId, roomId). If yes, the bound project's
   * path is attached to the enqueued payload so downstream agent-
   * invocation runs inside that project's scope. CHN-B (s163) slice 3
   * — 2026-05-14.
   */
  channelEventDispatcher?: ChannelEventDispatcher;
  /**
   * Optional pending-approval store. When set + a message arrives in a
   * project-bound room (i.e. dispatcher resolved a projectPath), the
   * router captures a pending-approval record so owner can see + act
   * on the contact via /identity/pending. CHN-E (s166) slice 2 —
   * data-collection only: this slice does NOT gate the message; routing
   * proceeds normally. Slice 3+ wires the gate-and-drop + UI together.
   */
  pendingApprovalStore?: PendingApprovalStore;
  /** Optional logger instance. */
  logger?: Logger;
}

/** Result returned by a successful routing pipeline run. */
export interface InboundResult {
  entityId: string;
  coaFingerprint: string;
  queueMessageId: string;
  /**
   * Project path resolved via the ChannelEventDispatcher when the
   * message carries a roomId that binds to a project. Absent when
   * no dispatcher is configured OR the room isn't bound. CHN-B
   * (s163) slice 3 — 2026-05-14.
   */
  projectPath?: string;
}

// ---------------------------------------------------------------------------
// InboundRouter
// ---------------------------------------------------------------------------

/**
 * Normalizes an inbound channel message through the full routing pipeline:
 * entity resolution → COA logging → queue enqueue.
 *
 * All dependencies are synchronous (SQLite-backed) — no async/await is used.
 *
 * @example
 * const router = new InboundRouter({ entityStore, messageQueue, coaLogger, resourceId: "$A0", nodeId: "@A0" });
 * const result = router.route(aionimaMessage);
 * console.log(result.queueMessageId);
 */
export class InboundRouter {
  private readonly entityStore: EntityStore;
  private readonly messageQueue: MessageQueue;
  private readonly resourceId: string;
  private readonly nodeId: string;
  private readonly voicePipeline: VoicePipeline | undefined;
  private readonly getGatewayState: (() => VoiceGatewayState) | undefined;
  private readonly ownerConfig: OwnerConfig | undefined;
  private readonly commsLog: CommsLog | undefined;
  private readonly channelEventDispatcher: ChannelEventDispatcher | undefined;
  private readonly pendingApprovalStore: PendingApprovalStore | undefined;
  private readonly log: ComponentLogger;
  constructor(deps: InboundRouterDeps) {
    this.entityStore = deps.entityStore;
    this.messageQueue = deps.messageQueue;
    this.resourceId = deps.resourceId;
    this.nodeId = deps.nodeId;
    this.voicePipeline = deps.voicePipeline;
    this.getGatewayState = deps.getGatewayState;
    this.ownerConfig = deps.ownerConfig;
    this.commsLog = deps.commsLog;
    this.channelEventDispatcher = deps.channelEventDispatcher;
    this.pendingApprovalStore = deps.pendingApprovalStore;
    this.log = createComponentLogger(deps.logger, "inbound");
  }

  // -------------------------------------------------------------------------
  // Owner + pairing helpers
  // -------------------------------------------------------------------------

  /**
   * Check if the given channel + channelUserId is the owner.
   */
  isOwner(channel: string, channelUserId: string): boolean {
    if (this.ownerConfig === undefined) return false;
    const channels = this.ownerConfig.channels;
    const ownerUserId = channels[channel as keyof typeof channels];
    return ownerUserId !== undefined && ownerUserId === channelUserId;
  }

  // s234 P4 — handleOwnerCommand (/approve //reject //paired //revoke) + the
  // PairingStore it drove were REMOVED. The legacy DM approval-code path they
  // served was retired 2026-06-08; channel identity is dashboard-only now
  // (/identity/pending register/associate + the owner claim flow). This is
  // unrelated to device/account pairing (CompanionPairingService), which stays.

  // -------------------------------------------------------------------------
  // Owner notification
  // -------------------------------------------------------------------------

  // notifyOwnerOfPairingRequest removed 2026-06-08 — it only served the retired
  // legacy pairing-code gate (Step 0b). Owner now approves channel contacts via
  // the /identity/pending dashboard, not via in-channel pairing notifications.

  // ---------------------------------------------------------------------------
  // Pipeline
  // ---------------------------------------------------------------------------

  /**
   * Run the inbound routing pipeline for a normalized channel message.
   *
   * Steps:
   * 0. (Optional) If content is voice/audio and voicePipeline is configured,
   *    transcribe audio to text via STT before routing.
   * 1. Resolve (or create) the sender entity via EntityStore.
   * 2. Log a COA record for the inbound message event.
   * 3. Enqueue the message payload for agent processing.
   *
   * @returns An InboundResult containing the entity ID, COA fingerprint, and queue message ID.
   */
  async route(message: AionimaMessage): Promise<InboundResult | null> {
    // Guard: channelId must be present
    if (!message.channelId) {
      throw new Error("AionimaMessage missing channelId — cannot route");
    }

    const channelId = message.channelId as string;

    // Step 0 — Legacy pairing RETIRED. The pairing-code DM gate was retired
    // 2026-06-08, and the vestigial owner-commands (/approve //reject //paired
    // //revoke) + PairingStore were removed in s234 P4. Channel identity is now
    // DASHBOARD-ONLY: unknown users are captured as pending approvals (Step 2c)
    // and surfaced on /identity/pending, where the owner registers or associates
    // them (and designates the owner via the claim flow). No code is ever sent.

    // Step 0c — STT transcription (optional, graceful degradation)
    let routedMessage = message;
    if (
      this.voicePipeline !== undefined &&
      message.content.type === "voice"
    ) {
      const voiceContent = message.content as {
        type: "voice";
        url: string;
        duration: number;
        audioBuffer?: Buffer;
        format?: string;
      };

      if (voiceContent.audioBuffer !== undefined) {
        try {
          const state = this.getGatewayState?.() ?? "ONLINE";
          const sttResult = await this.voicePipeline.transcribe({
            audio: {
              buffer: voiceContent.audioBuffer,
              format: (voiceContent.format ?? "ogg") as AudioFormat,
              durationSeconds: voiceContent.duration,
            },
            entityId: message.channelUserId,
            state,
          });

          // Replace voice content with transcribed text
          routedMessage = {
            ...message,
            content: { type: "text", text: sttResult.text },
          };

          this.log.info(
            `STT transcription: "${sttResult.text.slice(0, 80)}" (provider=${sttResult.provider})`,
          );
        } catch (err) {
          // Graceful degradation: log and continue with original message
          this.log.warn(
            `STT transcription failed, passing through as-is: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Step 1 — resolve or create the sending entity
    // Extract display name from channel metadata (if available)
    const displayName = typeof routedMessage.metadata === "object" && routedMessage.metadata !== null
      ? (routedMessage.metadata as Record<string, unknown>)["displayName"] as string | undefined
        ?? (routedMessage.metadata as Record<string, unknown>)["firstName"] as string | undefined
      : undefined;

    const entity = await this.entityStore.resolveOrCreate(
      channelId,
      routedMessage.channelUserId,
      displayName,
    );

    // Update display name if entity already exists but name was "Unknown"
    if (entity.displayName === "Unknown" && displayName !== undefined && displayName !== "Unknown") {
      await this.entityStore.updateEntity(entity.id, { displayName });
    }

    // Step 2 — generate a tracking ID for this inbound event.
    // COA entry is NOT created here — it's created when the agent COMPLETES
    // its response (the DONE signal in agent-invoker.ts).
    const coaFingerprint = `${this.resourceId}.${entity.coaAlias}.${this.nodeId}.pending`;

    // Step 2b (CHN-B s163 slice 3) — channel-room → project dispatch.
    // Extract roomId from metadata first (always) so pending-approval capture
    // (step 2c) works even when the room isn't bound to any project yet.
    let projectPath: string | undefined;
    let resolvedRoomId: string | undefined;
    if (typeof routedMessage.metadata === "object" && routedMessage.metadata !== null) {
      const roomId = (routedMessage.metadata as Record<string, unknown>)["roomId"];
      if (typeof roomId === "string" && roomId.length > 0) {
        resolvedRoomId = roomId;
        if (this.channelEventDispatcher !== undefined) {
          const dispatch = this.channelEventDispatcher.dispatch(channelId, roomId);
          if (dispatch !== null) {
            projectPath = dispatch.projectPath;
            this.log.info(`channel-event routed to project: ${channelId}::${roomId} → ${projectPath}`);
          }
        }
      }
    }

    // Step 2c (CHN-E s166 slice 2) — pending-approval capture for unknown
    // contacts in any channel room. Idempotent: same triple refreshes
    // display/preview, keeps original createdAt. Owner sees the captured
    // records via /identity/pending.
    //
    // Capture fires for ALL rooms that carry a roomId (not just project-bound
    // ones). projectPath is passed when the room is bound; otherwise the
    // record is grouped under "Unbound" in the UI so the owner can see who's
    // messaging before any project binding exists. DATA-COLLECTION ONLY here —
    // step 2d adds the gate-and-drop for project-bound rooms.
    if (resolvedRoomId !== undefined && this.pendingApprovalStore !== undefined) {
      const captureDisplayName = typeof routedMessage.metadata === "object" && routedMessage.metadata !== null
        ? (routedMessage.metadata as Record<string, unknown>)["displayName"] as string | undefined
          ?? (routedMessage.metadata as Record<string, unknown>)["username"] as string | undefined
          ?? "Unknown"
        : "Unknown";
      const preview = routedMessage.content.type === "text"
        ? (routedMessage.content as { text: string }).text
        : `[${routedMessage.content.type}]`;
      this.pendingApprovalStore.capture({
        channelId,
        roomId: resolvedRoomId,
        channelUserId: routedMessage.channelUserId,
        displayName: captureDisplayName,
        projectPath,
        firstMessagePreview: preview,
      });
    }

    // Step 2d (CHN-E s166 slice 6 / s194) — gate-and-drop unverified senders
    // in project-bound rooms. Messages from unverified entities are
    // captured (step 2c above) but DROPPED here so they don't reach
    // the agent until owner approves via /identity/pending.
    //
    // Exemptions:
    //  - Owner (already routed past Step 0a's owner-command branch with
    //    fall-through; we don't gate the owner here)
    //  - Rejected sender — also dropped, but with a "rejected" log line
    //  - Verified entities — proceed to enqueue normally
    //  - No projectPath (room isn't bound) — proceed normally (this
    //    gate only applies to bound rooms)
    //  - No pendingApprovalStore wired — proceed normally (gate disabled)
    //  - s194: User has a pending approval record (submitted registration) —
    //    let through but strip project scope so agent can respond without
    //    reading project data until owner approves
    if (
      projectPath !== undefined &&
      resolvedRoomId !== undefined &&
      this.pendingApprovalStore !== undefined &&
      !this.isOwner(channelId, routedMessage.channelUserId)
    ) {
      const decision = this.pendingApprovalStore.decisionFor(
        channelId,
        resolvedRoomId,
        routedMessage.channelUserId,
      );
      if (decision !== null && decision.status === "rejected") {
        this.log.info(
          `drop message from REJECTED sender: ${channelId}::${resolvedRoomId}::${routedMessage.channelUserId}`,
        );
        return null;
      }
      if (entity.verificationTier !== "verified" && entity.verificationTier !== "sealed") {
        const hasPendingRecord =
          this.pendingApprovalStore.getByChannelUser(channelId, routedMessage.channelUserId) !== null;
        if (!hasPendingRecord) {
          this.log.info(
            `drop message from UNREGISTERED sender (no pending record): ${channelId}::${resolvedRoomId}::${routedMessage.channelUserId}`,
          );
          return null;
        }
        // Has pending approval — allow through without project scope
        projectPath = undefined;
        this.log.info(
          `pending-approval sender allowed without project scope: ${channelId}::${resolvedRoomId}::${routedMessage.channelUserId}`,
        );
      }
    }

    // Step 3 — enqueue for agent processing
    const queued = await this.messageQueue.enqueue({
      channel: channelId,
      direction: "inbound",
      payload: {
        message: routedMessage,
        entityId: entity.id,
        coaFingerprint,
        ...(projectPath !== undefined ? { projectPath } : {}),
      },
    });

    // Step 4 — log to comms log (non-blocking, best-effort)
    if (this.commsLog !== undefined) {
      try {
        const textContent = routedMessage.content.type === "text"
          ? (routedMessage.content as { text: string }).text
          : `[${routedMessage.content.type}]`;
        const subject = typeof routedMessage.metadata === "object" && routedMessage.metadata !== null
          ? (routedMessage.metadata as Record<string, unknown>)["subject"] as string | undefined ?? null
          : null;

        this.commsLog.log({
          channel: channelId,
          direction: "inbound",
          senderId: routedMessage.channelUserId,
          senderName: displayName ?? null,
          subject,
          preview: textContent.slice(0, 200),
          fullPayload: JSON.stringify(routedMessage),
          entityId: entity.id,
        });
      } catch {
        // Best-effort — don't fail routing if logging fails
      }
    }

    return {
      entityId: entity.id,
      coaFingerprint,
      queueMessageId: queued.id,
      ...(projectPath !== undefined ? { projectPath } : {}),
    };
  }
}
