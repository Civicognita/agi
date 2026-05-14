/**
 * defineChannelV2 — builder for the new ChannelDefinition shape.
 *
 * **CHN-A (s162) slice 1 — 2026-05-14.** Pairs with the type contract
 * in `./channel-v2-types.ts`. Coexists with the legacy `defineChannel`
 * (which still builds the old `AionimaChannelPlugin` shape from
 * `@agi/channel-sdk`). When CHN-M (s174) lands and the legacy SDK is
 * deleted, this becomes the canonical `defineChannel`.
 *
 * Naming note: the suffix `V2` is transitional. Future major aion-sdk
 * rev renames `defineChannelV2 → defineChannel` and the old
 * `defineChannel → defineLegacyChannel` (or just deletes it). Both
 * names are valid TS identifiers; consumers migrate one import line
 * per fork.
 *
 * Quick example:
 *
 * ```ts
 * import { defineChannelV2, type ChannelProtocol } from "@agi/sdk";
 *
 * export default defineChannelV2({
 *   id: "discord",
 *   displayName: "Discord",
 *   createProtocol: (ctx): ChannelProtocol => new DiscordProtocol(ctx),
 *   SettingsPage: DiscordSettingsPage,
 *   ProjectPagePanel: DiscordProjectPanel,
 *   bridgeTools: [discordPostMessage, discordSearchMessages, discordGetUser],
 *   readPolicy: {
 *     canReadAllMessages: { configurable: true, defaultOn: false },
 *     canReadPresence:    { configurable: true, defaultOn: false },
 *     canReadRoles:       { configurable: true, defaultOn: true },
 *     nativeIntents: ["Guilds", "GuildMessages", "MessageContent"],
 *   },
 * });
 * ```
 */

import type { ChannelDefinition } from "./channel-v2-types.js";

/**
 * Build a `ChannelDefinition`. Validates required fields at runtime so
 * a misconfigured channel surfaces a clear error at registration time
 * rather than a runtime null-deref deep in the dispatcher.
 *
 * Returns the input object unchanged when valid — no wrapping, no
 * mutation. Plugins can `as const` the literal and pass it directly.
 */
export function defineChannelV2(def: ChannelDefinition): ChannelDefinition {
  if (def.id.trim().length === 0) {
    throw new Error("defineChannelV2: `id` is required and must be non-empty (e.g. 'discord')");
  }
  if (def.displayName.trim().length === 0) {
    throw new Error("defineChannelV2: `displayName` is required and must be non-empty");
  }
  if (typeof def.createProtocol !== "function") {
    throw new Error(`defineChannelV2[${def.id}]: \`createProtocol\` is required and must be a function`);
  }
  if (typeof def.SettingsPage !== "function" && typeof def.SettingsPage !== "object") {
    throw new Error(`defineChannelV2[${def.id}]: \`SettingsPage\` is required (React component)`);
  }
  if (!Array.isArray(def.bridgeTools)) {
    throw new Error(`defineChannelV2[${def.id}]: \`bridgeTools\` must be an array (pass [] if none)`);
  }
  if (typeof def.readPolicy !== "object" || def.readPolicy === null) {
    throw new Error(`defineChannelV2[${def.id}]: \`readPolicy\` is required`);
  }
  // Sanity-check the read-policy sub-shape — three required toggles.
  const policy = def.readPolicy;
  for (const key of ["canReadAllMessages", "canReadPresence", "canReadRoles"] as const) {
    const v = policy[key];
    if (typeof v !== "object" || v === null) {
      throw new Error(`defineChannelV2[${def.id}]: \`readPolicy.${key}\` is required`);
    }
    if (typeof v.configurable !== "boolean" || typeof v.defaultOn !== "boolean") {
      throw new Error(
        `defineChannelV2[${def.id}]: \`readPolicy.${key}\` must have boolean \`configurable\` + \`defaultOn\``,
      );
    }
  }
  return def;
}
