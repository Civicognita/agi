/**
 * ADF facades — global helpers for AGI core code.
 *
 * These provide framework-level utilities without manually threading
 * dependencies. Plugins don't need these (they have `AionimaPluginAPI`);
 * facades serve the dogfooding path where core AGI code uses ADF patterns.
 */

import { getADFContext } from "./adf-context.js";
import type { ADFLogger, ADFSecurityContext } from "./adf-context.js";

/** Get the ADF component logger. */
export function Log(): ADFLogger {
  return getADFContext().logger;
}

/** Dot-path config accessor over `gateway.json`. */
export function Config(): ConfigAccessor {
  return new ConfigAccessor(getADFContext().config);
}

/** Workspace info — root dir and project directories. */
export function Workspace(): WorkspaceInfo {
  const ctx = getADFContext();
  return { root: ctx.workspaceRoot, projects: ctx.projectDirs };
}

// ---------------------------------------------------------------------------
// Config accessor — dot-path traversal
// ---------------------------------------------------------------------------

class ConfigAccessor {
  constructor(private readonly data: Record<string, unknown>) {}

  /** Get a value by dot-separated path (e.g. "hosting.enabled"). */
  get<T = unknown>(path: string): T | undefined {
    const keys = path.split(".");
    let current: unknown = this.data;
    for (const key of keys) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current as T | undefined;
  }

  /** Get a value or throw if missing. */
  getOrThrow<T = unknown>(path: string): T {
    const value = this.get<T>(path);
    if (value === undefined) throw new Error(`Config key "${path}" not found`);
    return value;
  }

  /** Check if a key exists. */
  has(path: string): boolean {
    return this.get(path) !== undefined;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceInfo {
  root: string;
  projects: string[];
}

/** Security scan facade — run scans, query findings, list providers. */
export function Security(): ADFSecurityContext {
  const ctx = getADFContext();
  if (!ctx.security) throw new Error("Security module not initialized — is @agi/security loaded?");
  return ctx.security;
}

// ---------------------------------------------------------------------------
// Project & System Config facades
// ---------------------------------------------------------------------------

import type { ADFProjectConfigContext, ADFSystemConfigContext } from "./adf-context.js";

/** Read-only access to per-project config files (~/.agi/{slug}/project.json). */
export function ProjectConfig(): ADFProjectConfigContext {
  const ctx = getADFContext();
  if (!ctx.projectConfig) throw new Error("ProjectConfigManager not initialized");
  return ctx.projectConfig;
}

/** Read/write access to the system config (gateway.json). */
export function SystemConfig(): ADFSystemConfigContext {
  const ctx = getADFContext();
  if (!ctx.systemConfig) throw new Error("SystemConfigService not initialized");
  return ctx.systemConfig;
}
