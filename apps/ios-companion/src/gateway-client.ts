/**
 * Gateway WebSocket Client — Task #184
 *
 * Manages the WebSocket connection between the iOS companion and the gateway.
 * Handles pairing, message routing, and reconnection.
 */

// ---------------------------------------------------------------------------
// Types (mirrors gateway-core/companion-types.ts for the client side)
// ---------------------------------------------------------------------------

export interface PairingRequest {
  code: string;
  deviceName: string;
  platform: "ios" | "android";
  pushToken?: string;
}

export interface PairingResult {
  success: boolean;
  sessionToken?: string;
  error?: string;
}

export interface CompanionNotification {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

type CompanionToGateway =
  | { type: "pair"; payload: PairingRequest }
  | { type: "voice_input"; payload: { audioData: string; format: string; duration: number } }
  | { type: "camera_input"; payload: { imageData: string; format: string; width: number; height: number } }
  | { type: "push_token_update"; payload: { pushToken: string } }
  | { type: "ping" };

type GatewayToCompanion =
  | { type: "pair_result"; payload: PairingResult }
  | { type: "notification"; payload: CompanionNotification }
  | { type: "agent_message"; payload: { text: string; canvasId?: string } }
  | { type: "pong" };

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

export interface GatewayClientHandlers {
  onPairResult?: (result: PairingResult) => void;
  onNotification?: (notification: CompanionNotification) => void;
  onAgentMessage?: (message: { text: string; canvasId?: string }) => void;
  onConnectionChange?: (connected: boolean) => void;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class GatewayClient {
  private ws: WebSocket | null = null;
  private sessionToken: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reconnectIntervalMs = 5000;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly gatewayUrl: string,
    private readonly handlers: GatewayClientHandlers,
  ) {}

  /** Connect to the gateway WebSocket. */
  connect(): void {
    const url = this.sessionToken
      ? `${this.gatewayUrl}?token=${this.sessionToken}`
      : this.gatewayUrl;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.handlers.onConnectionChange?.(true);
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as GatewayToCompanion;
        this.handleMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.handlers.onConnectionChange?.(false);
      this.stopPing();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  /** Disconnect from the gateway. */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  /** Send a pairing request. */
  pair(request: PairingRequest): void {
    this.send({ type: "pair", payload: request });
  }

  /** Send voice input to the gateway. */
  sendVoiceInput(audioData: string, format: string, duration: number): void {
    this.send({ type: "voice_input", payload: { audioData, format, duration } });
  }

  /** Send camera input to the gateway. */
  sendCameraInput(imageData: string, format: string, width: number, height: number): void {
    this.send({ type: "camera_input", payload: { imageData, format, width, height } });
  }

  /** Update push notification token. */
  updatePushToken(pushToken: string): void {
    this.send({ type: "push_token_update", payload: { pushToken } });
  }

  /** Set session token (after pairing). */
  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private send(msg: CompanionToGateway): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(msg: GatewayToCompanion): void {
    switch (msg.type) {
      case "pair_result":
        if (msg.payload.sessionToken) {
          this.sessionToken = msg.payload.sessionToken;
        }
        this.handlers.onPairResult?.(msg.payload);
        break;

      case "notification":
        this.handlers.onNotification?.(msg.payload);
        break;

      case "agent_message":
        this.handlers.onAgentMessage?.(msg.payload);
        break;

      case "pong":
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectIntervalMs);
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, 30_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
