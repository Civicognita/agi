/**
 * RustDeskLogsSection — tabbed log viewer for signal, relay, and client services.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchRustDeskLogs } from "../../api.js";

const TABS = [
  { id: "signal", label: "Signal" },
  { id: "relay", label: "Relay" },
  { id: "client", label: "Client" },
] as const;

type ServiceTab = (typeof TABS)[number]["id"];

export function RustDeskLogsSection() {
  const [activeTab, setActiveTab] = useState<ServiceTab>("signal");
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async (service: ServiceTab) => {
    try {
      setLoading(true);
      const result = await fetchRustDeskLogs(service, 100);
      setLogs(result.logs);
    } catch (err) {
      setLogs(`Error: ${err instanceof Error ? err.message : "Failed to load logs"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLogs(activeTab);
  }, [activeTab, loadLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => void loadLogs(activeTab), 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, activeTab, loadLogs]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="flex flex-col gap-3">
      {/* Tab bar + controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-3 py-1 text-[12px] rounded-md transition-colors cursor-pointer border-none",
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground font-medium"
                  : "bg-transparent text-muted-foreground hover:bg-secondary",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-primary"
            />
            Auto-refresh
          </label>
          <button
            type="button"
            onClick={() => void loadLogs(activeTab)}
            disabled={loading}
            className="px-2.5 py-1 text-[12px] rounded-md bg-surface1 hover:bg-surface2 text-muted-foreground transition-colors disabled:opacity-50 cursor-pointer border-none"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Log viewer */}
      <div className="bg-mantle rounded-lg border border-border p-3 max-h-80 overflow-y-auto">
        <pre className="text-[11px] font-mono text-foreground whitespace-pre-wrap leading-relaxed m-0">
          {logs || (loading ? "Loading..." : "No logs available.")}
          <div ref={logEndRef} />
        </pre>
      </div>
    </div>
  );
}
