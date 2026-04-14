/**
 * tRPC context — carries runtime dependencies for procedure handlers.
 * Gateway-core provides the actual implementation at mount time.
 */

import type { DashboardQueries } from "@aionima/gateway-core";

export interface AppContext {
  /** Dashboard aggregation queries (read-only SQLite). */
  queries: DashboardQueries;
  /** Workspace project directories (from config). */
  workspaceProjects: string[];
  /** Workspace root path. */
  workspaceRoot: string;
  /** Path to gateway.json config file. */
  configPath: string | undefined;
  /** Path to the aionima source repo. */
  selfRepoPath: string | undefined;
  /** WebSocket broadcast function for upgrade events. */
  broadcastUpgrade: (phase: string, message: string) => void;
}
