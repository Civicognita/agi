import type { ChannelId, AionimaMessage } from "@agi/channel-sdk";
import type { GmailRawMessage } from "./gmail-client.js";
import type { gmail_v1 } from "googleapis";

export const GMAIL_CHANNEL_ID = "gmail" as ChannelId;

// ---------------------------------------------------------------------------
// Thread context — preserved per sender for outbound reply threading
// ---------------------------------------------------------------------------

export interface ThreadContext {
  threadId: string;
  subject: string;
  messageId: string;
  references: string;
}

// ---------------------------------------------------------------------------
// Normalizer: GmailRawMessage → AionimaMessage
// ---------------------------------------------------------------------------

/**
 * Convert a raw Gmail message into a normalized {@link AionimaMessage}.
 *
 * Returns `null` when:
 * - The message is from `selfAddress` (self-loop prevention)
 * - No extractable text body
 *
 * Also returns the {@link ThreadContext} for outbound reply threading.
 */
export function normalizeMessage(
  raw: GmailRawMessage,
  selfAddress: string,
): { message: AionimaMessage; threadContext: ThreadContext } | null {
  const headers = raw.payload.headers ?? [];
  const from = getHeader(headers, "From") ?? "";
  const to = getHeader(headers, "To") ?? "";
  const subject = getHeader(headers, "Subject") ?? "(no subject)";
  const messageId = getHeader(headers, "Message-ID") ?? getHeader(headers, "Message-Id") ?? "";
  const references = getHeader(headers, "References") ?? "";

  const senderEmail = extractSenderEmail(from);

  // Self-loop prevention
  if (senderEmail.toLowerCase() === selfAddress.toLowerCase()) {
    return null;
  }

  // Extract body
  const bodyText = extractBody(raw.payload);
  if (bodyText === null || bodyText.trim().length === 0) {
    return null;
  }

  // Build references chain for outbound threading
  const refsChain = references
    ? `${references} ${messageId}`.trim()
    : messageId;

  const threadContext: ThreadContext = {
    threadId: raw.threadId,
    subject,
    messageId,
    references: refsChain,
  };

  const message: AionimaMessage = {
    id: raw.id,
    channelId: GMAIL_CHANNEL_ID,
    channelUserId: senderEmail.toLowerCase(),
    timestamp: new Date(Number(raw.internalDate)).toISOString(),
    content: { type: "text", text: bodyText },
    threadId: raw.threadId,
    metadata: {
      subject,
      messageId,
      from,
      to,
    },
  };

  return { message, threadContext };
}

// ---------------------------------------------------------------------------
// Header extraction
// ---------------------------------------------------------------------------

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[],
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  const header = headers.find((h) => (h.name ?? "").toLowerCase() === lower);
  const val = header?.value;
  return val != null ? val : undefined;
}

// ---------------------------------------------------------------------------
// Email address extraction
// ---------------------------------------------------------------------------

/**
 * Extract the bare email address from a From header.
 * Handles formats like:
 *   "John Doe <john@example.com>"
 *   "<john@example.com>"
 *   "john@example.com"
 */
export function extractSenderEmail(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  if (match?.[1]) return match[1];
  return fromHeader.trim();
}

/**
 * Build a display name from a From header.
 * Returns the name portion if available, otherwise the email address.
 */
export function buildDisplayName(fromHeader: string): string {
  const match = fromHeader.match(/^"?([^"<]+)"?\s*</);
  if (match?.[1]) return match[1].trim();
  return extractSenderEmail(fromHeader);
}

// ---------------------------------------------------------------------------
// Body extraction
// ---------------------------------------------------------------------------

/**
 * Extract the text body from a Gmail message payload (exported for channel-def.ts).
 * Prefers text/plain, falls back to text/html with tag stripping.
 */
export function extractBodyText(payload: gmail_v1.Schema$MessagePart): string | null {
  return extractBody(payload);
}

function extractBody(payload: gmail_v1.Schema$MessagePart): string | null {
  // Simple single-part message
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart message — search parts recursively
  if (payload.parts) {
    // First pass: look for text/plain
    const plainText = findPartByMime(payload.parts, "text/plain");
    if (plainText) return plainText;

    // Second pass: fall back to text/html
    const htmlText = findPartByMime(payload.parts, "text/html");
    if (htmlText) return stripHtmlTags(htmlText);
  }

  // Fallback: check body directly for html
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return stripHtmlTags(decodeBase64Url(payload.body.data));
  }

  return null;
}

function findPartByMime(
  parts: gmail_v1.Schema$MessagePart[],
  mimeType: string,
): string | null {
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    // Recurse into nested multipart
    if (part.parts) {
      const result = findPartByMime(part.parts, mimeType);
      if (result) return result;
    }
  }
  return null;
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
