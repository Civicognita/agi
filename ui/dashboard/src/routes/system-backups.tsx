/**
 * Backups page — view and trigger database backups.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageScroll } from "@/components/PageScroll.js";
import { fetchBackups, triggerBackup } from "../api.js";

interface Backup {
  name: string;
  size: number;
  created: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BackupsPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchBackups().then(setBackups).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleTrigger = useCallback(async () => {
    setTriggering(true);
    setResult(null);
    try {
      const res = await triggerBackup();
      setResult(res.ok ? `Backup created (${String(res.files.length)} file(s))` : "Backup failed");
      refresh();
    } catch {
      setResult("Backup failed");
    } finally {
      setTriggering(false);
    }
  }, [refresh]);

  return (
    <PageScroll>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Database Backups</h2>
          <p className="text-sm text-muted-foreground">Automated daily backups of entity and marketplace databases.</p>
        </div>
        <Button size="sm" onClick={() => void handleTrigger()} disabled={triggering}>
          {triggering ? "Backing up..." : "Backup Now"}
        </Button>
      </div>

      {result && (
        <div className="rounded-lg bg-green/10 border border-green/30 px-3 py-2 text-sm text-green">
          {result}
        </div>
      )}

      <div className="rounded-xl bg-card border border-border overflow-hidden">
        {backups.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">No backups yet. Backups run automatically every 24 hours.</div>
        ) : (
          <div className="divide-y divide-border">
            {backups.map((b) => (
              <div key={b.name} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <span className="text-sm font-mono text-foreground">{b.name}</span>
                </div>
                <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
                  <span>{formatBytes(b.size)}</span>
                  <span>{new Date(b.created).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </PageScroll>
  );
}
