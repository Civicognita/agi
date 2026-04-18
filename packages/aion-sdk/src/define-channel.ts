/**
 * defineChannel — chainable builder for AionimaChannelPlugin.
 *
 * Channel plugins connect messaging platforms (Telegram, Discord, Signal,
 * WhatsApp, Gmail) to the Aionima agent pipeline.
 *
 * ## Quick example
 *
 * ```ts
 * const telegram = defineChannel("telegram", "Telegram")
 *   .version("1.0.0")
 *   .description("Telegram messaging channel via grammy")
 *   .capabilities({ text: true, media: true, voice: true, reactions: true, threads: false, ephemeral: false })
 *   .configAdapter({ validate: () => true, getDefaults: () => ({}) })
 *   .gatewayAdapter({ start: async () => {}, stop: async () => {}, isRunning: () => false })
 *   .outboundAdapter({ send: async () => {} })
 *   .messagingAdapter({ onMessage: () => {} })
 *   .build();
 *
 * // In your plugin's activate():
 * api.registerChannel(telegram);
 * ```
 */

import type {
  AionimaChannelPlugin,
  ChannelCapabilities,
  ChannelConfigAdapter,
  ChannelGatewayAdapter,
  ChannelOutboundAdapter,
  ChannelMessagingAdapter,
  ChannelSecurityAdapter,
  EntityResolverAdapter,
  ImpactHookAdapter,
  COAEmitterAdapter,
  ChannelId,
} from "@agi/channel-sdk";

class ChannelBuilder {
  private def: {
    id: ChannelId;
    meta: { name: string; version: string; description?: string; author?: string };
    capabilities: ChannelCapabilities;
    config?: ChannelConfigAdapter;
    gateway?: ChannelGatewayAdapter;
    outbound?: ChannelOutboundAdapter;
    messaging?: ChannelMessagingAdapter;
    security?: ChannelSecurityAdapter;
    entityResolver?: EntityResolverAdapter;
    impactHook?: ImpactHookAdapter;
    coaEmitter?: COAEmitterAdapter;
  };

  constructor(id: string, name: string) {
    this.def = {
      id: id as ChannelId,
      meta: { name, version: "0.1.0" },
      capabilities: { text: true, media: false, voice: false, reactions: false, threads: false, ephemeral: false },
    };
  }

  version(v: string): this {
    this.def.meta.version = v;
    return this;
  }

  description(desc: string): this {
    this.def.meta.description = desc;
    return this;
  }

  author(author: string): this {
    this.def.meta.author = author;
    return this;
  }

  capabilities(caps: Partial<ChannelCapabilities>): this {
    this.def.capabilities = { ...this.def.capabilities, ...caps };
    return this;
  }

  configAdapter(adapter: ChannelConfigAdapter): this {
    this.def.config = adapter;
    return this;
  }

  gatewayAdapter(adapter: ChannelGatewayAdapter): this {
    this.def.gateway = adapter;
    return this;
  }

  outboundAdapter(adapter: ChannelOutboundAdapter): this {
    this.def.outbound = adapter;
    return this;
  }

  messagingAdapter(adapter: ChannelMessagingAdapter): this {
    this.def.messaging = adapter;
    return this;
  }

  securityAdapter(adapter: ChannelSecurityAdapter): this {
    this.def.security = adapter;
    return this;
  }

  entityResolver(adapter: EntityResolverAdapter): this {
    this.def.entityResolver = adapter;
    return this;
  }

  impactHook(adapter: ImpactHookAdapter): this {
    this.def.impactHook = adapter;
    return this;
  }

  coaEmitter(adapter: COAEmitterAdapter): this {
    this.def.coaEmitter = adapter;
    return this;
  }

  build(): AionimaChannelPlugin {
    if (!this.def.config) throw new Error("AionimaChannelPlugin requires a configAdapter");
    if (!this.def.gateway) throw new Error("AionimaChannelPlugin requires a gatewayAdapter");
    if (!this.def.outbound) throw new Error("AionimaChannelPlugin requires an outboundAdapter");
    if (!this.def.messaging) throw new Error("AionimaChannelPlugin requires a messagingAdapter");

    return {
      id: this.def.id,
      meta: this.def.meta,
      capabilities: this.def.capabilities,
      config: this.def.config,
      gateway: this.def.gateway,
      outbound: this.def.outbound,
      messaging: this.def.messaging,
      security: this.def.security,
      entityResolver: this.def.entityResolver,
      impactHook: this.def.impactHook,
      coaEmitter: this.def.coaEmitter,
    };
  }
}

/**
 * Create a channel plugin definition using a chainable builder.
 *
 * @param id - Unique channel identifier (e.g. "telegram", "discord")
 * @param name - Human-readable name (e.g. "Telegram")
 */
export function defineChannel(id: string, name: string): ChannelBuilder {
  return new ChannelBuilder(id, name);
}
