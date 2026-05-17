import type { Api } from "grammy";
import type { OutboundContent } from "@agi/sdk";

/** Telegram's maximum message length for text. */
const MAX_TEXT_LENGTH = 4096;

// ---------------------------------------------------------------------------
// Outbound: OutboundContent → Telegram API calls
// ---------------------------------------------------------------------------

/**
 * Send an {@link OutboundContent} payload to a Telegram chat.
 *
 * - Text content is automatically split at {@link MAX_TEXT_LENGTH} boundaries.
 * - Media content dispatches to `sendPhoto` or `sendDocument` based on MIME type.
 */
export async function sendOutbound(
  api: Api,
  chatId: string | number,
  content: OutboundContent,
): Promise<void> {
  const numericChatId = Number(chatId);

  if (content.type === "text") {
    const chunks = splitText(content.text, MAX_TEXT_LENGTH);
    for (const chunk of chunks) {
      await api.sendMessage(numericChatId, chunk, { parse_mode: "Markdown" });
    }
    return;
  }

  if (content.type === "media") {
    if (content.mimeType.startsWith("image/")) {
      await api.sendPhoto(numericChatId, content.url, {
        caption: content.caption,
      });
    } else {
      await api.sendDocument(numericChatId, content.url, {
        caption: content.caption,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Text splitting
// ---------------------------------------------------------------------------

/**
 * Split a long text message into chunks, preferring newline boundaries.
 * Each chunk is guaranteed to be at most `maxLength` characters.
 */
export function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at last newline within the limit
    let splitIndex = remaining.lastIndexOf("\n", maxLength);

    // If no good split point, try last space
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }

    // Hard break if no word/line boundary found
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
