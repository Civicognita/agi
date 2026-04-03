/**
 * SecurityTab — per-project security scan results and finding management.
 */

import { useState, useEffect, useCallback } from "react";
import {
  fetchSecurityScans,
  fetchSecurityFindings,
  fetchSecuritySummary,
  triggerSecurityScan,
  updateFindingStatus,
} from "@/api";
import type { ScanRun, SecurityFinding, SecuritySummary, FindingSeverity } from "@/types";

const SEVERITY_COLORS: Record<FindingSeverity, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-blue-400 text-white",
  info: "bg-gray-400 text-white",
};

const SCAN_TYPES = ["sast", "sca", "secrets", "config"] as const;

interface SecurityTabProps {
  projectPath: string;
  onFixFinding?: (finding: SecurityFinding) => void;
}

export function SecurityTab({ projectPath, onFixFinding }: SecurityTabProps) {
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [scanning, setScanning] = useState(false);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const refresh = useCallback(async () => {
    const [s, sc, f] = await Promise.all([
      fetchSecuritySummary(projectPath).catch(() => null),
      fetchSecurityScans(projectPath).catch(() => []),
      fetchSecurityFindings({ projectPath }).catch(() => []),
    ]);
    setSummary(s);
    setScans(sc);
    setFindings(f);
  }, [projectPath]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleScan = async (types: string[]) => {
    setScanning(true);
    try {
      await triggerSecurityScan({ scanTypes: types, targetPath: projectPath });
      // Poll for completion
      setTimeout(() => { void refresh(); }, 2000);
      setTimeout(() => { void refresh(); }, 5000);
      setTimeout(() => { void refresh(); }, 10000);
    } finally {
      setScanning(false);
    }
  };

  const handleStatusChange = async (findingId: string, status: string) => {
    await updateFindingStatus(findingId, status);
    void refresh();
  };

  const filteredFindings = findings.filter(f => {
    if (severityFilter !== "all" && f.severity !== severityFilter) return false;
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Scan Trigger Bar */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void handleScan(["sast", "sca", "secrets", "config"])}
          disabled={scanning}
          className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
        >
          {scanning ? "Scanning..." : "Full Scan"}
        </button>
        {SCAN_TYPES.map(type => (
          <button
            key={type}
            onClick={() => void handleScan([type])}
            disabled={scanning}
            className="px-3 py-1.5 text-sm rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600 disabled:opacity-50"
          >
            {type.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {(["critical", "high", "medium", "low", "info"] as const).map(sev => (
            <div key={sev} className={`rounded-lg px-3 py-2 text-center ${SEVERITY_COLORS[sev]}`}>
              <div className="text-2xl font-bold">{summary.bySeverity[sev] ?? 0}</div>
              <div className="text-xs uppercase">{sev}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200">
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200">
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="mitigated">Mitigated</option>
          <option value="false_positive">False Positive</option>
        </select>
        <span className="text-sm text-zinc-400 self-center">{filteredFindings.length} findings</span>
      </div>

      {/* Findings List */}
      <div className="space-y-2">
        {filteredFindings.map(f => (
          <div key={f.id} className="border border-zinc-700 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedFinding(expandedFinding === f.id ? null : f.id)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-zinc-800/50"
            >
              <span className={`px-2 py-0.5 text-xs rounded font-medium ${SEVERITY_COLORS[f.severity]}`}>
                {f.severity.toUpperCase()}
              </span>
              <span className="text-sm text-zinc-200 flex-1">{f.title}</span>
              <span className="text-xs text-zinc-500">{f.checkId}</span>
              {f.evidence.file && (
                <span className="text-xs text-zinc-400">{f.evidence.file}{f.evidence.line ? `:${f.evidence.line}` : ""}</span>
              )}
            </button>
            {expandedFinding === f.id && (
              <div className="px-4 pb-4 space-y-3 border-t border-zinc-700 bg-zinc-900/50">
                <p className="text-sm text-zinc-300 pt-3">{f.description}</p>
                {f.evidence.snippet && (
                  <pre className="text-xs bg-zinc-950 p-2 rounded overflow-x-auto text-zinc-400">{f.evidence.snippet}</pre>
                )}
                {f.evidence.dependency && (
                  <div className="text-sm text-zinc-400">
                    <span className="font-medium">Dependency:</span> {f.evidence.dependency}@{f.evidence.installedVersion}
                    {f.evidence.fixedVersion && <span> &rarr; fix: {f.evidence.fixedVersion}</span>}
                  </div>
                )}
                <div className="text-sm text-zinc-300">
                  <span className="font-medium">Remediation:</span> {f.remediation.description}
                </div>
                {f.cwe && f.cwe.length > 0 && (
                  <div className="flex gap-2">
                    {f.cwe.map(c => <span key={c} className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">{c}</span>)}
                    {f.owasp?.map(o => <span key={o} className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">{o}</span>)}
                  </div>
                )}
                <div className="flex gap-2 pt-2 items-center">
                  <span className="text-xs text-zinc-500">Status:</span>
                  {(["open", "acknowledged", "mitigated", "false_positive"] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => void handleStatusChange(f.id, s)}
                      className={`text-xs px-2 py-0.5 rounded ${f.status === s ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
                    >
                      {s.replace("_", " ")}
                    </button>
                  ))}
                  {onFixFinding && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onFixFinding(f); }}
                      className="ml-auto px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
                    >
                      Fix this
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {filteredFindings.length === 0 && (
          <div className="text-center py-8 text-zinc-500">
            {findings.length === 0 ? "No scan results yet. Run a scan to get started." : "No findings match the current filters."}
          </div>
        )}
      </div>

      {/* Recent Scans */}
      {scans.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-2">Recent Scans</h3>
          <div className="space-y-1">
            {scans.slice(0, 5).map(s => (
              <div key={s.id} className="flex items-center gap-3 text-sm text-zinc-400 py-1">
                <span className={`w-2 h-2 rounded-full ${s.status === "completed" ? "bg-green-500" : s.status === "running" ? "bg-yellow-500 animate-pulse" : "bg-red-500"}`} />
                <span>{s.config.scanTypes.join(", ")}</span>
                <span className="text-zinc-600">{new Date(s.startedAt).toLocaleString()}</span>
                <span className="text-zinc-500">{s.totalFindings} findings</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
