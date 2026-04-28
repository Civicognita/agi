import type { OutboundContent } from "@agi/channel-sdk";
import type { SignalCliClient } from "./signal-cli-client.js";

/** Signal's practical maximum text length per message. */
const MAX_TEXT_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Outbound: OutboundContent → signal-cli REST calls
// ---------------------------------------------------------------------------

/**
 * Send an {@link OutboundContent} payload to a Signal recipient.
 *
 * - Text content is automatically split at {@link MAX_TEXT_LENGTH} boundaries.
 * - Media content sends the URL as a base64 attachment with an optional caption.
 *
 * @param client - Configured {@link SignalCliClient} instance.
 * @param recipient - E.164 phone number or group ID of the recipient.
 * @param content - Normalized outbound content to deliver.
 */
export async function sendOutbound(
  client: SignalCliClient,
  recipient: string,
  content: OutboundContent,
): Promise<void> {
  if (content.type === "text") {
    const chunks = splitText(content.text, MAX_TEXT_LENGTH);
    for (const chunk of chunks) {
      await client.sendMessage(recipient, chunk);
    }
    return;
  }

  if (content.type === "media") {
    await client.sendAttachment(recipient, content.url, content.caption);
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
