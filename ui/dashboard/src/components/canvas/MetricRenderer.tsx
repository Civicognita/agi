import React from "react";
import type { MetricSection } from "./canvas-types.js";

export function MetricRenderer({ section }: { section: MetricSection }): React.JSX.Element {
  const changeColor = section.change
    ? section.change.direction === "up"
      ? "var(--green, #a6e3a1)"
      : section.change.direction === "down"
        ? "var(--red, #f38ba8)"
        : "var(--subtext, #a6adc8)"
    : undefined;

  const changeIcon = section.change
    ? section.change.direction === "up" ? "\u2191" : section.change.direction === "down" ? "\u2193" : "\u2192"
    : "";

  return (
    <div style={{
      background: "var(--overlay, #45475a)",
      borderRadius: "8px",
      padding: "1rem 1.25rem",
      display: "inline-block",
      minWidth: "140px",
    }}>
      <div style={{ fontSize: "0.75rem", color: "var(--subtext, #a6adc8)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {section.label}
      </div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text, #cdd6f4)", marginTop: "0.25rem" }}>
        {typeof section.value === "number" ? section.value.toLocaleString() : section.value}
        {section.unit && <span style={{ fontSize: "0.85rem", marginLeft: "0.25rem", color: "var(--subtext, #a6adc8)" }}>{section.unit}</span>}
      </div>
      {section.change && (
        <div style={{ fontSize: "0.8rem", color: changeColor, marginTop: "0.25rem" }}>
          {changeIcon} {section.change.value} {section.change.period}
        </div>
      )}
    </div>
  );
}
