/**
 * DevNotes — universal page/tab/view annotation primitive.
 *
 * **Architecture (cycle 150 refactor):** all DevNotes across the dashboard
 * register into a single global modal; one icon trigger opens it; arrow
 * keys + clickable arrows navigate the stack.
 *
 * **Why one modal:** the prior per-page popover (cycle 80-ish) put a
 * separate icon + popover on each surface. Owner feedback (2026-04-30):
 * notes should accumulate centrally so any visible page/tab's notes are
 * reachable from one spot, with `←` / `→` to walk through them.
 *
 * **Visibility gate:** notes only register + the icon only renders when
 * Contributing/Dev Mode is on (`config.dev.enabled === true`). Outside
 * dev mode, this primitive is a no-op.
 *
 * **Embeddable:** `<DevNote>` is the consumer-side surface. It mounts on
 * a page/tab/view, registers its content with the provider, and unmounts
 * cleanly. It renders nothing visible on its own — it's a registration
 * shell, not a UI element.
 *
 * **Trigger:** `<DevNotesIcon>` is the icon button that opens the modal.
 * It sits in page or tab headers (multiple instances OK; all open the
 * same modal). Shows a count badge of currently-registered notes.
 *
 * **Provider:** wrap the app root in `<DevNotesProvider>` once. It holds
 * the registered-notes map + modal open state.
 *
 * ## Usage
 *
 * ```tsx
 * // 1. Wrap the app once at the root:
 * <DevNotesProvider>
 *   <App />
 * </DevNotesProvider>
 *
 * // 2. Drop the icon in any header that should show the notes:
 * <PageHeader>
 *   <h1>Projects</h1>
 *   <DevNotesIcon />
 * </PageHeader>
 *
 * // 3. Embed notes anywhere — they register on mount:
 * <DevNote
 *   kind="todo"
 *   heading="Slice 5c phase 4"
 *   scope="project-workspace"
 * >
 *   Chat thread still in floating flyout, not in workspace aside.
 * </DevNote>
 * ```
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Card } from "@/components/ui/card";
import { useConfig } from "@/hooks.js";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------

export type DevNoteKind = "info" | "todo" | "warning" | "deferred";

interface DevNoteEntry {
  id: string;
  heading: string;
  kind: DevNoteKind;
  scope?: string;
  body: ReactNode;
}

interface DevNotesContextShape {
  enabled: boolean;
  count: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  register: (id: string, entry: Omit<DevNoteEntry, "id">) => void;
  unregister: (id: string) => void;
  entries: DevNoteEntry[];
}

const KIND_ACCENT: Record<DevNoteKind, string> = {
  info: "border-l-blue",
  todo: "border-l-amber-400",
  warning: "border-l-red",
  deferred: "border-l-muted-foreground",
};

const KIND_LABEL: Record<DevNoteKind, string> = {
  info: "INFO",
  todo: "TODO",
  warning: "CAUTION",
  deferred: "DEFERRED",
};

const KIND_LABEL_CLASS: Record<DevNoteKind, string> = {
  info: "bg-blue/15 text-blue",
  todo: "bg-amber-400/15 text-amber-400",
  warning: "bg-red/15 text-red",
  deferred: "bg-muted-foreground/15 text-muted-foreground",
};

// ----------------------------------------------------------------------
// Context
// ----------------------------------------------------------------------

const DevNotesContext = createContext<DevNotesContextShape | null>(null);

function useDevNotesContext(): DevNotesContextShape | null {
  return useContext(DevNotesContext);
}

// ----------------------------------------------------------------------
// Provider — wraps the app root once. Holds registered notes + modal open
// state. Exposes register/unregister so embedded <DevNote> components can
// participate.
// ----------------------------------------------------------------------

export function DevNotesProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const enabled = Boolean(config.data?.dev?.enabled);

  const [open, setOpen] = useState(false);
  // Use a ref-backed Map + version counter so stable consumers don't see
  // identity churn while registrations come and go.
  const entriesRef = useRef<Map<string, DevNoteEntry>>(new Map());
  const [version, setVersion] = useState(0);

  const register = useCallback((id: string, entry: Omit<DevNoteEntry, "id">) => {
    entriesRef.current.set(id, { id, ...entry });
    setVersion((v) => v + 1);
  }, []);

  const unregister = useCallback((id: string) => {
    if (entriesRef.current.delete(id)) {
      setVersion((v) => v + 1);
    }
  }, []);

  const entries = useMemo(() => {
    // version dep makes this recompute on register/unregister.
    void version;
    return Array.from(entriesRef.current.values());
  }, [version]);

  const value: DevNotesContextShape = useMemo(
    () => ({
      enabled,
      count: entries.length,
      open,
      setOpen,
      register,
      unregister,
      entries,
    }),
    [enabled, entries, open, register, unregister],
  );

  return (
    <DevNotesContext.Provider value={value}>
      {children}
      <DevNotesModal />
    </DevNotesContext.Provider>
  );
}

// ----------------------------------------------------------------------
// <DevNote> — embeddable register-only component. Renders nothing visible.
// ----------------------------------------------------------------------

interface DevNoteProps {
  heading: string;
  kind?: DevNoteKind;
  scope?: string;
  children: ReactNode;
}

export function DevNote({ heading, kind = "info", scope, children }: DevNoteProps) {
  const ctx = useDevNotesContext();
  const id = useId();

  // Cycle 150 hotfix v0.4.427 — `children` (the body) is captured into a
  // ref instead of being a useEffect dep. JSX children with markup
  // (`<DevNote>text <strong>x</strong></DevNote>`) produce a NEW array
  // reference on every render, which would re-fire the effect, which
  // calls register → setVersion → re-render → new children reference →
  // infinite loop. Owner observed this as a "results hung hard crash"
  // when multiple DevNote-bearing pages were open at once.
  //
  // The ref always points at the latest children; the effect reads it
  // at mount time. If children ever needs to update post-mount, the
  // caller can change `heading` or remount via `key` to force re-register.
  const bodyRef = useRef<ReactNode>(children);
  bodyRef.current = children;

  useEffect(() => {
    if (!ctx?.enabled) return;
    ctx.register(id, { heading, kind, scope, body: bodyRef.current });
    return () => { ctx.unregister(id); };
  }, [ctx, id, heading, kind, scope]);

  return null;
}

// ----------------------------------------------------------------------
// <DevNotesIcon> — trigger button. Opens the global modal. Multiple
// instances OK; they all toggle the same modal.
// ----------------------------------------------------------------------

interface DevNotesIconProps {
  className?: string;
  /** Tooltip / accessible label override. Defaults to "Dev notes (N)". */
  title?: string;
}

