/**
 * Platform utilities — cross-platform helpers for CLI commands.
 * Centralizes OS detection, IP discovery, and browser opening.
 */

import { networkInterfaces, platform } from "node:os";
import { execSync } from "node:child_process";

/**
 * Detect the machine's primary LAN IP address.
 * Returns the first non-internal IPv4 address, or "127.0.0.1" as fallback.
 * Works on Linux, macOS, and Windows.
 */
export function detectLanIp(): string {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

/**
 * Open a URL in the user's default browser.
 * Best-effort — silently fails if no browser is available (e.g. headless server).
 */
export function openBrowser(url: string): void {
  try {
    const quoted = JSON.stringify(url);
    switch (platform()) {
      case "darwin":
        execSync(`open ${quoted}`, { stdio: "ignore" });
        break;
      case "win32":
        execSync(`start "" ${quoted}`, { stdio: "ignore", shell: "cmd.exe" });
        break;
      default:
        execSync(`xdg-open ${quoted}`, { stdio: "ignore" });
        break;
    }
  } catch {
    // Best-effort — headless servers or minimal environments may not have a browser
  }
}

export function isWindows(): boolean {
  return platform() === "win32";
}

export function isMac(): boolean {
  return platform() === "darwin";
}

export function isLinux(): boolean {
  return platform() === "linux";
}

/** Returns "sudo " on *nix, empty string on Windows. */
export function sudoPrefix(): string {
  return platform() === "win32" ? "" : "sudo ";
}
