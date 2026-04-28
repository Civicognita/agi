/**
 * MFA — TOTP-based two-factor authentication (RFC 6238).
 *
 * Compliance: UCS-IAM-01 (PCI 8.4.2 MFA, HIPAA access controls, SOC 2 CC6).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 8;

// ---------------------------------------------------------------------------
// TOTP Core (RFC 6238 / RFC 4226)
// ---------------------------------------------------------------------------

function hmacSha1(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha1", key).update(data).digest();
}

function dynamicTruncate(hmacResult: Buffer): number {
  const offset = hmacResult[hmacResult.length - 1]! & 0x0f;
  return (
    ((hmacResult[offset]! & 0x7f) << 24) |
    ((hmacResult[offset + 1]! & 0xff) << 16) |
    ((hmacResult[offset + 2]! & 0xff) << 8) |
    (hmacResult[offset + 3]! & 0xff)
  );
}

/** Generate a TOTP code for the given secret and time. */
export function generateTOTP(secret: Buffer, time?: number): string {
  const counter = Math.floor((time ?? Date.now() / 1000) / TOTP_PERIOD);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = hmacSha1(secret, counterBuf);
  const code = dynamicTruncate(hmac) % Math.pow(10, TOTP_DIGITS);
  return String(code).padStart(TOTP_DIGITS, "0");
}

/** Verify a TOTP code with ±1 window tolerance. */
export function verifyTOTP(secret: Buffer, code: string): boolean {
  const now = Date.now() / 1000;
  for (const offset of [-1, 0, 1]) {
    const expected = generateTOTP(secret, now + offset * TOTP_PERIOD);
    if (timingSafeEqual(Buffer.from(code), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Secret and recovery code generation
// ---------------------------------------------------------------------------

/** Generate a random TOTP secret (20 bytes = 160 bits). */
export function generateTOTPSecret(): Buffer {
  return randomBytes(20);
}

/** Encode a TOTP secret as base32 (for QR code URIs). */
export function encodeBase32(buf: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of buf) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let result = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    result += alphabet[parseInt(chunk, 2)]!;
  }
  return result;
}

/** Build an otpauth:// URI for QR code generation. */
export function buildTOTPUri(secret: Buffer, account: string, issuer = "Aionima"): string {
  const encoded = encodeBase32(secret);
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${encoded}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${String(TOTP_DIGITS)}&period=${String(TOTP_PERIOD)}`;
}

/** Generate recovery codes (one-time use backup codes). */
export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    codes.push(randomBytes(RECOVERY_CODE_LENGTH / 2).toString("hex"));
  }
  return codes;
}

/** Hash a recovery code for storage. */
export function hashRecoveryCode(code: string): string {
  return createHmac("sha256", "agi-recovery").update(code).digest("hex");
}

// ---------------------------------------------------------------------------
// MFA state (stored in entity_model meta table or separate mfa table)
// ---------------------------------------------------------------------------

export interface MFAEnrollment {
  secret: string; // hex-encoded TOTP secret
  recoveryCodes: string[]; // hashed recovery codes
  enrolledAt: string;
}

export const CREATE_MFA = `
CREATE TABLE IF NOT EXISTS mfa_enrollments (
  entity_id       TEXT NOT NULL PRIMARY KEY,
  totp_secret     TEXT NOT NULL,
  recovery_codes  TEXT NOT NULL DEFAULT '[]',
  enrolled_at     TEXT NOT NULL
)` as const;