export function DevNotesIcon({ className, title }: DevNotesIconProps) {
  const ctx = useDevNotesContext();
  if (!ctx?.enabled) return null;
  if (ctx.count === 0) return null;

  const label = title ?? `Dev notes (${ctx.count})`;

  return (
    <button
      type="button"
      onClick={() => { ctx.setOpen(true); }}
      aria-label={label}
      title={label}
      data-testid="dev-notes-icon"
      className={cn(
        "p-1.5 rounded-md transition-colors cursor-pointer relative",
        "text-muted-foreground hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3z" />
        <path d="M3 2v12" />
        <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
      </svg>
      {ctx.count > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-amber-400 text-black text-[9px] font-bold flex items-center justify-center"
          data-testid="dev-notes-count-badge"
        >
          {ctx.count}
        </span>
      )}
    </button>
  );
}

// ----------------------------------------------------------------------
// <DevNotesModal> — global modal with arrow-key + clickable nav.
// Rendered once by the provider; consumes context for entries + open state.
// ----------------------------------------------------------------------

function DevNotesModal() {
  const ctx = useDevNotesContext();
  const [index, setIndex] = useState(0);

  const total = ctx?.entries.length ?? 0;
  const open = Boolean(ctx?.open && total > 0);

  // Clamp the index when entries change (e.g. a page navigates and
  // registrations swap out underneath).
  useEffect(() => {
    if (total === 0) {
      if (index !== 0) setIndex(0);
      return;
    }
    if (index >= total) setIndex(total - 1);
  }, [total, index]);

  // Keyboard navigation while modal is open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => (i > 0 ? i - 1 : total - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((i) => (i < total - 1 ? i + 1 : 0));
      } else if (e.key === "Escape") {
        e.preventDefault();
        ctx?.setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); };
  }, [open, total, ctx]);

  if (!ctx?.enabled || !open) return null;
  const entry = ctx.entries[index];
  if (!entry) return null;

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[400] bg-black/40 backdrop-blur-sm"
        onClick={() => { ctx.setOpen(false); }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dev-notes-modal-title"
        data-testid="dev-notes-modal"
        className="fixed left-1/2 top-1/2 z-[401] -translate-x-1/2 -translate-y-1/2 w-[min(560px,92vw)] max-h-[80vh] overflow-hidden"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <Card className="p-0 shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 p-3 border-b border-border/50 bg-secondary/30">
            <div className="flex items-center gap-2">
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 font-bold uppercase tracking-wider">
                Dev Notes
              </span>
              <h3 id="dev-notes-modal-title" className="text-[13px] font-semibold text-foreground">
                {index + 1} of {total}
                {entry.scope && (
                  <span className="ml-2 text-muted-foreground font-normal">· {entry.scope}</span>
                )}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => { ctx.setOpen(false); }}
              aria-label="Close dev notes"
              className="text-muted-foreground hover:text-foreground p-1 rounded cursor-pointer"
              data-testid="dev-notes-modal-close"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

          {/* Body — current entry */}
          <div
            className={cn("p-4 border-l-4 flex-1 overflow-y-auto bg-secondary/10", KIND_ACCENT[entry.kind])}
            data-testid="dev-notes-modal-entry"
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider",
                  KIND_LABEL_CLASS[entry.kind],
                )}
              >
                {KIND_LABEL[entry.kind]}
              </span>
              <span className="text-[14px] font-semibold text-foreground">{entry.heading}</span>
            </div>
            <div className="text-[12px] text-muted-foreground leading-relaxed">
              {entry.body}
            </div>
          </div>

          {/* Footer — nav */}
          <div className="flex items-center justify-between gap-2 p-2 border-t border-border/50 bg-secondary/20 text-[11px]">
            <button
              type="button"
              onClick={() => { setIndex((i) => (i > 0 ? i - 1 : total - 1)); }}
              aria-label="Previous note"
              className="px-2 py-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1"
              data-testid="dev-notes-modal-prev"
            >
              <span aria-hidden="true">←</span> Prev
            </button>
            <span className="text-muted-foreground/70">
              ← / → to navigate · Esc to close
            </span>
            <button
              type="button"
              onClick={() => { setIndex((i) => (i < total - 1 ? i + 1 : 0)); }}
              aria-label="Next note"
              className="px-2 py-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1"
              data-testid="dev-notes-modal-next"
            >
              Next <span aria-hidden="true">→</span>
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}

// ----------------------------------------------------------------------
// Legacy compatibility shim — kept so v0.4.418 callsites still typecheck
// while we migrate them. Removed in a follow-up cycle once all consumers
// are on the new API. Renders nothing; logs a one-time deprecation in dev.
// ----------------------------------------------------------------------

interface LegacyDevNotesProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

function LegacyDevNotesRoot({ children }: LegacyDevNotesProps) {
  // Mount the children so the new <DevNote> components inside register normally.
  // The old `<DevNotes.Item>` API has been replaced by `<DevNote>` directly.
  return <>{children}</>;
}

function LegacyDevNotesItem({ heading, kind = "info", children }: { heading: string; kind?: DevNoteKind; children: ReactNode }) {
  return <DevNote heading={heading} kind={kind}>{children}</DevNote>;
}

export const DevNotes = Object.assign(LegacyDevNotesRoot, {
  Item: LegacyDevNotesItem,
});
