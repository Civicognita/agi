/**
 * Companion Pairing Service — Task #182
 *
 * Manages the pairing lifecycle between the gateway and iOS companion nodes.
 * Pairing codes are 6-digit random numbers valid for 5 minutes.
 */

import { randomInt } from "node:crypto";
import { ulid } from "ulid";
import type {
  PairingCode,
  CompanionDevice,
  PairingRequest,
  PairingResult,
} from "./companion-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TOKEN_BYTES = 32;

// ---------------------------------------------------------------------------
// CompanionPairingService
// ---------------------------------------------------------------------------

export class CompanionPairingService {
  private readonly pendingCodes = new Map<string, PairingCode>();
  private readonly devices = new Map<string, CompanionDevice>();
  private readonly sessionTokens = new Map<string, string>(); // token → deviceId

  // ---------------------------------------------------------------------------
  // Code generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a 6-digit pairing code for an entity.
   * Code expires after 5 minutes.
   */
  generateCode(entityId: string): PairingCode {
    // Clean expired codes
    this.cleanExpiredCodes();

    const code = String(randomInt(100000, 999999));
    const now = new Date();
    const pairingCode: PairingCode = {
      code,
      entityId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CODE_EXPIRY_MS).toISOString(),
    };

    this.pendingCodes.set(code, pairingCode);
    return pairingCode;
  }

  // ---------------------------------------------------------------------------
  // Pairing
  // ---------------------------------------------------------------------------

  /**
   * Attempt to pair a companion device using a pairing code.
   */
  pair(request: PairingRequest): PairingResult {
    this.cleanExpiredCodes();

    const pairingCode = this.pendingCodes.get(request.code);
    if (!pairingCode) {
      return { success: false, error: "Invalid or expired pairing code" };
    }

    // Check expiration
    if (new Date(pairingCode.expiresAt) < new Date()) {
      this.pendingCodes.delete(request.code);
      return { success: false, error: "Pairing code has expired" };
    }

    // Create device record
    const deviceId = ulid();
    const device: CompanionDevice = {
      id: deviceId,
      entityId: pairingCode.entityId,
      deviceName: request.deviceName,
      platform: request.platform,
      pushToken: request.pushToken ?? null,
      lastSeenAt: new Date().toISOString(),
      pairedAt: new Date().toISOString(),
      status: "active",
    };

    this.devices.set(deviceId, device);

    // Generate session token
    const tokenBytes = new Uint8Array(SESSION_TOKEN_BYTES);
    crypto.getRandomValues(tokenBytes);
    const sessionToken = Array.from(tokenBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    this.sessionTokens.set(sessionToken, deviceId);

    // Consume the pairing code
    this.pendingCodes.delete(request.code);

    return { success: true, device, sessionToken };
  }

  // ---------------------------------------------------------------------------
  // Device management
  // ---------------------------------------------------------------------------

  /** Validate a session token and return the associated device. */
  validateSession(sessionToken: string): CompanionDevice | null {
    const deviceId = this.sessionTokens.get(sessionToken);
    if (!deviceId) return null;

    const device = this.devices.get(deviceId);
    if (!device || device.status !== "active") return null;

    // Update last seen
    device.lastSeenAt = new Date().toISOString();
    return device;
  }

  /** Revoke a companion device. */
  revokeDevice(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    device.status = "revoked";

    // Remove session tokens for this device
    for (const [token, id] of this.sessionTokens) {
      if (id === deviceId) {
        this.sessionTokens.delete(token);
      }
    }

    return true;
  }

  /** Get all active devices for an entity. */
  getDevices(entityId: string): CompanionDevice[] {
    return [...this.devices.values()].filter(
      (d) => d.entityId === entityId && d.status === "active",
    );
  }

  /** Update push token for a device. */
  updatePushToken(deviceId: string, pushToken: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;
    device.pushToken = pushToken;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  private cleanExpiredCodes(): void {
    const now = new Date();
    for (const [code, pairingCode] of this.pendingCodes) {
      if (new Date(pairingCode.expiresAt) < now) {
        this.pendingCodes.delete(code);
      }
    }
  }
}
