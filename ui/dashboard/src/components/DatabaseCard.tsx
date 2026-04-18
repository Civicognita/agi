/**
 * DatabaseCard — per-project database engine selector and connection info panel.
 *
 * Shown above StackManager in HostingPanel. Lets the user pick a database engine
 * (PostgreSQL, MariaDB, etc.) or keep the default file-based storage. When an
 * engine is selected, the corresponding stack is installed and DATABASE_URL is
 * written to the project's .env file. Removing the engine un-installs the stack
 * and removes DATABASE_URL.
 *
 * QoL features:
 * - Auto-detects the database engine from project files and shows a suggestion
 * - Connection test dot in the header (green = OK, red = failed)
 * - Run Migrations button in the connection details panel
 * - Storage indicator as a 4th column in the connection grid
 */

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import type { ProjectStackInstance, StackInfo } from "@/types.js";
import {
  fetchDatabaseEngines,
  addStack,
  removeStack,
  fetchProjectEnv,
  saveProjectEnv,
  detectDatabaseEngine,
  runDatabaseMigrations,
  fetchDatabaseStorage,
  testDatabaseConnection,
} from "@/api.js";
import type { DatabaseEngine } from "@/api.js";

interface Props {
  projectPath: string;
  installedStacks: ProjectStackInstance[];
  stackDefs: StackInfo[];
  onStackChange: () => void;
  onRestartNeeded: () => void;
}

