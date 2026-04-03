import React from "react";
import type { COAChainSection } from "./canvas-types.js";
import { sanitizeHtml } from "./CanvasRenderer.js";

export function COAChainRenderer({ section }: { section: COAChainSection }): React.JSX.Element {
  // Table mode (default) — graph mode would use D3 force graph (future)
  return (
    <div>
      <h4 style={{ color: "var(--blue, #89b4fa)", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
        COA Chain ({section.entries.length} entries)
      </h4>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              {["Fingerprint", "Entity", "Work Type", "$imp", "Time"].map((h) => (
                <th key={h} style={{
                  textAlign: "left",
                  padding: "0.4rem 0.6rem",
                  borderBottom: "1px solid var(--border, #585b70)",
                  color: "var(--subtext, #a6adc8)",
                  fontWeight: 600,
                  fontSize: "0.7rem",
                  textTransform: "uppercase",
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.entries.map((entry, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--overlay, #45475a)" }}>
                <td style={{ padding: "0.4rem 0.6rem", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--teal, #94e2d5)" }}>
                  {sanitizeHtml(entry.fingerprint)}
                </td>
                <td style={{ padding: "0.4rem 0.6rem", color: "var(--text, #cdd6f4)" }}>
                  {sanitizeHtml(entry.entityId)}
                </td>
                <td style={{ padding: "0.4rem 0.6rem", color: "var(--text, #cdd6f4)" }}>
                  {sanitizeHtml(entry.workType)}
                </td>
                <td style={{
                  padding: "0.4rem 0.6rem",
                  fontFamily: "monospace",
                  color: entry.impScore >= 0 ? "var(--green, #a6e3a1)" : "var(--red, #f38ba8)",
                  fontWeight: 600,
                }}>
                  {entry.impScore >= 0 ? "+" : ""}{entry.impScore.toFixed(2)}
                </td>
                <td style={{ padding: "0.4rem 0.6rem", color: "var(--subtext, #a6adc8)", fontSize: "0.75rem" }}>
                  {new Date(entry.timestamp).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
