# Signal Adapter

The Signal adapter connects Aionima to Signal via the [signal-cli REST API](https://github.com/bbernhard/signal-cli-rest-api). This requires running a separate signal-cli REST service alongside Aionima. The adapter polls the REST API for new messages and sends replies through the same interface.

---

## Overview

Signal does not provide an official bot API. Aionima uses signal-cli, an unofficial command-line client for Signal, running as a REST API server. This means the Signal integration operates on a real Signal account (a phone number you control), not a bot account.

This approach has implications:
- Messages sent by Aionima appear to come from your Signal account.
- You must register a Signal account with signal-cli using a phone number.
- The phone number used for Aionima should be dedicated to the bot — not your personal number.

---

## Setting Up signal-cli REST API

### Step 1 — Install signal-cli REST API

The recommended method is Docker:

```bash
docker run -d \
  --name signal-api \
  -p 8080:8080 \
  -v $HOME/.local/share/signal-api:/home/.local/share/signal-api \
  -e MODE=native \
  bbernhard/signal-cli-rest-api:latest
```

For a non-Docker install, see the [signal-cli-rest-api releases page](https://github.com/bbernhard/signal-cli-rest-api/releases).

### Step 2 — Register a Phone Number

Signal requires phone number verification. Use a dedicated SIM or a virtual number service.

Register via the REST API:

```bash
# Request verification code (SMS)
curl -X POST "http://localhost:8080/v1/register/+15555550100" \
  -H "Content-Type: application/json" \
  -d '{"use_voice": false}'

# Verify with the code received via SMS
curl -X POST "http://localhost:8080/v1/register/+15555550100/verify/123456"
```

Replace `+15555550100` with your number in E.164 format.

After verification, signal-cli is ready to send and receive messages as that number.

### Step 3 — Test the Connection

```bash
# List registered accounts
curl http://localhost:8080/v1/accounts

# Send a test message
curl -X POST "http://localhost:8080/v2/send" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello from Aionima",
    "number": "+15555550100",
    "recipients": ["+15555550101"]
  }'
```

---

## Configuration

Add to `gateway.json`:

```json
{
  "channels": [
    {
      "id": "signal",
      "enabled": true,
      "config": {
        "apiUrl": "$ENV{SIGNAL_API_URL}",
        "phoneNumber": "$ENV{SIGNAL_PHONE_NUMBER}"
      }
    }
  ],
  "owner": {
    "channels": {
      "signal": "+15555550100"
    }
  }
}
```

Add to `.env`:

```bash
SIGNAL_API_URL=http://localhost:8080
SIGNAL_PHONE_NUMBER=+15555550100
```

The `owner.channels.signal` value is the owner's Signal phone number (not the bot's number).

---

## Config Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiUrl` | string | Yes | Base URL of the signal-cli REST API |
| `phoneNumber` | string | Yes | The bot's Signal phone number (E.164) |
| `pollIntervalMs` | number | No | How often to poll for messages (default: 3000 ms) |

---

## Supported Message Types

| Type | Inbound | Outbound | Notes |
|------|---------|---------|-------|
| Text | Yes | Yes | Plain text only |
| Images | Yes | Yes | Sent as attachments |
| Voice notes | Yes | Yes | Requires voice pipeline enabled |
| Documents | Yes | Yes | Sent as attachments |
| Reactions | Yes (text fallback) | No | Received as emoji text |
| Group messages | Yes | Yes | Groups are addressed by group ID |
| Read receipts | No | No | Not handled by the adapter |

---

## Group Chat Support

Signal groups are addressed by their group ID. When Aionima receives a group message, the sender's phone number is used to look up the entity, but the reply is sent to the group, not the individual.

Group message routing is enabled by default. To restrict Aionima to DMs only, the adapter can be configured with an `allowedSenders` list.

---

## Polling vs. WebSocket

The signal-cli REST API supports both a polling endpoint and a WebSocket connection for receiving messages. The adapter uses WebSocket mode by default when the API URL uses `ws://` or `wss://`. Otherwise it polls the `/v1/receive/{number}` endpoint.

For lower latency, configure the signal-cli REST API to use WebSocket mode:

```bash
# signal-cli-rest-api with WebSocket enabled
docker run -d ... -e MODE=native -e WS=true ...
```

Then set `apiUrl: "ws://localhost:8080"` in the channel config.

---

## Running signal-cli on the Same Host

If signal-cli REST API is running on the same machine as Aionima, the default `http://localhost:8080` URL works without additional configuration. Ensure the signal-cli container starts before Aionima, or Aionima will fail to start the channel and enter the backoff retry loop.

You can add signal-cli as a dependency in the systemd unit file for Aionima if you need ordered startup.

---

## Troubleshooting

### "Connection Refused" on Startup

The signal-cli REST API is not running or not reachable at the configured URL. Verify:

```bash
curl http://localhost:8080/v1/about
```

This should return a JSON response with the signal-cli version.

### Messages Are Not Being Received

- Check that the phone number in the config matches the registered account in signal-cli.
- Verify the adapter is in "running" state in the dashboard.
- Check `logs/gateway.log` for errors from the signal adapter.
- Ensure signal-cli is not in an error state: `docker logs signal-api`.

### "Account Not Found" Error

The phone number is not registered with this signal-cli instance. Re-run the registration steps.

### Messages Received But No Reply Sent

- Confirm `ANTHROPIC_API_KEY` is set in `.env`.
- Confirm the gateway state is ONLINE.
- Check `replyMode` — if `"human-in-loop"`, replies need dashboard approval.

### Signal Identity Changed Warning

If you reinstall signal-cli or move data to a new machine, Signal clients that have previously communicated with your number will see an "identity key changed" safety notice. This is expected and does not affect functionality. Recipients need to verify the new safety number.
