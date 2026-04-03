/**
 * Canvas / A2UI Types — Task #166
 *
 * Typed section system for agent-driven visual output.
 * The agent produces structured Canvas documents instead of plain text.
 *
 * Supported section types:
 *   - text:        Rich text (Markdown)
 *   - chart:       Recharts-compatible data series
 *   - coa-chain:   COA chain visualization
 *   - entity-card: Entity profile card
 *   - seal:        Seal verification badge
 *   - metric:      Single KPI metric
 *   - table:       Structured data table
 *   - form:        Structured input form
 *
 * Progressive enhancement:
 *   - WebChat/iOS: Full interactive render
 *   - Telegram:    Text fallback via toPlainText()
 */

// ---------------------------------------------------------------------------
// Canvas document
// ---------------------------------------------------------------------------

/** A Canvas document — ordered list of typed sections. */
export interface CanvasDocument {
  /** Unique document ID. */
  id: string;
  /** Document title (shown in header). */
  title: string;
  /** Ordered sections to render. */
  sections: CanvasSection[];
  /** Timestamp of creation. */
  createdAt: string;
  /** Entity ID of the agent that produced this canvas. */
  createdBy: string;
  /** Optional metadata for tracking/routing. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Section types
// ---------------------------------------------------------------------------

export type CanvasSection =
  | TextSection
  | ChartSection
  | COAChainSection
  | EntityCardSection
  | SealSection
  | MetricSection
  | TableSection
  | FormSection;

export type CanvasSectionType = CanvasSection["type"];

/** Rich text section (Markdown). */
export interface TextSection {
  type: "text";
  /** Markdown content. */
  content: string;
}

/** Chart section — data + chart configuration. */
export interface ChartSection {
  type: "chart";
  /** Chart title. */
  title: string;
  /** Chart variant. */
  chartType: "line" | "bar" | "area" | "pie";
  /** Data series to plot. */
  data: ChartDataPoint[];
  /** Series keys to render (column names in data). */
  series: ChartSeries[];
  /** X-axis key in data points. */
  xKey: string;
}

export interface ChartDataPoint {
  [key: string]: string | number;
}

export interface ChartSeries {
  key: string;
  label: string;
  color?: string;
}

/** COA chain visualization section. */
export interface COAChainSection {
  type: "coa-chain";
  /** COA chain entries to visualize. */
  entries: COAChainEntry[];
  /** If true, render as a force-directed graph (D3). Otherwise table. */
  graphMode?: boolean;
}

export interface COAChainEntry {
  fingerprint: string;
  entityId: string;
  workType: string;
  impScore: number;
  timestamp: string;
  parentFingerprint?: string;
}

/** Entity profile card. */
export interface EntityCardSection {
  type: "entity-card";
  entityId: string;
  entityType: string;
  displayName: string;
  verificationTier: string;
  totalImp: number;
  sealStatus?: "active" | "revoked" | "none";
  avatarUrl?: string;
}

/** Seal verification badge. */
export interface SealSection {
  type: "seal";
  sealId: string;
  entityId: string;
  entityType: string;
  status: "active" | "revoked";
  alignment: { a_a: number; u_u: number; c_c: number };
  issuedAt: string;
  issuedBy: string;
  grid: string;
}

/** Single metric display. */
export interface MetricSection {
  type: "metric";
  label: string;
  value: number | string;
  /** Optional unit (e.g., "$imp", "%", "entities"). */
  unit?: string;
  /** Change indicator. */
  change?: {
    value: number;
    direction: "up" | "down" | "flat";
    period: string;
  };
}

/** Data table section. */
export interface TableSection {
  type: "table";
  title?: string;
  columns: TableColumn[];
  rows: Record<string, string | number | boolean>[];
  /** Max rows to display before "show more". */
  pageSize?: number;
}

export interface TableColumn {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
}

/** Structured input form section. */
export interface FormSection {
  type: "form";
  /** Form title. */
  title: string;
  /** Form fields. */
  fields: FormField[];
  /** Submit button label. */
  submitLabel?: string;
  /** Action identifier for the agent to handle submission. */
  action: string;
}

export interface FormField {
  name: string;
  label: string;
  fieldType: "text" | "number" | "select" | "checkbox" | "textarea";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>; // for select
  defaultValue?: string | number | boolean;
}

// ---------------------------------------------------------------------------
// Plain text fallback
// ---------------------------------------------------------------------------

/**
 * Convert a Canvas document to plain text for channels that don't
 * support rich rendering (Telegram, SMS, etc.).
 */
export function canvasToPlainText(doc: CanvasDocument): string {
  const parts: string[] = [`**${doc.title}**`, ""];

  for (const section of doc.sections) {
    parts.push(sectionToPlainText(section));
    parts.push("");
  }

  return parts.join("\n").trim();
}

function sectionToPlainText(section: CanvasSection): string {
  switch (section.type) {
    case "text":
      return section.content;

    case "chart":
      return `[Chart: ${section.title}] (${section.data.length} data points)`;

    case "coa-chain": {
      const lines = section.entries.map(
        (e) => `  ${e.fingerprint}  ${e.workType}  $imp ${e.impScore}`,
      );
      return `COA Chain (${section.entries.length} entries):\n${lines.join("\n")}`;
    }

    case "entity-card":
      return [
        `Entity: ${section.displayName}`,
        `  Type: ${section.entityType}  Tier: ${section.verificationTier}`,
        `  Total $imp: ${section.totalImp}`,
      ].join("\n");

    case "seal":
      return [
        `Seal: ${section.sealId}`,
        `  Status: ${section.status}`,
        `  A:A ${section.alignment.a_a}  U:U ${section.alignment.u_u}  C:C ${section.alignment.c_c}`,
      ].join("\n");

    case "metric": {
      const changeStr = section.change
        ? ` (${section.change.direction === "up" ? "+" : section.change.direction === "down" ? "-" : ""}${section.change.value} ${section.change.period})`
        : "";
      return `${section.label}: ${section.value}${section.unit ? " " + section.unit : ""}${changeStr}`;
    }

    case "table": {
      const header = section.columns.map((c) => c.label).join(" | ");
      const rows = section.rows
        .slice(0, section.pageSize ?? 20)
        .map((row) =>
          section.columns.map((c) => String(row[c.key] ?? "")).join(" | "),
        );
      return `${section.title ?? "Table"}:\n${header}\n${rows.join("\n")}`;
    }

    case "form":
      return `[Form: ${section.title}] (${section.fields.length} fields)`;
  }
}
