/**
 * Protocol compatibility checker — validates that AGI, PRIME, BOTS, and ID repos
 * are running compatible protocol versions at boot time.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ProtocolManifest {
  name: string;
  version: string;
  protocol: string;
  requires?: Record<string, string>;
}

export interface ProtocolCheckResult {
  compatible: boolean;
  errors: string[];
  manifests: {
    agi: ProtocolManifest | null;
    prime: ProtocolManifest | null;
    bots: ProtocolManifest | null;
    id: ProtocolManifest | null;
  };
}

function readManifest(dir: string): ProtocolManifest | null {
  const filePath = join(dir, "protocol.json");
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ProtocolManifest;
  } catch {
    return null;
  }
}

/**
 * Parse a semver string into [major, minor, patch].
 * Returns null if the string isn't a valid semver.
 */
function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Check if `version` satisfies `range` (supports >=X.Y.Z only).
 */
function satisfiesRange(version: string, range: string): boolean {
  const rangeMatch = range.match(/^>=(.+)$/);
  if (!rangeMatch) {
    // Exact match fallback
    return version === range;
  }
  const required = parseSemver(rangeMatch[1]!);
  const actual = parseSemver(version);
  if (!required || !actual) return false;

  // Compare major.minor.patch
  for (let i = 0; i < 3; i++) {
    if (actual[i]! > required[i]!) return true;
    if (actual[i]! < required[i]!) return false;
  }
  return true; // equal
}

/**
 * Check protocol compatibility across all core repos.
 *
 * @param agiDir - Path to AGI repo root
 * @param primeDir - Path to PRIME corpus directory
 * @param botsDir - Path to BOTS system directory
 * @param idDir - Path to ID service directory
 */
export function checkProtocolCompatibility(
  agiDir: string,
  primeDir: string,
  botsDir: string | null,
  idDir: string,
): ProtocolCheckResult {
  const errors: string[] = [];

  const agi = readManifest(agiDir);
  const prime = readManifest(primeDir);
  const bots = botsDir !== null ? readManifest(botsDir) : null;
  const id = readManifest(idDir);

  if (!agi) {
    errors.push(`AGI protocol.json not found at ${agiDir}`);
  }
  if (!prime && existsSync(primeDir)) {
    errors.push(`PRIME protocol.json not found at ${primeDir}`);
  }
  if (botsDir !== null && !bots && existsSync(botsDir)) {
    errors.push(`BOTS protocol.json not found at ${botsDir}`);
  }
  if (!id && existsSync(idDir)) {
    errors.push(`ID protocol.json not found at ${idDir}`);
  }

  // Check AGI's requirements against all core repos
  if (agi?.requires) {
    const nameToManifest: Record<string, ProtocolManifest | null> = {
      "aionima-prime": prime,
      "aionima-bots": bots,
      "aionima-local-id": id,
    };

    for (const [depName, requiredRange] of Object.entries(agi.requires)) {
      const dep = nameToManifest[depName];
      if (!dep) continue; // already reported as missing
      if (!satisfiesRange(dep.protocol, requiredRange)) {
        errors.push(
          `${depName} protocol ${dep.protocol} does not satisfy AGI requirement ${requiredRange}`,
        );
      }
    }
  }

  return {
    compatible: errors.length === 0,
    errors,
    manifests: { agi, prime, bots, id },
  };
}
