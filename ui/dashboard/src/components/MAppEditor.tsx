/**
 * MAppEditor — 5-step wizard modal for creating/editing MApps.
 *
 * Steps: Basics → Constants → Pages → Output → Simulator
 * Auto-saves draft to sessionStorage. Dirty state tracking.
 *
 * UX principles:
 * - No developer jargon (no "A-column", "B-column")
 * - Fields/formulas/constants as structured cards
 * - Page prompt as modal dialog
 * - Cell refs only as small muted badges for formula reference
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Select } from "@/components/ui/select.js";
import { Card } from "@/components/ui/card.js";
import { DevNote } from "@/components/ui/dev-notes.js";
import { EmojiSelect, Textarea, Callout } from "@particle-academy/react-fancy";
import { MAppFormRenderer } from "./MAppFormRenderer.js";
import { cn } from "@/lib/utils";

const STEPS = ["Basics", "Constants", "Pages", "Screens", "Output", "Simulator"] as const;
const DRAFT_KEY = "mapp-editor-draft";

/**
 * Curated PAx component list for the Screens step's componentRef autocomplete
 * (s146 Phase A.2). Author can still type any "<package>:<ComponentName>"
 * value that matches the schema's regex; this list just makes the common
 * choices discoverable. Sourced from the ADF UI primitive cheatsheet in
 * `agi/docs/human/adf.md`.
 */
const PAX_COMPONENT_REFS = [
  // react-fancy
  "react-fancy:Card", "react-fancy:Tabs", "react-fancy:Action", "react-fancy:Field",
  "react-fancy:Input", "react-fancy:Select", "react-fancy:Textarea", "react-fancy:Modal",
  "react-fancy:Toast", "react-fancy:Sidebar", "react-fancy:Menu", "react-fancy:Dropdown",
  "react-fancy:ContentRenderer", "react-fancy:Editor", "react-fancy:Canvas",
  "react-fancy:Diagram", "react-fancy:Chart", "react-fancy:Calendar", "react-fancy:FileUpload",
  "react-fancy:Kanban", "react-fancy:Timeline", "react-fancy:Pagination",
  "react-fancy:Pillbox", "react-fancy:Skeleton", "react-fancy:Tooltip",
  "react-fancy:TreeNav", "react-fancy:Table",
  // fancy-sheets
  "fancy-sheets:Sheet",
  // fancy-code
  "fancy-code:Editor",
  // fancy-echarts
  "fancy-echarts:Chart",
  // fancy-3d
  "fancy-3d:Scene",
] as const;

const FIELD_TYPES = [
  "text", "textarea", "number", "int", "currency", "percentage",
  "date", "email", "phone", "url", "bool", "select", "multiselect", "info",
] as const;

const CATEGORIES = ["viewer", "production", "tool", "game", "custom"] as const;

interface EditorField {
  key: string; cell: string; type: string; label: string;
  required?: boolean; placeholder?: string; options?: string[];
  min?: number; max?: number;
}

interface EditorFormula {
  cell: string; label: string; expression: string;
  format: "number" | "currency" | "percent" | "text"; visible: boolean;
}

interface EditorConstant {
  key: string; cell: string; label: string;
  value: number | string; format: "number" | "currency" | "percent";
  visibility: "always" | "hidden" | "conditional";
}

interface EditorPage {
  key: string; title: string; pageType: string; visibility: string;
  fields: EditorField[]; formulas: EditorFormula[];
  processPage?: string;
}

// s146 Phase A.2 — Editor types for the screens primitive (cycle 183).
// Mirror the on-wire shapes from MAppScreenSchema in config/src/mapp-schema.ts;
// stateToDefinition / definitionToState bridge between EditorScreen* and
// the typed JSON the Zod schema validates.
interface EditorScreenInput {
  key: string;
  label: string;
  type: "string" | "text" | "number" | "boolean" | "date" | "select" | "object";
  qualifier: "required" | "prefilled" | "optional";
  source: "user" | "agent" | "either";
  default?: string;        // serialized as JSON (the wire schema accepts unknown)
  description?: string;
  options?: string;        // comma-separated in editor; split on save
}

interface EditorScreenElement {
  id: string;
  componentRef: string;    // free text in editor; validated on save
  propsJson: string;       // raw JSON in editor; parsed on save
}

interface EditorScreen {
  id: string;
  label: string;
  interface: "static" | "dynamic";
  inputs: EditorScreenInput[];
  elements: EditorScreenElement[];
}

interface EditorState {
  id: string; name: string; author: string; version: string;
  description: string; category: string; icon: string;
  permissions: Array<{ id: string; reason: string; required: boolean }>;
  constants: EditorConstant[];
  pages: EditorPage[];
  /** s146 Phase A.2 — owner-confirmed primitive: PAx-composed screens
   *  with typed input props (required/prefilled/optional, user/agent
   *  source). */
  screens: EditorScreen[];
  processingPrompt: string;
  panelWidgets: Array<Record<string, unknown>>;
}

function emptyState(): EditorState {
  return {
    id: "", name: "", author: "", version: "1.0.0",
    description: "", category: "tool", icon: "",
    permissions: [],
    constants: [],
    pages: [{ key: "page1", title: "Step 1", pageType: "standard", visibility: "always", fields: [], formulas: [] }],
    screens: [],
    processingPrompt: "",
    panelWidgets: [],
  };
}

export interface MAppEditorProps {
  initialDefinition?: Record<string, unknown>;
  onSave: (definition: Record<string, unknown>) => void;
  onClose: () => void;
}

