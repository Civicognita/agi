/**
 * Shared markdown rendering components for ReactMarkdown.
 *
 * Used by ChatFlyout and DocsPage to render markdown consistently.
 * Accepts an optional `prose` flag for full-page doc rendering (larger fonts, spacing).
 *
 * Supports custom block types:
 *   ```question [...] ``` — renders interactive form fields
 *   ```mockup {...} ```  — renders MagicApp preview
 */

import { useState, type ReactNode } from "react";
import type { Components } from "react-markdown";

// ---------------------------------------------------------------------------
// Question Block Renderer
// ---------------------------------------------------------------------------

function QuestionBlock({ json, onSubmit }: { json: string; onSubmit?: (answers: Record<string, string>) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  let questions: Array<{ question: string; type: string; key: string; options?: string[]; placeholder?: string }>;
  try { questions = JSON.parse(json); } catch { return <div style={{ color: "var(--color-red)", fontSize: "11px" }}>Invalid question block JSON</div>; }
  if (!Array.isArray(questions)) return null;

  if (submitted) {
    return (
      <div style={{ padding: "8px 12px", borderRadius: "8px", background: "var(--color-green)", color: "var(--color-background)", fontSize: "11px", fontWeight: 600, margin: "6px 0" }}>
        Questions answered
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--color-primary)", borderRadius: "8px", padding: "12px", margin: "6px 0", background: "var(--color-mantle)" }}>
      {questions.map((q) => (
        <div key={q.key} style={{ marginBottom: "10px" }}>
          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--color-foreground)", marginBottom: "4px" }}>
            {q.question}
          </label>
          {q.type === "textarea" ? (
            <textarea
              value={answers[q.key] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              placeholder={q.placeholder ?? ""}
              rows={3}
              style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)", fontSize: "12px", resize: "vertical" }}
            />
          ) : q.type === "select" || q.type === "multiselect" ? (
            <select
              value={answers[q.key] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)", fontSize: "12px" }}
            >
              <option value="">Select...</option>
              {(q.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          ) : (
            <input
              type="text"
              value={answers[q.key] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              placeholder={q.placeholder ?? ""}
              style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)", fontSize: "12px" }}
            />
          )}
        </div>
      ))}
      <button
        onClick={() => { setSubmitted(true); onSubmit?.(answers); }}
        style={{ padding: "6px 16px", borderRadius: "6px", background: "var(--color-primary)", color: "var(--color-primary-foreground)", border: "none", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
      >
        Submit
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mockup Block Renderer
// ---------------------------------------------------------------------------

function MockupBlock({ json }: { json: string }) {
  let data: Record<string, unknown>;
  try { data = JSON.parse(json); } catch { return <div style={{ color: "var(--color-red)", fontSize: "11px" }}>Invalid mockup JSON</div>; }

  const name = (data.name as string) ?? "Untitled";
  const category = (data.category as string) ?? "custom";
  const projectTypes = (data.projectTypes as string[]) ?? [];

  return (
    <div style={{ border: "1px solid var(--color-blue)", borderRadius: "8px", padding: "12px", margin: "6px 0", background: "var(--color-mantle)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span style={{ fontSize: "18px" }}>{"\u2728"}</span>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-foreground)" }}>{name}</div>
          <div style={{ fontSize: "10px", color: "var(--color-muted-foreground)" }}>
            {category} &middot; {projectTypes.join(", ") || "all types"}
          </div>
        </div>
      </div>
      {Boolean(data.description) && (
        <p style={{ fontSize: "12px", color: "var(--color-subtext0)", margin: "4px 0 8px" }}>{String(data.description)}</p>
      )}
      <div style={{ fontSize: "10px", color: "var(--color-muted-foreground)", fontFamily: "monospace", background: "var(--color-surface0)", borderRadius: "4px", padding: "6px 8px", maxHeight: "200px", overflow: "auto" }}>
        {JSON.stringify(data, null, 2)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extract text content from React children
// ---------------------------------------------------------------------------

function extractText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractText((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

export function markdownComponents(opts?: { prose?: boolean; onQuestionSubmit?: (answers: Record<string, string>) => void }): Components {
  const prose = opts?.prose ?? false;
  const fs = prose ? "14px" : "12px";
  const codeFontSize = prose ? "13px" : "12px";

  return {
    pre: ({ children, ...props }) => {
      // Detect custom block types (question, mockup) from the code element's className
      const codeChild = Array.isArray(children) ? children[0] : children;
      if (codeChild && typeof codeChild === "object" && "props" in codeChild) {
        const codeProps = (codeChild as { props: { className?: string; children?: ReactNode } }).props;
        const lang = codeProps.className?.replace("language-", "") ?? "";
        const text = extractText(codeProps.children);

        if (lang === "question") {
          return <QuestionBlock json={text} onSubmit={opts?.onQuestionSubmit} />;
        }
        if (lang === "mockup") {
          return <MockupBlock json={text} />;
        }
      }

      return (
        <pre
          {...props}
          style={{
            background: "var(--color-mantle)",
            border: "1px solid var(--color-surface0)",
            borderRadius: "6px",
            padding: prose ? "14px 16px" : "10px 12px",
            overflowX: "auto",
            fontSize: codeFontSize,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            margin: prose ? "12px 0" : "6px 0",
            lineHeight: "1.5",
          }}
        >
          {children}
        </pre>
      );
    },
    code: ({ children, className, ...props }) => {
      if (!className) {
        return (
          <code
            {...props}
            style={{
              background: "var(--color-mantle)",
              borderRadius: "3px",
              padding: "1px 5px",
              fontSize: codeFontSize,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}
          >
            {children}
          </code>
        );
      }
      return (
        <code
          {...props}
          className={className}
          style={{
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: codeFontSize,
          }}
        >
          {children}
        </code>
      );
    },
    h1: ({ children, ...props }) => (
      <h1 {...props} style={{ fontSize: prose ? "28px" : "18px", fontWeight: 700, margin: prose ? "24px 0 12px" : "8px 0 4px" }}>{children}</h1>
    ),
    h2: ({ children, ...props }) => (
      <h2 {...props} style={{ fontSize: prose ? "22px" : "16px", fontWeight: 700, margin: prose ? "20px 0 8px" : "8px 0 4px" }}>{children}</h2>
    ),
    h3: ({ children, ...props }) => (
      <h3 {...props} style={{ fontSize: prose ? "18px" : "14px", fontWeight: 600, margin: prose ? "16px 0 6px" : "6px 0 3px" }}>{children}</h3>
    ),
    p: ({ children, ...props }) => (
      <p {...props} style={{ margin: prose ? "8px 0" : "4px 0", lineHeight: "1.6", fontSize: fs }}>{children}</p>
    ),
    ul: ({ children, ...props }) => (
      <ul {...props} style={{ margin: prose ? "8px 0" : "4px 0", paddingLeft: "20px", fontSize: fs }}>{children}</ul>
    ),
    ol: ({ children, ...props }) => (
      <ol {...props} style={{ margin: prose ? "8px 0" : "4px 0", paddingLeft: "20px", fontSize: fs }}>{children}</ol>
    ),
    li: ({ children, ...props }) => (
      <li {...props} style={{ margin: prose ? "4px 0" : "2px 0", lineHeight: "1.6" }}>{children}</li>
    ),
    a: ({ children, href, ...props }) => (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--color-blue)", textDecoration: "underline" }}
      >
        {children}
      </a>
    ),
    blockquote: ({ children, ...props }) => (
      <blockquote
        {...props}
        style={{
          borderLeft: "3px solid var(--color-blue)",
          paddingLeft: prose ? "14px" : "10px",
          margin: prose ? "12px 0" : "6px 0",
          fontStyle: "italic",
          color: "var(--color-subtext0)",
        }}
      >
        {children}
      </blockquote>
    ),
    table: ({ children, ...props }) => (
      <div style={{ overflowX: "auto", margin: prose ? "12px 0" : "6px 0" }}>
        <table
          {...props}
          style={{
            borderCollapse: "collapse",
            width: "100%",
            fontSize: prose ? "13px" : "12px",
          }}
        >
          {children}
        </table>
      </div>
    ),
    thead: ({ children, ...props }) => (
      <thead {...props} style={{ background: "var(--color-surface0)" }}>{children}</thead>
    ),
    th: ({ children, ...props }) => (
      <th
        {...props}
        style={{
          border: "1px solid var(--color-surface0)",
          padding: prose ? "6px 12px" : "4px 8px",
          textAlign: "left",
          fontWeight: 600,
        }}
      >
        {children}
      </th>
    ),
    td: ({ children, ...props }) => (
      <td
        {...props}
        style={{
          border: "1px solid var(--color-surface0)",
          padding: prose ? "6px 12px" : "4px 8px",
        }}
      >
        {children}
      </td>
    ),
    hr: ({ ...props }) => (
      <hr {...props} style={{ border: "none", borderTop: "1px solid var(--color-surface0)", margin: prose ? "16px 0" : "8px 0" }} />
    ),
  };
}
