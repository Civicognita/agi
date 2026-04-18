import type { Message } from "grammy/types";
import type { ChannelId, AionimaMessage, MessageContent } from "@agi/channel-sdk";

export const TELEGRAM_CHANNEL_ID = "telegram" as ChannelId;

// ---------------------------------------------------------------------------
// Normalizer: Telegram Message → AionimaMessage
// ---------------------------------------------------------------------------

/**
 * Convert a raw Telegram {@link Message} into a normalized {@link AionimaMessage}.
 *
 * Supported content types: text, voice, document, photo.
 * Returns `null` when the message type is unsupported (sticker, location, etc.)
 * so callers can silently skip it.
 */
export function normalizeMessage(msg: Message): AionimaMessage | null {
  const content = extractContent(msg);
  if (content === null) return null;

  return {
    id: String(msg.message_id),
    channelId: TELEGRAM_CHANNEL_ID,
    channelUserId: String(msg.from?.id ?? msg.chat.id),
    timestamp: new Date(msg.date * 1000).toISOString(),
    content,
    replyTo: msg.reply_to_message
      ? String(msg.reply_to_message.message_id)
      : undefined,
    threadId: msg.message_thread_id
      ? String(msg.message_thread_id)
      : undefined,
    metadata: {
      chatId: msg.chat.id,
      chatType: msg.chat.type,
      username: msg.from?.username,
      firstName: msg.from?.first_name,
      lastName: msg.from?.last_name,
      displayName: buildDisplayName(msg),
    },
  };
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

function extractContent(msg: Message): MessageContent | null {
  if (msg.text !== undefined) {
    return { type: "text", text: msg.text };
  }

  if (msg.voice !== undefined) {
    return {
      type: "voice",
      url: msg.voice.file_id,
      duration: msg.voice.duration,
    };
  }

  if (msg.document !== undefined) {
    return {
      type: "media",
      url: msg.document.file_id,
      mimeType: msg.document.mime_type ?? "application/octet-stream",
      caption: msg.caption,
    };
  }

  if (msg.photo !== undefined && msg.photo.length > 0) {
    // Telegram sends multiple sizes; pick the largest (last element).
    const largest = msg.photo[msg.photo.length - 1]!;
    return {
      type: "media",
      url: largest.file_id,
      mimeType: "image/jpeg",
      caption: msg.caption,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Display name helper
// ---------------------------------------------------------------------------

/**
 * Build a display name from Telegram user fields.
 * Falls back to the numeric user ID when no name is available.
 */
export function buildDisplayName(msg: Message): string {
  const from = msg.from;
  if (!from) return `tg:${msg.chat.id}`;

  if (from.first_name && from.last_name) {
    return `${from.first_name} ${from.last_name}`;
  }
  if (from.first_name) return from.first_name;
  if (from.username) return from.username;
  return `tg:${from.id}`;
}
