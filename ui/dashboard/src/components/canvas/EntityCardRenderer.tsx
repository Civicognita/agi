import React from "react";
import type { EntityCardSection } from "./canvas-types.js";

const TIER_COLORS: Record<string, string> = {
  sealed: "var(--green, #a6e3a1)",
  verified: "var(--blue, #89b4fa)",
  unverified: "var(--subtext, #a6adc8)",
};

export function EntityCardRenderer({ section }: { section: EntityCardSection }): React.JSX.Element {
  return (
    <div style={{
      background: "var(--overlay, #45475a)",
      borderRadius: "8px",
      padding: "1rem",
      display: "flex",
      gap: "1rem",
      alignItems: "center",
    }}>
      <div style={{
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "var(--surface, #313244)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1.25rem",
        fontWeight: 700,
        color: "var(--mauve, #cba6f7)",
        flexShrink: 0,
      }}>
        {section.avatarUrl
          ? <img src={section.avatarUrl} alt="" style={{ width: 48, height: 48, borderRadius: "50%" }} />
          : section.displayName.charAt(0).toUpperCase()
        }
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontWeight: 600, color: "var(--text, #cdd6f4)" }}>
            {section.displayName}
          </span>
          <span style={{
            fontSize: "0.7rem",
            padding: "0.1rem 0.4rem",
            borderRadius: "4px",
            background: TIER_COLORS[section.verificationTier] ?? "var(--subtext)",
            color: "var(--bg, #1e1e2e)",
            fontWeight: 600,
          }}>
            {section.verificationTier}
          </span>
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--subtext, #a6adc8)", marginTop: "0.25rem" }}>
          {section.entityType} {section.entityId}
        </div>
        <div style={{ fontSize: "0.85rem", color: "var(--teal, #94e2d5)", marginTop: "0.25rem", fontWeight: 600 }}>
          {section.totalImp.toLocaleString()} $imp
        </div>
      </div>
      {section.sealStatus && section.sealStatus !== "none" && (
        <div style={{
          fontSize: "0.7rem",
          padding: "0.2rem 0.5rem",
          borderRadius: "4px",
          background: section.sealStatus === "active" ? "var(--green, #a6e3a1)" : "var(--red, #f38ba8)",
          color: "var(--bg, #1e1e2e)",
          fontWeight: 600,
        }}>
          {section.sealStatus === "active" ? "SEALED" : "REVOKED"}
        </div>
      )}
    </div>
  );
}
