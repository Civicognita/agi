/**
 * MAppFormRenderer — multi-step wizard form for MApps with pages.
 *
 * Renders fields by type, calculates formulas, evaluates conditions,
 * and handles page navigation.
 */

import { useCallback, useMemo, useState } from "react";
import { Textarea } from "@particle-academy/react-fancy";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Select } from "@/components/ui/select.js";
import { WidgetRenderer } from "./WidgetRenderer.js";

// ---------------------------------------------------------------------------
// Types (mirrors MApp schema from SDK — UI-side copies)
// ---------------------------------------------------------------------------

interface MAppField {
  key: string; cell: string; type: string; label: string;
  required?: boolean; placeholder?: string; options?: string[];
  min?: number; max?: number;
}

interface MAppFormula {
  cell: string; label: string; expression: string;
  format: "number" | "currency" | "percent" | "text"; visible: boolean;
}

interface MAppConstant {
  key: string; cell: string; label: string;
  value: number | string; format: string; visibility: string;
}

interface MAppPage {
  key: string; title: string; pageType: string; visibility: string;
  fields?: MAppField[]; formulas?: MAppFormula[];
  url?: string; widgets?: Array<Record<string, unknown>>;
}

export interface MAppFormRendererProps {
  pages: MAppPage[];
  constants?: MAppConstant[];
  onSubmit: (values: Record<string, unknown>, formulas: Record<string, unknown>) => void;
  projectPath?: string;
}

// ---------------------------------------------------------------------------
// Formula evaluator (basic arithmetic + cell refs)
// ---------------------------------------------------------------------------

function evaluateFormulas(
  formulas: MAppFormula[],
  values: Record<string, unknown>,
  constants: MAppConstant[],
  allFields: MAppField[],
): Record<string, number | string> {
  const cells: Record<string, number> = {};

  // Map A-cells from field values
  for (const f of allFields) {
    const v = values[f.key];
    cells[f.cell] = typeof v === "number" ? v : parseFloat(String(v)) || 0;
  }

  // Map C-cells from constants
  for (const c of constants) {
    cells[c.cell] = typeof c.value === "number" ? c.value : parseFloat(String(c.value)) || 0;
  }

  const results: Record<string, number | string> = {};

  for (const formula of formulas) {
    try {
      // Replace cell refs with values
      let expr = formula.expression;
      const refs = expr.match(/[ABC]\d+/g) ?? [];
      for (const ref of refs) {
        expr = expr.replace(new RegExp(`\\b${ref}\\b`, "g"), String(cells[ref] ?? 0));
      }
      // Simple eval (safe — only numbers and operators from cell refs)
      const result = new Function(`"use strict"; return (${expr})`)() as number;
      cells[formula.cell] = result;
      results[formula.cell] = isNaN(result) ? 0 : result;
    } catch {
      results[formula.cell] = 0;
    }
  }

  return results;
}

function formatValue(val: number | string, format: string): string {
  const num = typeof val === "number" ? val : parseFloat(String(val)) || 0;
  switch (format) {
    case "currency": return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "percent": return `${(num * 100).toFixed(1)}%`;
    case "number": return num.toLocaleString();
    default: return String(val);
  }
}

// ---------------------------------------------------------------------------
// Field renderer
// ---------------------------------------------------------------------------

