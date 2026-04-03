/**
 * Field-level encryption for PII/PHI data at rest.
 *
 * Uses AES-256-GCM with a 12-byte IV. Encrypted values are stored as
 * "enc:v1:<iv-hex>:<ciphertext-hex>:<tag-hex>" so they're distinguishable
 * from plaintext in the database.
 *
 * Compliance: HIPAA encryption guidance, PCI DSS Req 3, GDPR Art 32.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const PREFIX = "enc:v1:";

export interface CryptoProvider {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
  isEncrypted(value: string): boolean;
}

/**
 * Create a CryptoProvider from a 32-byte key (hex or Buffer).
 * If no key is provided, returns a passthrough provider (no encryption).
 */
export function createCryptoProvider(key?: string | Buffer): CryptoProvider {
  if (!key) return passthroughProvider;

  const keyBuf = typeof key === "string" ? Buffer.from(key, "hex") : key;
  if (keyBuf.length !== 32) {
    throw new Error(`Encryption key must be 32 bytes, got ${String(keyBuf.length)}`);
  }

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGO, keyBuf, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${PREFIX}${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
    },

    decrypt(ciphertext: string): string {
      if (!ciphertext.startsWith(PREFIX)) return ciphertext;
      const parts = ciphertext.slice(PREFIX.length).split(":");
      if (parts.length !== 3) return ciphertext;
      const [ivHex, dataHex, tagHex] = parts as [string, string, string];
      const decipher = createDecipheriv(ALGO, keyBuf, Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      return decipher.update(Buffer.from(dataHex, "hex")) + decipher.final("utf8");
    },

    isEncrypted(value: string): boolean {
      return value.startsWith(PREFIX);
    },
  };
}

const passthroughProvider: CryptoProvider = {
  encrypt: (v) => v,
  decrypt: (v) => v,
  isEncrypted: () => false,
};
