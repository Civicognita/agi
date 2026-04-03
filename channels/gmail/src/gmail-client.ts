import { Auth, google, type gmail_v1 } from "googleapis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GmailClientConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GmailRawMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: string;
  payload: gmail_v1.Schema$MessagePart;
}

export interface PollResult {
  messages: GmailRawMessage[];
  latestHistoryId: string | null;
}

// ---------------------------------------------------------------------------
// Gmail API client wrapper
// ---------------------------------------------------------------------------

export class GmailClient {
  private readonly gmail: gmail_v1.Gmail;
  private readonly auth: InstanceType<typeof Auth.OAuth2Client>;

  constructor(config: GmailClientConfig) {
    this.auth = new Auth.OAuth2Client(config.clientId, config.clientSecret);
    this.auth.setCredentials({ refresh_token: config.refreshToken });
    this.gmail = google.gmail({ version: "v1", auth: this.auth });
  }

  /** Verify connectivity by fetching the authenticated user's profile. */
  async healthCheck(): Promise<{ email: string; historyId: string }> {
    const res = await this.gmail.users.getProfile({ userId: "me" });
    return {
      email: res.data.emailAddress ?? "",
      historyId: res.data.historyId ?? "",
    };
  }

  /**
   * Poll for new messages.
   *
   * First call (no historyId): uses messages.list with `newer_than` + `is:unread`.
   * Subsequent calls: uses history.list for incremental changes since last historyId.
   */
  async pollNewMessages(
    sinceHistoryId: string | null,
    maxAgeMinutes: number,
    label: string,
  ): Promise<PollResult> {
    if (sinceHistoryId !== null) {
      return this.pollViaHistory(sinceHistoryId, label);
    }
    return this.pollViaList(maxAgeMinutes, label);
  }

  /** Initial poll: list unread messages newer than maxAgeMinutes. */
  private async pollViaList(
    maxAgeMinutes: number,
    label: string,
  ): Promise<PollResult> {
    const query = `is:unread newer_than:${String(maxAgeMinutes)}m in:${label}`;
    const res = await this.gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 20,
    });

    const messageRefs = res.data.messages ?? [];
    const messages = await this.fetchFullMessages(
      messageRefs.map((m) => m.id!).filter(Boolean),
    );

    // Determine latest historyId from the fetched messages or profile
    let latestHistoryId: string | null = null;
    if (messages.length > 0) {
      // Get profile for the current historyId
      const profile = await this.gmail.users.getProfile({ userId: "me" });
      latestHistoryId = profile.data.historyId ?? null;
    }

    return { messages, latestHistoryId };
  }

  /** Incremental poll: use history.list to get only changes since last check. */
  private async pollViaHistory(
    startHistoryId: string,
    label: string,
  ): Promise<PollResult> {
    try {
      const res = await this.gmail.users.history.list({
        userId: "me",
        startHistoryId,
        labelId: label === "INBOX" ? "INBOX" : undefined,
        historyTypes: ["messageAdded"],
      });

      const history = res.data.history ?? [];
      const latestHistoryId = res.data.historyId ?? startHistoryId;

      // Collect message IDs from added messages
      const messageIds = new Set<string>();
      for (const record of history) {
        for (const added of record.messagesAdded ?? []) {
          const id = added.message?.id;
          if (id) messageIds.add(id);
        }
      }

      const messages = await this.fetchFullMessages([...messageIds]);
      return { messages, latestHistoryId };
    } catch (err: unknown) {
      // historyId expired or invalid — fall back to list-based poll
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: number }).code === 404
      ) {
        console.warn("[email] historyId expired, falling back to list poll");
        return this.pollViaList(5, label);
      }
      throw err;
    }
  }

  /** Fetch full message details for a list of message IDs. */
  private async fetchFullMessages(messageIds: string[]): Promise<GmailRawMessage[]> {
    const results: GmailRawMessage[] = [];

    for (const id of messageIds) {
      try {
        const res = await this.gmail.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });

        const data = res.data;
        if (data.id && data.threadId && data.payload) {
          results.push({
            id: data.id,
            threadId: data.threadId,
            labelIds: data.labelIds ?? [],
            internalDate: data.internalDate ?? "0",
            payload: data.payload,
          });
        }
      } catch (err) {
        console.warn(
          `[email] failed to fetch message ${id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return results;
  }

  /**
   * Send an email message.
   *
   * @param to - Recipient email address.
   * @param subject - Email subject line.
   * @param body - Plain text body.
   * @param threadId - Gmail thread ID for threading (optional).
   * @param inReplyTo - Message-ID header of the message being replied to.
   * @param references - References header chain for threading.
   */
  async sendMessage(
    to: string,
    subject: string,
    body: string,
    threadId?: string,
    inReplyTo?: string,
    references?: string,
  ): Promise<string> {
    const from = (await this.gmail.users.getProfile({ userId: "me" })).data
      .emailAddress;
    const mimeMessage = buildMimeMessage(
      from ?? "",
      to,
      subject,
      body,
      inReplyTo,
      references,
    );

    const encodedMessage = Buffer.from(mimeMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
        threadId: threadId ?? undefined,
      },
    });

    return res.data.id ?? "";
  }

  /** Remove the UNREAD label from a message. */
  async markAsRead(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        removeLabelIds: ["UNREAD"],
      },
    });
  }
}

// ---------------------------------------------------------------------------
// MIME message builder
// ---------------------------------------------------------------------------

/**
 * Build an RFC 2822 MIME message string.
 * Pure function — no side effects, easy to test.
 */
export function buildMimeMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
  inReplyTo?: string,
  references?: string,
): string {
  const lines: string[] = [
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
  ];

  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
  }
  if (references) {
    lines.push(`References: ${references}`);
  }

  lines.push("", body);
  return lines.join("\r\n");
}
