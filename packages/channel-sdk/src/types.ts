/** Unique channel identifier (e.g. "telegram", "discord", "signal") */
export type ChannelId = string & { readonly __brand: unique symbol };

/** Channel metadata for registration and discovery */
export interface ChannelMeta {
  name: string;
  version: string;
  description?: string;
  author?: string;
}

/** Declares what a channel adapter supports */
export interface ChannelCapabilities {
  text: boolean;
  media: boolean;
  voice: boolean;
  reactions: boolean;
  threads: boolean;
  ephemeral: boolean;
}

/** Normalized inbound message from any channel */
export interface AionimaMessage {
  id: string;
  channelId: ChannelId;
  channelUserId: string;
  timestamp: string;
  content: MessageContent;
  replyTo?: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "media"; url: string; mimeType: string; caption?: string }
  | { type: "voice"; url: string; duration: number };
