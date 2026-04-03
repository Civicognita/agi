import React from "react";
import type { SealSection } from "./canvas-types.js";

function alignmentColor(value: number): string {
  if (value >= 0.9) return "var(--green, #a6e3a1)";
  if (value >= 0.7) return "var(--teal, #94e2d5)";
  if (value >= 0.55) return "var(--yellow, #f9e2af)";
  return "var(--red, #f38ba8)";
}

export function SealRenderer({ section }: { section: SealSection }): React.JSX.Element {
  const statusColor = section.status === "active"
    ? "var(--green, #a6e3a1)"
    : "var(--red, #f38ba8)";

  return (
    <div style={{
      background: "var(--overlay, #45475a)",
      borderRadius: "8px",
      borderLeft: `4px solid ${statusColor}`,
      padding: "1rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <span style={{ fontWeight: 600, color: "var(--text, #cdd6f4)", fontSize: "0.9rem" }}>
          0R Seal
        </span>
        <span style={{
          fontSize: "0.7rem",
          padding: "0.15rem 0.5rem",
          borderRadius: "4px",
          background: statusColor,
          color: "var(--bg, #1e1e2e)",
          fontWeight: 700,
        }}>
          {section.status.toUpperCase()}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.8rem" }}>
        <div>
          <span style={{ color: "var(--subtext, #a6adc8)" }}>Entity: </span>
          <span style={{ color: "var(--text, #cdd6f4)", fontFamily: "monospace" }}>{section.entityType} {section.entityId}</span>
        </div>
        <div>
          <span style={{ color: "var(--subtext, #a6adc8)" }}>Issued: </span>
          <span style={{ color: "var(--text, #cdd6f4)" }}>{new Date(section.issuedAt).toLocaleDateString()}</span>
        </div>
      </div>

      <div style={{ marginTop: "0.75rem" }}>
        {(["a_a", "u_u", "c_c"] as const).map((key) => {
          const value = section.alignment[key];
          const label = key === "a_a" ? "A:A" : key === "u_u" ? "U:U" : "C:C";
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--subtext, #a6adc8)", width: "2rem" }}>{label}</span>
              <div style={{ flex: 1, height: 6, background: "var(--surface, #313244)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${value * 100}%`, background: alignmentColor(value), borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: "0.75rem", fontFamily: "monospace", width: "2.5rem", textAlign: "right" }}>
                {(value * 100).toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>

      <pre style={{
        marginTop: "0.75rem",
        fontSize: "0.7rem",
        color: "var(--subtext, #a6adc8)",
        fontFamily: "monospace",
        whiteSpace: "pre-wrap",
        background: "var(--surface, #313244)",
        padding: "0.5rem",
        borderRadius: "4px",
      }}>
        {section.grid}
      </pre>
    </div>
  );
}
