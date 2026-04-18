/**
 * System Security page — platform-wide vulnerability scanning and finding management.
 */

import { useState, useEffect, useCallback } from "react";
import { PageScroll } from "@/components/PageScroll.js";
import {
  fetchSecuritySummary,
  fetchSecurityScans,
  fetchSecurityFindings,
  triggerSecurityScan,
  updateFindingStatus,
  fetchSecurityProviders,
} from "../api.js";
import type { SecuritySummary, ScanRun, SecurityFinding, FindingSeverity, ScanProvider } from "../types.js";
import { useRootContext } from "./root.js";
import { formatSecurityFixPrompt, formatSecurityIssueUrl } from "../lib/security-fix-prompt.js";

const SEVERITY_COLORS: Record<FindingSeverity, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-blue-400 text-white",
  info: "bg-gray-400 text-white",
};

export default function SystemSecurityPage() {
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [providers, setProviders] = useState<ScanProvider[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const { onOpenChatWithMessage, configHook } = useRootContext();
  const devMode = Boolean(configHook.data?.dev?.enabled);

  const handleFixFinding = useCallback((finding: SecurityFinding) => {
    onOpenChatWithMessage("/opt/agi", formatSecurityFixPrompt(finding));
  }, [onOpenChatWithMessage]);

  const refresh = useCallback(async () => {
    const [s, sc, f, p] = await Promise.all([
      fetchSecuritySummary().catch(() => null),
      fetchSecurityScans().catch(() => []),
      fetchSecurityFindings().catch(() => []),
      fetchSecurityProviders().catch(() => []),
    ]);
    setSummary(s);
    setScans(sc);
    setFindings(f);
    setProviders(p);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleSystemScan = async () => {
    setScanning(true);
    try {
      // Scan workspace root with all scan types
      await triggerSecurityScan({
        scanTypes: ["sast", "sca", "secrets", "config"],
        targetPath: "/opt/agi",
      });
      setTimeout(() => { void refresh(); }, 3000);
      setTimeout(() => { void refresh(); }, 8000);
      setTimeout(() => { void refresh(); }, 15000);
    } finally {
      setScanning(false);
    }
  };

  const filteredFindings = selectedSeverity === "all"
    ? findings
    : findings.filter(f => f.severity === selectedSeverity);

  return (
    <PageScroll>
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">System Security</h1>
        <button
          onClick={() => void handleSystemScan()}
          disabled={scanning}
          className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
        >
          {scanning ? "Scanning..." : "Run System Scan"}
        </button>
      </div>

      {/* Overview Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {(["critical", "high", "medium", "low", "info"] as const).map(sev => (
            <button
              key={sev}
              onClick={() => setSelectedSeverity(selectedSeverity === sev ? "all" : sev)}
              className={`rounded-lg px-3 py-3 text-center cursor-pointer transition-all ${
                selectedSeverity === sev ? "ring-2 ring-white" : ""
              } ${SEVERITY_COLORS[sev]}`}
            >
              <div className="text-3xl font-bold">{summary.bySeverity[sev] ?? 0}</div>
              <div className="text-xs uppercase">{sev}</div>
            </button>
          ))}
          <div className="rounded-lg px-3 py-3 text-center bg-zinc-800 text-zinc-200">
            <div className="text-3xl font-bold">{summary.scanCount}</div>
            <div className="text-xs uppercase">Scans</div>
          </div>
        </div>
      )}

      {/* Providers */}
      {providers.length > 0 && (
        <div className="text-sm text-zinc-400">
          <span className="font-medium text-zinc-300">Active providers:</span>{" "}
          {providers.map(p => p.name).join(", ")}
        </div>
      )}

      {/* Findings Table */}
      <div>
        <h2 className="text-lg font-medium text-zinc-200 mb-3">
          Findings {selectedSeverity !== "all" && <span className="text-sm text-zinc-400">({selectedSeverity})</span>}
        </h2>
        <div className="border border-zinc-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-800/50 text-zinc-400 text-left">
                <th className="px-4 py-2">Severity</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Check</th>
                <th className="px-4 py-2">File</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredFindings.slice(0, 100).map(f => (
                <>
                  <tr
                    key={f.id}
                    onClick={() => setExpandedFinding(expandedFinding === f.id ? null : f.id)}
                    className="border-t border-zinc-800 hover:bg-zinc-800/30 cursor-pointer"
                  >
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 text-xs rounded font-medium ${SEVERITY_COLORS[f.severity]}`}>
                        {f.severity}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-zinc-200">{f.title}</td>
                    <td className="px-4 py-2 text-zinc-500">{f.checkId}</td>
                    <td className="px-4 py-2 text-zinc-400 font-mono text-xs">
                      {f.evidence.file}{f.evidence.line ? `:${f.evidence.line}` : ""}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        f.status === "open" ? "bg-red-900/50 text-red-300" :
                        f.status === "mitigated" ? "bg-green-900/50 text-green-300" :
                        "bg-zinc-800 text-zinc-400"
                      }`}>{f.status}</span>
                    </td>
                  </tr>
                  {expandedFinding === f.id && (
                    <tr key={`${f.id}-detail`} className="border-t border-zinc-800 bg-zinc-900/50">
                      <td colSpan={5} className="px-4 py-3 space-y-2">
                        <p className="text-sm text-zinc-300">{f.description}</p>
                        {f.evidence.snippet && (
                          <pre className="text-xs bg-zinc-950 p-2 rounded overflow-x-auto text-zinc-400">{f.evidence.snippet}</pre>
                        )}
                        <div className="text-sm text-zinc-300">
                          <span className="font-medium">Remediation:</span> {f.remediation.description}
                        </div>
                        <div className="flex gap-2 items-center">
                          <span className="text-xs text-zinc-500">Status:</span>
                          {(["open", "acknowledged", "mitigated", "false_positive"] as const).map(s => (
                            <button
                              key={s}
                              onClick={() => {
                                void updateFindingStatus(f.id, s).then(() => { void refresh(); });
                              }}
                              className={`text-xs px-2 py-0.5 rounded ${f.status === s ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
                            >
                              {s.replace("_", " ")}
                            </button>
                          ))}
                          {devMode ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleFixFinding(f); }}
                              className="ml-auto px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
                            >
                              Fix this
                            </button>
                          ) : (
                            <a
                              href={formatSecurityIssueUrl(f)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="ml-auto px-3 py-1 text-sm rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600 inline-block"
                            >
                              Report this
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {filteredFindings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    No findings. Run a system scan to check for vulnerabilities.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Scan History */}
      {scans.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-zinc-200 mb-3">Scan History</h2>
          <div className="space-y-2">
            {scans.slice(0, 10).map(s => (
              <div key={s.id} className="flex items-center gap-4 text-sm px-4 py-2 bg-zinc-800/30 rounded">
                <span className={`w-2 h-2 rounded-full ${
                  s.status === "completed" ? "bg-green-500" : s.status === "running" ? "bg-yellow-500 animate-pulse" : "bg-red-500"
                }`} />
                <span className="text-zinc-300">{s.config.scanTypes.join(", ").toUpperCase()}</span>
                <span className="text-zinc-500">{new Date(s.startedAt).toLocaleString()}</span>
                <span className="text-zinc-400">{s.totalFindings} findings</span>
                <span className="text-zinc-600 text-xs">{s.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </PageScroll>
  );
}
