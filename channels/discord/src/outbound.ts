import type { TextChannel } from "discord.js";
import { AttachmentBuilder } from "discord.js";
import type { OutboundContent } from "@agi/channel-sdk";

/** Discord's maximum text length per message. */
const MAX_TEXT_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Outbound: OutboundContent → Discord API calls
// ---------------------------------------------------------------------------

/**
 * Send an {@link OutboundContent} payload to a Discord text channel.
 *
 * - Text content is automatically split at {@link MAX_TEXT_LENGTH} boundaries.
 * - Media content sends an attachment via URL with an optional caption.
 */
export async function sendOutbound(
  channel: TextChannel,
  content: OutboundContent,
): Promise<void> {
  if (content.type === "text") {
    const chunks = splitText(content.text, MAX_TEXT_LENGTH);
    for (const chunk of chunks) {
      await channel.send({ content: chunk });
    }
    return;
  }

  if (content.type === "media") {
    const attachment = new AttachmentBuilder(content.url);
    await channel.send({
      content: content.caption,
      files: [attachment],
    });
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
