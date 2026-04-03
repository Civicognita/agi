import React, { useState } from "react";
import type { TableSection } from "./canvas-types.js";
import { sanitizeHtml } from "./CanvasRenderer.js";

export function TableRenderer({ section }: { section: TableSection }): React.JSX.Element {
  const pageSize = section.pageSize ?? 20;
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(section.rows.length / pageSize);
  const visibleRows = section.rows.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div>
      {section.title && (
        <h4 style={{ color: "var(--blue, #89b4fa)", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
          {section.title}
        </h4>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr>
              {section.columns.map((col) => (
                <th key={col.key} style={{
                  textAlign: col.align ?? "left",
                  padding: "0.5rem 0.75rem",
                  borderBottom: "1px solid var(--border, #585b70)",
                  color: "var(--subtext, #a6adc8)",
                  fontWeight: 600,
                  fontSize: "0.75rem",
                  textTransform: "uppercase",
                }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--overlay, #45475a)" }}>
                {section.columns.map((col) => (
                  <td key={col.key} style={{
                    textAlign: col.align ?? "left",
                    padding: "0.5rem 0.75rem",
                    color: "var(--text, #cdd6f4)",
                  }}>
                    {sanitizeHtml(String(row[col.key] ?? ""))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", marginTop: "0.75rem" }}>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            style={paginationBtnStyle}
          >
            Prev
          </button>
          <span style={{ fontSize: "0.8rem", color: "var(--subtext, #a6adc8)", alignSelf: "center" }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={paginationBtnStyle}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

const paginationBtnStyle: React.CSSProperties = {
  background: "var(--overlay, #45475a)",
  border: "1px solid var(--border, #585b70)",
  color: "var(--text, #cdd6f4)",
  borderRadius: "4px",
  padding: "0.25rem 0.75rem",
  cursor: "pointer",
  fontSize: "0.8rem",
};
