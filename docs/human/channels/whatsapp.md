# WhatsApp Business API Adapter

The WhatsApp adapter connects Aionima to the WhatsApp Business Platform via Meta's Cloud API. It receives messages via a webhook and sends replies through the WhatsApp Business API.

---

## Overview

The WhatsApp Business Platform (formerly WhatsApp Business API) allows businesses to send and receive messages programmatically. To use this adapter, you need:

- A Meta (Facebook) Business account
- A WhatsApp Business account
- A phone number approved for WhatsApp Business API
- A Meta app with WhatsApp product enabled

This is a business-grade integration. Unlike Telegram or Discord, WhatsApp has stricter requirements around business verification and messaging templates.

---

## Setting Up the WhatsApp Business API

### Step 1 — Create a Meta App

1. Go to [Meta for Developers](https://developers.facebook.com/).
2. Click "My Apps" → "Create App".
3. Select "Business" as the app type.
4. Fill in the app name and click "Create App".
5. On the app dashboard, click "Add Product" and select "WhatsApp".

### Step 2 — Get Your Test Phone Number

Meta provides a test phone number for development. Go to WhatsApp → API Setup:

- Your test phone number and phone number ID are shown here.
- You can send up to 1000 messages per day to verified test recipients using the test number.
- For production, you must add and verify your own business phone number.

### Step 3 — Generate an Access Token

In the API Setup section:
- For testing: a temporary access token is shown (valid for 24 hours).
- For production: create a system user in Meta Business Manager and generate a permanent access token.

### Step 4 — Configure the Webhook

WhatsApp uses webhooks to deliver inbound messages to your server.

1. In the app dashboard, go to WhatsApp → Configuration.
2. Under "Webhook", click "Edit".
3. Enter your webhook URL: `https://your-domain.com/webhook/whatsapp`
4. Enter a verification token (any string you choose — you will set this in your config).
5. Click "Verify and Save".
6. Subscribe to the `messages` webhook field.

Your server must be publicly reachable via HTTPS for WhatsApp to deliver webhooks. Use Cloudflare quick tunnels or a reverse proxy for local development.

---

## Configuration

Add to `gateway.json`:

```json
{
  "channels": [
    {
      "id": "whatsapp",
      "enabled": true,
      "config": {
        "accessToken": "$ENV{WHATSAPP_ACCESS_TOKEN}",
        "phoneNumberId": "$ENV{WHATSAPP_PHONE_NUMBER_ID}",
        "verifyToken": "$ENV{WHATSAPP_VERIFY_TOKEN}"
      }
    }
  ],
  "owner": {
    "channels": {
      "whatsapp": "+15555550100"
    }
  }
}
```

Add to `.env`:

```bash
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_VERIFY_TOKEN=my-custom-verify-token
```

The `owner.channels.whatsapp` value is your personal WhatsApp number in E.164 format.

---

## Config Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accessToken` | string | Yes | Meta access token (temporary or permanent) |
| `phoneNumberId` | string | Yes | WhatsApp phone number ID from Meta app setup |
| `verifyToken` | string | Yes | Webhook verification token you chose |
| `apiVersion` | string | No | Graph API version (default: `v17.0`) |
| `businessAccountId` | string | No | WhatsApp Business Account ID |

---

## Supported Message Types

| Type | Inbound | Outbound | Notes |
|------|---------|---------|-------|
| Text | Yes | Yes | Plain text |
| Images | Yes | Yes | JPEG, PNG (max 5 MB) |
| Documents | Yes | Yes | PDF, Office (max 100 MB) |
| Audio | Yes | Yes | MP3, OGG (max 16 MB) |
| Video | Yes | No | Received as media reference |
| Stickers | Yes (metadata) | No | |
| Location | Yes | No | Latitude/longitude received |
| Interactive (buttons) | No | Yes | Button messages and list messages |
| Templates | No | Yes | Pre-approved message templates |
| Reactions | Yes | No | Received as emoji |

---

## Message Templates

WhatsApp restricts outbound messages to new conversations — you can only initiate a conversation using a pre-approved message template. Once the user replies, you can send free-form messages for 24 hours.

Templates must be approved by Meta before use. To send a template message, the agent response must reference the template name and parameters in a structured format.

For inbound-initiated conversations (the user messages first), templates are not required. Replies within 24 hours of the last user message are unrestricted.

---

## 24-Hour Messaging Window

WhatsApp enforces a 24-hour customer service window:
- You can reply freely within 24 hours of the last inbound message.
- After 24 hours, you can only send approved template messages.

The adapter tracks message timestamps and warns in the log when a session is approaching the 24-hour boundary.

---

## Webhook Verification

When you configure the webhook in Meta's portal, Meta sends a GET request with a `hub.verify_token` and `hub.challenge` to your endpoint. The adapter responds to this verification handshake automatically using the `verifyToken` from the config.

The webhook endpoint is mounted at `/webhook/whatsapp` by the gateway when the WhatsApp channel is enabled.

---

## Troubleshooting

### Webhook Verification Fails

- Ensure the gateway is publicly reachable at the webhook URL.
- Confirm the `WHATSAPP_VERIFY_TOKEN` in `.env` matches what you entered in Meta's webhook configuration.
- Check `logs/gateway.log` for the verification request.

### Messages Are Not Delivered

- The access token may be expired. Temporary tokens expire after 24 hours. Use a system user token for production.
- Check the phone number ID is correct.
- Verify the `messages` webhook field is subscribed in your app's webhook configuration.

### "Session Expired" Error from Meta

Your access token has expired. Generate a new one and update `WHATSAPP_ACCESS_TOKEN` in `.env`, then restart the gateway.

### Test Number Recipient Restrictions

With Meta's test phone number, you can only send messages to phone numbers explicitly added as test recipients in the Meta developer portal. Add your personal number there for testing.

### Outside the 24-Hour Window

If a user has not messaged in 24 hours and you attempt to reply, the Meta API returns an error. The agent's response will be logged but not delivered. To re-engage, send a template message.

### HTTPS Required for Webhooks

WhatsApp only delivers webhooks to HTTPS endpoints with a valid TLS certificate. Use Caddy with an automatic TLS certificate, or use Cloudflare Tunnel for local development.
