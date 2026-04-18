/**
 * SecretsManager — TPM2-sealed credential store via systemd-creds.
 *
 * Reads decrypted credentials from $CREDENTIALS_DIRECTORY (set by systemd at
 * service start) and writes new secrets via `systemd-creds encrypt --with-key=tpm2`.
 * Falls back to process.env for dev / migration scenarios.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const SERVICE_UNIT_PATH = "/etc/systemd/system/agi.service";
const BEGIN_MARKER = "# --- BEGIN CREDENTIALS ---";
const END_MARKER = "# --- END CREDENTIALS ---";

export class SecretsManager {
  readonly secretsDir: string;
  private credentialsDir: string | null;

  constructor(secretsDir?: string) {
    this.secretsDir = secretsDir ?? resolve(homedir(), ".agi/secrets");
    this.credentialsDir = process.env["CREDENTIALS_DIRECTORY"] ?? null;
  }

  /** Create secrets dir if missing. */
  async initialize(): Promise<void> {
    if (!existsSync(this.secretsDir)) {
      mkdirSync(this.secretsDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Read all decrypted credentials from $CREDENTIALS_DIRECTORY
   * and merge into process.env. Called early in boot.
   *
   * If $CREDENTIALS_DIRECTORY is not set (service unit missing
   * LoadCredentialEncrypted lines) or a .cred file on disk isn't
   * present in the credentials dir, falls back to inline decryption
   * via `systemd-creds decrypt` and self-heals the service unit.
   */
  loadIntoEnv(): void {
    // Phase 1: Load from systemd's $CREDENTIALS_DIRECTORY (fast path)
    if (this.credentialsDir && existsSync(this.credentialsDir)) {
      const entries = readdirSync(this.credentialsDir);
      for (const name of entries) {
        try {
          const value = readFileSync(join(this.credentialsDir, name), "utf8").trim();
          if (value) {
            process.env[name] = value;
          }
        } catch {
          // Skip unreadable credentials
        }
      }
    }

    // Phase 2: Check for .cred files on disk that weren't loaded (deploy
    // may have wiped LoadCredentialEncrypted lines from the service unit).
    // Decrypt them inline and self-heal the service unit for next restart.
    const onDisk = this.listSecrets();
    const missing = onDisk.filter((name) => !process.env[name]);

    if (missing.length === 0) return;

    let healed = false;
    for (const name of missing) {
      const credPath = join(this.secretsDir, `${name}.cred`);
      try {
        const value = execSync(
          `sudo systemd-creds decrypt ${shellEscape(credPath)} -`,
          { stdio: ["pipe", "pipe", "pipe"], timeout: 10_000 },
        ).toString().trim();
        if (value) {
          process.env[name] = value;
          healed = true;
        }
      } catch {
        // Can't decrypt — skip
      }
    }

    // Self-heal: re-inject LoadCredentialEncrypted lines into the service unit
    // so the next restart uses the fast path.
    if (healed) {
      void this.updateServiceUnit().catch(() => {});
    }
  }

  /**
   * Read a single secret. Priority:
   * 1. $CREDENTIALS_DIRECTORY/{name} (decrypted by systemd)
   * 2. process.env[name] (fallback for migration / dev)
   */
  readSecret(name: string): string | undefined {
    if (this.credentialsDir) {
      const credPath = join(this.credentialsDir, name);
      try {
        const value = readFileSync(credPath, "utf8").trim();
        if (value) return value;
      } catch {
        // Fall through to process.env
      }
    }
    return process.env[name];
  }

  /**
   * Encrypt and persist a secret via systemd-creds.
   * Writes to ~/.agi/secrets/{name}.cred
   * Also sets process.env[name] for immediate use in current process.
   */
  async writeSecret(name: string, value: string): Promise<void> {
    await this.initialize();

    const credPath = join(this.secretsDir, `${name}.cred`);

    try {
      execSync(
        `sudo systemd-creds encrypt --with-key=tpm2 --name=${shellEscape(name)} - ${shellEscape(credPath)}`,
        { input: value, stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to encrypt secret ${name}: ${msg}`);
    }

    // Immediate use in current process
    process.env[name] = value;

    // Update service unit to pick up the new credential on next restart
    await this.updateServiceUnit();
  }

  /** Delete a secret file from ~/.agi/secrets/ */
  async deleteSecret(name: string): Promise<void> {
    const credPath = join(this.secretsDir, `${name}.cred`);
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(credPath);
    } catch {
      // File didn't exist
    }
    delete process.env[name];
    await this.updateServiceUnit();
  }

  /** List all stored secret names (from .cred files on disk). */
  listSecrets(): string[] {
    if (!existsSync(this.secretsDir)) return [];
    return readdirSync(this.secretsDir)
      .filter((f) => f.endsWith(".cred"))
      .map((f) => f.slice(0, -5));
  }

  /**
   * Regenerate the service unit's LoadCredentialEncrypted lines
   * and reload systemd. Called after writing/deleting secrets.
   */
  async updateServiceUnit(): Promise<void> {
    if (!existsSync(SERVICE_UNIT_PATH)) return;

    const secrets = this.listSecrets();
    const credLines = secrets.map(
      (name) => `LoadCredentialEncrypted=${name}:${join(this.secretsDir, `${name}.cred`)}`,
    );

    const unit = readFileSync(SERVICE_UNIT_PATH, "utf8");

    const beginIdx = unit.indexOf(BEGIN_MARKER);
    const endIdx = unit.indexOf(END_MARKER);

    let newUnit: string;

    if (beginIdx !== -1 && endIdx !== -1) {
      // Replace content between markers
      const before = unit.slice(0, beginIdx + BEGIN_MARKER.length);
      const after = unit.slice(endIdx);
      const credSection = credLines.length > 0 ? "\n" + credLines.join("\n") + "\n" : "\n";
      newUnit = before + credSection + after;
    } else {
      // Markers not found — inject them before ExecStart
      const execIdx = unit.indexOf("ExecStart=");
      if (execIdx === -1) return;

      const markerBlock =
        BEGIN_MARKER +
        "\n" +
        credLines.join("\n") +
        (credLines.length > 0 ? "\n" : "") +
        END_MARKER +
        "\n";

      newUnit = unit.slice(0, execIdx) + markerBlock + "\n" + unit.slice(execIdx);
    }

    try {
      execSync(`sudo tee ${shellEscape(SERVICE_UNIT_PATH)} > /dev/null`, {
        input: newUnit,
        stdio: ["pipe", "pipe", "pipe"],
      });
      execSync("sudo systemctl daemon-reload", { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      // Non-fatal — service unit update is best-effort during dev
    }
  }
}

/** Simple shell argument escaping — wraps in single quotes. */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
