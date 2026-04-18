import type { AionimaMessage, OutboundContent } from "@agi/channel-sdk";
import type { EntityStore, MessageQueue, CommsLog } from "@agi/entity-model";
import type { COAChainLogger } from "@agi/coa-chain";
import type { VoicePipeline, VoiceGatewayState, AudioFormat } from "@agi/voice";
import type { PairingStore } from "./pairing-store.js";
import type { OwnerConfig } from "@agi/config";
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
  /** Pairing store — manages pairing codes for DM access grants. */
  pairingStore?: PairingStore;
  /** Outbound sender — used to send pairing messages and owner notifications. */
  outboundSender?: OutboundSender;
  /** Owner entity ID — resolved at boot and used for owner notification routing. */
  ownerEntityId?: string;
  /** Optional CommsLog instance for logging inbound messages. */
  commsLog?: CommsLog;
  /** Optional logger instance. */
  logger?: Logger;
}

/** Result returned by a successful routing pipeline run. */
export interface InboundResult {
  entityId: string;
  coaFingerprint: string;
  queueMessageId: string;
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
  private readonly pairingStore: PairingStore | undefined;
  private readonly outboundSender: OutboundSender | undefined;
  private readonly commsLog: CommsLog | undefined;
  private readonly log: ComponentLogger;
  constructor(deps: InboundRouterDeps) {
    this.entityStore = deps.entityStore;
    this.messageQueue = deps.messageQueue;
    this.resourceId = deps.resourceId;
    this.nodeId = deps.nodeId;
    this.voicePipeline = deps.voicePipeline;
    this.getGatewayState = deps.getGatewayState;
    this.ownerConfig = deps.ownerConfig;
    this.pairingStore = deps.pairingStore;
    this.outboundSender = deps.outboundSender;
    this.commsLog = deps.commsLog;
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

  /**
   * Handle owner commands (/approve, /reject, /paired, /revoke).
   * Returns true if the message was an owner command and was handled.
   */
  private async handleOwnerCommand(message: AionimaMessage): Promise<boolean> {
    if (this.pairingStore === undefined || this.outboundSender === undefined) return false;

    const text = message.content.type === "text" ? message.content.text.trim() : "";
    if (!text.startsWith("/")) return false;

    const parts = text.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const arg = parts[1];
    const channelId = message.channelId as string;
    const userId = message.channelUserId;

    switch (cmd) {
      case "/approve": {
        if (arg === undefined) {
          await this.outboundSender(channelId, userId, { type: "text", text: "Usage: /approve <CODE>" });
          return true;
        }
        const paired = this.pairingStore.approve(arg);
        if (paired === null) {
          await this.outboundSender(channelId, userId, { type: "text", text: `Pairing code not found or expired: ${arg}` });
        } else {
          // Ensure the paired user has a verified entity
          const pairedEntity = this.entityStore.resolveOrCreate(
            paired.channel,
            paired.channelUserId,
            paired.displayName,
          );
          this.entityStore.updateEntity(pairedEntity.id, { verificationTier: "verified" });

          await this.outboundSender(channelId, userId, {
            type: "text",
            text: `Approved: ${paired.displayName} (${paired.channel}) is now paired with verified access.`,
          });

          // Notify the approved user
          try {
            await this.outboundSender(paired.channel, paired.channelUserId, {
              type: "text",
              text: "You have been approved to talk to me. Go ahead and send a message.",
            });
          } catch {
            // User may not be reachable — ignore
          }
        }
        return true;
      }

      case "/reject": {
        if (arg === undefined) {
          await this.outboundSender(channelId, userId, { type: "text", text: "Usage: /reject <CODE>" });
          return true;
        }
        const rejected = this.pairingStore.reject(arg);
        await this.outboundSender(channelId, userId, {
          type: "text",
          text: rejected ? `Rejected pairing code: ${arg}` : `Pairing code not found: ${arg}`,
        });
        return true;
      }

      case "/paired": {
        const users = this.pairingStore.getApprovedUsers();
        const pending = this.pairingStore.getPendingRequests();
        const lines: string[] = [];

        if (users.length > 0) {
          lines.push("Paired users:");
          for (const u of users) {
            lines.push(`  ${u.displayName} (${u.channel}:${u.channelUserId}) — paired ${u.pairedAt}`);
          }
        } else {
          lines.push("No paired users.");
        }

        if (pending.length > 0) {
          lines.push("");
          lines.push("Pending requests:");
          for (const p of pending) {
            lines.push(`  ${p.displayName} (${p.channel}) — code: ${p.code} (expires ${p.expiresAt})`);
          }
        }

        await this.outboundSender(channelId, userId, { type: "text", text: lines.join("\n") });
        return true;
      }

      case "/revoke": {
        if (arg === undefined) {
          await this.outboundSender(channelId, userId, { type: "text", text: "Usage: /revoke <channel:channelUserId>" });
          return true;
        }
        const [revokeChannel, revokeUserId] = arg.split(":");
        if (revokeChannel === undefined || revokeUserId === undefined) {
          await this.outboundSender(channelId, userId, { type: "text", text: "Usage: /revoke <channel:channelUserId> (e.g. /revoke telegram:123456)" });
          return true;
        }
        const revoked = this.pairingStore.revoke(revokeChannel, revokeUserId);

        // Downgrade entity back to unverified
        if (revoked) {
          const revokedEntity = this.entityStore.getEntityByChannel(revokeChannel, revokeUserId);
          if (revokedEntity !== null) {
            this.entityStore.updateEntity(revokedEntity.id, { verificationTier: "unverified" });
          }
        }

        await this.outboundSender(channelId, userId, {
          type: "text",
          text: revoked ? `Revoked: ${arg}` : `User not found: ${arg}`,
        });
        return true;
      }

      default:
        return false; // Not an owner command — pass through to agent
    }
  }

  // -------------------------------------------------------------------------
  // Owner notification
  // -------------------------------------------------------------------------

  /**
   * Notify the owner of a new pairing request on their preferred channel.
   */
  private notifyOwnerOfPairingRequest(
    code: string,
    displayName: string,
    fromChannel: string,
    fromUserId: string,
  ): void {
    if (this.ownerConfig === undefined || this.outboundSender === undefined) return;

    // Find the owner's preferred channel (first one configured)
    const channels = this.ownerConfig.channels;
    for (const [ch, uid] of Object.entries(channels)) {
      if (uid !== undefined) {
        this.outboundSender(ch, uid, {
          type: "text",
          text: `New pairing request from ${displayName} (${fromChannel}:${fromUserId})\n\nCode: ${code}\n\nReply /approve ${code} or /reject ${code}`,
        }).catch((err: unknown) => {
          this.log.warn(
            `Failed to notify owner on ${ch}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
        return; // Only notify on one channel
      }
    }
  }

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

    // Step 0a — Owner command interception
    // If the sender is the owner and the message is an owner command,
    // handle it inline and return null (not routed to agent).
    if (this.isOwner(channelId, message.channelUserId)) {
      const handled = await this.handleOwnerCommand(message);
      if (handled) return null;
      // Fall through — owner's non-command messages go to agent
    }

    // Step 0b — Pairing gate for non-owner users
    // When dmPolicy is "pairing" and the sender is not the owner and not
    // paired, generate a pairing code and notify the owner.
    if (
      this.ownerConfig !== undefined &&
      this.pairingStore !== undefined &&
      this.outboundSender !== undefined &&
      this.ownerConfig.dmPolicy === "pairing" &&
      !this.isOwner(channelId, message.channelUserId) &&
      !this.pairingStore.isApproved(channelId, message.channelUserId)
    ) {
      const displayName = typeof message.metadata === "object" && message.metadata !== null
        ? (message.metadata as Record<string, unknown>)["displayName"] as string | undefined
          ?? (message.metadata as Record<string, unknown>)["firstName"] as string | undefined
          ?? (message.metadata as Record<string, unknown>)["username"] as string | undefined
        : undefined;

      const request = this.pairingStore.createRequest(
        channelId,
        message.channelUserId,
        displayName ?? "Unknown",
      );

      if (request !== null) {
        // Send pairing message to the unknown user
        try {
          await this.outboundSender(channelId, message.channelUserId, {
            type: "text",
            text: `To talk to me, you need my owner's approval.\n\nYour pairing code: **${request.code}**\n\nAsk my owner to approve you, or wait for them to see this request.`,
          });
        } catch {
          // Outbound may fail — ignore
        }

        // Notify the owner on their preferred channel
        this.notifyOwnerOfPairingRequest(request.code, displayName ?? "Unknown", channelId, message.channelUserId);
      }

      return null; // Message NOT routed to agent
    }

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

    const entity = this.entityStore.resolveOrCreate(
      channelId,
      routedMessage.channelUserId,
      displayName,
    );

    // Update display name if entity already exists but name was "Unknown"
    if (entity.displayName === "Unknown" && displayName !== undefined && displayName !== "Unknown") {
      this.entityStore.updateEntity(entity.id, { displayName });
    }

    // Step 2 — generate a tracking ID for this inbound event.
    // COA entry is NOT created here — it's created when the agent COMPLETES
    // its response (the DONE signal in agent-invoker.ts).
    const coaFingerprint = `${this.resourceId}.${entity.coaAlias}.${this.nodeId}.pending`;

    // Step 3 — enqueue for agent processing
    const queued = this.messageQueue.enqueue({
      channel: channelId,
      direction: "inbound",
      payload: { message: routedMessage, entityId: entity.id, coaFingerprint },
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
    };
  }
}
