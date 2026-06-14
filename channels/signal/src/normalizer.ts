import { createHash } from "node:crypto";
import type { ChannelId, AionimaMessage, MessageContent } from "@agi/sdk";
import type { SignalMessage } from "./signal-cli-client.js";

export const SIGNAL_CHANNEL_ID = "signal" as ChannelId;

// ---------------------------------------------------------------------------
// Phone number hashing — PII protection
// ---------------------------------------------------------------------------

/**
 * SHA-256 hex digest of a phone number.
 * Phone numbers are PII and must NEVER be stored or surfaced raw.
 *
 * @param phone - E.164 phone number (e.g. "+14155552671").
 * @returns Lowercase hex SHA-256 digest.
 */
export function hashPhoneNumber(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}

// ---------------------------------------------------------------------------
// Normalizer: SignalMessage → AionimaMessage
// ---------------------------------------------------------------------------

/**
 * Convert a raw signal-cli {@link SignalMessage} into a normalized
 * {@link AionimaMessage}.
 *
 * Supported content types: text, attachments (audio → voice, other → media).
 * Returns `null` when the envelope carries no supported data message so
 * callers can silently skip it.
 *
 * CRITICAL: `channelUserId` is always the SHA-256 hash of the sender's
 * phone number — never the raw E.164 number.
 */
export function normalizeMessage(msg: SignalMessage): AionimaMessage | null {
  const { envelope } = msg;
  if (envelope.dataMessage === undefined) return null;

  const content = extractContent(envelope.dataMessage);
  if (content === null) return null;

  const hashedSource = hashPhoneNumber(envelope.source);

  return {
    id: String(envelope.timestamp),
    channelId: SIGNAL_CHANNEL_ID,
    channelUserId: hashedSource,
    timestamp: new Date(envelope.timestamp).toISOString(),
    content,
    replyTo: envelope.dataMessage.quote
      ? String(envelope.dataMessage.quote.id)
      : undefined,
    threadId: envelope.dataMessage.groupInfo?.groupId,
    metadata: {
      sourceDevice: envelope.sourceDevice,
      groupId: envelope.dataMessage.groupInfo?.groupId,
    },
  };
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

function extractContent(
  dataMessage: NonNullable<SignalMessage["envelope"]["dataMessage"]>,
): MessageContent | null {
  const firstAttachment = dataMessage.attachments?.[0];

  if (firstAttachment !== undefined) {
    // Voice note detection: audio content type
    if (firstAttachment.contentType.startsWith("audio/")) {
      return {
        type: "voice",
        // signal-cli exposes attachments by their local ID
        url: firstAttachment.id,
        // Signal does not expose duration in the receive payload;
        // use 0 as a sentinel — callers can fetch metadata separately.
        duration: 0,
      };
    }

    // Regular attachment
    return {
      type: "media",
      url: firstAttachment.id,
      mimeType: firstAttachment.contentType,
      caption:
        dataMessage.message !== undefined && dataMessage.message.length > 0
          ? dataMessage.message
          : undefined,
    };
  }

  if (dataMessage.message !== undefined && dataMessage.message.length > 0) {
    return { type: "text", text: dataMessage.message };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Display name helper
// ---------------------------------------------------------------------------

/**
 * Build a display name from a SignalMessage.
 * Returns `signal:<8-char hash prefix>` — no raw phone number is ever used.
 */
export function buildDisplayName(msg: SignalMessage): string {
  const hash = hashPhoneNumber(msg.envelope.source);
  return `signal:${hash.slice(0, 8)}`;
}
