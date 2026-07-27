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
import type {
  AionimaPlugin,
  AionimaPluginAPI,
  AmbientEntry,
  RegistrationSession,
  PendingApprovalCaptureInput,
} from "@agi/plugins";
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
  coerceDiscordConfig,
  createConfigAdapter,
  normalizeDiscordArrayField,
} from "./config.js";
import {
  DISCORD_CHANNEL_ID,
  normalizeMessage,
  buildDisplayName,
  resolveDiscordMentions,
} from "./normalizer.js";
import { sendOutbound } from "./outbound.js";
import {
  createSecurityAdapter,
  isGuildAllowed,
  isRoleAllowed,
} from "./security.js";
import { buildDiscordBridgeTools } from "./aion-tools.js";
import { createDiscordChannelDefV2WithTools } from "./channel-def.js";
import { getDiscordState, getDiscordAvailableRooms } from "./state.js";

// Re-exports for consumer convenience
export type { DiscordConfig } from "./config.js";
export { isDiscordConfig, coerceDiscordConfig } from "./config.js";
export {
  normalizeMessage,
  buildDisplayName,
  resolveDiscordMentions,
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
type CreateUserFn = (
  channelId: string,
  userId: string,
  meta: { displayName?: string; username?: string },
) => Promise<{ userId: string; isNew: boolean }>;

// ---------------------------------------------------------------------------
// s194 — Registration flow helpers
// ---------------------------------------------------------------------------

/** Simple email format check — not exhaustive, just catches obvious mistakes. */
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Validates MM/DD/YYYY date format. */
function isValidBirthdate(s: string): boolean {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(s);
}

/** Send a DM to a Discord user; best-effort (DMs may be disabled). */
async function sendDm(
  author: { createDM: () => Promise<{ send: (text: string) => Promise<unknown> }> },
  text: string,
): Promise<void> {
  try {
    const dm = await author.createDM();
    await dm.send(text);
  } catch {
    // Best-effort — user may have DMs disabled
  }
}

type RegistrationOpts = {
  getRegistrationSession?: (id: string) => RegistrationSession | null;
  setRegistrationSession?: (s: RegistrationSession) => void;
  deleteRegistrationSession?: (id: string) => void;
  capturePendingApproval?: (input: PendingApprovalCaptureInput) => void;
};

/** Advance a registration session based on the user's DM reply. */
async function handleRegistrationDm(
  msg: { author: { id: string; username: string; createDM: () => Promise<{ send: (t: string) => Promise<unknown> }> }; content: string },
  session: RegistrationSession,
  reg: RegistrationOpts,
): Promise<void> {
  const input = msg.content.trim();
  if (input.toLowerCase() === "cancel") {
    reg.deleteRegistrationSession?.(session.sessionId);
    await sendDm(msg.author, "Registration cancelled. Mention me in the server to restart anytime.");
    return;
  }

  switch (session.step) {
    case "name": {
      if (input.length < 2) {
        await sendDm(msg.author, "Please provide your full name (at least 2 characters):");
        return;
      }
      reg.setRegistrationSession?.({ ...session, step: "email", data: { ...session.data, name: input } });
      await sendDm(msg.author, `Thanks, ${input}! What's your email address?`);
      break;
    }
    case "email": {
      if (!isValidEmail(input)) {
        await sendDm(msg.author, "That doesn't look like a valid email. Try again:");
        return;
      }
      reg.setRegistrationSession?.({ ...session, step: "birthdate", data: { ...session.data, email: input } });
      await sendDm(msg.author, "Got it! What's your birthdate? (MM/DD/YYYY)");
      break;
    }
    case "birthdate": {
      if (!isValidBirthdate(input)) {
        await sendDm(msg.author, "Please use MM/DD/YYYY format (e.g. 01/15/1990):");
        return;
      }
      reg.setRegistrationSession?.({ ...session, step: "pronouns" as const, data: { ...session.data, birthdate: input } });
      await sendDm(msg.author, "Almost there! What are your preferred pronouns? (e.g. she/her, he/him, they/them — or type **skip** to leave blank)");
      break;
    }
    case "pronouns": {
      const pronounsValue = input.toLowerCase() === "skip" ? undefined : input;
      const withPronouns = { ...session, step: "confirm" as const, data: { ...session.data, pronouns: pronounsValue } };
      reg.setRegistrationSession?.(withPronouns);
      const summary = [
        `Name: ${withPronouns.data.name ?? ""}`,
        `Email: ${withPronouns.data.email ?? ""}`,
        `Birthdate: ${withPronouns.data.birthdate ?? ""}`,
        ...(withPronouns.data.pronouns !== undefined ? [`Pronouns: ${withPronouns.data.pronouns}`] : []),
        `Discord: @${session.discordHandle}`,
      ].join("\n");
      await sendDm(msg.author, `Almost done! Here's what I have:\n\n${summary}\n\nReply **yes** to submit, or **cancel** to abort.`);
      break;
    }
    case "confirm": {
      if (input.toLowerCase().startsWith("y")) {
        reg.capturePendingApproval?.({
          channelId: DISCORD_CHANNEL_ID,
          roomId: `dm:${msg.author.id}`,
          channelUserId: msg.author.id,
          displayName: session.data.name ?? session.discordHandle,
          firstMessagePreview: "(registration submitted via DM)",
          registrationData: {
            name: session.data.name,
            email: session.data.email,
            birthdate: session.data.birthdate,
            pronouns: session.data.pronouns,
            discordHandle: session.discordHandle,
          },
        });
        reg.setRegistrationSession?.({ ...session, step: "submitted" });
        await sendDm(msg.author, "Done! Your registration is pending owner approval. You can keep chatting with me in the meantime.");
      } else {
        await sendDm(msg.author, "Got it. Type **yes** when you're ready to submit, or **cancel** to abort.");
      }
      break;
    }
    default:
      break;
  }
}

/** Initiate a registration flow for an unregistered user with an allowed role. */
async function startRegistration(
  msg: {
    author: { id: string; username: string; createDM: () => Promise<{ send: (t: string) => Promise<unknown> }> };
    guildId: string | null;
    member: { displayName: string } | null;
  },
  reg: RegistrationOpts,
): Promise<void> {
  const displayName =
    msg.member?.displayName ??
    (msg.author as { globalName?: string }).globalName ??
    msg.author.username;

  const session: RegistrationSession = {
    sessionId: `discord::${msg.author.id}`,
    channelUserId: msg.author.id,
    discordHandle: msg.author.username,
    guildId: msg.guildId ?? undefined,
    step: "name",
    data: { name: displayName },
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  reg.setRegistrationSession?.(session);
  await sendDm(
    msg.author,
    `Hi! Before I can help with project work, I need to verify your identity.\n\nI have your name as "${displayName}" — reply to confirm or type a different name.\n\n(Reply **cancel** at any time to stop.)`,
  );
}

/**
 * Format a list of ambient log entries as a timestamped conversation preamble.
 * Entries carry an `isOwner` flag (set at log time) so the model can
 * distinguish owner directives from participant messages. Format:
 *   HH:MM [owner] Glenn: directive text
 *   HH:MM [participant] Alice: their question
 */
function formatAmbientPreamble(entries: AmbientEntry[]): string {
  return entries
    .map((e) => {
      const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const role = e.isOwner === true ? "[owner]" : "[participant]";
      return `${time} ${role} ${e.displayName}: ${e.text}`;
    })
    .join("\n");
}

export function createDiscordPlugin(
  config: DiscordConfig,
  opts?: {
    createUser?: CreateUserFn;
    /** Log every raw channel message to the ambient daily session (s189). */
    logMessage?: (channelId: string, entry: AmbientEntry) => void;
    /** Return recent messages from today's ambient log for context injection (s189). */
    getContext?: (channelId: string, limit: number, roomId?: string) => AmbientEntry[];
    /** s194: Check whether a user is verified in the entity store. */
    isEntityVerified?: (channelId: string, userId: string) => Promise<boolean>;
    /** s194: Retrieve an in-progress DM registration session. */
    getRegistrationSession?: (sessionId: string) => RegistrationSession | null;
    /** s194: Persist or update a registration session. */
    setRegistrationSession?: (session: RegistrationSession) => void;
    /** s194: Remove a session (cancelled or submitted). */
    deleteRegistrationSession?: (sessionId: string) => void;
    /** s194: Capture a pending approval record from the registration flow. */
    capturePendingApproval?: (input: PendingApprovalCaptureInput) => void;
    /**
     * Return the owner entity's Discord authorId (channelUserId), if known.
     * When provided, ambient log entries are tagged with `isOwner: true/false`
     * so the model can distinguish owner directives from participant messages.
     */
    getOwnerChannelUserId?: (channelId: string) => string | undefined;
  },
): AionimaChannelPlugin & {
  __client: Client;
  __config: DiscordConfig;
  getExtendedState: () => Record<string, unknown>;
} {
  if (!isDiscordConfig(config)) {
    throw new Error("Invalid Discord config: botToken is required");
  }

  // GuildMembers and GuildPresences are PRIVILEGED intents — discord.js will
  // fail to connect (4014 Disallowed Intents) if they're requested without the
  // matching portal toggle turned ON at:
  // https://discord.com/developers/applications/<applicationId>/bot
  //
  // GuildMembers: controlled by config.enableServerMembersIntent (default off).
  // GuildPresences: disabled until explicitly needed — enable portal toggle first.
  const baseIntents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ];
  if (config.enableServerMembersIntent) {
    baseIntents.push(GatewayIntentBits.GuildMembers);
  }
  const client = new Client({ intents: baseIntents });

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

    // s194: Intercept DMs for active registration sessions before any guild checks.
    // Users completing registration always DM the bot — their guildId is null here.
    if (msg.guildId === null && opts?.getRegistrationSession) {
      const session = opts.getRegistrationSession(`discord::${msg.author.id}`);
      if (session !== null && session.step !== "submitted" && session.step !== "cancelled") {
        await handleRegistrationDm(msg, session, opts);
        return;
      }
    }

    // Guild scope (always enforced)
    if (!isGuildAllowed(msg.guildId, normalizeDiscordArrayField(config.allowedGuildIds))) return;

    // Channel mode: Off (ignore completely) / Monitor (read, no AI) / Respond (full pipeline)
    // If neither list is configured → legacy open-access: treat everything as Respond.
    const configuredAllowed = normalizeDiscordArrayField(config.allowedChannelIds);
    const configuredPresence = normalizeDiscordArrayField(config.presenceChannelIds);
    const hasExplicitChannels = configuredAllowed.length > 0 || configuredPresence.length > 0;
    const isRespondChannel = !hasExplicitChannels || configuredAllowed.includes(msg.channelId);
    const isMonitorChannel =
      hasExplicitChannels && !isRespondChannel && configuredPresence.includes(msg.channelId);
    // Off channel — drop completely
    if (hasExplicitChannels && !isRespondChannel && !isMonitorChannel) return;

    // Ambient log — record every message from configured channels regardless of
    // mode or mention so Aion can wake up with today's conversation context (s189).
    // isOwner is tagged at write time so historical entries loaded from disk
    // carry the flag and formatAmbientPreamble can label them correctly.
    if (opts?.logMessage) {
      const ownerUserId = opts.getOwnerChannelUserId?.(DISCORD_CHANNEL_ID);
      opts.logMessage(DISCORD_CHANNEL_ID, {
        ts: new Date().toISOString(),
        authorId: msg.author.id,
        displayName: buildDisplayName(msg),
        text: msg.content,
        roomId: msg.guildId !== null ? `${msg.guildId}:${msg.channelId}` : `dm:${msg.author.id}`,
        isOwner: ownerUserId !== undefined ? msg.author.id === ownerUserId : undefined,
      });
    }

    // Monitor channels: track context + user registration, but skip AI routing entirely
    if (isMonitorChannel) {
      replyChannelMap.set(msg.author.id, msg.channelId);
      if (opts?.createUser) {
        await opts.createUser("discord", msg.author.id, {
          displayName: buildDisplayName(msg),
          username: msg.author.username,
        }).catch(() => { /* non-critical */ });
      }
      return;
    }

    // --- Respond channel: full pipeline below ---

    // Role allowlist — guild messages only (DMs bypass the role check)
    const allowedRoleIds = normalizeDiscordArrayField(config.allowedRoleIds);
    if (allowedRoleIds.length > 0 && msg.guildId !== null && msg.guild) {
      const member = await msg.guild.members.fetch(msg.author.id).catch(() => null);
      const memberRoleIds = member ? [...member.roles.cache.keys()] : [];
      if (!isRoleAllowed(memberRoleIds, allowedRoleIds)) {
        // Send a DM explaining access is restricted
        try {
          const dm = await msg.author.createDM();
          await dm.send(
            "You don't have the required role to speak to Aionima in this server. " +
              "Contact a server administrator if you believe this is an error.",
          );
        } catch {
          // DMs may be disabled — best-effort only
        }
        return;
      }
    }

    // s194: Registration flow — for users who have an allowed role but are not yet verified.
    // Only applies when allowedRoleIds are configured (role-gated server).
    // allowedRoleIds is already defined above in the role-check block.
    if (
      allowedRoleIds.length > 0 &&
      msg.guildId !== null &&
      opts?.isEntityVerified &&
      opts?.getRegistrationSession
    ) {
      const isVerified = await opts.isEntityVerified(DISCORD_CHANNEL_ID, msg.author.id);
      if (!isVerified) {
        const sessionId = `discord::${msg.author.id}`;
        const session = opts.getRegistrationSession(sessionId);
        if (session === null) {
          // No session — offer registration only when user @-mentions the bot
          const isMentioned = client.user !== null && msg.mentions.has(client.user);
          if (isMentioned) {
            await startRegistration(msg, opts);
          }
          return; // Don't route to Aion until registered
        }
        if (session.step !== "submitted") {
          // Active registration in DMs — drop guild message silently
          return;
        }
        // step === "submitted": pending owner approval — allow routing without project scope
      }
    }

    // Mention filter: in guild channels, only respond to @mentions, replies,
    // or messages that call the bot by username / the "aion" alias.
    const mentionOnly = config.mentionOnly ?? true;
    if (mentionOnly && msg.guildId !== null) {
      const isMentioned = client.user !== null && msg.mentions.has(client.user);
      const isReply = msg.reference !== null;
      const botUsername = client.user?.username ?? "";
      const namePattern = new RegExp(
        `\\b(aion|${botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`,
        "i"
      );
      const isNameCalled = namePattern.test(msg.content);
      if (!isMentioned && !isReply && !isNameCalled) return;
    }

    // Strip bot mention from content before normalizing
    if (client.user) {
      msg.content = msg.content
        .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
        .trim();
    }

    // Resolve user/role/channel mention tags to human-readable names (s193)
    if (msg.guild !== null) {
      msg.content = resolveDiscordMentions(msg.content, msg.guild);
    }

    // Track the author→channel mapping for outbound replies
    replyChannelMap.set(msg.author.id, msg.channelId);

    const normalized = normalizeMessage(msg);
    if (normalized === null) return;

    // On-message user registration — ensure sender has a pending AGI account
    if (opts?.createUser) {
      await opts.createUser("discord", msg.author.id, {
        displayName: buildDisplayName(msg),
        username: msg.author.username,
      }).catch(() => { /* non-critical — DB errors must not block message delivery */ });
    }

    // When allowedRoleIds are configured, the role check above already verified
    // this sender. Signal the inbound-router to skip the pairing gate so
    // role-approved guild members don't see "pairing code / owner approval".
    let normalizedWithMeta = allowedRoleIds.length > 0
      ? { ...normalized, metadata: { ...normalized.metadata, bypassPairingGate: true } }
      : normalized;

    // Inject today's ambient context as a preamble so Aion wakes up knowing
    // what the channel has been discussing (s189). Prepended to the message
    // text so it flows through the existing agent pipeline without changes.
    if (opts?.getContext && normalizedWithMeta.content.type === "text") {
      // Scope the injected preamble to THIS channel/room. The ambient log is
      // provider-keyed (one daily file for all Discord channels), so without the
      // roomId filter one channel's conversation bleeds into another's prompt
      // (e.g. #Leadership topics surfacing in #water-cooler).
      const myRoom = msg.guildId !== null ? `${msg.guildId}:${msg.channelId}` : `dm:${msg.author.id}`;
      const recent = opts.getContext(DISCORD_CHANNEL_ID, 30, myRoom);
      if (recent.length > 0) {
        const preamble = `[Today's channel conversation]\n${formatAmbientPreamble(recent)}\n\n---\n`;
        normalizedWithMeta = {
          ...normalizedWithMeta,
          content: { type: "text", text: preamble + normalizedWithMeta.content.text },
        };
      }
    }

    await messageHandler(normalizedWithMeta);
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

    // Proactive member sync — only when Server Members Intent is enabled.
    // guild.members.fetch() requires GuildMembers intent; without it the call
    // throws. Skip sync silently when the intent is not configured.
    if (opts?.createUser && config.enableServerMembersIntent) {
      const createUser = opts.createUser;
      const allowedRoleIds = normalizeDiscordArrayField(config.allowedRoleIds);
      void (async () => {
        for (const guild of client.guilds.cache.values()) {
          try {
            const members = await guild.members.fetch();
            for (const member of members.values()) {
              if (member.user.bot) continue;
              if (
                allowedRoleIds.length > 0 &&
                !isRoleAllowed([...member.roles.cache.keys()], allowedRoleIds)
              ) continue;
              await createUser("discord", member.user.id, {
                displayName: member.displayName,
                username: member.user.username,
              }).catch(() => { /* non-critical per member */ });
            }
          } catch (err) {
            console.warn(
              `[discord] proactive member sync failed for guild ${guild.name}:`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
        console.log("[discord] proactive member sync complete");
      })();
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
        // Skip re-login when the shared client was already connected by the v2
        // protocol path (buildProtocol). This makes legacy start() safe to call
        // after v2 has already authenticated the bot.
        if (!client.isReady()) {
          await client.login(config.botToken);
        }
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

    // Exposes live guild/channel/role state through the gateway's standard
    // GET /api/channels/:id/state endpoint (server-runtime-state.ts:974).
    // The plugin-registered route at /api/channels/discord/state takes
    // precedence in practice; this is for completeness + future callers.
    getExtendedState: (): Record<string, unknown> =>
      getDiscordState(client) as unknown as Record<string, unknown>,

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

    // Register a config-only stub when botToken is absent so that
    // Settings → Channels can render the credential field for initial setup.
    if (!isDiscordConfig(channelConfig.config)) {
      api.getLogger().warn("discord: botToken not configured — registering stub until credentials are saved");
      api.registerChannel({
        id: DISCORD_CHANNEL_ID,
        meta: { name: "Discord", version: "0.0.0" },
        capabilities: { text: false, media: false, voice: false, reactions: false, threads: false, ephemeral: false },
        config: createConfigAdapter(),
        gateway: { start: async () => {}, stop: async () => {}, isRunning: () => false },
        outbound: { send: async () => {} },
        messaging: { onMessage: () => {} },
      });
      return;
    }

    // Coerce string-serialized booleans/numbers from the dashboard form
    // (form state is Record<string,string> so mentionOnly:"true", rateLimitPerMinute:"20" etc.)
    const discordConfig = coerceDiscordConfig(channelConfig.config as Record<string, unknown>);

    const createUser = api.getOrCreateChannelUser?.bind(api);
    const logMessage = api.logAmbientMessage?.bind(api);
    const getContext = api.getAmbientContext?.bind(api);
    const isEntityVerified = api.isEntityVerified?.bind(api);
    const getRegistrationSession = api.getRegistrationSession?.bind(api);
    const setRegistrationSession = api.setRegistrationSession?.bind(api);
    const deleteRegistrationSession = api.deleteRegistrationSession?.bind(api);
    const capturePendingApproval = api.capturePendingApproval?.bind(api);
    const getOwnerChannelUserId = api.getOwnerChannelUserId?.bind(api);
    const plugin = createDiscordPlugin(
      discordConfig,
      {
        ...(createUser ? { createUser } : {}),
        ...(logMessage ? { logMessage } : {}),
        ...(getContext ? { getContext } : {}),
        ...(isEntityVerified ? { isEntityVerified } : {}),
        ...(getRegistrationSession ? { getRegistrationSession } : {}),
        ...(setRegistrationSession ? { setRegistrationSession } : {}),
        ...(deleteRegistrationSession ? { deleteRegistrationSession } : {}),
        ...(capturePendingApproval ? { capturePendingApproval } : {}),
        ...(getOwnerChannelUserId ? { getOwnerChannelUserId } : {}),
      },
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
