/**
 * Signal channel definition built against the defineChannelV2 SDK
 * (CHN-A s162). This is the s173 CHN-L migration target.
 *
 * Signal uses signal-cli in HTTP/REST mode (polling GET /v1/receive/{number}).
 * No external npm Signal protocol library required — just native fetch.
 *
 * Room ID encoding:
 *   `signal:dm:<phoneHash>`    — 1-1 conversation (phoneHash = SHA-256 of E.164)
 *   `signal:group:<groupId>`   — Signal group chat (groupId from signal-cli)
 *
 * Reference: agi/docs/agents/channel-plugin-redesign.md §4 + §11 (CHN-L).
 */

import { createHash } from "node:crypto";
import {
  defineChannelV2,
  type ChannelDefinition,
  type ChannelProtocol,
  type ChannelContext,
  type ChannelEvent,
  type ChannelMessage,
  type ChannelMessageAttachment,
  type ChannelRoom,
  type ChannelUser,
} from "@agi/sdk";

import type { SignalConfig } from "./config.js";
import { isSignalConfig } from "./config.js";
import { SignalCliClient, type SignalMessage } from "./signal-cli-client.js";
import { sendOutbound } from "./outbound.js";

export const SIGNAL_CHANNEL_ID_V2 = "signal";

// ---------------------------------------------------------------------------
// Room ID encoding / decoding
// ---------------------------------------------------------------------------

export type SignalConvType = "dm" | "group";

export function encodeRoomId(kind: SignalConvType, id: string): string {
  return `signal:${kind}:${id}`;
}

export function decodeRoomId(
  roomId: string,
): { kind: SignalConvType; id: string } | null {
  const prefix = "signal:";
  if (!roomId.startsWith(prefix)) return null;
  const rest = roomId.slice(prefix.length);
  const colon = rest.indexOf(":");
  if (colon === -1) return null;
  const kind = rest.slice(0, colon) as SignalConvType;
  const id = rest.slice(colon + 1);
  if (kind !== "dm" && kind !== "group") return null;
  if (!id) return null;
  return { kind, id };
}

// ---------------------------------------------------------------------------
// Message + room normalization
// ---------------------------------------------------------------------------

function hashPhone(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}

/**
 * Convert a signal-cli SignalMessage into a ChannelMessage.
 * Returns null when the envelope carries no supported data (e.g. delivery receipts).
 */
export function signalMessageToChannelMessage(msg: SignalMessage): ChannelMessage | null {
  const { envelope } = msg;
  if (envelope.dataMessage === undefined) return null;

  const { dataMessage } = envelope;
  const isGroup = dataMessage.groupInfo?.groupId !== undefined;
  const phoneHash = hashPhone(envelope.source);
  const roomId = isGroup
    ? encodeRoomId("group", dataMessage.groupInfo!.groupId)
    : encodeRoomId("dm", phoneHash);

  const text = dataMessage.message ?? "";

  const attachments: ChannelMessageAttachment[] = [];
  for (const att of dataMessage.attachments ?? []) {
    attachments.push({
      kind: att.contentType.startsWith("audio/") ? "audio" : "file",
      url: att.id,
      mime: att.contentType,
    });
  }

  return {
    messageId: String(envelope.timestamp),
    roomId,
    authorId: phoneHash,
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
    replyToMessageId: dataMessage.quote ? String(dataMessage.quote.id) : undefined,
    threadRootMessageId: isGroup ? dataMessage.groupInfo?.groupId : undefined,
    sentAt: new Date(envelope.timestamp).toISOString(),
    // DMs are always directed at the bot; group messages aren't unless @-mentioned
    // (Signal doesn't expose mention data via signal-cli, so assume not mentioned)
    mentionsBot: !isGroup,
  };
}

/**
 * Derive a ChannelRoom from a signal-cli message.
 */
export function signalMessageToRoom(msg: SignalMessage): ChannelRoom {
  const { envelope } = msg;
  const isGroup = envelope.dataMessage?.groupInfo?.groupId !== undefined;

  if (isGroup) {
    const groupId = envelope.dataMessage!.groupInfo!.groupId;
    return {
      roomId: encodeRoomId("group", groupId),
      label: `group:${groupId.slice(0, 8)}`,
      kind: "group",
      privacy: "private",
    };
  }

  const hash = hashPhone(envelope.source);
  return {
    roomId: encodeRoomId("dm", hash),
    label: `signal:${hash.slice(0, 8)}`,
    kind: "dm",
    privacy: "private",
  };
}

// ---------------------------------------------------------------------------
// Protocol implementation
// ---------------------------------------------------------------------------

