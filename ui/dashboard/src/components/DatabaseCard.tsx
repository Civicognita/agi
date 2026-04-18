/**
 * DatabaseCard — per-project database engine selector and connection info panel.
 *
 * Shown above StackManager in HostingPanel. Lets the user pick a database engine
 * (PostgreSQL, MariaDB, etc.) or keep the default file-based storage. When an
 * engine is selected, the corresponding stack is installed and DATABASE_URL is
 * written to the project's .env file. Removing the engine un-installs the stack
 * and removes DATABASE_URL.
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

  const handleEngineChange = useCallback(
    async (newStackId: string) => {
      setChanging(true);
      setError(null);
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
            </div>
          </div>

          {connectionUrl && (
            <div className="text-[11px] font-mono text-foreground break-all">{connectionUrl}</div>
          )}

          <div className="grid grid-cols-3 gap-2 mt-2">
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
          </div>
        </div>
      )}
    </div>
  );
}
