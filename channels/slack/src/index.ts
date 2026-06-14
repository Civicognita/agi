import type { AionimaPlugin, AionimaPluginAPI } from "@agi/plugins";
import { type SlackConfig, isSlackConfig } from "./config.js";
import { createSlackChannelDefV2, SLACK_CHANNEL_ID } from "./channel-def.js";

// Re-exports for consumer convenience
export type { SlackConfig } from "./config.js";
export { isSlackConfig } from "./config.js";
export { createSlackChannelDefV2, encodeRoomId, decodeRoomId, SLACK_CHANNEL_ID } from "./channel-def.js";

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export default {
  async activate(api: AionimaPluginAPI): Promise<void> {
    const channelConfig = api.getChannelConfig("slack");
    if (!channelConfig?.enabled) return;
    const config = channelConfig.config as unknown as SlackConfig;

    if (!isSlackConfig(config)) {
      throw new Error(
        `Invalid Slack config: botToken (xoxb-…) and appToken (xapp-…) are required`,
      );
    }

    // Net-new adapter: no legacy v1 path to shadow. Register v2 only.
    // The gateway dispatcher (slice 3, CHN-D s165) will activate the protocol
    // when a project binding routes traffic to the Slack channel.
    const v2Def = createSlackChannelDefV2(config);
    api.registerChannelV2?.(v2Def);
  },

  id: SLACK_CHANNEL_ID,
} satisfies AionimaPlugin & { id: string };
