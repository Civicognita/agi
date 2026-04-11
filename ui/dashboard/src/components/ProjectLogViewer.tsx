import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AnsiToHtml from "ansi-to-html";
import type { LogSourceDefinition } from "../types.js";
import { fetchContainerLogs, fetchLogSources } from "../api.js";

interface ProjectLogViewerProps {
  projectPath: string;
  /** Bump this key to trigger an immediate log reload. */
  refreshKey?: number;
}

const ansiConverter = new AnsiToHtml({ fg: "#e1e4ea", bg: "transparent", escapeXML: true });

export function ProjectLogViewer({ projectPath, refreshKey }: ProjectLogViewerProps) {
  const [sources, setSources] = useState<LogSourceDefinition[]>([]);
  const [selectedSource, setSelectedSource] = useState("container");
  const [logs, setLogs] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  // Load available log sources
  useEffect(() => {
    fetchLogSources(projectPath).then((s) => {
      setSources(s);
      if (s.length > 0 && !s.find((src) => src.id === selectedSource)) {
        setSelectedSource(s[0]!.id);
      }
    }).catch(() => {
      setSources([{ id: "container", label: "Container Output", type: "container" }]);
    });
  }, [projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchContainerLogs(projectPath, 200, selectedSource);
      setLogs(result.logs || "");
      setError(false);
    } catch {
      setLogs(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [projectPath, selectedSource]);

  // Initial load + when source changes
  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  // Reload when refreshKey changes (tool execution completed)
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      void loadLogs();
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => void loadLogs(), 5000);
    return () => clearInterval(id);
  }, [autoRefresh, loadLogs]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-muted-foreground">Logs</span>
          {sources.length > 1 && (
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="h-6 px-1.5 rounded border border-border bg-background text-foreground text-[11px]"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-3 h-3"
            />
            Auto
          </label>
          <button
            onClick={() => void loadLogs()}
            disabled={loading}
            className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>
      <pre
        ref={preRef}
        className="bg-background border border-border rounded-md p-2 text-[11px] font-mono max-h-48 overflow-auto text-foreground whitespace-pre-wrap break-all"
        dangerouslySetInnerHTML={{
          __html: error
            ? "Failed to retrieve logs"
            : logs === null
              ? "Loading..."
              : logs
                ? ansiConverter.toHtml(logs)
                : "No output yet",
        }}
      />
    </div>
  );
}
