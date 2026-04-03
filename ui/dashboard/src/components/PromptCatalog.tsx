/**
 * PromptCatalog — read-only documentation components for the Workflows page.
 *
 * SystemPromptPipeline: renders the 16-section system prompt assembly as a numbered pipeline.
 * PromptEntryList: renders collapsible cards for agents, workers, commands, and truth entries.
 */

import { useState } from "react";
import type { PromptEntry, SystemPromptSection } from "./prompt-catalog.js";

// ---------------------------------------------------------------------------
// SystemPromptPipeline
// ---------------------------------------------------------------------------

const STEP_COLORS = [
  "var(--color-blue)",
  "var(--color-teal)",
  "var(--color-green)",
  "var(--color-yellow)",
  "var(--color-peach)",
  "var(--color-flamingo)",
  "var(--color-mauve)",
  "var(--color-lavender)",
];

function stepColor(order: number): string {
  return STEP_COLORS[(order - 1) % STEP_COLORS.length]!;
}

export function SystemPromptPipeline({
  entries,
}: {
  entries: SystemPromptSection[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <p
        style={{
          color: "var(--color-muted-foreground)",
          fontSize: 13,
          marginBottom: 16,
          lineHeight: 1.5,
        }}
      >
        The system prompt is assembled fresh on every API invocation — never
        cached. Sections are layered in order; conditional sections are skipped
        when their context is absent.
      </p>
      {entries.map((section, idx) => (
        <div key={section.order} style={{ display: "flex", gap: 0 }}>
          {/* Left rail: step number + connector */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: 40,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: stepColor(section.order),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--color-crust)",
                flexShrink: 0,
              }}
            >
              {section.order}
            </div>
            {idx < entries.length - 1 && (
              <div
                style={{
                  width: 2,
                  flex: 1,
                  background: "var(--color-border)",
                  minHeight: 12,
                }}
              />
            )}
          </div>

          {/* Right: content card */}
          <div
            style={{
              flex: 1,
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: idx < entries.length - 1 ? 0 : 0,
              marginLeft: 8,
              background: "var(--color-card)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--color-foreground)",
                }}
              >
                {section.title}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--color-muted-foreground)",
                  fontFamily: "monospace",
                  background: "var(--color-surface1)",
                  padding: "1px 6px",
                  borderRadius: 4,
                }}
              >
                {section.condition}
              </span>
            </div>
            <p
              style={{
                fontSize: 12,
                color: "var(--color-muted-foreground)",
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              {section.description}
            </p>
            <div
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                color: "var(--color-muted-foreground)",
                marginTop: 6,
                opacity: 0.7,
              }}
            >
              {section.source}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PromptEntryList
// ---------------------------------------------------------------------------

function ModelBadge({ model }: { model: string }) {
  const colors: Record<string, string> = {
    opus: "var(--color-mauve)",
    sonnet: "var(--color-blue)",
    haiku: "var(--color-green)",
  };
  const bg = colors[model] ?? "var(--color-muted-foreground)";

  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        padding: "1px 6px",
        borderRadius: 4,
        background: bg,
        color: "var(--color-crust)",
      }}
    >
      {model}
    </span>
  );
}

function ChainInfo({ chain }: { chain: NonNullable<PromptEntry["chain"]> }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        fontSize: 11,
        color: "var(--color-muted-foreground)",
        marginTop: 6,
      }}
    >
      {chain.from && chain.from.length > 0 && (
        <span>
          <span style={{ opacity: 0.6 }}>triggered by</span>{" "}
          {chain.from.join(", ")}
        </span>
      )}
      {chain.to && chain.to.length > 0 && (
        <span>
          <span style={{ opacity: 0.6 }}>triggers</span>{" "}
          {chain.to.join(", ")}
        </span>
      )}
    </div>
  );
}

function Tags({ tags }: { tags: string[] }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 4,
            border: "1px solid var(--color-border)",
            color: "var(--color-muted-foreground)",
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function EntryCard({
  entry,
  expanded,
  onToggle,
  onFileOpen,
}: {
  entry: PromptEntry;
  expanded: boolean;
  onToggle: () => void;
  onFileOpen?: (path: string) => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: "10px 14px",
        background: "var(--color-card)",
        cursor: "pointer",
        transition: "border-color 0.15s",
        borderColor: expanded
          ? "var(--color-muted-foreground)"
          : "var(--color-border)",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: "var(--color-muted-foreground)",
            userSelect: "none",
            width: 12,
          }}
        >
          {expanded ? "\u25BC" : "\u25B6"}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-foreground)",
          }}
        >
          {entry.title}
        </span>
        {entry.model && <ModelBadge model={entry.model} />}
        <span
          onClick={
            onFileOpen
              ? (e: React.MouseEvent) => {
                  e.stopPropagation();
                  onFileOpen(entry.filePath);
                }
              : undefined
          }
          style={{
            marginLeft: "auto",
            fontSize: 11,
            fontFamily: "monospace",
            color: onFileOpen ? "var(--color-blue)" : "var(--color-muted-foreground)",
            opacity: onFileOpen ? 1 : 0.6,
            textDecoration: onFileOpen ? "underline" : "none",
            cursor: onFileOpen ? "pointer" : "default",
          }}
        >
          {entry.filePath}
        </span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ marginTop: 8, paddingLeft: 20 }}>
          <p
            style={{
              fontSize: 12,
              color: "var(--color-muted-foreground)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {entry.description}
          </p>
          {entry.chain && <ChainInfo chain={entry.chain} />}
          {entry.tags && entry.tags.length > 0 && <Tags tags={entry.tags} />}
        </div>
      )}
    </div>
  );
}

export function PromptEntryList({
  entries,
  onFileOpen,
}: {
  entries: PromptEntry[];
  onFileOpen?: (path: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          expanded={expandedId === entry.id}
          onToggle={() =>
            setExpandedId(expandedId === entry.id ? null : entry.id)
          }
          onFileOpen={onFileOpen}
        />
      ))}
    </div>
  );
}
