/**
 * Resources route — system resource monitoring (CPU, RAM, disk, uptime).
 * Also includes a Database Storage section showing aggregate DB volume usage.
 */

import { useEffect, useState } from "react";
import { ResourceUsage } from "@/components/ResourceUsage.js";
import { PageScroll } from "@/components/PageScroll.js";
import { Card } from "@/components/ui/card.js";
import { fetchDatabaseStorage } from "@/api.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function DatabaseStorageSection() {
  const [data, setData] = useState<{
    projectBytes: number | null;
    totalBytes: number | null;
    volumeName: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDatabaseStorage()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-[11px] text-muted-foreground">Loading database storage...</p>;
  }

  if (!data || data.totalBytes === null) {
    return <p className="text-[11px] text-muted-foreground">No database volumes found.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Total Volume Usage</span>
          <div className="text-[22px] font-bold text-foreground mt-0.5">{formatBytes(data.totalBytes)}</div>
          {data.volumeName && (
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{data.volumeName}</div>
          )}
        </div>
        {data.projectBytes !== null && (
          <div>
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Project Data</span>
            <div className="text-[22px] font-bold text-foreground mt-0.5">{formatBytes(data.projectBytes)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">across all hosted projects</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResourcesPage() {
  return (
    <PageScroll>
      <ResourceUsage />
      <div className="mt-4">
        <Card className="p-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Database Storage</h3>
          <DatabaseStorageSection />
        </Card>
      </div>
    </PageScroll>
  );
}
