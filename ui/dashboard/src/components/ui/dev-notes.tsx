/**
 * DevNotes — page-level developer notes surfaced via a header icon.
 *
 * **Status:** ADF candidate primitive. Built local to dashboard for now;
 * upstream into `@particle-academy/react-fancy` once the API stabilizes
 * (per CLAUDE.md § 1.5, particle-academy bug routing — file an issue
 * upstream when a primitive is missing, build locally with lower-level
 * primitives in the meantime).
 *
 * **Visibility:** Dev Notes only render when Contributing/Dev Mode is on
 * (`config.dev.enabled === true`). End users running the gateway in
 * production never see them. The owner sees them whenever they have
 * Contributing enabled, signaling "this page has work-in-progress notes
 * the agent left behind."
 *
 * **Why this primitive:** the agent leaves design caveats, deferred work
 * notes, and "first slice" disclaimers on pages it's actively building.
 * Inline disclaimer banners (the cycle 83 pattern) clutter the surface
 * for non-dev users. DevNotes formalizes the pattern: notes live next to
 * the page (passed as children), surface only behind a small icon, and
 * disappear entirely outside Dev Mode.
 *
 * **Reusability:** plugins, MApps, and locally-hosted apps can also use
 * this primitive — it's exported from the dashboard's UI wrapper layer
 * (path TBD when a plugin first consumes it; today it's local).
 *
 * **Usage:**
 * ```tsx
 * <PageHeader>
 *   <h1>Vault</h1>
 *   <DevNotes title="Vault — dev notes">
 *     <DevNotes.Item kind="info" heading="TPM2 detection">
 *       Backend selection runs at boot via detectTpm2Available().
 *       Production with TPM2 → SecretsManager. Test VM → FilesystemSecretsBackend.
 *     </DevNotes.Item>
 *     <DevNotes.Item kind="todo" heading="Per-project Vault picker">
 *       MCP-tab + Stacks integration deferred to follow-up cycle.
 *     </DevNotes.Item>
 *   </DevNotes>
 * </PageHeader>
 * ```
 */

import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { useConfig } from "@/hooks.js";
import { cn } from "@/lib/utils";

/** Kind of note — drives the left-border accent + icon. */
export type DevNoteKind = "info" | "todo" | "warning" | "deferred";

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

interface DevNotesProps {
  /** Title shown at the top of the open panel. Defaults to "Dev Notes". */
  title?: string;
  /** One or more <DevNotes.Item> children. */
  children: ReactNode;
  /** Optional class for the trigger icon. */
  className?: string;
}

interface DevNotesItemProps {
  heading: string;
  kind?: DevNoteKind;
  children: ReactNode;
}

function DevNotesItem({ heading, kind = "info", children }: DevNotesItemProps) {
  return (
    <div
      data-testid="dev-notes-item"
      className={cn("p-3 border-l-4 rounded-r-md bg-secondary/30", KIND_ACCENT[kind])}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className={cn(
            "text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider",
            KIND_LABEL_CLASS[kind],
          )}
        >
          {KIND_LABEL[kind]}
        </span>
        <span className="text-[12px] font-semibold text-foreground">{heading}</span>
      </div>
      <div className="text-[12px] text-muted-foreground leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function DevNotesRoot({ title = "Dev Notes", children, className }: DevNotesProps) {
  const config = useConfig();
  const [open, setOpen] = useState(false);

  // Visibility gate: only renders when Contributing/Dev Mode is on. Outside
  // Dev Mode, the icon doesn't appear at all so end-users never see "this
  // page has notes."
  const devModeEnabled = Boolean(config.data?.dev?.enabled);
  if (!devModeEnabled) return null;

  return (
    <div className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); }}
        aria-label={open ? "Close dev notes" : "Open dev notes"}
        aria-expanded={open}
        data-testid="dev-notes-trigger"
        className={cn(
          "p-1.5 rounded-md transition-colors cursor-pointer",
          open ? "bg-amber-400/15 text-amber-400" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
        title={`${title} (Contributing mode)`}
      >
        {/* Notebook glyph — inline SVG to avoid icon-set dependency */}
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
      </button>

      {open && (
        <>
          {/* Click-outside scrim — transparent layer that closes the panel
              without dimming the page. */}
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40"
            onClick={() => { setOpen(false); }}
          />
          <Card
            data-testid="dev-notes-panel"
            className="absolute z-50 right-0 top-full mt-2 w-[420px] max-h-[60vh] overflow-y-auto p-4 shadow-lg space-y-3"
            onClick={(e) => { e.stopPropagation(); }}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 font-bold uppercase tracking-wider">
                  Dev Notes
                </span>
                <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
              </div>
              <button
                type="button"
                onClick={() => { setOpen(false); }}
                aria-label="Close dev notes"
                className="text-muted-foreground hover:text-foreground p-1 rounded cursor-pointer"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="space-y-2">
              {children}
            </div>
            <div className="pt-2 border-t border-border/50 text-[10px] text-muted-foreground/70">
              Notes shown only in Contributing/Dev Mode. Configurable in Settings → Gateway.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/** DevNotes namespace component. `<DevNotes>` is the root (icon trigger
 *  + popover); `<DevNotes.Item>` is each individual note inside. */
export const DevNotes = Object.assign(DevNotesRoot, {
  Item: DevNotesItem,
});
