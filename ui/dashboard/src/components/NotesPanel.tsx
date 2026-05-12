/**
 * NotesPanel — markdown notepad surface for a scope (s152, 2026-05-09).
 *
 * Props:
 *   - projectPath: null  → global notes (mounted on a future Notes page)
 *   - projectPath: string → per-project notes (mounted as the Notes tab)
 *
 * Two-pane layout: list on the left, selected note's editor on the right.
 * A "New note" button at the top of the list creates an empty note and
 * focuses the editor. Save is explicit — typing without saving keeps a
 * dirty marker; ⌘S / clicking Save persists. Pinned notes float to top.
 *
 * Owner directive 2026-05-09 (Wish #17 → s152): "Aion can read these
 * notes the same way it reads Dev Notes." Backend already exposes
 * /api/notes; agent-context-assembly hookup ships in a follow-up.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Table } from "@particle-academy/react-fancy";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createNote, deleteNote, fetchNotes, updateNote, type UserNote } from "../api.js";
import { WhiteboardEditor } from "./WhiteboardEditor.js";

export interface NotesPanelProps {
  /** Per-project: pass the absolute project path. Global: pass null. */
  projectPath: string | null;
}

export function NotesPanel({ projectPath }: NotesPanelProps): ReactElement {
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchNotes(projectPath);
      setNotes(list);
      // Preserve current selection when possible; otherwise pick first.
      setSelectedId((prev) => {
        if (prev !== null && list.some((n) => n.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? null,
    [notes, selectedId],
  );

  // Sync the draft fields when the selection changes.
  useEffect(() => {
    if (selected !== null) {
      setDraftTitle(selected.title);
      setDraftBody(selected.body);
    } else {
      setDraftTitle("");
      setDraftBody("");
    }
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    if (selected === null) return false;
    return draftTitle !== selected.title || draftBody !== selected.body;
  }, [selected, draftTitle, draftBody]);

  const handleNew = useCallback(async (kind: "markdown" | "whiteboard" = "markdown") => {
    setSaving(true);
    setError(null);
    try {
      const created = await createNote({
        projectPath,
        title: kind === "whiteboard" ? "Untitled whiteboard" : "Untitled",
        kind,
        body: kind === "whiteboard" ? "{}" : "",
      });
      setNotes((prev) => [created, ...prev]);
      setSelectedId(created.id);
      // Defer focus until the textarea remounts (markdown only).
      if (kind === "markdown") {
        setTimeout(() => bodyRef.current?.focus(), 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [projectPath]);

  const handleSave = useCallback(async () => {
    if (selected === null || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateNote(selected.id, {
        title: draftTitle.trim() || "Untitled",
        body: draftBody,
      });
      setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [selected, dirty, draftTitle, draftBody]);

  const handleDelete = useCallback(async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      await deleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setSelectedId((prev) => (prev === id ? null : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  const handleTogglePin = useCallback(async (id: string, currentlyPinned: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateNote(id, { pinned: !currentlyPinned });
      setNotes((prev) => {
        const next = prev.map((n) => (n.id === updated.id ? updated : n));
        // Re-sort: pinned first, then by sortOrder asc, then createdAt desc.
        return next.sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return b.createdAt.localeCompare(a.createdAt);
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  // ⌘S / Ctrl+S to save while editor is focused.
  const handleEditorKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
    },
    [handleSave],
  );

  return (
    <div className="flex gap-4 h-full" data-testid="notes-panel">
      {/* List pane */}
      <Card className="p-3 w-[280px] flex flex-col gap-2 max-h-[600px] overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            {projectPath !== null ? "Project Notes" : "Global Notes"}
          </h3>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              onClick={() => void handleNew("markdown")}
              disabled={saving}
              data-testid="notes-new-button"
              className="text-[11px] h-7"
            >
              + Note
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleNew("whiteboard")}
              disabled={saving}
              data-testid="notes-new-whiteboard-button"
              className="text-[11px] h-7"
              title="Create a whiteboard note (canvas mode)"
            >
              + Board
            </Button>
          </div>
        </div>

        {error !== null && (
          <p className="text-[11px] text-red break-words" data-testid="notes-error">{error}</p>
        )}

        <div className="flex-1 overflow-y-auto -mx-1">
          {loading && notes.length === 0 && (
            <p className="text-[12px] text-muted-foreground italic px-1">Loading notes…</p>
          )}
          {!loading && notes.length === 0 && error === null && (
            <p className="text-[12px] text-muted-foreground italic px-1" data-testid="notes-empty">
              No notes yet. Click + New to start one.
            </p>
          )}
          {/* s156 t675 — list rendered via PAx Table for selection
              affordance + a11y. Each row's onClick selects the note;
              the row className highlights the selected one. Pin
              indicator is the leading cell. */}
          <Table className="border-0" data-testid="notes-list">
            <Table.Body>
              {notes.map((note) => {
                const isSelected = note.id === selectedId;
                return (
                  <Table.Row
                    key={note.id}
                    onClick={() => setSelectedId(note.id)}
                    className={`cursor-pointer text-[13px] ${
                      isSelected ? "bg-foreground text-background" : "hover:bg-secondary/40"
                    }`}
                    data-testid="notes-list-item"
                    data-note-id={note.id}
                  >
                    <Table.Cell className="w-4 px-1.5 py-1.5">
                      {note.pinned ? (
                        <span title="Pinned" className="text-yellow text-[10px]">★</span>
                      ) : null}
                    </Table.Cell>
                    <Table.Cell className="px-1 py-1.5">
                      <span className="truncate block" title={note.title}>{note.title || "Untitled"}</span>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        </div>
      </Card>

      {/* Editor pane */}
      <Card className="p-4 flex-1 flex flex-col gap-2 max-h-[600px] overflow-hidden">
        {selected === null && (
          <p className="text-[12px] text-muted-foreground italic" data-testid="notes-editor-empty">
            Select a note from the left, or click + New to create one.
          </p>
        )}
        {selected !== null && (
          <>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                placeholder="Untitled"
                className="text-[14px] flex-1"
                data-testid="notes-title-input"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleTogglePin(selected.id, selected.pinned)}
                disabled={saving}
                className="text-[11px] h-8"
                data-testid="notes-pin-button"
              >
                {selected.pinned ? "Unpin" : "Pin"}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                data-testid="notes-save-button"
                className="text-[11px] h-8"
              >
                {dirty ? "Save" : "Saved"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleDelete(selected.id)}
                disabled={saving}
                className="text-[11px] h-8 text-red hover:text-red"
                data-testid="notes-delete-button"
              >
                Delete
              </Button>
            </div>
            {/* s157 Phase 2b — whiteboard kind renders the full
                SharedWhiteboard (fancy-whiteboard primitives + in-page
                MicroMcpServer + AgentPanel). State is session-ephemeral
                in this slice; persistence + relay broker land in Phase 2c. */}
            {selected.kind === "whiteboard" ? (
              <WhiteboardEditor body={draftBody} />
            ) : (
              <textarea
                ref={bodyRef}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                placeholder="Markdown body…"
                className="flex-1 rounded border border-input bg-background px-3 py-2 text-[13px] font-mono leading-relaxed resize-none disabled:opacity-50"
                data-testid="notes-body-textarea"
              />
            )}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
              <span>{dirty ? "Unsaved changes — ⌘S to save" : `Saved ${new Date(selected.updatedAt).toLocaleString()}`}</span>
              <span className="font-mono">
                {selected.kind === "whiteboard"
                  ? `whiteboard · ${String(draftBody.length)} JSON chars`
                  : `${String(draftBody.length)} chars`}
              </span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
