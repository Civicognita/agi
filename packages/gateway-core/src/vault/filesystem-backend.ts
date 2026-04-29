/**
 * vault/filesystem-backend — non-TPM2 SecretsBackend for dev/test/CI.
 *
 * Production environments use SecretsManager which encrypts via TPM2-sealed
 * `.cred` files (sudo systemd-creds). The test VM (multipass) has no TPM2
 * hardware, so the production path returns "Operation not supported" on
 * every write. This backend writes plaintext blobs to disk with mode 0o600
 * — same SecretsBackend interface, no encryption guarantees.
 *
 * Activation rules (server.ts):
 *   - AIONIMA_TEST_VM=1 or AGI_VAULT_PLAINTEXT=1: use FilesystemSecretsBackend
 *   - `sudo systemd-creds` probe fails at boot: use FilesystemSecretsBackend
 *   - Otherwise: use SecretsManager (real TPM2)
 *
 * Same SecretsBackend interface; only the encryption guarantees differ.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SecretsBackend } from "./storage.js";

export class FilesystemSecretsBackend implements SecretsBackend {
  private readonly secretsDir: string;

  constructor(secretsDir: string) {
    this.secretsDir = secretsDir;
    if (!existsSync(this.secretsDir)) {
      mkdirSync(this.secretsDir, { recursive: true, mode: 0o700 });
    }
  }

  async writeSecret(name: string, value: string): Promise<void> {
    const credPath = join(this.secretsDir, `${name}.plain`);
    writeFileSync(credPath, value, { mode: 0o600, encoding: "utf-8" });
  }

  readSecret(name: string): string | undefined {
    const credPath = join(this.secretsDir, `${name}.plain`);
    if (!existsSync(credPath)) return undefined;
    try {
      return readFileSync(credPath, "utf-8");
    } catch {
      return undefined;
    }
  }

  async deleteSecret(name: string): Promise<void> {
    const credPath = join(this.secretsDir, `${name}.plain`);
    if (existsSync(credPath)) {
      try { unlinkSync(credPath); } catch { /* already gone */ }
    }
  }
}

/** Detect whether the production TPM2 path is usable. Cached per-boot
 *  semantics — caller should call once at gateway startup and reuse. */
export async function detectTpm2Available(): Promise<boolean> {
  // Explicit overrides — owner can force plaintext in dev/test
  if (process.env["AGI_VAULT_PLAINTEXT"] === "1") return false;
  if (process.env["AIONIMA_TEST_VM"] === "1") return false;

  try {
    const { execFileSync } = await import("node:child_process");
    // Probe: hardcoded args, no shell, no user input → no injection surface.
    // `sudo -n systemd-creds list` returns 0 on healthy TPM2 envs, non-zero
    // otherwise (missing binary, sudo prompt, missing TPM2, etc).
    execFileSync("sudo", ["-n", "systemd-creds", "list"], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}
