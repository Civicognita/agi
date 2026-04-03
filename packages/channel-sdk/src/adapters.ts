import type { AionimaMessage } from "./types.js";

/** Configuration adapter — validates and provides channel config */
export interface ChannelConfigAdapter {
  validate(config: unknown): boolean;
  getDefaults(): Record<string, unknown>;
}

/** Gateway lifecycle — start/stop the channel connection */
export interface ChannelGatewayAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

/** Outbound delivery — send messages back to channel */
export interface ChannelOutboundAdapter {
  send(channelUserId: string, content: OutboundContent): Promise<void>;
}

export type OutboundContent =
  | { type: "text"; text: string }
  | { type: "media"; url: string; mimeType: string; caption?: string }
  | { type: "voice"; audioBuffer: Buffer; format: string };

/** Inbound delivery — receive messages from channel */
export interface ChannelMessagingAdapter {
  onMessage(handler: (message: AionimaMessage) => Promise<void>): void;
}

/** Security — DM policy, allowlists */
export interface ChannelSecurityAdapter {
  isAllowed(channelUserId: string): Promise<boolean>;
  getAllowlist(): Promise<string[]>;
}

// --- 0R Additions (not in OpenClaw) ---

/** Resolve a channel sender to a #E entity ID */
export interface EntityResolverAdapter {
  resolve(channelUserId: string): Promise<string | null>;
  createUnverified(channelUserId: string, displayName?: string): Promise<string>;
}

/** Classify interaction for impact scoring */
export interface ImpactHookAdapter {
  classify(message: AionimaMessage): Promise<ImpactClassification>;
}

export interface ImpactClassification {
  interactionType: string;
  quant: number;
  boolValue: number; // -3 to +3 (0BOOL_SCALE)
}

/** Generate COA records per message */
export interface COAEmitterAdapter {
  emit(message: AionimaMessage, entityId: string): Promise<string>; // returns COA fingerprint
}
