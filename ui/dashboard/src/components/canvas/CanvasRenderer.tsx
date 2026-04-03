/**
 * Canvas Renderer — Task #167
 *
 * Top-level renderer that takes a CanvasDocument and renders each section
 * using the appropriate component. Handles XSS prevention by sanitizing
 * all text content before rendering.
 */

import React from "react";
import type { CanvasDocument, CanvasSection } from "./canvas-types.js";
import { TextRenderer } from "./TextRenderer.js";
import { ChartRenderer } from "./ChartRenderer.js";
import { MetricRenderer } from "./MetricRenderer.js";
import { TableRenderer } from "./TableRenderer.js";
import { EntityCardRenderer } from "./EntityCardRenderer.js";
import { SealRenderer } from "./SealRenderer.js";
import { COAChainRenderer } from "./COAChainRenderer.js";
import { FormRenderer } from "./FormRenderer.js";

// ---------------------------------------------------------------------------
// XSS sanitizer
// ---------------------------------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

export function sanitizeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] ?? c);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CanvasRendererProps {
  document: CanvasDocument;
  onFormSubmit?: (action: string, values: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CanvasRenderer({ document: doc, onFormSubmit }: CanvasRendererProps): React.JSX.Element {
  return (
    <div style={{
      background: "var(--surface, #313244)",
      borderRadius: "12px",
      padding: "1.5rem",
      maxWidth: "800px",
    }}>
      <h2 style={{
        color: "var(--mauve, #cba6f7)",
        fontSize: "1.25rem",
        marginBottom: "1.5rem",
        borderBottom: "1px solid var(--border, #585b70)",
        paddingBottom: "0.75rem",
      }}>
        {sanitizeHtml(doc.title)}
      </h2>

      {doc.sections.map((section, i) => (
        <div key={i} style={{ marginBottom: "1.25rem" }}>
          <SectionRenderer section={section} onFormSubmit={onFormSubmit} />
        </div>
      ))}

      <div style={{
        fontSize: "0.7rem",
        color: "var(--subtext, #a6adc8)",
        marginTop: "1rem",
        textAlign: "right",
      }}>
        {new Date(doc.createdAt).toLocaleString()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section dispatcher
// ---------------------------------------------------------------------------

function SectionRenderer({
  section,
  onFormSubmit,
}: {
  section: CanvasSection;
  onFormSubmit?: (action: string, values: Record<string, unknown>) => void;
}): React.JSX.Element {
  switch (section.type) {
    case "text":
      return <TextRenderer content={section.content} />;
    case "chart":
      return <ChartRenderer section={section} />;
    case "metric":
      return <MetricRenderer section={section} />;
    case "table":
      return <TableRenderer section={section} />;
    case "entity-card":
      return <EntityCardRenderer section={section} />;
    case "seal":
      return <SealRenderer section={section} />;
    case "coa-chain":
      return <COAChainRenderer section={section} />;
    case "form":
      return <FormRenderer section={section} onSubmit={onFormSubmit} />;
  }
}
