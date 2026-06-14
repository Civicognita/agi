/**
 * AES-256-GCM encrypt/decrypt for OAuth token storage.
 *
 * Tokens from OAuth providers (GitHub, Google, Discord) are stored encrypted
 * in the `connections` table. The key is sourced from gateway.json
 * `encryptionKey` (64-char hex = 32 bytes). If missing, one is auto-generated
 * and persisted on first use so tokens survive restarts.
 *
 * Wire format: `${ivHex}:${authTagHex}:${ciphertextHex}` — same as the
 * format used by the local-ID service before absorption, so existing rows
 * in the connections table remain readable without migration.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the AES-256-GCM encryption key from gateway.json.
 * Auto-generates a 32-byte random key and persists it if one isn't configured.
 * The key is intentionally stable — rotating it would invalidate all stored tokens.
 */
export function resolveEncryptionKey(configPath: string): Buffer {
  try {
    const raw = readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    const hex = cfg.encryptionKey as string | undefined;

    if (hex) {
      const key = Buffer.from(hex, "hex");
      if (key.length === 32) return key;
      // Wrong length — fall through to regenerate
    }

    // Not set or invalid — generate and persist.
    const generated = randomBytes(32).toString("hex");
    cfg.encryptionKey = generated;
    writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf-8");
    return Buffer.from(generated, "hex");
  } catch {
    // Config unreadable — return ephemeral key (tokens won't survive restart
    // but won't crash either). Caller can log a warning.
    return randomBytes(32);
  }
}

// ---------------------------------------------------------------------------
// Encrypt / Decrypt
// ---------------------------------------------------------------------------

export function encryptToken(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptToken(key: Buffer, ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");

  const [ivHex, authTagHex, encHex] = parts;
  const iv = Buffer.from(ivHex!, "hex");
  const authTag = Buffer.from(authTagHex!, "hex");
  const encrypted = Buffer.from(encHex!, "hex");

  if (iv.length !== IV_LENGTH) throw new Error("Invalid IV length");
  if (authTag.length !== AUTH_TAG_LENGTH) throw new Error("Invalid auth tag length");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
