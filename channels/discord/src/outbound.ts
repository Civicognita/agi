import type { TextChannel } from "discord.js";
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import type { OutboundContent } from "@agi/sdk";

/** Discord's maximum text length per message. */
const MAX_TEXT_LENGTH = 2000;
/** Discord's maximum embed description length. */
const MAX_EMBED_DESCRIPTION = 4096;
/** Muted grey so the reasoning embed reads as de-emphasized vs the reply. */
const REASONING_COLOR = 0x4f545c;

// ---------------------------------------------------------------------------
// Reasoning embed
// ---------------------------------------------------------------------------

/**
 * Build the plain data for Aion's reasoning embed. Kept pure (no EmbedBuilder)
 * so the truncation + styling is unit-testable. Reasoning is rendered in a
 * separate, de-emphasized embed rather than inline in the reply — taking
 * advantage of Discord's embed support instead of dumping a raw <thinking> block.
 */
export function buildThinkingEmbedData(thinking: string): { title: string; description: string; color: number } {
  const trimmed = thinking.trim();
  const description = trimmed.length > MAX_EMBED_DESCRIPTION
    ? trimmed.slice(0, MAX_EMBED_DESCRIPTION - 1) + "…"
    : trimmed;
  return { title: "💭 Reasoning", description, color: REASONING_COLOR };
}

// ---------------------------------------------------------------------------
// Outbound: OutboundContent → Discord API calls
// ---------------------------------------------------------------------------

/**
 * Send an {@link OutboundContent} payload to a Discord text channel.
 *
 * - Reasoning (when present) is sent first as a de-emphasized embed, so the
 *   visible reply stays clean — the <thinking> block is never inline.
 * - Text content is automatically split at {@link MAX_TEXT_LENGTH} boundaries.
 * - Media content sends an attachment via URL with an optional caption.
 */
export async function sendOutbound(
  channel: TextChannel,
  content: OutboundContent,
): Promise<void> {
  if (content.type === "text") {
    // Reasoning embed first (if the model produced any), then the clean reply.
    if (typeof content.thinking === "string" && content.thinking.trim().length > 0) {
      const data = buildThinkingEmbedData(content.thinking);
      const embed = new EmbedBuilder()
        .setTitle(data.title)
        .setDescription(data.description)
        .setColor(data.color);
      await channel.send({ embeds: [embed] });
    }
    // Skip empty text (Discord rejects empty messages) — e.g. the model spent
    // its whole turn thinking; the reasoning embed above already conveys that.
    const chunks = splitText(content.text, MAX_TEXT_LENGTH).filter((c) => c.trim().length > 0);
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