function buildConnectionUrl(engine: DatabaseEngine, instance: ProjectStackInstance): string {
  const user = instance.databaseUser ?? "app";
  const password = instance.databasePassword ?? "";
  const database = instance.databaseName ?? "app";
  const port = engine.port;

  if (engine.engine.includes("postgres")) {
    return `postgresql://${user}:${password}@host.containers.internal:${port}/${database}`;
  }
  if (engine.engine.includes("mariadb") || engine.engine.includes("mysql")) {
    return `mysql://${user}:${password}@host.containers.internal:${port}/${database}`;
  }
  return `${engine.engine}://${user}:${password}@host.containers.internal:${port}/${database}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function DatabaseCard({
  projectPath,
  installedStacks,
  stackDefs,
  onStackChange,
  onRestartNeeded,
}: Props) {
  const [engines, setEngines] = useState<DatabaseEngine[]>([]);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // QoL: auto-detect engine suggestion
  const [detected, setDetected] = useState<{ engine: string | null; reason: string } | null>(null);

  // QoL: connection test dot
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);

  // QoL: run migrations
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{ ok: boolean; output?: string; error?: string } | null>(null);

  // QoL: storage indicator
  const [storage, setStorage] = useState<{ projectBytes: number | null; totalBytes: number | null } | null>(null);

  useEffect(() => {
    fetchDatabaseEngines().then(setEngines).catch(() => setEngines([]));
  }, []);

  // Find the currently installed database stack (if any)
  const currentDbInstance = installedStacks.find((inst) => {
    const def = stackDefs.find((d) => d.id === inst.stackId);
    return def?.category === "database";
  });

  const currentDbDef = currentDbInstance
    ? stackDefs.find((d) => d.id === currentDbInstance.stackId)
    : undefined;

  const currentEngine = currentDbInstance
    ? engines.find((e) => e.stackId === currentDbInstance.stackId)
    : undefined;

  const connectionUrl =
    currentEngine && currentDbInstance
      ? buildConnectionUrl(currentEngine, currentDbInstance)
      : null;

  // Selected value in the dropdown — either the active stackId or "" (file/default)
  const selectedValue = currentDbInstance?.stackId ?? "";

  // Auto-detect engine when no DB is selected
  useEffect(() => {
    if (!currentDbInstance) {
      detectDatabaseEngine(projectPath).then(setDetected).catch(() => {});
    } else {
      setDetected(null);
    }
  }, [projectPath, currentDbInstance]);

  // Test connection when a DB is active
  useEffect(() => {
    if (currentDbInstance) {
      testDatabaseConnection(projectPath)
        .then((r) => setConnectionOk(r.ok))
        .catch(() => setConnectionOk(null));
    } else {
      setConnectionOk(null);
    }
  }, [currentDbInstance, projectPath]);

  // Fetch storage when a DB is active
  useEffect(() => {
    if (currentDbInstance) {
      fetchDatabaseStorage(projectPath).then(setStorage).catch(() => {});
    } else {
      setStorage(null);
    }
  }, [currentDbInstance, projectPath]);

  const handleEngineChange = useCallback(
    async (newStackId: string) => {
      setChanging(true);
      setError(null);
      setMigrateResult(null);
      try {
        // Remove the current DB stack if there is one
        if (currentDbInstance) {
          await removeStack(projectPath, currentDbInstance.stackId);
          // Remove DATABASE_URL from .env
          const vars = await fetchProjectEnv(projectPath);
          const { DATABASE_URL: _removed, ...rest } = vars;
          await saveProjectEnv(projectPath, rest);
        }

        if (newStackId !== "") {
          // Add the new DB stack
          const instance = await addStack(projectPath, newStackId);
          const newEngine = engines.find((e) => e.stackId === newStackId);

          if (newEngine && instance) {
            // Write DATABASE_URL to .env
            const url = buildConnectionUrl(newEngine, instance);
            const vars = await fetchProjectEnv(projectPath);
            await saveProjectEnv(projectPath, { ...vars, DATABASE_URL: url });
          }
        }

        onStackChange();
        onRestartNeeded();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setChanging(false);
      }
    },
    [currentDbInstance, engines, projectPath, onStackChange, onRestartNeeded],
  );

  function handleCopy() {
    if (!connectionUrl) return;
    void navigator.clipboard.writeText(connectionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleOpenWhoDB() {
    window.open("https://db.ai.on", "_blank", "noopener,noreferrer");
  }

  const statusRunning = currentEngine?.containerRunning ?? false;

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Database
        </h4>
        <div className="flex items-center gap-1.5">
          {/* Connection test dot */}
          {connectionOk !== null && (
            <span
              className={`w-2 h-2 rounded-full ${connectionOk ? "bg-green-500" : "bg-red-500"}`}
              title={connectionOk ? "Connection OK" : "Connection failed"}
            />
          )}
          {currentDbDef && (
            <Badge
              className={
                statusRunning
                  ? "bg-green-500/20 text-green-300"
                  : "bg-muted-foreground/20 text-muted-foreground"
              }
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${statusRunning ? "bg-green-500" : "bg-muted-foreground"}`}
              />
              {statusRunning ? "Running" : "Stopped"}
            </Badge>
          )}
        </div>
      </div>

      {/* Auto-detect suggestion */}
      {detected?.engine && !currentDbInstance && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-primary/5 rounded px-2 py-1">
          <span className="text-primary font-medium">Detected:</span>
          <span>{detected.engine} (from {detected.reason})</span>
        </div>
      )}

      {/* Engine selector */}
      <select
        value={selectedValue}
        disabled={changing}
        onChange={(e) => void handleEngineChange(e.target.value)}
        className="w-full h-8 px-2 rounded-md border border-border bg-background text-foreground text-[12px] disabled:opacity-50"
      >
        <option value="">File (default)</option>
        {engines.map((eng) => (
          <option key={eng.stackId} value={eng.stackId}>
            {eng.label}
          </option>
        ))}
      </select>

      {changing && (
        <p className="text-[11px] text-muted-foreground">Applying database change...</p>
      )}

      {error && <p className="text-[11px] text-red">{error}</p>}

      {/* Connection details — only shown when a DB engine is selected */}
      {currentEngine && currentDbInstance && (
        <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-muted-foreground">Connection</span>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px]"
                onClick={handleCopy}
              >
                {copied ? "Copied!" : "Copy URL"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px]"
                onClick={handleOpenWhoDB}
              >
                WhoDB
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px]"
                disabled={migrating}
                onClick={async () => {
                  setMigrating(true);
                  setMigrateResult(null);
                  const r = await runDatabaseMigrations(projectPath);
                  setMigrateResult(r);
                  setMigrating(false);
                }}
              >
                {migrating ? "Running..." : "Migrate"}
              </Button>
            </div>
          </div>

          {connectionUrl && (
            <div className="text-[11px] font-mono text-foreground break-all">{connectionUrl}</div>
          )}

          {/* Migration result */}
          {migrateResult && (
            <div className={`text-[10px] mt-1 ${migrateResult.ok ? "text-green-500" : "text-red-500"}`}>
              {migrateResult.ok ? "Migrations complete" : migrateResult.error ?? "Migration failed"}
            </div>
          )}

          <div className="grid grid-cols-4 gap-2 mt-2">
            <div>
              <span className="text-[9px] text-muted-foreground">Database</span>
              <div className="text-[11px]">{currentDbInstance.databaseName ?? "app"}</div>
            </div>
            <div>
              <span className="text-[9px] text-muted-foreground">User</span>
              <div className="text-[11px]">{currentDbInstance.databaseUser ?? "app"}</div>
            </div>
            <div>
              <span className="text-[9px] text-muted-foreground">Port</span>
              <div className="text-[11px]">{currentEngine.port}</div>
            </div>
            {storage?.totalBytes != null && (
              <div>
                <span className="text-[9px] text-muted-foreground">Storage</span>
                <div className="text-[11px]">{formatBytes(storage.totalBytes)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
