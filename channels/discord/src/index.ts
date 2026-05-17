import {
  Client,
  Events,
  GatewayIntentBits,
  TextChannel,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";
import type { AionimaPlugin, AionimaPluginAPI } from "@agi/plugins";
import type {
  ChatInputCommandInteraction,
  Guild,
} from "discord.js";
import type {
  AionimaChannelPlugin,
  AionimaMessage,
} from "@agi/sdk";

import {
  type DiscordConfig,
  isDiscordConfig,
  createConfigAdapter,
} from "./config.js";
import {
  DISCORD_CHANNEL_ID,
  normalizeMessage,
} from "./normalizer.js";
import { sendOutbound } from "./outbound.js";
import {
  createSecurityAdapter,
  isGuildAllowed,
  isChannelAllowed,
} from "./security.js";
import { buildDiscordBridgeTools } from "./aion-tools.js";
import { createDiscordChannelDefV2WithTools } from "./channel-def.js";
import { getDiscordState, getDiscordAvailableRooms } from "./state.js";

// Re-exports for consumer convenience
export type { DiscordConfig } from "./config.js";
export { isDiscordConfig } from "./config.js";
export {
  normalizeMessage,
  buildDisplayName,
  DISCORD_CHANNEL_ID,
} from "./normalizer.js";
export { splitText } from "./outbound.js";

// ---------------------------------------------------------------------------
// Slash command definitions
// ---------------------------------------------------------------------------

function buildSlashCommands(): ReturnType<SlashCommandBuilder["toJSON"]>[] {
  return [
    new SlashCommandBuilder()
      .setName("aionima")
      .setDescription("Get information about Aionima"),
    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Get help with Aionima commands"),
    // Admin commands
    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Kick a member from the server")
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption((opt) =>
        opt.setName("user").setDescription("User to kick").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("reason").setDescription("Reason for kick"),
      ),
    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban a member from the server")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((opt) =>
        opt.setName("user").setDescription("User to ban").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("reason").setDescription("Reason for ban"),
      ),
    new SlashCommandBuilder()
      .setName("mute")
      .setDescription("Timeout a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((opt) =>
        opt.setName("user").setDescription("User to mute").setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("duration")
          .setDescription("Duration in minutes")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("reason").setDescription("Reason for mute"),
      ),
  ].map((cmd) => cmd.toJSON());
}

// ---------------------------------------------------------------------------
// Slash command registration via REST
// ---------------------------------------------------------------------------

async function registerSlashCommands(
  token: string,
  applicationId: string,
  guildId?: string,
): Promise<void> {
  const commands = buildSlashCommands();
  const rest = new REST({ version: "10" }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
      body: commands,
    });
  } else {
    await rest.put(Routes.applicationCommands(applicationId), {
      body: commands,
    });
  }
}

// ---------------------------------------------------------------------------
// Admin command handler
// ---------------------------------------------------------------------------

