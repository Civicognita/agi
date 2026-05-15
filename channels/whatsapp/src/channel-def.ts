/**
 * WhatsApp channel definition built against the defineChannelV2 SDK
 * (CHN-A s162). This is the s173 CHN-L migration target.
 *
 * WhatsApp Business API is webhook-based, not connection-based. There is no
 * concept of "listing rooms" via the API — rooms are discovered as inbound
 * messages arrive. The protocol exposes an extra `processWebhook(payload)`
 * method (outside ChannelProtocol) for the gateway to call when an HTTP POST
 * arrives at the WhatsApp webhook endpoint.
 *
 * Room ID encoding:
 *   `wa:dm:<phoneHash>`  — 1-1 conversation with a sender (phoneHash = SHA-256 of E.164)
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

import type { WhatsAppConfig } from "./config.js";
import { isWhatsAppConfig } from "./config.js";
import type {
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  WhatsAppContact,
} from "./types.js";
import { createApiClient, ConversationWindowTracker, sendOutbound } from "./outbound.js";
import { mediaUrl } from "./normalizer.js";

export const WHATSAPP_CHANNEL_ID_V2 = "whatsapp";

// ---------------------------------------------------------------------------
// Room ID encoding / decoding
// ---------------------------------------------------------------------------

export function encodeRoomId(phoneHash: string): string {
  return `wa:dm:${phoneHash}`;
}

export function decodePhoneHash(roomId: string): string | null {
  const prefix = "wa:dm:";
  if (!roomId.startsWith(prefix)) return null;
  const hash = roomId.slice(prefix.length);
  // SHA-256 hex digest is always exactly 64 characters
  return hash.length === 64 ? hash : null;
}

// ---------------------------------------------------------------------------
// Message normalization: WhatsApp webhook message → ChannelMessage
// ---------------------------------------------------------------------------

function buildContactMap(contacts?: WhatsAppContact[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!contacts) return map;
  for (const c of contacts) map.set(c.wa_id, c.profile.name);
  return map;
}

function hashPhone(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}

export function waMessageToChannelMessage(
  msg: WhatsAppMessage,
  contactMap: Map<string, string>,
  config: Pick<WhatsAppConfig, "apiBaseUrl" | "apiVersion">,
): ChannelMessage | null {
  if (msg.type === "reaction") return null;

  const phoneHash = hashPhone(msg.from);
  const roomId = encodeRoomId(phoneHash);
  const displayName = contactMap.get(msg.from);

  let text = "";
  const attachments: ChannelMessageAttachment[] = [];

  switch (msg.type) {
    case "text":
      text = msg.text.body;
      break;
    case "image":
      attachments.push({
        kind: "image",
        url: mediaUrl(msg.image.id, config),
        mime: msg.image.mime_type,
      });
      text = msg.image.caption ?? "";
      break;
    case "audio":
      attachments.push({
        kind: "audio",
        url: mediaUrl(msg.audio.id, config),
        mime: msg.audio.mime_type,
      });
      break;
    case "document":
      attachments.push({
        kind: "file",
        url: mediaUrl(msg.document.id, config),
        mime: msg.document.mime_type,
      });
      text = msg.document.caption ?? "";
      break;
  }

  return {
    messageId: msg.id,
    roomId,
    authorId: phoneHash,
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
    replyToMessageId: msg.context?.message_id,
    sentAt: new Date(Number(msg.timestamp) * 1000).toISOString(),
    // WhatsApp Business API is always 1-1; all messages are directed at the bot
    mentionsBot: true,
    ...(displayName ? {} : {}),
  };
}

/**
 * Process a WhatsApp webhook payload into ChannelMessages.
 * Returns one entry per message with the raw phone number for hash→phone mapping.
 */
