/**
 * EditorFlyout — slide-in panel wrapping KnowledgeEditor with file load/save lifecycle.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FlyoutPanel, FlyoutHeader, FlyoutBody, FlyoutFooter } from "@/components/ui/flyout-panel.js";
import { KnowledgeEditor } from "@/components/KnowledgeEditor.js";
import { fetchFile, saveFile, fetchProjectFile, saveProjectFile } from "@/api.js";
import { useIsMobile } from "@/hooks.js";
import { cn } from "@/lib/utils";

export interface EditorFlyoutProps {
  filePath: string | null; // null = closed
  onClose: () => void;
  theme?: "light" | "dark";
  position?: "left" | "right";
  docked?: boolean;
  /** Shell panel mode — renders as full-height inline div with no overlay chrome. */
  panel?: boolean;
}

export function EditorFlyout({ filePath, onClose, position = "right", docked = false, panel = false }: EditorFlyoutProps) {
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();
  // Keep handleSave stable for the keydown listener
  const handleSaveRef = useRef<() => Promise<void>>();

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

  // Keep ref in sync so the keydown handler always calls the latest version
  handleSaveRef.current = handleSave;

  // Ctrl+S / Cmd+S save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void handleSaveRef.current?.();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

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
          <KnowledgeEditor
            filePath={filePath}
            content={content}
            onChange={setDraft}
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

  // Panel mode — shell workspace section, fills AccordionPanel.Content
  if (panel) {
    return (
      <div
        className={cn(
          "flex flex-col h-full w-full min-h-0 min-w-0 bg-card",
          !filePath && "items-center justify-center",
        )}
        data-testid="editor-panel"
      >
        {filePath ? innerContent : (
          <div className="text-center px-6">
            <div className="text-5xl mb-3 opacity-20 select-none">✎</div>
            <p className="text-[13px] text-muted-foreground/70">
              Open a file from the project to edit it here.
            </p>
          </div>
        )}
      </div>
    );
  }

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
