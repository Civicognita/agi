/**
 * Plugin security — permission validation and sandboxing.
 * Adapted from OpenClaw's security.ts.
 */

import type { AionimaPermission, AionimaPluginManifest } from "./types.js";

const VALID_PERMISSIONS: ReadonlySet<AionimaPermission> = new Set([
  "filesystem.read",
  "filesystem.write",
  "network",
  "shell.exec",
  "config.read",
  "config.write",
]);

export function validatePermissions(permissions: string[]): { valid: boolean; invalid: string[] } {
  const invalid: string[] = [];
  for (const perm of permissions) {
    if (!VALID_PERMISSIONS.has(perm as AionimaPermission)) {
      invalid.push(perm);
    }
  }
  return { valid: invalid.length === 0, invalid };
}

/** Plugin ID must be lowercase kebab-case: starts with a letter, segments separated by hyphens. */
const PLUGIN_ID_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function validatePluginId(id: string): boolean {
  return PLUGIN_ID_REGEX.test(id);
}

export function validateManifest(manifest: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof manifest !== "object" || manifest === null) {
    return { valid: false, errors: ["Manifest must be a JSON object"] };
  }

  const m = manifest as Record<string, unknown>;

  if (typeof m.id !== "string" || m.id.length === 0) {
    errors.push("id is required and must be a non-empty string");
  } else if (!validatePluginId(m.id)) {
    errors.push(`id "${m.id}" must be lowercase kebab-case (e.g. "my-plugin")`);
  }
  if (typeof m.name !== "string" || m.name.length === 0) {
    errors.push("name is required and must be a non-empty string");
  }
  if (typeof m.version !== "string" || m.version.length === 0) {
    errors.push("version is required and must be a non-empty string");
  }
  if (typeof m.description !== "string") {
    errors.push("description is required and must be a string");
  }
  if (typeof m.aionimaVersion !== "string" && typeof m.nexusVersion !== "string") {
    errors.push("aionimaVersion is required and must be a string");
  }
  if (typeof m.entry !== "string" || m.entry.length === 0) {
    errors.push("entry is required and must be a non-empty string");
  }

  if (!Array.isArray(m.permissions)) {
    errors.push("permissions must be an array");
  } else {
    const { invalid } = validatePermissions(m.permissions as string[]);
    if (invalid.length > 0) {
      errors.push(`Invalid permissions: ${invalid.join(", ")}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function hasPermission(manifest: AionimaPluginManifest, permission: AionimaPermission): boolean {
  return manifest.permissions.includes(permission);
}
