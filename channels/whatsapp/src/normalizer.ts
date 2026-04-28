/**
 * WhatsApp Normalizer — Task #162
 *
 * Converts WhatsApp Business API webhook payloads into normalized
 * AionimaMessage format. Handles text, image, audio, and document messages.
 *
 * Phone numbers are stored as SHA-256 hashes in channelUserId to prevent
 * plaintext PII storage (per acceptance criteria).
 */

import { createHash } from "node:crypto";
import type { ChannelId, AionimaMessage, MessageContent } from "@agi/channel-sdk";
import type {
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  WhatsAppContact,
} from "./types.js";
import type { WhatsAppConfig } from "./config.js";

export const WHATSAPP_CHANNEL_ID = "whatsapp" as ChannelId;

// ---------------------------------------------------------------------------
// Phone number hashing
// ---------------------------------------------------------------------------

/**
 * Hash a phone number with SHA-256 for privacy.
 * Phone numbers are NEVER stored in plaintext.
 */
export function hashPhoneNumber(phoneNumber: string): string {
  return createHash("sha256").update(phoneNumber).digest("hex");
}

// ---------------------------------------------------------------------------
// Media URL builder
// ---------------------------------------------------------------------------

/**
 * Build a media download URL from a WhatsApp media ID.
 * The caller must use the access token to actually download.
 */
export function mediaUrl(
  mediaId: string,
  config: Pick<WhatsAppConfig, "apiBaseUrl" | "apiVersion">,
): string {
  const base = config.apiBaseUrl ?? "https://graph.facebook.com";
  const version = config.apiVersion ?? "v21.0";
  return `${base}/${version}/${mediaId}`;
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

/**
 * Extract AionimaMessages from a WhatsApp webhook payload.
 *
 * A single webhook may contain multiple entries and changes.
 * Each message is individually normalized.
 *
 * @returns Array of normalized messages (may be empty if no messages in payload).
 */
export function normalizeWebhook(
  payload: WhatsAppWebhookPayload,
  config: Pick<WhatsAppConfig, "apiBaseUrl" | "apiVersion">,
): AionimaMessage[] {
  const messages: AionimaMessage[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;

      const value = change.value;
      if (!value.messages) continue;

      const contactMap = buildContactMap(value.contacts);

      for (const msg of value.messages) {
        const normalized = normalizeMessage(msg, contactMap, config);
        if (normalized !== null) {
          messages.push(normalized);
        }
      }
    }
  }

  return messages;
}

/**
 * Normalize a single WhatsApp message into a AionimaMessage.
 * Returns null for unsupported message types (reaction, etc.).
 */
export function normalizeMessage(
  msg: WhatsAppMessage,
  contactMap: Map<string, string>,
  config: Pick<WhatsAppConfig, "apiBaseUrl" | "apiVersion">,
): AionimaMessage | null {
  const content = extractContent(msg, config);
  if (content === null) return null;

  const hashedPhone = hashPhoneNumber(msg.from);
  const displayName = contactMap.get(msg.from);

  return {
    id: msg.id,
    channelId: WHATSAPP_CHANNEL_ID,
    channelUserId: hashedPhone,
    timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
    content,
    replyTo: msg.context?.message_id,
    metadata: {
      originalPhone: hashedPhone, // Already hashed — safe to store
      displayName,
      phoneNumberHash: hashedPhone,
    },
  };
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

function extractContent(
  msg: WhatsAppMessage,
  config: Pick<WhatsAppConfig, "apiBaseUrl" | "apiVersion">,
): MessageContent | null {
  switch (msg.type) {
    case "text":
      return { type: "text", text: msg.text.body };

    case "image":
      return {
        type: "media",
        url: mediaUrl(msg.image.id, config),
        mimeType: msg.image.mime_type,
        caption: msg.image.caption,
      };

    case "audio":
      return {
        type: "voice",
        url: mediaUrl(msg.audio.id, config),
        duration: 0, // WhatsApp doesn't provide duration in webhook
      };

    case "document":
      return {
        type: "media",
        url: mediaUrl(msg.document.id, config),
        mimeType: msg.document.mime_type,
        caption: msg.document.caption,
      };

    case "reaction":
      // Reactions are not supported as AionimaMessages
      return null;
  }
}

// ---------------------------------------------------------------------------
// Contact map
// ---------------------------------------------------------------------------

function buildContactMap(
  contacts?: WhatsAppContact[],
): Map<string, string> {
  const map = new Map<string, string>();
  if (!contacts) return map;

  for (const contact of contacts) {
    map.set(contact.wa_id, contact.profile.name);
  }
  return map;
}
