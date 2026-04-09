/**
 * RuntimeManagerSection — self-contained runtime install/uninstall UI.
 * Used by plugin settings pages with type "runtime-manager".
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  fetchRuntimes,
  fetchInstalledRuntimes,
  installRuntime,
  uninstallRuntime,
} from "@/api.js";
import type { RuntimeInfo } from "@/types.js";

interface Props {
  /** Filter runtimes to this language (e.g. "node", "php"). */
  language?: string;
}

export function RuntimeManagerSection({ language }: Props) {
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [installedVersions, setInstalledVersions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rts, installed] = await Promise.all([
        fetchRuntimes(),
        fetchInstalledRuntimes().catch(() => ({} as Record<string, string[]>)),
      ]);
      const filtered = language ? rts.filter((rt) => rt.language === language) : rts;
      setRuntimes(filtered);
      setInstalledVersions(installed);
    } catch {
      setRuntimes([]);
    }
    setLoading(false);
  }, [language]);

  useEffect(() => { void load(); }, [load]);

  const handleInstall = useCallback(async (id: string) => {
    setBusy(id);
    try {
      await installRuntime(id);
      setError(null);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Install failed");
    }
    setBusy(null);
  }, [load]);

  const handleUninstall = useCallback(async (id: string) => {
    setBusy(id);
    try {
      await uninstallRuntime(id);
      setError(null);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Uninstall failed");
    }
    setBusy(null);
  }, [load]);

  if (loading) {
    return <div className="text-[12px] text-muted-foreground">Loading runtimes...</div>;
  }

  if (runtimes.length === 0) {
    return <div className="text-[12px] text-muted-foreground">No runtimes registered</div>;
  }

  return (
    <div className="grid gap-4">
      {error && (
        <div className="rounded-lg bg-red/10 border border-red/30 px-4 py-2 text-[12px] text-red flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red hover:text-foreground cursor-pointer bg-transparent border-none text-[11px]">
            Dismiss
          </button>
        </div>
      )}
      {/* Group by language */}
      {Object.entries(
        runtimes.reduce<Record<string, RuntimeInfo[]>>((acc, rt) => {
          (acc[rt.language] ??= []).push(rt);
          return acc;
        }, {}),
      ).map(([lang, langRuntimes]) => (
        <div key={lang}>
          <div className="text-[13px] font-semibold text-foreground capitalize mb-2">
            {lang === "node" ? "Node.js" : lang === "php" ? "PHP" : lang === "postgresql" ? "PostgreSQL" : lang === "mariadb" ? "MariaDB" : lang}
          </div>
          <div className="grid gap-2">
            {langRuntimes.map((rt) => {
              const langInstalled = installedVersions[rt.language] ?? [];
              const isInstalled = langInstalled.includes(rt.version);
              const isBusy = busy === rt.id;

              return (
                <div
                  key={rt.id}
                  className="flex items-center justify-between rounded-lg bg-secondary/30 p-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-medium text-foreground">{rt.label}</span>
                    {isInstalled ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 text-green font-medium">
                        Image ready
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-medium">
                        Not pulled
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      Container: <code>{rt.containerImage}</code>
                    </span>
                  </div>
                  {rt.installable && (
                    <div className="flex gap-1.5">
                      {isInstalled ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => void handleUninstall(rt.id)}
                          className="text-[11px] h-7"
                        >
                          {isBusy ? "Working..." : "Remove image"}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => void handleInstall(rt.id)}
                          className="text-[11px] h-7"
                        >
                          {isBusy ? "Working..." : "Pull image"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
