import React, { useState } from "react";
import type { FormSection } from "./canvas-types.js";
import { sanitizeHtml } from "./CanvasRenderer.js";

export function FormRenderer({
  section,
  onSubmit,
}: {
  section: FormSection;
  onSubmit?: (action: string, values: Record<string, unknown>) => void;
}): React.JSX.Element {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const field of section.fields) {
      initial[field.name] = field.defaultValue ?? (field.fieldType === "checkbox" ? false : "");
    }
    return initial;
  });

  const handleChange = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.(section.action, values);
  };

  return (
    <form onSubmit={handleSubmit} style={{
      background: "var(--overlay, #45475a)",
      borderRadius: "8px",
      padding: "1rem",
    }}>
      <h4 style={{ color: "var(--blue, #89b4fa)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
        {sanitizeHtml(section.title)}
      </h4>

      {section.fields.map((field) => (
        <div key={field.name} style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", fontSize: "0.8rem", color: "var(--subtext, #a6adc8)", marginBottom: "0.25rem" }}>
            {field.label}
            {field.required && <span style={{ color: "var(--red, #f38ba8)" }}> *</span>}
          </label>

          {field.fieldType === "textarea" ? (
            <textarea
              value={String(values[field.name] ?? "")}
              onChange={(e) => handleChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              required={field.required}
              style={inputStyle}
              rows={3}
            />
          ) : field.fieldType === "select" ? (
            <select
              value={String(values[field.name] ?? "")}
              onChange={(e) => handleChange(field.name, e.target.value)}
              required={field.required}
              style={inputStyle}
            >
              <option value="">Select...</option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : field.fieldType === "checkbox" ? (
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={Boolean(values[field.name])}
                onChange={(e) => handleChange(field.name, e.target.checked)}
              />
              <span style={{ fontSize: "0.85rem", color: "var(--text, #cdd6f4)" }}>{field.placeholder ?? ""}</span>
            </label>
          ) : (
            <input
              type={field.fieldType}
              value={String(values[field.name] ?? "")}
              onChange={(e) => handleChange(field.name, field.fieldType === "number" ? Number(e.target.value) : e.target.value)}
              placeholder={field.placeholder}
              required={field.required}
              style={inputStyle}
            />
          )}
        </div>
      ))}

      <button type="submit" style={{
        background: "var(--blue, #89b4fa)",
        color: "var(--bg, #1e1e2e)",
        border: "none",
        borderRadius: "6px",
        padding: "0.5rem 1.5rem",
        fontWeight: 600,
        cursor: "pointer",
        fontSize: "0.85rem",
      }}>
        {section.submitLabel ?? "Submit"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--surface, #313244)",
  border: "1px solid var(--border, #585b70)",
  borderRadius: "4px",
  color: "var(--text, #cdd6f4)",
  padding: "0.5rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
};
