/**
 * EditorFlyout — slide-in panel wrapping FileEditor with file load/save lifecycle.
 */

import { useCallback, useEffect, useState } from "react";
import { FlyoutPanel, FlyoutHeader, FlyoutBody, FlyoutFooter } from "@/components/ui/flyout-panel.js";
import { FileEditor } from "@/components/FileEditor.js";
import { fetchFile, saveFile, fetchProjectFile, saveProjectFile } from "@/api.js";
import { useIsMobile } from "@/hooks.js";

export interface EditorFlyoutProps {
  filePath: string | null; // null = closed
  onClose: () => void;
  theme: "light" | "dark";
  position?: "left" | "right";
  docked?: boolean;
}

export function EditorFlyout({ filePath, onClose, theme, position = "right", docked = false }: EditorFlyoutProps) {
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();

  const dirty = draft !== content;

  // Detect whether the path is an absolute project file path
  const isProjectFile = filePath?.startsWith("/") ?? false;

  // Load file when filePath changes
  useEffect(() => {
    if (!filePath) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const loader = isProjectFile ? fetchProjectFile(filePath) : fetchFile(filePath);
    loader
      .then((result) => {
        if (cancelled) return;
        setContent(result.content);
        setDraft(result.content);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setContent("");
        setDraft("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [filePath, isProjectFile]);

  const handleSave = useCallback(async () => {
    if (!filePath || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      if (isProjectFile) {
        await saveProjectFile(filePath, draft);
      } else {
        await saveFile(filePath, draft);
      }
      setContent(draft);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [filePath, draft, dirty, isProjectFile]);

  const fileName = filePath?.split("/").pop() ?? "";

  const innerContent = (
    <>
      <FlyoutHeader>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-foreground)" }}>
            {fileName}
          </span>
          <span
            style={{
              fontSize: 11,
              fontFamily: "monospace",
              color: "var(--color-muted-foreground)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {filePath}
          </span>
          {dirty && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--color-warning)",
                color: "var(--color-crust)",
                flexShrink: 0,
              }}
            >
              modified
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {!docked && (
            <button
              onClick={() => setExpanded((p) => !p)}
              style={{
                background: "none",
                border: "none",
                color: "var(--color-muted-foreground)",
                cursor: "pointer",
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                minWidth: 44,
                minHeight: 44,
              }}
              title={expanded ? "Half screen" : "Full screen"}
            >
              {expanded ? "Shrink" : "Expand"}
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-muted-foreground)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: "0 4px",
              minWidth: 44,
              minHeight: 44,
            }}
          >
            &times;
          </button>
        </div>
      </FlyoutHeader>

      <FlyoutBody className="p-0 overflow-hidden">
        {loading && (
          <div style={{ padding: 16, color: "var(--color-muted-foreground)", fontSize: 13 }}>
            Loading...
          </div>
        )}
        {error && (
          <div style={{ padding: 16, color: "var(--color-red)", fontSize: 13 }}>
            {error}
          </div>
        )}
        {!loading && !error && filePath && (
          <FileEditor
            filePath={filePath}
            content={content}
            theme={theme}
            onChange={setDraft}
            onSave={handleSave}
          />
        )}
      </FlyoutBody>

      {dirty && (
        <FlyoutFooter>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              onClick={() => setDraft(content)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid var(--color-border)",
                background: "transparent",
                color: "var(--color-foreground)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "none",
                background: "var(--color-blue)",
                color: "var(--color-crust)",
                fontSize: 12,
                fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </FlyoutFooter>
      )}
    </>
  );

  if (docked) {
    return (
      <div className="flex flex-col h-full border-r border-border bg-card" style={{ width: "50%" }}>
        {innerContent}
      </div>
    );
  }

  return (
    <FlyoutPanel
      open={filePath !== null}
      onClose={onClose}
      position={isMobile ? "bottom" : position}
      width={isMobile ? "100vw" : (expanded ? "90vw" : "50vw")}
      height={isMobile ? "90dvh" : undefined}
    >
      {innerContent}
    </FlyoutPanel>
  );
}
