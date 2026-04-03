import React from "react";
import { sanitizeHtml } from "./CanvasRenderer.js";

export function TextRenderer({ content }: { content: string }): React.JSX.Element {
  // Basic Markdown-like rendering: bold, italic, code, headers
  const lines = content.split("\n");

  return (
    <div style={{ color: "var(--text, #cdd6f4)", fontSize: "0.9rem", lineHeight: 1.6 }}>
      {lines.map((line, i) => {
        const sanitized = sanitizeHtml(line);

        if (sanitized.startsWith("### ")) {
          return <h4 key={i} style={{ color: "var(--blue, #89b4fa)", margin: "0.75rem 0 0.25rem" }}>{sanitized.slice(4)}</h4>;
        }
        if (sanitized.startsWith("## ")) {
          return <h3 key={i} style={{ color: "var(--blue, #89b4fa)", margin: "0.75rem 0 0.25rem" }}>{sanitized.slice(3)}</h3>;
        }
        if (sanitized.startsWith("# ")) {
          return <h2 key={i} style={{ color: "var(--blue, #89b4fa)", margin: "0.75rem 0 0.25rem" }}>{sanitized.slice(2)}</h2>;
        }
        if (sanitized.startsWith("- ") || sanitized.startsWith("* ")) {
          return <div key={i} style={{ paddingLeft: "1rem" }}>{"\u2022 "}{sanitized.slice(2)}</div>;
        }
        if (sanitized.trim() === "") {
          return <br key={i} />;
        }

        return <p key={i} style={{ margin: "0.25rem 0" }}>{sanitized}</p>;
      })}
    </div>
  );
}
