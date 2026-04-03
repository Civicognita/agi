/**
 * Canvas types for the browser renderer.
 * Mirrors gateway-core/canvas-types.ts but avoids importing Node.js code.
 */

export interface CanvasDocument {
  id: string;
  title: string;
  sections: CanvasSection[];
  createdAt: string;
  createdBy: string;
  metadata?: Record<string, unknown>;
}

export type CanvasSection =
  | TextSection
  | ChartSection
  | COAChainSection
  | EntityCardSection
  | SealSection
  | MetricSection
  | TableSection
  | FormSection;

export interface TextSection { type: "text"; content: string; }

export interface ChartSection {
  type: "chart";
  title: string;
  chartType: "line" | "bar" | "area" | "pie";
  data: Record<string, string | number>[];
  series: Array<{ key: string; label: string; color?: string }>;
  xKey: string;
}

export interface COAChainSection {
  type: "coa-chain";
  entries: Array<{
    fingerprint: string;
    entityId: string;
    workType: string;
    impScore: number;
    timestamp: string;
    parentFingerprint?: string;
  }>;
  graphMode?: boolean;
}

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

export interface MetricSection {
  type: "metric";
  label: string;
  value: number | string;
  unit?: string;
  change?: { value: number; direction: "up" | "down" | "flat"; period: string };
}

export interface TableSection {
  type: "table";
  title?: string;
  columns: Array<{ key: string; label: string; align?: "left" | "center" | "right" }>;
  rows: Record<string, string | number | boolean>[];
  pageSize?: number;
}

export interface FormSection {
  type: "form";
  title: string;
  fields: Array<{
    name: string;
    label: string;
    fieldType: "text" | "number" | "select" | "checkbox" | "textarea";
    required?: boolean;
    placeholder?: string;
    options?: Array<{ label: string; value: string }>;
    defaultValue?: string | number | boolean;
  }>;
  submitLabel?: string;
  action: string;
}
