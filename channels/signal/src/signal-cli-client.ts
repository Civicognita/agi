// ---------------------------------------------------------------------------
// signal-cli HTTP client wrapper
// ---------------------------------------------------------------------------

export interface SignalCliConfig {
  /** Base URL of the signal-cli REST API (default: "http://localhost:8080"). */
  baseUrl: string;
  /** The registered phone number for the bot account. */
  accountNumber: string;
  /** Request timeout in milliseconds (default: 10000). */
  timeout?: number;
}

export interface SignalAttachment {
  contentType: string;
  filename?: string;
  id: string;
  size: number;
}

export interface SignalMessage {
  envelope: {
    source: string;
    sourceDevice: number;
    timestamp: number;
    dataMessage?: {
      message?: string;
      attachments?: SignalAttachment[];
      quote?: { id: number; author: string; text: string };
      groupInfo?: { groupId: string; type: string };
    };
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * HTTP client wrapper for the signal-cli REST API.
 *
 * Uses Node 22's native `fetch` — no external dependencies.
 * All endpoints follow the signal-cli JSON-RPC-over-HTTP convention.
 */
export class SignalCliClient {
  private readonly baseUrl: string;
  private readonly accountNumber: string;
  private readonly timeout: number;

  constructor(config: SignalCliConfig) {
    // Trim trailing slash for safe URL construction
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.accountNumber = config.accountNumber;
    this.timeout = config.timeout ?? 10_000;
  }

  /** Check if signal-cli is reachable via GET /v1/about. */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/v1/about`,
        { method: "GET" },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Send a text message to a recipient via POST /v2/send.
   * @param recipient - E.164 phone number or group ID.
   * @param message - Text content to send.
   */
  async sendMessage(recipient: string, message: string): Promise<void> {
    const body = {
      message,
      number: this.accountNumber,
      recipients: [recipient],
    };

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/v2/send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `signal-cli sendMessage failed: ${response.status} ${text}`,
      );
    }
  }

  /**
   * Send a message with an attachment via POST /v2/send.
   * @param recipient - E.164 phone number or group ID.
   * @param attachment - URL or base64-encoded attachment data.
   * @param caption - Optional caption for the attachment.
   */
  async sendAttachment(
    recipient: string,
    attachment: string,
    caption?: string,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      number: this.accountNumber,
      recipients: [recipient],
      base64_attachments: [attachment],
    };

    if (caption !== undefined && caption.length > 0) {
      body["message"] = caption;
    }

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/v2/send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `signal-cli sendAttachment failed: ${response.status} ${text}`,
      );
    }
  }

  /**
   * Receive pending messages via GET /v1/receive/{number}.
   * Returns an array of {@link SignalMessage} objects (may be empty).
   */
  async receive(): Promise<SignalMessage[]> {
    const encodedNumber = encodeURIComponent(this.accountNumber);
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/v1/receive/${encodedNumber}`,
      { method: "GET" },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `signal-cli receive failed: ${response.status} ${text}`,
      );
    }

    const data = await response.json();
    return Array.isArray(data) ? (data as SignalMessage[]) : [];
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
