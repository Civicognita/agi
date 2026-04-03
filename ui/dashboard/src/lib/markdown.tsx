/**
 * Shared markdown rendering components for ReactMarkdown.
 *
 * Used by ChatFlyout and DocsPage to render markdown consistently.
 * Accepts an optional `prose` flag for full-page doc rendering (larger fonts, spacing).
 */

import type { Components } from "react-markdown";

export function markdownComponents(opts?: { prose?: boolean }): Components {
  const prose = opts?.prose ?? false;
  const fs = prose ? "14px" : "12px";
  const codeFontSize = prose ? "13px" : "12px";

  return {
    pre: ({ children, ...props }) => (
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
    ),
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
