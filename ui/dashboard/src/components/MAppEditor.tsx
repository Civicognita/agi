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
import { EmojiSelect } from "@particle-academy/react-fancy";
import { MAppFormRenderer } from "./MAppFormRenderer.js";
import { cn } from "@/lib/utils";

const STEPS = ["Basics", "Constants", "Pages", "Output", "Simulator"] as const;
const DRAFT_KEY = "mapp-editor-draft";

const FIELD_TYPES = [
  "text", "textarea", "number", "int", "currency", "percentage",
  "date", "email", "phone", "url", "bool", "select", "multiselect", "info",
] as const;

const CATEGORIES = ["reader", "gallery", "tool", "suite", "editor", "viewer", "game", "custom"] as const;

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

interface EditorState {
  id: string; name: string; author: string; version: string;
  description: string; category: string; icon: string;
  permissions: Array<{ id: string; reason: string; required: boolean }>;
  constants: EditorConstant[];
  pages: EditorPage[];
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
          {step === 3 && <OutputStep state={state} update={update} />}
          {step === 4 && <SimulatorStep state={state} />}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <Button variant="secondary" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</Button>
          <div className="flex gap-2">
            {step < 4 && <Button size="sm" variant="outline" onClick={() => setStep((s) => s + 1)}>Next</Button>}
            <Button size="sm" onClick={handleSave}>Save MApp</Button>
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
          <select value={state.category} onChange={(e) => update("category", e.target.value)} className="w-full h-9 px-3 rounded-md border border-border bg-background text-foreground text-[13px]">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Description</label>
        <textarea value={state.description} onChange={(e) => update("description", e.target.value)} rows={2} placeholder="What does this MApp do?" className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-[13px]" />
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
                <select value={c.visibility} onChange={(e) => { const cs = [...state.constants]; cs[i] = { ...c, visibility: e.target.value as EditorConstant["visibility"] }; update("constants", cs); }}
                  className="h-7 px-1 rounded border border-border bg-background text-[10px]">
                  <option value="always">Visible</option><option value="hidden">Hidden</option>
                </select>
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
          <select value={page.pageType} onChange={(e) => { const ps = [...state.pages]; ps[activePage] = { ...page, pageType: e.target.value }; update("pages", ps); }} className="h-8 px-2 rounded border border-border bg-background text-[11px]">
            <option value="standard">Standard</option><option value="magic">Magic</option><option value="embedded">Embedded</option><option value="canvas">Canvas</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">Visibility</label>
          {activePage === 0 ? (
            <div className="h-8 px-2 rounded border border-border bg-surface0/30 text-muted-foreground text-[11px] flex items-center">Always</div>
          ) : (
            <select value={page.visibility} onChange={(e) => { const ps = [...state.pages]; ps[activePage] = { ...page, visibility: e.target.value }; update("pages", ps); }} className="h-8 px-2 rounded border border-border bg-background text-[11px]">
              <option value="always">Always</option><option value="conditional">Conditional</option><option value="auto">Auto</option><option value="hidden">Hidden</option>
            </select>
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
                  <select value={f.type} onChange={(e) => updateField(i, { type: e.target.value })} className="h-7 px-1 rounded border border-border bg-background text-[11px]">
                    {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
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
                    <textarea value={(f.options ?? []).join("\n")} onChange={(e) => updateField(i, { options: e.target.value.split("\n").filter(Boolean) })}
                      rows={3} className="w-full px-2 py-1 rounded border border-border bg-background text-[11px]" placeholder={"Option 1\nOption 2\nOption 3"} />
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
              <textarea value={page.processPage ?? ""} onChange={(e) => { const ps = [...state.pages]; ps[activePage] = { ...page, processPage: e.target.value || undefined }; update("pages", ps); }}
                rows={8} placeholder="Analyze the inputs and determine what to show next..." className="w-full px-3 py-2 rounded-md border border-border bg-mantle text-foreground text-[12px]" />
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
// Step 4: Output — matches reference screenshot
// ---------------------------------------------------------------------------

function OutputStep({ state, update }: { state: EditorState; update: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void }) {
  const allFieldKeys = state.pages.flatMap((p) => p.fields.map((f) => f.key));
  const allFormulaCells = state.pages.flatMap((p) => p.formulas.map((f) => f.cell));

  return (
    <div className="space-y-5">
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
        <textarea value={state.processingPrompt} onChange={(e) => update("processingPrompt", e.target.value)}
          rows={10} placeholder="After completing the inputs, produce a comprehensive analysis..." className="w-full px-4 py-3 rounded-lg border border-border bg-mantle text-foreground text-[13px]" />
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

  if (pages.length === 0) return <div className="text-center text-muted-foreground py-8">No pages to simulate. Add fields in the Pages step.</div>;

  return (
    <div className="border border-border rounded-lg p-4 bg-mantle">
      <h4 className="text-[12px] font-semibold text-foreground mb-3">Live Preview</h4>
      <MAppFormRenderer
        pages={pages as import("./MAppFormRenderer.js").MAppFormRendererProps["pages"]}
        constants={(def.constants ?? []) as import("./MAppFormRenderer.js").MAppFormRendererProps["constants"]}
        onSubmit={(values, formulas) => { console.log("Simulator:", { values, formulas }); }}
      />
    </div>
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
  return def;
}

function definitionToState(def: Record<string, unknown>): EditorState {
  return {
    id: String(def.id ?? ""), name: String(def.name ?? ""), author: String(def.author ?? ""),
    version: String(def.version ?? "1.0.0"), description: String(def.description ?? ""),
    category: String(def.category ?? "tool"), icon: String(def.icon ?? ""),
    permissions: (def.permissions as EditorState["permissions"]) ?? [],
    constants: (def.constants as EditorState["constants"]) ?? [],
    pages: (def.pages as EditorState["pages"]) ?? [{ key: "page1", title: "Step 1", pageType: "standard", visibility: "always", fields: [], formulas: [] }],
    processingPrompt: ((def.output as Record<string, unknown>)?.processingPrompt as string) ?? "",
    panelWidgets: ((def.panel as Record<string, unknown>)?.widgets as Array<Record<string, unknown>>) ?? [],
  };
}