function FieldInput({ field, value, onChange }: { field: MAppField; value: unknown; onChange: (v: unknown) => void }) {
  const cls = "text-[13px]";

  switch (field.type) {
    case "textarea":
      return <Textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} rows={3} className={cls} style={{ resize: "vertical" }} />;

    case "number": case "int": case "currency": case "percentage":
      return <Input type="number" value={String(value ?? "")} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} placeholder={field.placeholder} min={field.min} max={field.max} step={field.type === "int" ? 1 : "any"} className={cls} />;

    case "select":
      return (
        <Select
          className={cls}
          list={[
            { value: "", label: "Select..." },
            ...(field.options ?? []).map((o) => ({ value: o, label: o })),
          ]}
          value={String(value ?? "")}
          onValueChange={onChange}
        />
      );

    case "multiselect":
      return (
        <Select
          className={cls}
          variant="listbox"
          multiple
          list={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          values={Array.isArray(value) ? (value as string[]) : value ? [String(value)] : []}
          onValuesChange={onChange}
        />
      );

    case "bool":
      return (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>
      );

    case "date": case "date_range":
      return <Input type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={cls} />;

    case "time":
      return <Input type="time" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={cls} />;

    case "email":
      return <Input type="email" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder ?? "email@example.com"} className={cls} />;

    case "url":
      return <Input type="url" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder ?? "https://"} className={cls} />;

    case "phone":
      return <Input type="tel" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className={cls} />;

    case "info":
      return <div className="text-[12px] text-muted-foreground py-1">{field.placeholder ?? field.label}</div>;

    default: // text and fallback
      return <Input type="text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className={cls} />;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MAppFormRenderer({ pages, constants = [], onSubmit, projectPath }: MAppFormRendererProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>({});

  const visiblePages = pages.filter((p) => p.visibility !== "hidden");
  const page = visiblePages[currentPage];
  const isLast = currentPage === visiblePages.length - 1;
  const isFirst = currentPage === 0;

  // Collect all fields across pages for formula evaluation
  const allFields = useMemo(() => pages.flatMap((p) => p.fields ?? []), [pages]);

  // Calculate formulas for current page
  const currentFormulas = useMemo(() => {
    const pageFormulas = page?.formulas ?? [];
    if (pageFormulas.length === 0) return {};
    return evaluateFormulas(pageFormulas, values, constants, allFields);
  }, [page, values, constants, allFields]);

  const handleFieldChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleNext = useCallback(() => {
    if (isLast) {
      // Submit all collected values + formula results
      const allFormulas = pages.flatMap((p) => p.formulas ?? []);
      const allFormulaResults = evaluateFormulas(allFormulas, values, constants, allFields);
      onSubmit(values, allFormulaResults);
    } else {
      setCurrentPage((p) => p + 1);
    }
  }, [isLast, currentPage, values, constants, allFields, pages, onSubmit]);

  if (!page) return <div className="text-muted-foreground text-sm">No pages defined</div>;

  return (
    <div className="flex flex-col h-full">
      {/* Step indicator */}
      {visiblePages.length > 1 && (
        <div className="flex items-center gap-1 mb-4 px-1">
          {visiblePages.map((p, i) => (
            <div key={p.key} className="flex items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                i === currentPage ? "bg-primary text-primary-foreground" :
                i < currentPage ? "bg-green/20 text-green" :
                "bg-surface1 text-muted-foreground"
              }`}>
                {i + 1}
              </div>
              <span className={`text-[11px] ${i === currentPage ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                {p.title}
              </span>
              {i < visiblePages.length - 1 && <div className="w-4 h-px bg-border mx-1" />}
            </div>
          ))}
        </div>
      )}

      {/* Page title */}
      <h3 className="text-[14px] font-semibold text-foreground mb-3">{page.title}</h3>

      {/* Page content */}
      <div className="flex-1 overflow-auto space-y-3">
        {/* Standard/Magic: render fields */}
        {(page.pageType === "standard" || page.pageType === "magic") && page.fields?.map((field) => (
          <div key={field.key}>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
              {field.label}
              {field.required && <span className="text-red ml-0.5">*</span>}
            </label>
            <FieldInput
              field={field}
              value={values[field.key]}
              onChange={(v) => handleFieldChange(field.key, v)}
            />
          </div>
        ))}

        {/* Visible formula results */}
        {page.formulas?.filter((f) => f.visible).map((formula) => (
          <div key={formula.cell} className="p-3 rounded-lg bg-primary/5 border border-primary/20">
            <div className="text-[10px] text-muted-foreground">{formula.label}</div>
            <div className="text-[16px] font-bold text-primary">
              {formatValue(currentFormulas[formula.cell] ?? 0, formula.format)}
            </div>
          </div>
        ))}

        {/* Embedded: iframe */}
        {page.pageType === "embedded" && page.url && (
          <iframe src={page.url} className="w-full border border-border rounded-md" style={{ height: "400px" }} />
        )}

        {/* Canvas: WidgetRenderer */}
        {page.pageType === "canvas" && page.widgets && (
          <WidgetRenderer widgets={page.widgets as import("@/types.js").PanelWidget[]} projectPath={projectPath} />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setCurrentPage((p) => p - 1)}
          disabled={isFirst}
        >
          Back
        </Button>
        <div className="text-[10px] text-muted-foreground">
          Page {currentPage + 1} of {visiblePages.length}
        </div>
        <Button size="sm" onClick={handleNext}>
          {isLast ? "Submit" : "Next"}
        </Button>
      </div>
    </div>
  );
}
