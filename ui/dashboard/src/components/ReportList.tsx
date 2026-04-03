/**
 * ReportList — card grid with project filter and pagination.
 */

import { useState } from "react";
import { ReportCard } from "./ReportCard.js";
import { useReports } from "@/hooks.js";

export function ReportList() {
  const [project, setProject] = useState<string>("");
  const [page, setPage] = useState(0);
  const pageSize = 12;

  const { data, loading, error } = useReports({
    project: project || undefined,
    limit: pageSize,
    offset: page * pageSize,
  });

  const reports = data?.reports ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  // Collect unique project names for filter
  const projectNames = [...new Set(reports.map((r) => r.project?.name).filter(Boolean))] as string[];

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={project}
          onChange={(e) => { setProject(e.target.value); setPage(0); }}
          className="text-[12px] bg-secondary text-foreground border border-border rounded-md px-2 py-1"
        >
          <option value="">All Projects</option>
          {projectNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      {loading && <p className="text-[12px] text-muted-foreground">Loading reports...</p>}
      {error && <p className="text-[12px] text-destructive">{error}</p>}

      {!loading && reports.length === 0 && (
        <div className="text-center py-12">
          <p className="text-[13px] text-muted-foreground">
            No reports yet. Reports are generated when workers complete tasks.
          </p>
        </div>
      )}

      {/* Card grid */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
        {reports.map((report) => (
          <ReportCard key={report.coaReqId} report={report} />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-[12px] px-3 py-1 rounded bg-secondary text-foreground border border-border disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-[12px] text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="text-[12px] px-3 py-1 rounded bg-secondary text-foreground border border-border disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
