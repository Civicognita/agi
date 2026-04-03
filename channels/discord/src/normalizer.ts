import type { Message } from "discord.js";
import type { ChannelId, AionimaMessage, MessageContent } from "@aionima/channel-sdk";

export const DISCORD_CHANNEL_ID = "discord" as ChannelId;

// ---------------------------------------------------------------------------
// Normalizer: Discord Message → AionimaMessage
// ---------------------------------------------------------------------------

/**
 * Convert a raw Discord.js {@link Message} into a normalized {@link AionimaMessage}.
 *
 * Supported content types: text, attachments (image → media, other → media),
 * voice messages.
 * Returns `null` when the message type is unsupported (system messages, etc.)
 * so callers can silently skip it.
 */
export function normalizeMessage(msg: Message): AionimaMessage | null {
  const content = extractContent(msg);
  if (content === null) return null;

  const channel = msg.channel;
  const isThread = channel.isThread();

  return {
    id: msg.id,
    channelId: DISCORD_CHANNEL_ID,
    // Use the author's Discord ID for entity resolution — each user gets
    // their own entity rather than sharing one per text channel.
    // The outbound adapter maintains an authorId->channelId map for replies.
    channelUserId: msg.author.id,
    timestamp: msg.createdAt.toISOString(),
    content,
    replyTo: msg.reference?.messageId ?? undefined,
    threadId: isThread ? channel.id : undefined,
    metadata: {
      guildId: msg.guildId ?? undefined,
      guildName: msg.guild?.name ?? undefined,
      channelId: msg.channelId,
      replyChannelId: msg.channelId,
      authorId: msg.author.id,
      channelName: "name" in channel ? (channel.name as string) : undefined,
      username: msg.author.username,
      discriminator: msg.author.discriminator,
      displayName: buildDisplayName(msg),
    },
  };
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

function extractContent(msg: Message): MessageContent | null {
  // Voice messages are attachments flagged with the voice message flag.
  // Discord.js exposes them via msg.flags.has(MessageFlags.IsVoiceMessage)
  // and the attachment has a duration_secs property on the raw data.
  const firstAttachment = msg.attachments.first();

  if (firstAttachment !== undefined) {
    // Check for voice message: content type is audio and duration is present
    const rawDuration = (firstAttachment as unknown as Record<string, unknown>)[
      "duration_secs"
    ];
    if (
      firstAttachment.contentType?.startsWith("audio/") === true &&
      typeof rawDuration === "number"
    ) {
      return {
        type: "voice",
        url: firstAttachment.url,
        duration: rawDuration,
      };
    }

    // Regular attachment: image or generic media
    const mimeType =
      firstAttachment.contentType ?? "application/octet-stream";
    return {
      type: "media",
      url: firstAttachment.url,
      mimeType,
      caption: msg.content.length > 0 ? msg.content : undefined,
    };
  }

  if (msg.content.length > 0) {
    return { type: "text", text: msg.content };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Display name helper
// ---------------------------------------------------------------------------

/**
 * Build a display name from Discord user fields.
 * Prefers global display name, falls back to username, then user ID.
 */
export function buildDisplayName(msg: Message): string {
  // globalName is the user's display name (new username system, no discriminator)
  const globalName = (msg.author as unknown as Record<string, unknown>)[
    "globalName"
  ];
  if (typeof globalName === "string" && globalName.length > 0) {
    return globalName;
  }
  if (msg.author.username.length > 0) return msg.author.username;
  return `discord:${msg.author.id}`;
}
