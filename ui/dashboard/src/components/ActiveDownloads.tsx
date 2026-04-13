/**
 * ActiveDownloads — header indicator for in-progress model downloads.
 *
 * Polls the HF installed models API every 5 seconds. When any model has
 * status "downloading", shows a spinning indicator with the model name.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchHFInstalledModels } from "../api.js";
import type { HFInstalledModel } from "../types.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function ActiveDownloads() {
  const [downloading, setDownloading] = useState<HFInstalledModel[]>([]);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const models = await fetchHFInstalledModels();
        if (active) {
          setDownloading(models.filter((m) => m.status === "downloading" || m.status === "starting"));
        }
      } catch {
        // HF not enabled or network error — silently ignore
        if (active) setDownloading([]);
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), 5_000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  if (downloading.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-blue/10 border border-blue/20">
      {/* Spinner */}
      <svg className="w-3.5 h-3.5 animate-spin text-blue" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
      </svg>
      <div className="text-[11px] text-blue max-w-[200px] truncate">
        {downloading.length === 1 ? (
          <span>
            {downloading[0]!.status === "starting" ? "Starting" : "Downloading"}{" "}
            <span className="font-medium">{downloading[0]!.displayName}</span>
            {downloading[0]!.status === "downloading" && downloading[0]!.fileSizeBytes > 0 && (
              <span className="text-blue/70"> ({formatBytes(downloading[0]!.fileSizeBytes)})</span>
            )}
          </span>
        ) : (
          <span>
            <span className="font-medium">{String(downloading.length)} models</span> in progress
          </span>
        )}
      </div>
    </div>
  );
}
