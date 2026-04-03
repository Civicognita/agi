export {
  validateAdapter,
  assertValidAdapter,
  type AdapterValidationResult,
  type AdapterValidationError,
} from "./validate.js";

export type {
  ChannelId,
  ChannelMeta,
  ChannelCapabilities,
  AionimaMessage,
  MessageContent,
} from "./types.js";

export type {
  ChannelConfigAdapter,
  ChannelGatewayAdapter,
  ChannelOutboundAdapter,
  OutboundContent,
  ChannelMessagingAdapter,
  ChannelSecurityAdapter,
  EntityResolverAdapter,
  ImpactHookAdapter,
  ImpactClassification,
  COAEmitterAdapter,
} from "./adapters.js";

export {
  ChannelMetaSchema,
  type ChannelMetaParsed,
  ChannelCapabilitiesSchema,
  type ChannelCapabilitiesParsed,
  MessageContentSchema,
  type MessageContentParsed,
  AionimaMessageSchema,
  type AionimaMessageParsed,
  OutboundContentSchema,
  type OutboundContentParsed,
  ChannelConfigAdapterSchema,
  type ChannelConfigAdapterParsed,
  ChannelGatewayAdapterSchema,
  type ChannelGatewayAdapterParsed,
  ChannelOutboundAdapterSchema,
  type ChannelOutboundAdapterParsed,
  ChannelMessagingAdapterSchema,
  type ChannelMessagingAdapterParsed,
  ChannelSecurityAdapterSchema,
  type ChannelSecurityAdapterParsed,
  EntityResolverAdapterSchema,
  type EntityResolverAdapterParsed,
  ImpactClassificationSchema,
  type ImpactClassificationParsed,
  ImpactHookAdapterSchema,
  type ImpactHookAdapterParsed,
  COAEmitterAdapterSchema,
  type COAEmitterAdapterParsed,
} from "./schemas.js";

export { testPlugin } from "./test-harness.js";
export type {
  TestResult,
  TestSuiteResult,
  TestHarnessOptions,
} from "./test-harness.js";

import type { ChannelId, ChannelMeta, ChannelCapabilities } from "./types.js";
import type {
  ChannelConfigAdapter,
  ChannelGatewayAdapter,
  ChannelOutboundAdapter,
  ChannelMessagingAdapter,
  ChannelSecurityAdapter,
  EntityResolverAdapter,
  ImpactHookAdapter,
  COAEmitterAdapter,
} from "./adapters.js";

/** Full channel plugin contract — adapted from OpenClaw with 0R additions */
export interface AionimaChannelPlugin {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;

  // Core adapters (same pattern as OpenClaw)
  config: ChannelConfigAdapter;
  gateway: ChannelGatewayAdapter;
  outbound: ChannelOutboundAdapter;
  messaging: ChannelMessagingAdapter;
  security?: ChannelSecurityAdapter;

  // 0R additions
  entityResolver?: EntityResolverAdapter;
  impactHook?: ImpactHookAdapter;
  coaEmitter?: COAEmitterAdapter;
}
