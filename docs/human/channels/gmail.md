# Gmail Adapter (OAuth2)

The Gmail adapter connects Aionima to Gmail using the Google OAuth2 API. It polls your inbox for new messages and sends replies via the Gmail API. The adapter reads email threads and maintains conversation context across multiple emails in the same thread.

---

## Setting Up Gmail API Access

### Step 1 — Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click "New Project", give it a name, and click "Create".
3. In the left menu, go to "APIs & Services" → "Library".
4. Search for "Gmail API" and click "Enable".

### Step 2 — Create OAuth2 Credentials

1. Go to "APIs & Services" → "Credentials".
2. Click "Create Credentials" → "OAuth client ID".
3. If prompted, configure the OAuth consent screen first:
   - User type: "External" (or "Internal" if using Google Workspace).
   - Add your email to test users.
4. Application type: "Desktop app".
5. Click "Create" and download the credentials JSON.

From the downloaded JSON, copy:
- `client_id`
- `client_secret`

### Step 3 — Generate a Refresh Token

You need a refresh token that grants ongoing access to your Gmail account. Use the OAuth2 playground or run a one-time authorization flow.

Using the Google OAuth2 Playground:

1. Go to [Google OAuth2 Playground](https://developers.google.com/oauthplayground/).
2. Click the settings gear (top right) → check "Use your own OAuth credentials".
3. Enter your client ID and client secret.
4. In the left panel, select Gmail API v1 → select scope `https://www.googleapis.com/auth/gmail.modify`.
5. Click "Authorize APIs" and complete the authorization.
6. Click "Exchange authorization code for tokens".
7. Copy the `refresh_token` from the response.

---

## Configuration

Add to `aionima.json`:

```json
{
  "channels": [
    {
      "id": "gmail",
      "enabled": true,
      "config": {
        "clientId": "$ENV{GMAIL_CLIENT_ID}",
        "clientSecret": "$ENV{GMAIL_CLIENT_SECRET}",
        "refreshToken": "$ENV{GMAIL_REFRESH_TOKEN}"
      }
    }
  ],
  "owner": {
    "channels": {
      "gmail": "youraddress@gmail.com"
    }
  }
}
```

Add to `.env`:

```bash
GMAIL_CLIENT_ID=123456789-xxxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxx
GMAIL_REFRESH_TOKEN=1//xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Config Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientId` | string | Yes | OAuth2 client ID from Google Cloud Console |
| `clientSecret` | string | Yes | OAuth2 client secret |
| `refreshToken` | string | Yes | OAuth2 refresh token with gmail.modify scope |
| `pollIntervalMs` | number | No | How often to check for new mail (default: 30000 ms) |
| `maxResults` | number | No | Max messages to fetch per poll (default: 10) |
| `labelFilter` | string | No | Only process messages with this Gmail label |

---

## How Email Threads Work

The adapter processes email using Gmail's thread model. Each thread has a unique thread ID. When a user sends an email:

1. The adapter polls for new, unread messages with the `INBOX` label.
2. For each new message, it looks up the thread to get the conversation context.
3. The normalized `AionimaMessage` includes a `threadId` field.
4. The agent session is keyed on the thread ID, maintaining conversation context across multiple emails in the same thread.
5. Replies are sent as replies within the same thread using the `In-Reply-To` and `References` headers.

After processing a message, the adapter marks it as read (`UNREAD` label removed) to prevent re-processing on the next poll.

---

## Supported Message Types

| Type | Inbound | Outbound | Notes |
|------|---------|---------|-------|
| Plain text | Yes | Yes | |
| HTML email | Yes (converted to text) | Yes | Outbound uses HTML formatting |
| Attachments | Yes (metadata only) | No | Attachment URLs are provided but files are not downloaded |
| Reply | Yes | Yes | Maintains thread context |

Email subjects are included in the inbound message content. The agent can reference the subject when composing replies.

---

## Label Filtering

To avoid processing all email (newsletters, notifications, etc.), you can configure a label filter. Only emails tagged with that label will be processed.

In Gmail, create a filter that applies a custom label (e.g. "Aionima") to emails from specific senders or matching specific criteria. Then set `labelFilter: "Aionima"` in the channel config.

---

## Token Refresh

The adapter automatically refreshes the access token using the refresh token before making API calls. Access tokens expire after one hour; the adapter handles rotation transparently.

If the refresh token becomes invalid (e.g. the OAuth consent was revoked), the adapter will log an auth error and stop polling. You will need to generate a new refresh token following the setup steps above.

---

## Troubleshooting

### "Invalid Credentials" or "Token Expired"

- Check that the `GMAIL_REFRESH_TOKEN` in `.env` is correct and not expired.
- Verify the client ID and client secret match the downloaded credentials JSON.
- Ensure the Gmail API is enabled for your Google Cloud project.

### No Emails Are Being Processed

- Confirm the inbox has unread messages.
- Check if a `labelFilter` is configured — emails without that label are skipped.
- Check `logs/gateway.log` for errors from the Gmail adapter.
- Verify the adapter is in "running" state in the dashboard (Communication → Gmail).

### Replies Are Not Threaded Correctly

Gmail threads messages based on the `Subject` header and `References` headers. If the subject changes mid-thread, Gmail may start a new thread. The adapter uses the Gmail thread ID, not subject-based threading, so this is handled correctly on the API side.

### Gmail API Quota Exceeded

The Gmail API has a daily quota (typically 1 billion units per day for standard apps). The poll-based approach uses the `messages.list` and `messages.get` methods, which cost a small number of units per call. If you are approaching quota limits, increase `pollIntervalMs` to poll less frequently.

### OAuth Consent Screen in "Testing" Mode

If your OAuth consent screen is in "Testing" mode, refresh tokens expire after 7 days. Publish the consent screen to production to get non-expiring refresh tokens. Note that publishing requires completing Google's verification process for external apps.
