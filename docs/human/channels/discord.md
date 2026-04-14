# Discord Adapter

The Discord adapter connects Aionima to Discord using [discord.js](https://discord.js.org/). It connects to the Discord Gateway WebSocket and responds to direct messages and (optionally) mentions in guild channels.

---

## Creating a Discord Application and Bot

### Step 1 — Create an Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click "New Application".
3. Give it a name and click "Create".

### Step 2 — Create a Bot User

1. In your application, go to the "Bot" section in the left sidebar.
2. Click "Add Bot" then "Yes, do it!".
3. Under "Token", click "Reset Token" and copy the token.

Keep this token secret. Anyone with it can operate your bot.

### Step 3 — Configure Bot Permissions

In the Bot section:

- Enable **Message Content Intent** — required to read message content.
- Enable **Server Members Intent** — required for member-related features.
- Enable **Presence Intent** — optional.

Under "OAuth2 → URL Generator":
- Scope: `bot`, `applications.commands`
- Bot Permissions: `Send Messages`, `Read Messages/View Channels`, `Read Message History`

Copy the generated URL and open it in a browser to invite the bot to your server.

### Step 4 — Find Your Discord User ID

1. In Discord, open Settings → Advanced.
2. Enable "Developer Mode".
3. Right-click your username anywhere and select "Copy ID".

Your user ID is a snowflake (a large number like `123456789012345678`).

---

## Configuration

Add to `gateway.json`:

```json
{
  "channels": [
    {
      "id": "discord",
      "enabled": true,
      "config": {
        "botToken": "$ENV{DISCORD_BOT_TOKEN}"
      }
    }
  ],
  "owner": {
    "channels": {
      "discord": "123456789012345678"
    }
  }
}
```

Add to `.env`:

```bash
DISCORD_BOT_TOKEN=MTIzNDU2Nzg5...
```

---

## Config Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `botToken` | string | Yes | Discord bot token from the Developer Portal |
| `allowedUserIds` | string[] | No | Additional user IDs granted access |
| `guildId` | string | No | Restrict operation to a specific guild |
| `allowMentions` | boolean | No | Respond when bot is @mentioned in a channel |
| `allowDMs` | boolean | No | Respond to direct messages (default: true) |

---

## Supported Message Types

| Type | Inbound | Outbound | Notes |
|------|---------|---------|-------|
| Text | Yes | Yes | Plain and formatted |
| Embeds | No | Yes | Rich embed cards with fields |
| Attachments | Yes | Yes | Files and images |
| Voice messages | Yes | No | Received as attachment reference |
| Reactions | No | Yes | Bot can react to messages |
| Threads | Yes | Yes | Replies stay in thread context |
| Slash commands | Partial | No | Registered via Discord API |

### Rich Embeds

The agent can include embed-formatted output in responses. When the gateway detects a structured embed in the agent's response, discord.js renders it as a Discord embed card with title, description, fields, and optional footer.

---

## DM vs. Mention Behavior

By default, the adapter responds only to direct messages (DMs). The bot's DM inbox is monitored for messages.

If `allowMentions: true` is set, the bot also responds when @mentioned in any channel it has access to in the configured guild. Messages in channels without @mention are ignored.

The DM policy (pairing vs. open) applies to all users who are not registered as the owner.

---

## Slash Commands

Slash commands can be registered with Discord's application commands API. The adapter handles `interactionCreate` events for registered commands and routes them through the agent pipeline.

Slash commands appear in the Discord command palette (type `/` in a channel). They provide a structured interface for predefined queries or actions.

To register a slash command, the bot must be added to a guild with `applications.commands` scope. Commands are registered on startup if configured.

---

## Message Length Limits

Discord has a 2000 character limit per message. If the agent's response exceeds this limit, the adapter automatically splits it into multiple messages while preserving paragraph boundaries where possible.

Long code blocks are sent as file attachments rather than inline text to avoid truncation.

---

## Troubleshooting

### Bot Is Not Online

- Verify the token: the bot should appear with a green "Online" status in your server's member list after a successful connection.
- Check `logs/gateway.log` for errors from the discord adapter.
- Confirm the bot has been invited to the server using the OAuth2 URL Generator with the correct scopes.

### Bot Receives Messages But Does Not Reply

- Confirm `MESSAGE_CONTENT` privileged intent is enabled in the Developer Portal under Bot → Privileged Gateway Intents.
- Confirm `ANTHROPIC_API_KEY` is set in `.env`.
- Check the reply mode — `"human-in-loop"` requires dashboard approval before the reply is sent.

### "Missing Permissions" Error

The bot's role in the guild must have "Send Messages" and "View Channel" permissions in the channels where it operates.

### Rate Limits from Discord

Discord rate limits bots per route. If the adapter is sending many messages quickly, it may hit rate limits and responses will be delayed. The discord.js library handles rate limit headers and queues requests automatically — no action needed on your end.

### Slash Commands Not Appearing

Slash commands may take up to an hour to propagate globally after registration. For development, register commands to a specific guild (instant propagation) by setting `guildId` in the channel config.