export function MAppEditor({ initialDefinition, onSave, onClose }: MAppEditorProps) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<EditorState>(() => {
    const draft = sessionStorage.getItem(DRAFT_KEY);
    if (draft) { try { return JSON.parse(draft) as EditorState; } catch { /* fall through */ } }
    if (initialDefinition) return definitionToState(initialDefinition);
    return emptyState();
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(state)); }, 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const update = useCallback(<K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    onSave(stateToDefinition(state));
    sessionStorage.removeItem(DRAFT_KEY);
    setDirty(false);
  }, [state, onSave]);

  // Validate invariants that would produce a broken MAppDefinition. Magic
  // pages (`pageType: "magic"`) require (a) they aren't the first page and
  // (b) the preceding page declares `processPage`. The Editor used to show
  // these as paragraphs in the magic-page info block but let Save through
  // anyway — so authors could ship a MApp that can never render its magic
  // page. Gate Save on these invariants, don't just warn.
  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    state.pages.forEach((page, idx) => {
      if (page.pageType !== "magic") return;
      if (idx === 0) {
        errs.push(`Page ${idx + 1}: magic page cannot be the first page.`);
      } else if (!state.pages[idx - 1]?.processPage) {
        errs.push(`Page ${idx + 1}: preceding page needs a processing prompt.`);
      }
    });
    return errs;
  }, [state.pages]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[850px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-foreground">MApp Editor</h2>
            {dirty && <span className="flex items-center gap-1 text-[10px] text-yellow"><span className="w-1.5 h-1.5 rounded-full bg-yellow animate-pulse" />Unsaved</span>}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">{"\u2715"}</button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-border">
          {STEPS.map((s, i) => (
            <button key={s} onClick={() => setStep(i)} className={cn(
              "flex-1 py-2.5 text-[12px] font-semibold border-b-2 transition-colors",
              i === step ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}>
              <span className="text-[10px] mr-1 opacity-50">{i + 1}.</span> {s}
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-auto p-5">
          {step === 0 && <BasicsStep state={state} update={update} />}
          {step === 1 && <ConstantsStep state={state} update={update} />}
          {step === 2 && <PagesStep state={state} update={update} />}
          {step === 3 && <ScreensStep state={state} update={update} />}
          {step === 4 && <OutputStep state={state} update={update} />}
          {step === 5 && <SimulatorStep state={state} />}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <Button variant="secondary" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</Button>
          <div className="flex items-center gap-2">
            {validationErrors.length > 0 && (
              <span
                data-testid="mapp-editor-validation-errors"
                title={validationErrors.join("\n")}
                className="text-[11px] text-red"
              >
                {validationErrors.length} error{validationErrors.length === 1 ? "" : "s"}
              </span>
            )}
            {step < 5 && <Button size="sm" variant="outline" onClick={() => setStep((s) => s + 1)}>Next</Button>}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={validationErrors.length > 0}
              title={validationErrors.length > 0 ? validationErrors.join("\n") : undefined}
            >
              Save MApp
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Basics
// ---------------------------------------------------------------------------

function BasicsStep({ state, update }: { state: EditorState; update: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void }) {
  return (
    <div className="space-y-4 max-w-lg">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Name</label>
          <Input value={state.name} onChange={(e) => { update("name", e.target.value); if (!state.id) update("id", e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-")); }} placeholder="My Calculator" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-muted-foreground mb-1">ID</label>
          <Input value={state.id} onChange={(e) => update("id", e.target.value)} placeholder="my-calculator" className="font-mono text-[12px]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Author</label>
          <Input value={state.author} onChange={(e) => update("author", e.target.value)} placeholder="wishborn" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Category</label>
          <Select
            className="text-[13px]"
            list={CATEGORIES.map((c) => ({ value: c, label: c }))}
            value={state.category}
            onValueChange={(v) => update("category", v)}
          />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Description</label>
        <Textarea value={state.description} onChange={(e) => update("description", e.target.value)} rows={2} placeholder="What does this MApp do?" className="text-[13px]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Version</label>
          <Input value={state.version} onChange={(e) => update("version", e.target.value)} placeholder="1.0.0" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Icon</label>
          <EmojiSelect value={state.icon || undefined} onChange={(emoji) => update("icon", emoji ?? "")} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Constants — grid of cards, no cell ref jargon
// ---------------------------------------------------------------------------

function ConstantsStep({ state, update }: { state: EditorState; update: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void }) {
  const addConstant = () => {
    const idx = state.constants.length + 1;
    update("constants", [...state.constants, { key: `const_${idx}`, cell: `C${idx}`, label: `Constant ${idx}`, value: 0, format: "number" as const, visibility: "always" as const }]);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">Constants</h3>
          <p className="text-[11px] text-muted-foreground">Preset values used in formulas. These don't change per use.</p>
        </div>
        <Button size="sm" variant="outline" onClick={addConstant}>+ Add Constant</Button>
      </div>

      {state.constants.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-[12px] border border-dashed border-border rounded-lg">
          No constants yet. Add preset values like tax rates, multipliers, or thresholds.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {state.constants.map((c, i) => (
          <div key={i} className="rounded-lg border border-border bg-mantle p-4 relative">
            <button onClick={() => update("constants", state.constants.filter((_, j) => j !== i))} className="absolute top-2 right-2 text-[11px] text-muted-foreground hover:text-red">{"\u2715"}</button>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Label</label>
                <Input value={c.label} onChange={(e) => { const cs = [...state.constants]; cs[i] = { ...c, label: e.target.value }; update("constants", cs); }} className="h-8 text-[12px]" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Key</label>
                <Input value={c.key} onChange={(e) => { const cs = [...state.constants]; cs[i] = { ...c, key: e.target.value }; update("constants", cs); }} className="h-8 text-[11px] font-mono" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Value</label>
                <Input value={String(c.value)} onChange={(e) => { const cs = [...state.constants]; cs[i] = { ...c, value: parseFloat(e.target.value) || 0 }; update("constants", cs); }} type="number" className="h-8 text-[12px]" />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex gap-0.5">
                  {(["number", "currency", "percent"] as const).map((fmt) => (
                    <button key={fmt} onClick={() => { const cs = [...state.constants]; cs[i] = { ...c, format: fmt }; update("constants", cs); }}
                      className={cn("px-2 py-0.5 text-[10px] rounded", c.format === fmt ? "bg-primary text-primary-foreground" : "bg-surface0 text-muted-foreground")}>
                      {fmt === "number" ? "#" : fmt === "currency" ? "$" : "%"}
                    </button>
                  ))}
                </div>
                <Select
                  className="text-[10px]"
                  list={[
                    { value: "always", label: "Visible" },
                    { value: "hidden", label: "Hidden" },
                  ]}
                  value={c.visibility}
                  onValueChange={(v) => { const cs = [...state.constants]; cs[i] = { ...c, visibility: v as EditorConstant["visibility"] }; update("constants", cs); }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Pages — tabs, field cards, prompt modal
// ---------------------------------------------------------------------------

function PagesStep({ state, update }: { state: EditorState; update: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void }) {
  const [activePage, setActivePage] = useState(0);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const page = state.pages[activePage];

  const addPage = () => {
    const idx = state.pages.length + 1;
    update("pages", [...state.pages, { key: `page${idx}`, title: `Step ${idx}`, pageType: "standard", visibility: "always", fields: [], formulas: [] }]);
  };

  const addField = () => {
    if (!page) return;
    const fieldIdx = page.fields.length + 1;
    const pages = [...state.pages];
    pages[activePage] = { ...page, fields: [...page.fields, { key: `field_${fieldIdx}`, cell: `A${fieldIdx}`, type: "text", label: `Field ${fieldIdx}` }] };
    update("pages", pages);
  };

  const addFormula = () => {
    if (!page) return;
    const fIdx = page.formulas.length + 1;
    const pages = [...state.pages];
    pages[activePage] = { ...page, formulas: [...page.formulas, { cell: `B${fIdx}`, label: `Result ${fIdx}`, expression: "", format: "number" as const, visible: true }] };
    update("pages", pages);
  };

  const updateField = (fieldIdx: number, patch: Partial<EditorField>) => {
    const pages = [...state.pages];
    const fields = [...page!.fields];
    fields[fieldIdx] = { ...fields[fieldIdx], ...patch };
    pages[activePage] = { ...page!, fields };
    update("pages", pages);
  };

  const updateFormula = (fIdx: number, patch: Partial<EditorFormula>) => {
    const pages = [...state.pages];
    const formulas = [...page!.formulas];
    formulas[fIdx] = { ...formulas[fIdx], ...patch };
    pages[activePage] = { ...page!, formulas };
    update("pages", pages);
  };

  const removeField = (idx: number) => {
    const pages = [...state.pages];
    pages[activePage] = { ...page!, fields: page!.fields.filter((_, j) => j !== idx) };
    update("pages", pages);
  };

  const removeFormula = (idx: number) => {
    const pages = [...state.pages];
    pages[activePage] = { ...page!, formulas: page!.formulas.filter((_, j) => j !== idx) };
    update("pages", pages);
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= page!.fields.length) return;

    // Reordering re-assigns A-cell refs in place (`A${i + 1}`), which means
    // any formula that referenced the OLD `Aidx` or `AnewIdx` will now
    // silently point at swapped content (story #101 task #315). Detect
    // affected formulas and confirm with the author before committing the
    // reorder. The proper auto-rewrite path needs a formula parser; this
    // confirm-or-cancel guard is the alpha-stable-1 fix.
    const oldA = `A${idx + 1}`;
    const newA = `A${newIdx + 1}`;
    const refRe = new RegExp(`\\b(?:${oldA}|${newA})\\b`);
    const affected = (page!.formulas ?? []).filter((f) => refRe.test(f.expression));
    if (affected.length > 0) {
      const refList = affected.map((f) => `  ${f.cell}: ${f.expression}`).join("\n");
      const ok = window.confirm(
        `Reordering will swap which cells "${oldA}" and "${newA}" point at.\n\n` +
          `These formulas reference them and will silently retarget:\n${refList}\n\n` +
          `Proceed anyway? (Cancel keeps the current order.)`,
      );
      if (!ok) return;
    }

    const pages = [...state.pages];
    const fields = [...page!.fields];
    [fields[idx], fields[newIdx]] = [fields[newIdx]!, fields[idx]!];
    // Re-assign cell refs
    fields.forEach((f, i) => { f.cell = `A${i + 1}`; });
    pages[activePage] = { ...page!, fields };
    update("pages", pages);
  };

  if (!page) return null;

  return (
    <div>
      <DevNote
        kind="warning"
        scope="mapp-editor:pages"
        heading="Field reorder silently retargets formulas"
      >
        Reordering a field re-assigns its A-column cell ref in place
        (<code>A1</code>, <code>A2</code>, …). Any formula that referenced
        the old cell will silently retarget to whatever now sits there.
        Move-field shows a `window.confirm` listing affected formulas
        (story #101 task #315) — confirm-or-cancel guard, not a fix. The
        proper fix needs a formula parser that rewrites refs on reorder.
      </DevNote>
      {/* Page tabs */}
      <div className="flex items-center gap-0 border-b border-border mb-4">
        {state.pages.map((p, i) => (
          <button key={p.key} onClick={() => setActivePage(i)} className={cn(
            "px-4 py-2.5 text-[12px] font-semibold border-b-2 transition-colors",
            i === activePage ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}>
            {p.processPage && <span className="mr-1 text-purple-400">{"\u2728"}</span>}
            {p.title}
            {p.fields.length > 0 && <span className="ml-1 text-[10px] opacity-50">({p.fields.length})</span>}
          </button>
        ))}
        <button onClick={addPage} className="px-3 py-2.5 text-[12px] text-muted-foreground hover:text-primary border-b-2 border-transparent">+ Add Page</button>
      </div>

      {/* Page config header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1">
          <label className="text-[10px] text-muted-foreground mb-0.5 block">Title</label>
          <Input value={page.title} onChange={(e) => { const ps = [...state.pages]; ps[activePage] = { ...page, title: e.target.value }; update("pages", ps); }} className="h-8 text-[12px]" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">Type</label>
          <Select
            className="text-[11px]"
            list={[
              { value: "standard", label: "Standard" },
              { value: "magic", label: "Magic" },
              { value: "embedded", label: "Embedded" },
              { value: "canvas", label: "Canvas" },
            ]}
            value={page.pageType}
            onValueChange={(v) => { const ps = [...state.pages]; ps[activePage] = { ...page, pageType: v }; update("pages", ps); }}
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">Visibility</label>
          {activePage === 0 ? (
            <div className="h-8 px-2 rounded border border-border bg-surface0/30 text-muted-foreground text-[11px] flex items-center">Always</div>
          ) : (
            <Select
              className="text-[11px]"
              list={[
                { value: "always", label: "Always" },
                { value: "conditional", label: "Conditional" },
                { value: "auto", label: "Auto" },
                { value: "hidden", label: "Hidden" },
              ]}
              value={page.visibility}
              onValueChange={(v) => { const ps = [...state.pages]; ps[activePage] = { ...page, visibility: v }; update("pages", ps); }}
            />
          )}
        </div>
        {/* Prompt button */}
        <button onClick={() => setPromptModalOpen(true)} className={cn(
          "h-8 px-3 rounded text-[11px] font-semibold flex items-center gap-1",
          page.processPage ? "bg-purple-500/20 text-purple-400 border border-purple-500/30" : "bg-surface0 text-muted-foreground border border-border hover:text-purple-400",
        )}>
          {"\u2728"} Prompt
        </button>
        {/* Delete page (not first) */}
        {activePage > 0 && (
          <button onClick={() => { const ps = state.pages.filter((_, i) => i !== activePage); update("pages", ps); setActivePage(Math.max(0, activePage - 1)); }}
            className="h-8 px-2 rounded bg-red/10 text-red text-[11px] hover:bg-red/20">{"\u2715"}</button>
        )}
      </div>

      {/* Magic page info */}
      {page.pageType === "magic" && (
        <div className="rounded-lg bg-purple-400/10 border border-purple-400/30 px-4 py-3 mb-4">
          <p className="text-[11px] text-purple-300/80">{"\u2728"} <strong>Magic Page</strong> — Fields are generated dynamically by AI based on the previous page's processing prompt output.</p>
          {activePage === 0 && <p className="text-[11px] text-red mt-1">Cannot be the first page.</p>}
          {activePage > 0 && !state.pages[activePage - 1]?.processPage && <p className="text-[11px] text-yellow mt-1">Previous page needs a processing prompt.</p>}
        </div>
      )}

      {/* Fields */}
      {(page.pageType === "standard" || page.pageType === "magic") && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[13px] font-semibold text-foreground">Fields</h4>
            <Button size="sm" variant="outline" onClick={addField}>+ Add Field</Button>
          </div>
          {page.fields.length === 0 && <div className="text-[11px] text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg">No fields yet.</div>}
          <div className="space-y-2">
            {page.fields.map((f, i) => (
              <div key={i} className="rounded-lg border border-border bg-mantle p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[9px] font-mono text-muted-foreground bg-surface0 px-1.5 py-0.5 rounded">{f.cell}</span>
                  <Select
                    className="text-[11px]"
                    list={FIELD_TYPES.map((t) => ({ value: t, label: t }))}
                    value={f.type}
                    onValueChange={(v) => updateField(i, { type: v })}
                  />
                  <div className="flex-1" />
                  <button onClick={() => moveField(i, -1)} disabled={i === 0} className="text-[11px] text-muted-foreground disabled:opacity-30">{"\u25B2"}</button>
                  <button onClick={() => moveField(i, 1)} disabled={i === page.fields.length - 1} className="text-[11px] text-muted-foreground disabled:opacity-30">{"\u25BC"}</button>
                  <button onClick={() => removeField(i)} className="text-[11px] text-red/60 hover:text-red">{"\u2715"}</button>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-1">
                  <div>
                    <label className="text-[9px] text-muted-foreground">Label</label>
                    <Input value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} className="h-7 text-[12px]" />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground">Key</label>
                    <Input value={f.key} onChange={(e) => updateField(i, { key: e.target.value })} className="h-7 text-[11px] font-mono" />
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                  <div>
                    <label className="text-[9px] text-muted-foreground">Placeholder</label>
                    <Input value={f.placeholder ?? ""} onChange={(e) => updateField(i, { placeholder: e.target.value })} className="h-7 text-[11px]" placeholder="Hint text..." />
                  </div>
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground mt-3">
                    <input type="checkbox" checked={f.required ?? false} onChange={(e) => updateField(i, { required: e.target.checked })} /> Required
                  </label>
                </div>
                {/* Type-specific: select options */}
                {(f.type === "select" || f.type === "multiselect") && (
                  <div className="mt-2">
                    <label className="text-[9px] text-muted-foreground">Options (one per line)</label>
                    <Textarea value={(f.options ?? []).join("\n")} onChange={(e) => updateField(i, { options: e.target.value.split("\n").filter(Boolean) })}
                      rows={3} className="text-[11px]" placeholder={"Option 1\nOption 2\nOption 3"} />
                  </div>
                )}
                {/* Type-specific: number min/max */}
                {(f.type === "number" || f.type === "int" || f.type === "currency" || f.type === "percentage") && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div><label className="text-[9px] text-muted-foreground">Min</label><Input value={f.min ?? ""} onChange={(e) => updateField(i, { min: parseFloat(e.target.value) || undefined })} type="number" className="h-7 text-[11px]" /></div>
                    <div><label className="text-[9px] text-muted-foreground">Max</label><Input value={f.max ?? ""} onChange={(e) => updateField(i, { max: parseFloat(e.target.value) || undefined })} type="number" className="h-7 text-[11px]" /></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formulas */}
      {page.pageType === "standard" && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[13px] font-semibold text-foreground">Formulas</h4>
            <Button size="sm" variant="outline" onClick={addFormula}>+ Add Formula</Button>
          </div>
          <div className="space-y-2">
            {page.formulas.map((f, i) => (
              <div key={i} className="rounded-lg border border-border bg-mantle p-3 flex items-center gap-3">
                <span className="text-[9px] font-mono text-muted-foreground bg-surface0 px-1.5 py-0.5 rounded">{f.cell}</span>
                <div className="flex-1 grid grid-cols-[1fr_2fr] gap-2">
                  <Input value={f.label} onChange={(e) => updateFormula(i, { label: e.target.value })} className="h-7 text-[12px]" placeholder="Label" />
                  <Input value={f.expression} onChange={(e) => updateFormula(i, { expression: e.target.value })} className="h-7 text-[11px] font-mono" placeholder="A1 * C1" />
                </div>
                <div className="flex gap-0.5">
                  {(["number", "currency", "percent", "text"] as const).map((fmt) => (
                    <button key={fmt} onClick={() => updateFormula(i, { format: fmt })} className={cn("px-1.5 py-0.5 text-[9px] rounded", f.format === fmt ? "bg-primary text-primary-foreground" : "bg-surface0 text-muted-foreground")}>
                      {fmt === "number" ? "#" : fmt === "currency" ? "$" : fmt === "percent" ? "%" : "Txt"}
                    </button>
                  ))}
                </div>
                <button onClick={() => removeFormula(i)} className="text-[11px] text-red/60 hover:text-red">{"\u2715"}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formula reference strip */}
      {(state.pages.some((p) => p.formulas.length > 0) || state.constants.length > 0) && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[9px] text-muted-foreground mb-1">Formula reference:</p>
          <div className="flex flex-wrap gap-1">
            {state.pages.flatMap((p) => p.fields.map((f) => <span key={f.cell} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue/5 text-blue/70">{f.cell}: {f.label}</span>))}
            {state.constants.map((c) => <span key={c.cell} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-green/5 text-green/70">{c.cell}: {c.label}</span>)}
            {state.pages.flatMap((p) => p.formulas.map((f) => <span key={f.cell} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/5 text-amber-500/70">{f.cell}: {f.label}</span>))}
          </div>
        </div>
      )}

      {/* Page Prompt Modal */}
      {promptModalOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-[550px] flex flex-col">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-[14px] font-bold text-foreground">{"\u2728"} Page Prompt: {page.title}</h3>
            </div>
            <div className="p-4">
              <p className="text-[11px] text-muted-foreground mb-3"><strong>Page prompts</strong> are executed by AI after completing this page.</p>
              <ul className="text-[11px] text-muted-foreground mb-4 list-disc pl-4 space-y-1">
                <li>Extract data from long-text inputs</li>
                <li>Pre-populate fields on downstream pages</li>
                <li>Control page visibility (show/hide pages)</li>
                <li>Generate dynamic inputs for magic pages</li>
              </ul>
              <label className="block text-[12px] font-semibold text-foreground mb-2">Page Prompt</label>
              <Textarea value={page.processPage ?? ""} onChange={(e) => { const ps = [...state.pages]; ps[activePage] = { ...page, processPage: e.target.value || undefined }; update("pages", ps); }}
                rows={8} placeholder="Analyze the inputs and determine what to show next..." className="text-[12px]" />
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPromptModalOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={() => setPromptModalOpen(false)}>Save Prompt</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 (new): Screens — owner-confirmed primitive (s146 Phase A.2)
// ---------------------------------------------------------------------------
//
// Authors compose screens from PAx components (every component in the five
// @particle-academy packages). Each screen has typed input props with
// required/prefilled/optional qualifiers and user/agent/either source. The
// per-screen mini-agent shape is gated on owner judgment (s146 open question
// 1) and is NOT authored from this step yet.

function ScreensStep({ state, update }: { state: EditorState; update: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void }) {
  const [activeScreen, setActiveScreen] = useState(0);
  const screen = state.screens[activeScreen];

  const addScreen = () => {
    const idx = state.screens.length + 1;
    update("screens", [
      ...state.screens,
      { id: `screen${String(idx)}`, label: `Screen ${String(idx)}`, interface: "static", inputs: [], elements: [] },
    ]);
    setActiveScreen(state.screens.length);
  };

  const removeScreen = (idx: number) => {
    update("screens", state.screens.filter((_, j) => j !== idx));
    if (activeScreen >= state.screens.length - 1) setActiveScreen(Math.max(0, state.screens.length - 2));
  };

  const updateScreen = (patch: Partial<EditorScreen>) => {
    if (!screen) return;
    const screens = [...state.screens];
    screens[activeScreen] = { ...screen, ...patch };
    update("screens", screens);
  };

  const addInput = () => {
    if (!screen) return;
    const idx = screen.inputs.length + 1;
    updateScreen({
      inputs: [...screen.inputs, {
        key: `input_${String(idx)}`, label: `Input ${String(idx)}`,
        type: "string", qualifier: "optional", source: "either",
      }],
    });
  };

  const updateInput = (idx: number, patch: Partial<EditorScreenInput>) => {
    if (!screen) return;
    const inputs = [...screen.inputs];
    inputs[idx] = { ...inputs[idx]!, ...patch };
    updateScreen({ inputs });
  };

  const removeInput = (idx: number) => {
    if (!screen) return;
    updateScreen({ inputs: screen.inputs.filter((_, j) => j !== idx) });
  };

  const addElement = () => {
    if (!screen) return;
    const idx = screen.elements.length + 1;
    updateScreen({
      elements: [...screen.elements, {
        id: `el_${String(idx)}`, componentRef: "react-fancy:Card", propsJson: "",
      }],
    });
  };

  const updateElement = (idx: number, patch: Partial<EditorScreenElement>) => {
    if (!screen) return;
    const elements = [...screen.elements];
    elements[idx] = { ...elements[idx]!, ...patch };
    updateScreen({ elements });
  };

  const removeElement = (idx: number) => {
    if (!screen) return;
    updateScreen({ elements: screen.elements.filter((_, j) => j !== idx) });
  };

  // Contributor-facing DevNotes — register the deferred / TODO items on this
  // step's scope so dev-mode users can browse them via the global modal.
  // Embedded outside the conditional return so they register regardless of
  // whether the empty-state or the populated-state renders.
  const screensStepDevNotes = (
    <>
      <DevNote
        kind="deferred"
        scope="mapp-editor:screens"
        heading="Per-screen mini-agent authoring (s146 phase C)"
      >
        Each screen runs a hybrid agentic-typed mini-agent with special
        agentic tools (owner primitive, cycle 181). The Editor surface for
        authoring it is gated on s146 open question 1: what configures the
        mini-agent (prompt, tool list, intent description) and what tool
        set does it have access to?
      </DevNote>
      <DevNote
        kind="todo"
        scope="mapp-editor:screens"
        heading="Per-component prop schema introspection (Phase E+)"
      >
        Today element props are authored as raw JSON. Phase E will
        introspect each PAx component{"’"}s prop types and render a typed
        form per component. Until then, the JSON textarea is the surface.
      </DevNote>
      <DevNote
        kind="todo"
        scope="mapp-editor:screens"
        heading="Drag-drop reorder of inputs + elements"
      >
        Currently authors remove + re-add to change order. Add up/down
        buttons or HTML5 DnD. Polish, not core to the primitive.
      </DevNote>
      <DevNote
        kind="deferred"
        scope="mapp-editor:screens"
        heading="Live screen preview (Phase D pairing)"
      >
        The Simulator step today renders only legacy form-and-formula
        MApps via MAppFormRenderer. Screens-shaped MApp preview pairs
        with Phase D (runtime renderer) — same JSON definition, both the
        Simulator and the deployed mapp-desktop runtime consume it.
      </DevNote>
    </>
  );

  if (state.screens.length === 0) {
    return (
      <div className="space-y-3">
        {screensStepDevNotes}
        <div className="text-[12px] text-muted-foreground">
          A MApp can be authored as a legacy form-and-formula MApp (Pages step) OR
          as a screens-shaped MApp (this step) OR both. Screens are composed from
          PAx components with typed input props that accept values from user or
          agent.
        </div>
        <Button size="sm" onClick={addScreen} data-testid="mapp-editor-add-screen">+ Add screen</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="mapp-editor-screens-step">
      {screensStepDevNotes}
      <div className="flex items-center gap-2 flex-wrap">
        {state.screens.map((s, i) => (
          <button
            key={i}
            onClick={() => setActiveScreen(i)}
            data-testid={`mapp-editor-screen-tab-${String(i)}`}
            className={cn(
              "px-2.5 py-1 text-[11px] rounded border",
              i === activeScreen ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label || s.id || `Screen ${String(i + 1)}`}
          </button>
        ))}
        <Button size="sm" variant="outline" onClick={addScreen} data-testid="mapp-editor-add-screen">+ Screen</Button>
      </div>

      {screen && (
        <Card className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Screen ID</label>
              <Input
                value={screen.id}
                onChange={(e) => updateScreen({ id: e.target.value })}
                placeholder="main"
                className="font-mono text-[12px]"
                data-testid="mapp-editor-screen-id"
              />
              <div className="text-[10px] text-muted-foreground mt-1">
                Lowercase, alphanumeric, underscore/hyphen ok. No spaces.
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Label</label>
              <Input
                value={screen.label}
                onChange={(e) => updateScreen({ label: e.target.value })}
                placeholder="Main"
                data-testid="mapp-editor-screen-label"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Interface</label>
            <Select
              className="text-[12px]"
              list={[
                { value: "static", label: "Static — composition fixed at author time" },
                { value: "dynamic", label: "Dynamic — composition adapts at runtime" },
              ]}
              value={screen.interface}
              onValueChange={(v) => updateScreen({ interface: v as "static" | "dynamic" })}
            />
          </div>

          {/* Inputs sublist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[12px] font-semibold">Input props ({screen.inputs.length})</h4>
              <Button size="sm" variant="outline" onClick={addInput} data-testid="mapp-editor-add-input">+ Input</Button>
            </div>
            {screen.inputs.length === 0 && (
              <div className="text-[11px] text-muted-foreground italic">
                No inputs yet. Add a typed prop (string/number/select/...) with a qualifier (required/prefilled/optional) and a source (user/agent/either).
              </div>
            )}
            {screen.inputs.map((inp, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-start p-2 bg-bg/50 rounded border border-border">
                <Input className="col-span-2 text-[11px] font-mono" value={inp.key} onChange={(e) => updateInput(i, { key: e.target.value })} placeholder="key" />
                <Input className="col-span-2 text-[11px]" value={inp.label} onChange={(e) => updateInput(i, { label: e.target.value })} placeholder="Label" />
                <Select className="col-span-2 text-[11px]" list={["string","text","number","boolean","date","select","object"].map((v) => ({ value: v, label: v }))} value={inp.type} onValueChange={(v) => updateInput(i, { type: v as EditorScreenInput["type"] })} />
                <Select className="col-span-2 text-[11px]" list={["required","prefilled","optional"].map((v) => ({ value: v, label: v }))} value={inp.qualifier} onValueChange={(v) => updateInput(i, { qualifier: v as EditorScreenInput["qualifier"] })} />
                <Select className="col-span-2 text-[11px]" list={["user","agent","either"].map((v) => ({ value: v, label: v }))} value={inp.source} onValueChange={(v) => updateInput(i, { source: v as EditorScreenInput["source"] })} />
                <Input className="col-span-1 text-[11px]" value={inp.default ?? ""} onChange={(e) => updateInput(i, { default: e.target.value })} placeholder="default" title="Default value (JSON for non-strings)" />
                <button onClick={() => removeInput(i)} className="col-span-1 text-[14px] text-muted-foreground hover:text-red" data-testid={`mapp-editor-remove-input-${String(i)}`}>{"✕"}</button>
              </div>
            ))}
          </div>

          {/* Elements sublist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[12px] font-semibold">Elements ({screen.elements.length})</h4>
              <Button size="sm" variant="outline" onClick={addElement} data-testid="mapp-editor-add-element">+ Element</Button>
            </div>
            {screen.elements.length === 0 && (
              <div className="text-[11px] text-muted-foreground italic">
                Drop a PAx component (e.g. <code>react-fancy:Card</code>, <code>fancy-code:Editor</code>) and configure its props as JSON.
              </div>
            )}
            <datalist id="pax-component-refs">
              {PAX_COMPONENT_REFS.map((ref) => <option key={ref} value={ref} />)}
            </datalist>
            {screen.elements.map((el, i) => (
              <div key={i} className="space-y-2 p-2 bg-bg/50 rounded border border-border">
                <div className="grid grid-cols-12 gap-2 items-center">
                  <Input className="col-span-3 text-[11px] font-mono" value={el.id} onChange={(e) => updateElement(i, { id: e.target.value })} placeholder="element-id" />
                  <input
                    list="pax-component-refs"
                    className="col-span-7 text-[11px] font-mono px-2 py-1.5 bg-bg border border-border rounded"
                    value={el.componentRef}
                    onChange={(e) => updateElement(i, { componentRef: e.target.value })}
                    placeholder="react-fancy:Card"
                    data-testid={`mapp-editor-element-componentref-${String(i)}`}
                  />
                  <button onClick={() => removeElement(i)} className="col-span-2 text-[14px] text-muted-foreground hover:text-red" data-testid={`mapp-editor-remove-element-${String(i)}`}>{"✕"}</button>
                </div>
                <Textarea
                  className="text-[11px] font-mono"
                  rows={3}
                  value={el.propsJson}
                  onChange={(e) => updateElement(i, { propsJson: e.target.value })}
                  placeholder='{"title": "Hello", "value": "$input.userInput"}'
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-2 border-t border-border">
            <Button size="sm" variant="ghost" onClick={() => removeScreen(activeScreen)} data-testid="mapp-editor-remove-screen">Remove screen</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 (legacy index): Output — matches reference screenshot
// ---------------------------------------------------------------------------

function OutputStep({ state, update }: { state: EditorState; update: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void }) {
  const allFieldKeys = state.pages.flatMap((p) => p.fields.map((f) => f.key));
  const allFormulaCells = state.pages.flatMap((p) => p.formulas.map((f) => f.cell));

  return (
    <div className="space-y-5">
      <DevNote
        kind="todo"
        scope="mapp-editor:output"
        heading="Available variables ignores screens[*].inputs[*]"
      >
        `allFieldKeys` aggregates from `state.pages[*].fields` only; the
        s146 phase A.2 screens primitive ships with its own typed input
        props (<code>state.screens[*].inputs[*].key</code>). The Available
        variables hint should surface those too once Phase D runtime
        renderer wires the substitution. Until then, screens-shaped MApp
        authors won{"\u2019"}t see their input keys listed here.
      </DevNote>
      <DevNote
        kind="todo"
        scope="mapp-editor:output"
        heading="Tool Analysis Analyze button is a placeholder"
      >
        Clicking the {"\u2728"} Analyze button currently does nothing.
        Intended to surface complexity / quality metrics for the
        authored MApp (cf. AGI{"\u2019"}s code-analyzer or model-runtime
        tooling). Either wire it to a real analyzer or remove the
        affordance.
      </DevNote>
      <div>
        <h3 className="text-[14px] font-semibold text-foreground">Output Configuration</h3>
        <p className="text-[11px] text-muted-foreground">Review your tool's workflow and define the final processing prompt.</p>
      </div>

      {/* Tool Analysis placeholder */}
      <div className="rounded-lg border border-border bg-mantle p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-foreground">{"\u2728"} Tool Analysis</span>
          <Button size="sm" variant="outline">Analyze</Button>
        </div>
        <p className="text-center py-3 text-[11px] text-muted-foreground">Click "Analyze" to review your tool's complexity and quality.</p>
      </div>

      {/* Final Processing Prompt */}
      <div>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-foreground mb-2">
          {"\u2728"} Final Processing Prompt
        </label>
        <Textarea value={state.processingPrompt} onChange={(e) => update("processingPrompt", e.target.value)}
          rows={10} placeholder="After completing the inputs, produce a comprehensive analysis..." className="text-[13px]" />
        <p className="text-[11px] text-muted-foreground mt-1">This AI prompt receives all inputs from all pages and formula results to generate the final output.</p>
      </div>

      {/* Available variables */}
      {(allFieldKeys.length > 0 || allFormulaCells.length > 0) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <span className="text-[12px] font-semibold text-foreground">Available variables: </span>
          <span className="text-[11px] text-muted-foreground">
            All field keys (e.g., <code className="text-amber-500 bg-amber-500/10 px-1 rounded">{`{{${allFieldKeys[0] ?? "field_key"}}}`}</code>)
            and formula results (e.g., <code className="text-amber-500 bg-amber-500/10 px-1 rounded">{`{{${allFormulaCells[0] ?? "B1"}}}`}</code>)
            are available in the prompt.
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Simulator
// ---------------------------------------------------------------------------

function SimulatorStep({ state }: { state: EditorState }) {
  const def = useMemo(() => stateToDefinition(state), [state]);
  const pages = (def.pages ?? []) as Array<{ key: string; title: string; pageType: string; visibility: string; fields?: Array<Record<string, unknown>>; formulas?: Array<Record<string, unknown>> }>;

  return (
    <>
      <DevNote
        kind="deferred"
        scope="mapp-editor:simulator"
        heading="Screens-shaped MApps don't render in the Simulator yet (Phase D)"
      >
        The Simulator preview only renders `pages` via
        <code>MAppFormRenderer</code> (legacy form-and-formula path). The
        s146 phase A.2 screens primitive needs Phase D{"’"}s runtime
        renderer to draw PAx components from <code>state.screens[*].elements</code>.
        Until Phase D ships, screens-shaped MApps authored in step 4 are
        invisible here. Pairs naturally with `mapp-editor:output` notes.
      </DevNote>
      {pages.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">No pages to simulate. Add fields in the Pages step.</div>
      ) : (
        <div className="border border-border rounded-lg p-4 bg-mantle">
          <h4 className="text-[12px] font-semibold text-foreground mb-3">Live Preview</h4>
          <MAppFormRenderer
            pages={pages as import("./MAppFormRenderer.js").MAppFormRendererProps["pages"]}
            constants={(def.constants ?? []) as import("./MAppFormRenderer.js").MAppFormRendererProps["constants"]}
            onSubmit={(values, formulas) => { console.log("Simulator:", { values, formulas }); }}
          />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// State ↔ Definition conversion
// ---------------------------------------------------------------------------

function stateToDefinition(state: EditorState): Record<string, unknown> {
  const def: Record<string, unknown> = {
    $schema: "mapp/1.0", id: state.id, name: state.name, author: state.author,
    version: state.version, description: state.description, category: state.category,
    permissions: state.permissions,
    panel: { label: state.name || "App", widgets: state.panelWidgets },
  };
  if (state.icon) def.icon = state.icon;
  if (state.pages.length > 0 && state.pages.some((p) => p.fields.length > 0 || p.formulas.length > 0)) def.pages = state.pages;
  if (state.constants.length > 0) def.constants = state.constants;
  if (state.processingPrompt) def.output = { processingPrompt: state.processingPrompt };
  // s146 Phase A.2 — emit screens when authored. Editor stores defaults and
  // props as text/JSON strings for editing; this serializer parses them out.
  if (state.screens.length > 0) {
    def.screens = state.screens.map((s) => ({
      id: s.id,
      label: s.label,
      interface: s.interface,
      ...(s.inputs.length > 0 ? {
        inputs: s.inputs.map((i) => {
          const out: Record<string, unknown> = {
            key: i.key, label: i.label, type: i.type,
            qualifier: i.qualifier, source: i.source,
          };
          if (i.description) out.description = i.description;
          if (i.options !== undefined && i.options !== "") {
            out.options = i.options.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
          }
          if (i.default !== undefined && i.default !== "") {
            try { out.default = JSON.parse(i.default); }
            catch { out.default = i.default; }
          }
          return out;
        }),
      } : {}),
      elements: s.elements.map((el) => {
        const out: Record<string, unknown> = { id: el.id, componentRef: el.componentRef };
        if (el.propsJson && el.propsJson.trim().length > 0) {
          try { out.props = JSON.parse(el.propsJson); }
          catch { /* invalid JSON drops props — Save validation surfaces error elsewhere */ }
        }
        return out;
      }),
    }));
  }
  return def;
}

function definitionToState(def: Record<string, unknown>): EditorState {
  // s146 Phase A.2 — round-trip screens. Inputs/elements come back as typed
  // JSON; the Editor stores defaults + props as serialized text for editing.
  const rawScreens = (def.screens as Array<Record<string, unknown>> | undefined) ?? [];
  const screens: EditorScreen[] = rawScreens.map((s) => ({
    id: String(s.id ?? ""),
    label: String(s.label ?? ""),
    interface: (s.interface === "dynamic" ? "dynamic" : "static") as "static" | "dynamic",
    inputs: (s.inputs as Array<Record<string, unknown>> | undefined ?? []).map((i) => ({
      key: String(i.key ?? ""),
      label: String(i.label ?? ""),
      type: String(i.type ?? "string") as EditorScreenInput["type"],
      qualifier: String(i.qualifier ?? "optional") as EditorScreenInput["qualifier"],
      source: String(i.source ?? "either") as EditorScreenInput["source"],
      default: i.default !== undefined ? JSON.stringify(i.default) : "",
      description: typeof i.description === "string" ? i.description : "",
      options: Array.isArray(i.options) ? (i.options as string[]).join(",") : "",
    })),
    elements: (s.elements as Array<Record<string, unknown>> | undefined ?? []).map((el) => ({
      id: String(el.id ?? ""),
      componentRef: String(el.componentRef ?? ""),
      propsJson: el.props !== undefined ? JSON.stringify(el.props, null, 2) : "",
    })),
  }));

  return {
    id: String(def.id ?? ""), name: String(def.name ?? ""), author: String(def.author ?? ""),
    version: String(def.version ?? "1.0.0"), description: String(def.description ?? ""),
    category: String(def.category ?? "tool"), icon: String(def.icon ?? ""),
    permissions: (def.permissions as EditorState["permissions"]) ?? [],
    constants: (def.constants as EditorState["constants"]) ?? [],
    pages: (def.pages as EditorState["pages"]) ?? [{ key: "page1", title: "Step 1", pageType: "standard", visibility: "always", fields: [], formulas: [] }],
    screens,
    processingPrompt: ((def.output as Record<string, unknown>)?.processingPrompt as string) ?? "",
    panelWidgets: ((def.panel as Record<string, unknown>)?.widgets as Array<Record<string, unknown>>) ?? [],
  };
}
