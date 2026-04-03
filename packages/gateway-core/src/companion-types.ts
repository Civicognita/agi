/**
 * iOS Companion Types — Task #182
 *
 * Gateway-side types for the iOS companion node.
 * The companion is a sensor + notification surface — NOT a standalone agent.
 *
 * Pairing flow:
 *   1. Gateway generates 6-digit pairing code
 *   2. User enters code on iOS app
 *   3. App sends code + device info via WebSocket
 *   4. Gateway validates and creates pairing record
 *   5. All future WS messages authenticated via pairing token
 *
 * Push notifications:
 *   - APNs via expo-notifications managed push
 *   - Gateway emits notification when $imp events occur
 *   - App receives and displays as native iOS notification
 */

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

/** 6-digit pairing code with expiration. */
export interface PairingCode {
  code: string; // 6 digits
  entityId: string;
  createdAt: string;
  expiresAt: string;
}

/** Paired companion device. */
export interface CompanionDevice {
  id: string;
  entityId: string;
  deviceName: string;
  platform: "ios" | "android";
  pushToken: string | null;
  lastSeenAt: string;
  pairedAt: string;
  status: "active" | "revoked";
}

/** Pairing request from the companion app. */
export interface PairingRequest {
  code: string;
  deviceName: string;
  platform: "ios" | "android";
  pushToken?: string;
}

/** Pairing result. */
export interface PairingResult {
  success: boolean;
  device?: CompanionDevice;
  sessionToken?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Push notification payload sent to the companion. */
export interface CompanionNotification {
  type: CompanionNotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export type CompanionNotificationType =
  | "imp_mint"      // New $imp recorded
  | "seal_issued"   // Entity sealed
  | "seal_revoked"  // Seal revoked
  | "message"       // New message from agent
  | "verification"  // Verification status change
  | "system";       // System notification

// ---------------------------------------------------------------------------
// WebSocket messages (companion ↔ gateway)
// ---------------------------------------------------------------------------

/** Messages from companion to gateway. */
export type CompanionToGateway =
  | { type: "pair"; payload: PairingRequest }
  | { type: "voice_input"; payload: VoiceInputPayload }
  | { type: "camera_input"; payload: CameraInputPayload }
  | { type: "push_token_update"; payload: { pushToken: string } }
  | { type: "ping" };

/** Messages from gateway to companion. */
export type GatewayToCompanion =
  | { type: "pair_result"; payload: PairingResult }
  | { type: "notification"; payload: CompanionNotification }
  | { type: "agent_message"; payload: { text: string; canvasId?: string } }
  | { type: "pong" };

// ---------------------------------------------------------------------------
// Sensor payloads
// ---------------------------------------------------------------------------

export interface VoiceInputPayload {
  /** Base64-encoded audio data. */
  audioData: string;
  /** Audio format (e.g., "wav", "m4a", "opus"). */
  format: string;
  /** Duration in seconds. */
  duration: number;
}

export interface CameraInputPayload {
  /** Base64-encoded image data. */
  imageData: string;
  /** Image format (e.g., "jpeg", "png"). */
  format: string;
  /** Image dimensions. */
  width: number;
  height: number;
}