function buildProtocol(config: SignalConfig, _ctx: ChannelContext): ChannelProtocol {
  const client = new SignalCliClient({
    baseUrl: config.signalCliUrl,
    accountNumber: config.accountNumber,
  });

  const eventHandlers: Array<(e: ChannelEvent) => void> = [];
  const seenRooms = new Map<string, ChannelRoom>();
  const hashToPhone = new Map<string, string>();

  let pollingTimer: ReturnType<typeof setInterval> | null = null;
  const pollingIntervalMs = config.pollingIntervalMs ?? 2_000;

  async function poll(): Promise<void> {
    try {
      const messages = await client.receive();
      for (const rawMsg of messages) {
        const rawPhone = rawMsg.envelope.source;
        const hash = hashPhone(rawPhone);
        hashToPhone.set(hash, rawPhone);

        const channelMsg = signalMessageToChannelMessage(rawMsg);
        if (channelMsg === null) continue;

        const room = signalMessageToRoom(rawMsg);
        seenRooms.set(channelMsg.roomId, room);

        const event: ChannelEvent = { kind: "message", message: channelMsg };
        for (const h of eventHandlers) h(event);
      }
    } catch (err) {
      // Graceful degradation — signal-cli might be temporarily unreachable
      console.warn(
        "[signal] polling error:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return {
    start: async () => {
      const healthy = await client.healthCheck();
      if (!healthy) {
        console.warn("[signal] signal-cli unreachable at startup — polling will retry");
      }
      pollingTimer = setInterval(() => { void poll(); }, pollingIntervalMs);
      return {
        stop: async () => {
          if (pollingTimer !== null) {
            clearInterval(pollingTimer);
            pollingTimer = null;
          }
        },
      };
    },

    onEvent: (handler) => {
      eventHandlers.push(handler);
      return () => {
        const i = eventHandlers.indexOf(handler);
        if (i >= 0) eventHandlers.splice(i, 1);
      };
    },

    listRooms: async () => [...seenRooms.values()],

    getRoom: async (roomId) => seenRooms.get(roomId) ?? null,

    subscribeRoom: (roomId, handler) => {
      const filtered = (event: ChannelEvent): void => {
        if (
          (event.kind === "message" || event.kind === "message-edit") &&
          event.message.roomId !== roomId
        ) return;
        handler(event);
      };
      eventHandlers.push(filtered);
      return () => {
        const i = eventHandlers.indexOf(filtered);
        if (i >= 0) eventHandlers.splice(i, 1);
      };
    },

    postToRoom: async (roomId, message) => {
      const decoded = decodeRoomId(roomId);
      if (decoded === null) throw new Error(`Invalid Signal roomId: ${roomId}`);

      let recipient: string;
      if (decoded.kind === "dm") {
        const rawPhone = hashToPhone.get(decoded.id);
        if (rawPhone === undefined) {
          throw new Error(
            `Signal postToRoom: cannot resolve hash ${decoded.id.slice(0, 8)}… to phone — no inbound message received from this user yet`,
          );
        }
        recipient = rawPhone;
      } else {
        // For groups, the groupId IS the recipient identifier for signal-cli
        recipient = decoded.id;
      }

      await sendOutbound(client, recipient, { type: "text", text: message.text });
      return {
        messageId: `signal-sent-${Date.now().toString()}`,
        roomId,
        authorId: "bot",
        text: message.text,
        sentAt: new Date().toISOString(),
        mentionsBot: false,
      };
    },

    // signal-cli has no message history/search endpoint.
    searchMessages: async (_roomId, _opts) => ({ messages: [] }),

    // No direct user lookup via signal-cli REST API.
    getUser: async (_userId): Promise<ChannelUser | null> => null,

    // signal-cli doesn't expose member lists for groups.
    listMembers: async (_scope) => [],
  };
}

// ---------------------------------------------------------------------------
// Factory + ChannelDefinition
// ---------------------------------------------------------------------------

const StubSettingsPage = () => null;

/**
 * Build a v2 ChannelDefinition for Signal via signal-cli.
 * Wraps the existing polling-based adapter under the defineChannelV2 contract.
 *
 * @throws {Error} If `config` fails runtime validation.
 */
export function createSignalChannelDefV2(config: SignalConfig): ChannelDefinition {
  if (!isSignalConfig(config)) {
    throw new Error(
      "Invalid Signal config: signalCliUrl and accountNumber are required",
    );
  }

  return defineChannelV2({
    id: SIGNAL_CHANNEL_ID_V2,
    displayName: "Signal",
    icon: undefined,
    createProtocol: (ctx) => buildProtocol(config, ctx),
    SettingsPage: StubSettingsPage as unknown as ChannelDefinition["SettingsPage"],
    bridgeTools: [],
    readPolicy: {
      canReadAllMessages: { configurable: false, defaultOn: true },
      canReadPresence: { configurable: false, defaultOn: false },
      canReadRoles: { configurable: false, defaultOn: false },
      nativeIntents: [],
    },
  });
}