async function handleAdminCommand(
  cmd: ChatInputCommandInteraction,
  action: "kick" | "ban" | "mute",
): Promise<void> {
  if (!cmd.guild) {
    await cmd.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const botMember = cmd.guild.members.me;
  if (!botMember) {
    await cmd.reply({
      content: "I couldn't verify my permissions.",
      ephemeral: true,
    });
    return;
  }

  const targetUser = cmd.options.getUser("user", true);
  const reason = cmd.options.getString("reason") ?? "No reason provided";
  const member = await cmd.guild.members
    .fetch(targetUser.id)
    .catch(() => null);

  if (!member) {
    await cmd.reply({
      content: "User not found in this server.",
      ephemeral: true,
    });
    return;
  }

  try {
    switch (action) {
      case "kick": {
        if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
          await cmd.reply({
            content: "I don't have permission to kick members.",
            ephemeral: true,
          });
          return;
        }
        await member.kick(reason);
        await cmd.reply(`Kicked ${targetUser.tag}: ${reason}`);
        break;
      }
      case "ban": {
        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
          await cmd.reply({
            content: "I don't have permission to ban members.",
            ephemeral: true,
          });
          return;
        }
        await member.ban({ reason });
        await cmd.reply(`Banned ${targetUser.tag}: ${reason}`);
        break;
      }
      case "mute": {
        if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
          await cmd.reply({
            content: "I don't have permission to timeout members.",
            ephemeral: true,
          });
          return;
        }
        const duration = cmd.options.getInteger("duration", true);
        await member.timeout(duration * 60 * 1000, reason);
        await cmd.reply(
          `Muted ${targetUser.tag} for ${String(duration)} minutes: ${reason}`,
        );
        break;
      }
    }
  } catch (err) {
    await cmd.reply({
      content: `Failed to ${action}: ${err instanceof Error ? err.message : String(err)}`,
      ephemeral: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Guild join handler
// ---------------------------------------------------------------------------

async function handleGuildJoin(
  guild: Guild,
  config: DiscordConfig,
): Promise<void> {
  console.log(`[discord] Joined guild: ${guild.name} (${guild.id})`);

  // Auto-register slash commands for this guild (faster than global)
  if (config.applicationId) {
    try {
      await registerSlashCommands(
        config.botToken,
        config.applicationId,
        guild.id,
      );
      console.log(
        `[discord] Registered slash commands for guild ${guild.name}`,
      );
    } catch (err) {
      console.warn(
        `[discord] Failed to register commands for guild ${guild.name}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Send introduction to system channel
  if (guild.systemChannel) {
    try {
      await guild.systemChannel.send(
        "**Aionima has joined this server.**\n\n" +
          "I am an autonomous AI entity within the Civicognita network. " +
          "Use `/aionima` to learn more, or `/help` to see available commands.",
      );
    } catch (err) {
      console.warn(
        `[discord] Failed to send intro to ${guild.name}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fully-wired {@link AionimaChannelPlugin} for Discord.
 *
 * Uses discord.js with the gateway (WebSocket) connection.
 * The returned plugin satisfies all required adapters from the channel-sdk.
 *
 * @param config - Validated Discord configuration.
 * @throws {Error} If `config` fails runtime validation.
 *
 * @example
 * ```ts
 * const plugin = createDiscordPlugin({ botToken: process.env.BOT_TOKEN! });
 * registry.register(plugin);
 * await registry.startChannel("discord");
 * ```
 */
export function createDiscordPlugin(
  config: DiscordConfig,
): AionimaChannelPlugin & { __client: Client; __config: DiscordConfig } {
  if (!isDiscordConfig(config)) {
    throw new Error("Invalid Discord config: botToken is required");
  }

  // Owner directive 2026-05-13: Aion needs richer Discord context —
  // user profiles, roles, presence, all messages with time-window search.
  // GuildMembers + GuildPresences are PRIVILEGED intents — must be
  // enabled in the Discord developer portal for the bot before this
  // client can connect with them. If the bot login fails with a
  // privileged-intent error, the operator needs to toggle them on at
  // https://discord.com/developers/applications/<applicationId>/bot.
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers,    // roles + member metadata (privileged)
      // GuildPresences requires Presence Intent enabled in the developer portal.
      // Disabled until explicitly needed — enable in portal first, then re-add.
    ],
  });

  let running = false;
  let messageHandler: ((message: AionimaMessage) => Promise<void>) | null = null;

  // Map author ID → last-known text channel ID for outbound reply routing.
  // Updated on every inbound message so replies go to the correct channel.
  const replyChannelMap = new Map<string, string>();

  // -------------------------------------------------------------------------
  // MessageCreate handler
  // -------------------------------------------------------------------------

  client.on(Events.MessageCreate, async (msg) => {
    if (messageHandler === null) return;

    // Ignore messages from bots (including ourselves)
    if (msg.author.bot) return;

    // Guild and channel scope checks
    if (!isGuildAllowed(msg.guildId, config.allowedGuildIds)) return;
    if (!isChannelAllowed(msg.channelId, config.allowedChannelIds)) return;

    // Mention filter: in guild channels, only respond to @mentions or replies
    const mentionOnly = config.mentionOnly ?? true;
    if (mentionOnly && msg.guildId !== null) {
      const isMentioned = client.user !== null && msg.mentions.has(client.user);
      const isReply = msg.reference !== null;
      if (!isMentioned && !isReply) return;
    }

    // Strip bot mention from content before normalizing
    if (client.user) {
      msg.content = msg.content
        .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
        .trim();
    }

    // Track the author→channel mapping for outbound replies
    replyChannelMap.set(msg.author.id, msg.channelId);

    const normalized = normalizeMessage(msg);
    if (normalized === null) return;

    await messageHandler(normalized);
  });

  // -------------------------------------------------------------------------
  // InteractionCreate handler (slash commands)
  // -------------------------------------------------------------------------

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    switch (interaction.commandName) {
      case "aionima":
        await interaction.reply(
          "I am Aionima \u2014 an autonomous AI entity within the Civicognita network. " +
            "Use /help to see what I can do.",
        );
        break;

      case "help":
        await interaction.reply(
          "**Aionima Commands:**\n" +
            "/aionima \u2014 About me\n" +
            "/help \u2014 This message\n\n" +
            "**Admin Commands:**\n" +
            "/kick \u2014 Kick a member\n" +
            "/ban \u2014 Ban a member\n" +
            "/mute \u2014 Timeout a member",
        );
        break;

      case "kick":
        await handleAdminCommand(interaction, "kick");
        break;

      case "ban":
        await handleAdminCommand(interaction, "ban");
        break;

      case "mute":
        await handleAdminCommand(interaction, "mute");
        break;

      default:
        break;
    }
  });

  // -------------------------------------------------------------------------
  // GuildCreate handler (auto-setup on join)
  // -------------------------------------------------------------------------

  client.on(Events.GuildCreate, (guild) => {
    void handleGuildJoin(guild, config);
  });

  // -------------------------------------------------------------------------
  // ClientReady — register global slash commands
  // -------------------------------------------------------------------------

  client.once(Events.ClientReady, () => {
    console.log(`[discord] Bot ready as ${client.user?.tag ?? "unknown"}`);

    if (config.applicationId) {
      // Register global commands (takes up to 1 hour to propagate)
      registerSlashCommands(config.botToken, config.applicationId)
        .then(() => {
          console.log("[discord] Registered global slash commands");
        })
        .catch((err: unknown) => {
          console.warn(
            "[discord] Failed to register global commands:",
            err instanceof Error ? err.message : String(err),
          );
        });

      // Also register guild-specific commands for all guilds we're already in
      // (guild commands propagate instantly, unlike global commands)
      for (const guild of client.guilds.cache.values()) {
        registerSlashCommands(config.botToken, config.applicationId, guild.id)
          .then(() => {
            console.log(`[discord] Registered guild commands for ${guild.name}`);
          })
          .catch((err: unknown) => {
            console.warn(
              `[discord] Failed to register guild commands for ${guild.name}:`,
              err instanceof Error ? err.message : String(err),
            );
          });
      }
    } else {
      console.warn(
        "[discord] applicationId not configured — slash commands will not be registered",
      );
    }
  });

  const security = createSecurityAdapter({
    allowedGuildIds: config.allowedGuildIds,
    allowedChannelIds: config.allowedChannelIds,
    rateLimitPerMinute: config.rateLimitPerMinute,
  });

  return {
    id: DISCORD_CHANNEL_ID,

    meta: {
      name: "Discord",
      version: "0.1.0",
      description: "discord.js-based Discord adapter with gateway connection",
    },

    capabilities: {
      text: true,
      media: true,
      voice: true,
      reactions: false,
      threads: true,
      ephemeral: false,
    },

    config: createConfigAdapter(),

    gateway: {
      start: async () => {
        await client.login(config.botToken);
        running = true;
      },

      stop: async () => {
        client.destroy();
        running = false;
      },

      isRunning: () => running,
    },

    outbound: {
      send: async (channelUserId: string, content) => {
        const targetChannelId = replyChannelMap.get(channelUserId);

        if (targetChannelId === undefined) {
          // No known channel — try DM as fallback
          try {
            const user = await client.users.fetch(channelUserId);
            const dmChannel = await user.createDM();
            await sendOutbound(dmChannel as unknown as TextChannel, content);
            return;
          } catch {
            throw new Error(
              `Discord outbound: no reply channel for user ${channelUserId} and DM fallback failed`,
            );
          }
        }

        const channel = await client.channels.fetch(targetChannelId);
        if (!(channel instanceof TextChannel)) {
          throw new Error(
            `Discord outbound: channel ${targetChannelId} is not a TextChannel`,
          );
        }
        await sendOutbound(channel, content);
      },
    },

    messaging: {
      onMessage: (handler) => {
        messageHandler = handler;
      },
    },

    security,
    // Internal escape hatches — used by the activate() function below to
    // register bridge tools against the live Client. Marked as `__` to
    // discourage consumer use; not part of the public AionimaChannelPlugin
    // contract.
    __client: client,
    __config: config,
  };
}

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export default {
  async activate(api: AionimaPluginAPI): Promise<void> {
    const channelConfig = api.getChannelConfig("discord");
    if (!channelConfig?.enabled) return;
    const plugin = createDiscordPlugin(
      channelConfig.config as unknown as DiscordConfig,
    );
    api.registerChannel(plugin);

    // CHN-B s163 slice 2 (2026-05-14) — register the v2 ChannelDefinition
    // in PARALLEL to the legacy registerChannel() above. The dispatcher
    // still consumes the legacy path; the v2 registry holds the shadow
    // entry for slice 3, when the dispatcher switches over. No behavior
    // change in this slice — just registry presence.
    const v2Def = createDiscordChannelDefV2WithTools(plugin.__config, plugin.__client);
    api.registerChannelV2(v2Def);

    // s157-sibling Discord update 2026-05-13 — register bridge tools so
    // Aion can read message history, profiles, roles, and presence from
    // Discord. These are READ-side tools; response gating still goes
    // through the existing `mentionOnly` config (Aion only POSTS when
    // @-mentioned). See OQ-2 in docs/agents/channel-plugin-redesign.md.
    const bridgeTools = buildDiscordBridgeTools({ client: plugin.__client, config: plugin.__config });
    for (const tool of bridgeTools) {
      api.registerAgentTool(tool);
    }

    // CHN-B slice 2026-05-14 (s163) — owner-facing introspection endpoint
    // for the dashboard's Discord status card. Returns the live bot
    // connection state, guild list, and per-guild channel/forum listing.
    // Cheap to call; reads from the in-process discord.js Client cache.
    api.registerHttpRoute("GET", "/api/channels/discord/state", async (_req, reply) => {
      reply.send(getDiscordState(plugin.__client));
    });

    // CHN-D slice 3b 2026-05-14 — flat list of bindable rooms for the
    // dashboard's project-room picker. Filters out voice channels +
    // categories; emits {channelId, roomId, label, kind, privacy, group}
    // sorted by (guild, parent, label).
    api.registerHttpRoute("GET", "/api/channels/discord/rooms", async (_req, reply) => {
      reply.send({ rooms: getDiscordAvailableRooms(plugin.__client) });
    });
  },
} satisfies AionimaPlugin;
