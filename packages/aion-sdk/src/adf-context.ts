/**
 * ADF context — module-scoped singleton for framework facades.
 *
 * Initialized once at gateway boot via `initADF()`. Provides global access
 * to logger, config, and workspace info so AGI core code can use framework
 * helpers without manually threading dependencies.
 *
 * Plugins don't need this — they have `AionimaPluginAPI`.
 */

export interface ADFContext {
  logger: ADFLogger;
  config: Record<string, unknown>;
  workspaceRoot: string;
  projectDirs: string[];
  /** Security scanning context — available when @aionima/security is loaded. */
  security?: ADFSecurityContext;
  /** Project config manager — available when ProjectConfigManager is initialized. */
  projectConfig?: ADFProjectConfigContext;
  /** System config service — available when SystemConfigService is initialized. */
  systemConfig?: ADFSystemConfigContext;
}

/** ADF project config facade — read-only access to per-project config files. */
export interface ADFProjectConfigContext {
  read(projectPath: string): Record<string, unknown> | null;
  readHosting(projectPath: string): Record<string, unknown> | null;
  getStacks(projectPath: string): Array<{ stackId: string; addedAt: string }>;
}

/** ADF system config facade — read/write access to aionima.json. */
export interface ADFSystemConfigContext {
  read(): Record<string, unknown>;
  readKey(dotPath: string): unknown;
  patch(dotPath: string, value: unknown): void;
}

/** ADF security facade context — provides scan execution and finding queries. */
export interface ADFSecurityContext {
  runScan(config: { scanTypes: string[]; targetPath: string; projectId?: string; excludePaths?: string[]; severityThreshold?: string; maxFindings?: number }): Promise<unknown>;
  getFindings(scanId: string): unknown[];
  getScanHistory(projectPath?: string, limit?: number): unknown[];
  getProviders(): Array<{ id: string; name: string; scanType: string; description?: string }>;
}

export interface ADFLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

let ctx: ADFContext | null = null;

/** Initialize the ADF context. Call once at boot, before plugins activate. */
export function initADF(context: ADFContext): void {
  ctx = context;
}

/** Reset the ADF context (for testing). */
export function resetADF(): void {
  ctx = null;
}

/** Get the ADF context. Throws if not initialized. */
export function getADFContext(): ADFContext {
  if (!ctx) throw new Error("ADF not initialized — call initADF() at boot");
  return ctx;
}
