import { z } from "zod";

// ---------------------------------------------------------------------------
// Core data schemas (mirror types.ts)
// ---------------------------------------------------------------------------

export const ChannelMetaSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    author: z.string().optional(),
  })
  .strict();

export type ChannelMetaParsed = z.infer<typeof ChannelMetaSchema>;

export const ChannelCapabilitiesSchema = z
  .object({
    text: z.boolean(),
    media: z.boolean(),
    voice: z.boolean(),
    reactions: z.boolean(),
    threads: z.boolean(),
    ephemeral: z.boolean(),
  })
  .strict();

export type ChannelCapabilitiesParsed = z.infer<typeof ChannelCapabilitiesSchema>;

export const MessageContentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).strict(),
  z
    .object({
      type: z.literal("media"),
      url: z.string(),
      mimeType: z.string(),
      caption: z.string().optional(),
    })
    .strict(),
  z.object({ type: z.literal("voice"), url: z.string(), duration: z.number() }).strict(),
]);

export type MessageContentParsed = z.infer<typeof MessageContentSchema>;

export const AionimaMessageSchema = z
  .object({
    id: z.string(),
    channelId: z.string(),
    channelUserId: z.string(),
    timestamp: z.string(),
    content: MessageContentSchema,
    replyTo: z.string().optional(),
    threadId: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type AionimaMessageParsed = z.infer<typeof AionimaMessageSchema>;

// ---------------------------------------------------------------------------
// Outbound content schema (mirrors OutboundContent in adapters.ts)
// ---------------------------------------------------------------------------

export const OutboundContentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).strict(),
  z
    .object({
      type: z.literal("media"),
      url: z.string(),
      mimeType: z.string(),
      caption: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("voice"),
      audioBuffer: z.instanceof(Buffer),
      format: z.string(),
    })
    .strict(),
]);

export type OutboundContentParsed = z.infer<typeof OutboundContentSchema>;

// ---------------------------------------------------------------------------
// Adapter shape schemas — validate that an object has the right method names
// as functions. We cannot validate full generic signatures at runtime, so each
// method slot is z.function() (any-in/any-out).
// ---------------------------------------------------------------------------

/** ChannelConfigAdapter — validate(config), getDefaults() */
export const ChannelConfigAdapterSchema = z
  .object({
    validate: z.function(),
    getDefaults: z.function(),
  })
  .strict();

export type ChannelConfigAdapterParsed = z.infer<typeof ChannelConfigAdapterSchema>;

/** ChannelGatewayAdapter — start(), stop(), isRunning() */
export const ChannelGatewayAdapterSchema = z
  .object({
    start: z.function(),
    stop: z.function(),
    isRunning: z.function(),
  })
  .strict();

export type ChannelGatewayAdapterParsed = z.infer<typeof ChannelGatewayAdapterSchema>;

/** ChannelOutboundAdapter — send(channelUserId, content) */
export const ChannelOutboundAdapterSchema = z
  .object({
    send: z.function(),
  })
  .strict();

export type ChannelOutboundAdapterParsed = z.infer<typeof ChannelOutboundAdapterSchema>;

/** ChannelMessagingAdapter — onMessage(handler) */
export const ChannelMessagingAdapterSchema = z
  .object({
    onMessage: z.function(),
  })
  .strict();

export type ChannelMessagingAdapterParsed = z.infer<typeof ChannelMessagingAdapterSchema>;

/** ChannelSecurityAdapter — isAllowed(channelUserId), getAllowlist() */
export const ChannelSecurityAdapterSchema = z
  .object({
    isAllowed: z.function(),
    getAllowlist: z.function(),
  })
  .strict();

export type ChannelSecurityAdapterParsed = z.infer<typeof ChannelSecurityAdapterSchema>;

/** EntityResolverAdapter — resolve(channelUserId), createUnverified(channelUserId, displayName?) */
export const EntityResolverAdapterSchema = z
  .object({
    resolve: z.function(),
    createUnverified: z.function(),
  })
  .strict();

export type EntityResolverAdapterParsed = z.infer<typeof EntityResolverAdapterSchema>;

/** ImpactClassification data shape */
export const ImpactClassificationSchema = z
  .object({
    interactionType: z.string(),
    quant: z.number(),
    boolValue: z.number().int().min(-3).max(3),
  })
  .strict();

export type ImpactClassificationParsed = z.infer<typeof ImpactClassificationSchema>;

/** ImpactHookAdapter — classify(message) */
export const ImpactHookAdapterSchema = z
  .object({
    classify: z.function(),
  })
  .strict();

export type ImpactHookAdapterParsed = z.infer<typeof ImpactHookAdapterSchema>;

/** COAEmitterAdapter — emit(message, entityId) */
export const COAEmitterAdapterSchema = z
  .object({
    emit: z.function(),
  })
  .strict();

export type COAEmitterAdapterParsed = z.infer<typeof COAEmitterAdapterSchema>;