export function waPayloadToChannelMessages(
  payload: WhatsAppWebhookPayload,
  config: Pick<WhatsAppConfig, "apiBaseUrl" | "apiVersion">,
): Array<{ msg: ChannelMessage; rawPhone: string }> {
  const results: Array<{ msg: ChannelMessage; rawPhone: string }> = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const { messages, contacts } = change.value;
      if (!messages) continue;
      const contactMap = buildContactMap(contacts);
      for (const waMsg of messages) {
        const channelMsg = waMessageToChannelMessage(waMsg, contactMap, config);
        if (channelMsg === null) continue;
        results.push({ msg: channelMsg, rawPhone: waMsg.from });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Extended protocol interface — extra method outside ChannelProtocol contract
// ---------------------------------------------------------------------------

export interface WhatsAppChannelProtocol extends ChannelProtocol {
  /**
   * Process a pre-parsed WhatsApp webhook payload.
   * The gateway HTTP handler reads + verifies the request body, then calls this.
   */
  processWebhook(payload: WhatsAppWebhookPayload): Promise<void>;
}

// ---------------------------------------------------------------------------
// Protocol implementation
// ---------------------------------------------------------------------------

function buildProtocol(config: WhatsAppConfig, _ctx: ChannelContext): WhatsAppChannelProtocol {
  const api = createApiClient(config);
  const windowTracker = new ConversationWindowTracker();
  const eventHandlers: Array<(e: ChannelEvent) => void> = [];
  const seenRooms = new Map<string, ChannelRoom>();
  const hashToPhone = new Map<string, string>();

  function dispatchPayload(payload: WhatsAppWebhookPayload): void {
    const results = waPayloadToChannelMessages(payload, config);
    for (const { msg, rawPhone } of results) {
      const hash = hashPhone(rawPhone);
      hashToPhone.set(hash, rawPhone);
      windowTracker.recordInbound(hash);

      const label = `wa:${hash.slice(0, 8)}`;
      seenRooms.set(msg.roomId, {
        roomId: msg.roomId,
        label,
        kind: "dm",
        privacy: "private",
      });

      const event: ChannelEvent = { kind: "message", message: msg };
      for (const h of eventHandlers) h(event);
    }
  }

  return {
    start: async () => ({
      stop: async () => { windowTracker.cleanup(); },
    }),

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
      const phoneHash = decodePhoneHash(roomId);
      if (phoneHash === null) throw new Error(`Invalid WhatsApp roomId: ${roomId}`);
      const rawPhone = hashToPhone.get(phoneHash);
      if (rawPhone === undefined) {
        throw new Error(
          `WhatsApp postToRoom: cannot resolve hash ${phoneHash.slice(0, 8)}… to phone — no inbound message received from this user yet`,
        );
      }
      await sendOutbound(api, rawPhone, { type: "text", text: message.text }, windowTracker, config);
      return {
        messageId: `wa-sent-${Date.now().toString()}`,
        roomId,
        authorId: "bot",
        text: message.text,
        sentAt: new Date().toISOString(),
        mentionsBot: false,
      };
    },

    // WhatsApp Business API has no message history endpoint.
    searchMessages: async (_roomId, _opts) => ({ messages: [] }),

    // No direct user lookup via WhatsApp Business API.
    getUser: async (_userId): Promise<ChannelUser | null> => null,

    // 1-1 only in the current Cloud API adapter; no group member enumeration.
    listMembers: async (_scope) => [],

    processWebhook: async (payload) => { dispatchPayload(payload); },
  };
}

// ---------------------------------------------------------------------------
// Factory + ChannelDefinition
// ---------------------------------------------------------------------------

const StubSettingsPage = () => null;

/**
 * Build a v2 ChannelDefinition for WhatsApp Business API.
 * Wraps the existing webhook-based adapter under the defineChannelV2 contract.
 *
 * @throws {Error} If `config` fails runtime validation.
 */
export function createWhatsAppChannelDefV2(config: WhatsAppConfig): ChannelDefinition {
  if (!isWhatsAppConfig(config)) {
    throw new Error(
      "Invalid WhatsApp config: accessToken, phoneNumberId, verifyToken, and appSecret are required",
    );
  }

  return defineChannelV2({
    id: WHATSAPP_CHANNEL_ID_V2,
    displayName: "WhatsApp",
    icon: undefined,
    createProtocol: (ctx) => buildProtocol(config, ctx),
    SettingsPage: StubSettingsPage as unknown as ChannelDefinition["SettingsPage"],
    bridgeTools: [],
    readPolicy: {
      canReadAllMessages: { configurable: false, defaultOn: true },
      canReadPresence: { configurable: false, defaultOn: false },
      canReadRoles: { configurable: false, defaultOn: false },
      nativeIntents: ["whatsapp_business_messaging"],
    },
  });
}
