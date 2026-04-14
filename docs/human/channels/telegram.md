# Telegram Adapter

The Telegram adapter connects Aionima to the Telegram Bot API using the [grammy](https://grammy.dev/) framework. It supports long-polling (default) and can be configured for webhook mode.

---

## Creating a Bot

1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Follow the prompts: choose a name (display name) and a username (must end in `bot`).
4. BotFather replies with your bot token: `123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

Keep this token secret. Anyone with the token can send messages as your bot.

---

## Finding Your Telegram User ID

The owner's Telegram user ID is a numeric string that uniquely identifies your account. To find it:

1. Start a chat with [@userinfobot](https://t.me/userinfobot) or [@getidsbot](https://t.me/getidsbot).
2. Send any message; the bot replies with your user ID.

The user ID looks like `123456789`. It is different from your username.

---

## Configuration

Add the following to `gateway.json`:

```json
{
  "channels": [
    {
      "id": "telegram",
      "enabled": true,
      "config": {
        "botToken": "$ENV{TELEGRAM_BOT_TOKEN}"
      }
    }
  ],
  "owner": {
    "channels": {
      "telegram": "YOUR_NUMERIC_USER_ID"
    }
  }
}
```

Add the secret to `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Config Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `botToken` | string | Yes | Telegram Bot API token from BotFather |
| `allowedUserIds` | string[] | No | Whitelist of user IDs (in addition to owner) |
| `webhookUrl` | string | No | Enable webhook mode. Must be publicly reachable HTTPS URL |
| `webhookPort` | number | No | Port to listen on for webhook (default: same as gateway) |

When `webhookUrl` is not set, the adapter uses long-polling.

---

## Supported Message Types

| Type | Inbound | Outbound | Notes |
|------|---------|---------|-------|
| Text | Yes | Yes | Plain and formatted (Markdown, HTML) |
| Photos | Yes | Yes | Sent as photo with optional caption |
| Documents | Yes | Yes | Any file type |
| Voice messages | Yes | Yes | Requires voice pipeline enabled |
| Stickers | Yes (text fallback) | No | Received as emoji or description |
| Video | Yes | No | Received as media reference |
| Inline keyboard | No | Yes | Reply markup with callback buttons |

### Outbound Formatting

Aionima sends replies using Telegram's `MarkdownV2` parse mode by default. Markdown formatting in the agent's response is preserved — headers become bold, code blocks become monospace.

Special characters (`_`, `*`, `[`, etc.) are automatically escaped in message content to comply with MarkdownV2 syntax requirements.

---

## Inline Keyboard Support

The agent can include inline keyboards in responses using a structured format. When the agent's response includes a `[button text](callback:data)` pattern, the adapter converts it to a Telegram inline keyboard button.

Users can tap inline buttons; their callback data is routed back through the inbound pipeline as a text message with the callback content.

---

## DM Policy and Pairing

By default, `dmPolicy` is `"pairing"`. When an unknown user messages your bot:

1. The adapter receives the message.
2. The `InboundRouter` checks if the sender is the owner or a known paired entity.
3. If neither, the user receives a pairing prompt asking for a code.
4. The owner generates a pairing code via the dashboard or the `pair` command.
5. The user enters the code; they are then registered as a verified entity.

To allow all users without pairing, set `"dmPolicy": "open"` in the owner config. Users are then given unverified-tier access.

---

## Webhook Mode

For production use on a server with a public IP, webhook mode is more efficient than long-polling because Telegram pushes messages to your endpoint rather than you polling for them.

Requirements:
- A publicly reachable HTTPS endpoint with a valid TLS certificate.
- Telegram only sends webhooks to HTTPS on ports 443, 80, 88, or 8443.

To configure:

```json
{
  "channels": [
    {
      "id": "telegram",
      "enabled": true,
      "config": {
        "botToken": "$ENV{TELEGRAM_BOT_TOKEN}",
        "webhookUrl": "https://your-domain.com/webhook/telegram"
      }
    }
  ]
}
```

The adapter registers the webhook with Telegram on startup and mounts the handler at the specified path. Cloudflare quick tunnels (see the project hosting docs) provide a convenient way to expose a local endpoint publicly for testing.

---

## Troubleshooting

### Bot Does Not Reply

- Verify the token is correct: `curl https://api.telegram.org/bot<TOKEN>/getMe`
- Check the channel status in the dashboard (Communication → Telegram).
- Check `logs/gateway.log` for error messages from the telegram adapter.
- Ensure `"enabled": true` in `gateway.json` for the telegram channel.

### "Unauthorized" Error on Startup

The bot token is invalid or has been revoked. Generate a new one with BotFather using `/revoke` on the old bot followed by `/newbot` or `/token`.

### Messages Are Received But No Reply Is Sent

- Confirm the agent config is valid: `pnpm cli config validate`.
- Confirm `ANTHROPIC_API_KEY` (or your chosen provider's key) is set in `.env`.
- Check `replyMode` — if set to `"human-in-loop"`, responses queue in the dashboard awaiting approval.

### Long-Polling Conflict

If another process is also running the same bot with long-polling, Telegram will give conflicting updates to both. Ensure only one Aionima instance is running for a given bot token.

### Gateway State Blocks Responses

The gateway must be in `ONLINE` or `LIMBO` state for the agent to process messages. If the state is `OFFLINE` or `UNKNOWN`, the agent returns a null response. Check the dashboard header for the current state indicator.
