/**
 * MAppEditor — 5-step wizard modal for visually creating/editing MApps.
 *
 * Steps: Basics → Constants → Pages → Output → Simulator
 * Auto-saves draft to sessionStorage. Dirty state tracking.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { EmojiSelect, Select, Tabs, Textarea } from "@particle-academy/react-fancy";
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
  processPage?: string;  // AI prompt run after page completion
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
    // Check for draft
    const draft = sessionStorage.getItem(DRAFT_KEY);
    if (draft) {
      try { return JSON.parse(draft) as EditorState; } catch { /* fall through */ }
    }
    if (initialDefinition) {
      return definitionToState(initialDefinition);
    }
    return emptyState();
  });
  const [dirty, setDirty] = useState(false);

  // Auto-save draft
  useEffect(() => {
    const timer = setTimeout(() => {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    }, 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const update = useCallback(<K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    const def = stateToDefinition(state);
    onSave(def);
    sessionStorage.removeItem(DRAFT_KEY);
    setDirty(false);
  }, [state, onSave]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[800px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-foreground">MApp Editor</h2>
            {dirty && <span className="w-2 h-2 rounded-full bg-yellow animate-pulse" title="Unsaved changes" />}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">{"\u2715"}</button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-border">
          {STEPS.map((s, i) => (
            <button
              key={s}
              onClick={() => setStep(i)}
              className={cn(
                "flex-1 py-2 text-[12px] font-semibold transition-colors",
                i === step ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {i + 1}. {s}
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-auto p-4">
          {step === 0 && <BasicsStep state={state} update={update} />}
          {step === 1 && <ConstantsStep state={state} update={update} />}
          {step === 2 && <PagesStep state={state} update={update} />}
          {step === 3 && <OutputStep state={state} update={update} />}
          {step === 4 && <SimulatorStep state={state} />}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <Button variant="secondary" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            Back
          </Button>
          <div className="flex gap-2">
            {step < 4 && <Button size="sm" onClick={() => setStep((s) => s + 1)}>Next</Button>}
            <Button size="sm" variant="default" onClick={handleSave}>Save MApp</Button>
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
    <div className="space-y-3 max-w-lg">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Name</label>
          <Input value={state.name} onChange={(e) => { update("name", e.target.value); if (!state.id) update("id", e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-")); }} placeholder="My Calculator" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-muted-foreground mb-1">ID (slug)</label>
          <Input value={state.id} onChange={(e) => update("id", e.target.value)} placeholder="my-calculator" />
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
// Step 2: Constants
// ---------------------------------------------------------------------------

function ConstantsStep({ state, update }: { state: EditorState; update: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void }) {
  const addConstant = () => {
    const idx = state.constants.length + 1;
    update("constants", [...state.constants, { key: `const_${idx}`, cell: `C${idx}`, label: `Constant ${idx}`, value: 0, format: "number" as const, visibility: "always" as const }]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-semibold text-foreground">Constants (C-column)</h3>
        <Button size="sm" variant="outline" onClick={addConstant}>Add Constant</Button>
      </div>
      {state.constants.length === 0 && <div className="text-[12px] text-muted-foreground py-4 text-center">No constants yet. Add preset values used in formulas.</div>}
      {state.constants.map((c, i) => (
        <div key={i} className="p-3 rounded-lg border border-green/30 bg-green/5 flex items-start gap-3">
          <span className="text-[10px] font-bold text-green bg-green/20 px-1.5 py-0.5 rounded">{c.cell}</span>
          <div className="flex-1 grid grid-cols-3 gap-2">
            <Input value={c.label} onChange={(e) => { const cs = [...state.constants]; cs[i] = { ...c, label: e.target.value }; update("constants", cs); }} placeholder="Label" />
            <Input value={String(c.value)} onChange={(e) => { const cs = [...state.constants]; cs[i] = { ...c, value: parseFloat(e.target.value) || 0 }; update("constants", cs); }} placeholder="Value" type="number" />
            <select value={c.format} onChange={(e) => { const cs = [...state.constants]; cs[i] = { ...c, format: e.target.value as EditorConstant["format"] }; update("constants", cs); }} className="h-9 px-2 rounded-md border border-border bg-background text-[12px]">
              <option value="number">#</option><option value="currency">$</option><option value="percent">%</option>
            </select>
          </div>
          <button onClick={() => update("constants", state.constants.filter((_, j) => j !== i))} className="text-red text-[11px]">{"\u2715"}</button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Pages
// ---------------------------------------------------------------------------

function PagesStep({ state, update }: { state: EditorState; update: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void }) {
  const [activePage, setActivePage] = useState(0);
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

  if (!page) return null;

  return (
    <div>
      {/* Page tabs */}
      <div className="flex items-center gap-1 mb-3 border-b border-border pb-2">
        {state.pages.map((p, i) => (
          <button key={p.key} onClick={() => setActivePage(i)} className={cn("px-3 py-1 text-[11px] rounded-t", i === activePage ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground")}>
            {p.title}
          </button>
        ))}
        <button onClick={addPage} className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">+ Page</button>
      </div>

      {/* Page config */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Input value={page.title} onChange={(e) => { const ps = [...state.pages]; ps[activePage] = { ...page, title: e.target.value }; update("pages", ps); }} placeholder="Page title" />
        <select value={page.pageType} onChange={(e) => { const ps = [...state.pages]; ps[activePage] = { ...page, pageType: e.target.value }; update("pages", ps); }} className="h-9 px-2 rounded-md border border-border bg-background text-[12px]">
          <option value="standard">Standard</option>
          <option value="magic">Magic (AI-generated fields)</option>
          <option value="embedded">Embedded (iframe)</option>
          <option value="canvas">Canvas (widgets)</option>
        </select>
        {/* First page is always "always" — cannot be changed */}
        {activePage === 0 ? (
          <div className="h-9 px-2 rounded-md border border-border bg-surface0/50 text-foreground text-[12px] flex items-center text-muted-foreground">Always (first page)</div>
        ) : (
          <select value={page.visibility} onChange={(e) => { const ps = [...state.pages]; ps[activePage] = { ...page, visibility: e.target.value }; update("pages", ps); }} className="h-9 px-2 rounded-md border border-border bg-background text-[12px]">
            <option value="always">Always</option>
            <option value="conditional">Conditional</option>
            <option value="auto">Auto (AI decides)</option>
            <option value="hidden">Hidden (AI-prefilled)</option>
          </select>
        )}
      </div>

      {/* Magic page validation warning */}
      {page.pageType === "magic" && activePage === 0 && (
        <div className="text-[11px] text-red bg-red/10 rounded-lg px-3 py-2 mb-3">Magic pages cannot be the first page — they need a prior page with a processing prompt.</div>
      )}
      {page.pageType === "magic" && activePage > 0 && !state.pages[activePage - 1]?.processPage && (
        <div className="text-[11px] text-yellow bg-yellow/10 rounded-lg px-3 py-2 mb-3">Magic pages should follow a page with a processing prompt so AI can generate dynamic fields.</div>
      )}

      {/* Processing Prompt (per page — runs after user completes this page) */}
      {(page.pageType === "standard" || page.pageType === "magic") && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-purple-400">Processing Prompt (AI runs after this page)</label>
            {!page.processPage && (
              <button
                onClick={() => { const ps = [...state.pages]; ps[activePage] = { ...page, processPage: "" }; update("pages", ps); }}
                className="text-[10px] text-purple-400 hover:text-purple-300"
              >
                + Add
              </button>
            )}
          </div>
          {page.processPage !== undefined && (
            <div className="relative">
              <textarea
                value={page.processPage}
                onChange={(e) => { const ps = [...state.pages]; ps[activePage] = { ...page, processPage: e.target.value }; update("pages", ps); }}
                rows={3}
                placeholder="Analyze the inputs from this page and determine what to show next..."
                className="w-full px-3 py-2 rounded-md border border-purple-400/30 bg-purple-400/5 text-foreground text-[12px] font-mono"
              />
              <button
                onClick={() => { const ps = [...state.pages]; ps[activePage] = { ...page, processPage: undefined }; update("pages", ps); }}
                className="absolute top-1 right-1 text-[10px] text-muted-foreground hover:text-red"
              >
                Remove
              </button>
            </div>
          )}
          {page.processPage !== undefined && (
            <p className="text-[10px] text-muted-foreground mt-1">
              AI processes collected inputs after this page. Returns: prepopulate, visibility overrides, dynamic fields for magic pages.
            </p>
          )}
        </div>
      )}

      {/* Fields */}
      {(page.pageType === "standard" || page.pageType === "magic") && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[12px] font-semibold text-blue">Fields (A-column)</h4>
            <Button size="sm" variant="outline" onClick={addField}>Add Field</Button>
          </div>
          {page.fields.map((f, i) => (
            <div key={i} className="p-2 rounded-lg border border-blue/30 bg-blue/5 mb-2 flex items-center gap-2">
              <span className="text-[10px] font-bold text-blue bg-blue/20 px-1.5 py-0.5 rounded">{f.cell}</span>
              <Input value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} className="flex-1 h-8 text-[12px]" placeholder="Label" />
              <select value={f.type} onChange={(e) => updateField(i, { type: e.target.value })} className="h-8 px-1 rounded border border-border bg-background text-[11px] w-24">
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <label className="flex items-center gap-1 text-[10px]">
                <input type="checkbox" checked={f.required ?? false} onChange={(e) => updateField(i, { required: e.target.checked })} /> Req
              </label>
              <button onClick={() => { const ps = [...state.pages]; ps[activePage] = { ...page, fields: page.fields.filter((_, j) => j !== i) }; update("pages", ps); }} className="text-red text-[11px]">{"\u2715"}</button>
            </div>
          ))}
        </div>
      )}

      {/* Formulas */}
      {page.pageType === "standard" && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[12px] font-semibold text-amber-500">Formulas (B-column)</h4>
            <Button size="sm" variant="outline" onClick={addFormula}>Add Formula</Button>
          </div>
          {page.formulas.map((f, i) => (
            <div key={i} className="p-2 rounded-lg border border-amber-500/30 bg-amber-500/5 mb-2 flex items-center gap-2">
              <span className="text-[10px] font-bold text-amber-500 bg-amber-500/20 px-1.5 py-0.5 rounded">{f.cell}</span>
              <Input value={f.label} onChange={(e) => updateFormula(i, { label: e.target.value })} className="w-32 h-8 text-[12px]" placeholder="Label" />
              <Input value={f.expression} onChange={(e) => updateFormula(i, { expression: e.target.value })} className="flex-1 h-8 text-[12px] font-mono" placeholder="A1 * C1" />
              <select value={f.format} onChange={(e) => updateFormula(i, { format: e.target.value as EditorFormula["format"] })} className="h-8 px-1 rounded border border-border bg-background text-[11px] w-16">
                <option value="number">#</option><option value="currency">$</option><option value="percent">%</option><option value="text">Txt</option>
              </select>
              <button onClick={() => { const ps = [...state.pages]; ps[activePage] = { ...page, formulas: page.formulas.filter((_, j) => j !== i) }; update("pages", ps); }} className="text-red text-[11px]">{"\u2715"}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Output
// ---------------------------------------------------------------------------

function OutputStep({ state, update }: { state: EditorState; update: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void }) {
  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Processing Prompt</label>
        <p className="text-[10px] text-muted-foreground mb-2">AI instruction for generating the final output from collected data. Leave empty for formula-only MApps.</p>
        <textarea value={state.processingPrompt} onChange={(e) => update("processingPrompt", e.target.value)} rows={6} placeholder="Analyze the collected data and provide..." className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-[13px] font-mono" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Simulator
// ---------------------------------------------------------------------------

function SimulatorStep({ state }: { state: EditorState }) {
  const def = useMemo(() => stateToDefinition(state), [state]);
  const pages = (def.pages ?? []) as Array<{ key: string; title: string; pageType: string; visibility: string; fields?: Array<Record<string, unknown>>; formulas?: Array<Record<string, unknown>> }>;

  if (pages.length === 0) {
    return <div className="text-center text-muted-foreground py-8">No pages to simulate. Add fields in Step 3.</div>;
  }

  return (
    <div className="border border-border rounded-lg p-4 bg-mantle">
      <h4 className="text-[12px] font-semibold text-foreground mb-3">Live Preview</h4>
      <MAppFormRenderer
        pages={pages as import("./MAppFormRenderer.js").MAppFormRendererProps["pages"]}
        constants={(def.constants ?? []) as import("./MAppFormRenderer.js").MAppFormRendererProps["constants"]}
        onSubmit={(values, formulas) => {
          console.log("Simulator submit:", { values, formulas });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function stateToDefinition(state: EditorState): Record<string, unknown> {
  const def: Record<string, unknown> = {
    $schema: "mapp/1.0",
    id: state.id,
    name: state.name,
    author: state.author,
    version: state.version,
    description: state.description,
    category: state.category,
    permissions: state.permissions,
    panel: { label: state.name || "App", widgets: state.panelWidgets },
  };
  if (state.icon) def.icon = state.icon;
  if (state.pages.length > 0 && state.pages.some((p) => p.fields.length > 0 || p.formulas.length > 0)) {
    def.pages = state.pages;
  }
  if (state.constants.length > 0) def.constants = state.constants;
  if (state.processingPrompt) def.output = { processingPrompt: state.processingPrompt };
  return def;
}

function definitionToState(def: Record<string, unknown>): EditorState {
  return {
    id: String(def.id ?? ""),
    name: String(def.name ?? ""),
    author: String(def.author ?? ""),
    version: String(def.version ?? "1.0.0"),
    description: String(def.description ?? ""),
    category: String(def.category ?? "tool"),
    icon: String(def.icon ?? ""),
    permissions: (def.permissions as EditorState["permissions"]) ?? [],
    constants: (def.constants as EditorState["constants"]) ?? [],
    pages: (def.pages as EditorState["pages"]) ?? [{ key: "page1", title: "Step 1", pageType: "standard", visibility: "always", fields: [], formulas: [] }],
    processingPrompt: ((def.output as Record<string, unknown>)?.processingPrompt as string) ?? "",
    panelWidgets: ((def.panel as Record<string, unknown>)?.widgets as Array<Record<string, unknown>>) ?? [],
  };
}
