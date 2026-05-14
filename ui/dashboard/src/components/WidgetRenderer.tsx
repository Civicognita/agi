/**
 * WidgetRenderer — renders plugin-provided PanelWidget[] arrays.
 *
 * All plugin UI is declarative data structures rendered by this generic renderer.
 * Plugins cannot inject React components directly (static Vite build).
 */

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ContentRenderer, Textarea } from "@particle-academy/react-fancy";
import { markdownComponents } from "@/lib/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Chart,
  Timeline,
  Kanban,
  Editor,
  TreeNav,
  DatePicker,
  ColorPicker,
  Autocomplete,
  Slider,
  OtpInput,
  FileUpload,
  Switch,
  Select,
} from "@particle-academy/react-fancy";
import { CodeEditor } from "@particle-academy/fancy-code";
import { FlowCanvas, type FlowEdge, type FlowNode } from "@particle-academy/fancy-flow";
import "@particle-academy/fancy-code/styles.css";
import { executeAction, fetchProjectFileTree } from "../api.js";
import type { FileNode } from "../api.js";
import type { PanelWidget, PluginAction, UIField } from "../types.js";

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

function FieldGroupWidget({ widget }: { widget: Extract<PanelWidget, { type: "field-group" }> }) {
  return (
    <div className="space-y-2">
      {widget.title && (
        <h4 className="text-[12px] font-semibold text-foreground">{widget.title}</h4>
      )}
      <div className="grid grid-cols-2 gap-3">
        {widget.fields.map((f) => (
          <FieldInput key={f.id} field={f} />
        ))}
      </div>
    </div>
  );
}

function FieldInput({ field }: { field: UIField }) {
  const [value, setValue] = useState<string | number | boolean>(field.defaultValue ?? "");

  if (field.type === "readonly") {
    return (
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{field.label}</label>
        <div className="h-9 flex items-center text-[12px] text-foreground">{String(value)}</div>
      </div>
    );
  }

  if (field.type === "toggle") {
    return (
      <div className="flex items-center gap-2">
        <label className="text-[11px] font-semibold text-muted-foreground">{field.label}</label>
        <Switch checked={!!value} onCheckedChange={(v) => setValue(v)} />
      </div>
    );
  }

  if (field.type === "select" && field.options) {
    return (
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{field.label}</label>
        <Select
          list={field.options.map((o) => ({ value: o.value, label: o.label }))}
          value={String(value)}
          onValueChange={(v) => setValue(v)}
          placeholder={field.placeholder}
        />
      </div>
    );
  }

  if (field.type === "date") {
    return (
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{field.label}</label>
        <DatePicker value={String(value)} onChange={(v) => setValue(v)} />
      </div>
    );
  }

  if (field.type === "color") {
    return (
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{field.label}</label>
        <ColorPicker value={String(value)} onChange={(v) => setValue(v)} />
      </div>
    );
  }

  if (field.type === "autocomplete") {
    return (
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{field.label}</label>
        <Autocomplete
          value={String(value)}
          onChange={(v) => setValue(v)}
          endpoint={field.autocompleteEndpoint}
          multiple={field.multiple}
          placeholder={field.placeholder}
        />
      </div>
    );
  }

  if (field.type === "slider") {
    return (
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
          {field.label} <span className="text-foreground font-normal">{value}</span>
        </label>
        <Slider
          value={Number(value) || 0}
          onChange={(v) => setValue(v)}
          min={field.min ?? 0}
          max={field.max ?? 100}
          step={field.step ?? 1}
        />
      </div>
    );
  }

  if (field.type === "otp") {
    return (
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{field.label}</label>
        <OtpInput value={String(value)} onChange={(v) => setValue(v)} />
      </div>
    );
  }

  if (field.type === "file") {
    return (
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{field.label}</label>
        <FileUpload accept={field.accept} multiple={field.multiple}>
          <FileUpload.Dropzone />
        </FileUpload>
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className="col-span-2">
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{field.label}</label>
        <Textarea
          value={String(value)}
          onChange={(e) => setValue(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className="text-[13px] resize-y"
        />
      </div>
    );
  }

  return (
    <div>
      <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{field.label}</label>
      <Input
        type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
        value={String(value)}
        onChange={(e) => setValue(field.type === "number" ? Number(e.target.value) : e.target.value)}
        placeholder={field.placeholder}
      />
    </div>
  );
}

function ActionBarWidget({ widget, actions, projectPath }: {
  widget: Extract<PanelWidget, { type: "action-bar" }>;
  actions: PluginAction[];
  projectPath?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; ok: boolean; message?: string } | null>(null);

  const handleExecute = useCallback(async (action: PluginAction) => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setBusy(action.id);
    setResult(null);
    try {
      const ctx: Record<string, string> = {};
      if (projectPath) ctx.projectPath = projectPath;
      const r = await executeAction(action.id, ctx);
      setResult({ id: action.id, ok: r.ok, message: r.output ?? r.error });
    } catch (err) {
      setResult({ id: action.id, ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }, [projectPath]);

  const barActions = widget.actionIds
    .map((id) => actions.find((a) => a.id === id))
    .filter((a): a is PluginAction => a != null);

  if (barActions.length === 0) return null;

  // Group by action.group
  const groups = new Map<string, PluginAction[]>();
  for (const a of barActions) {
    const g = a.group ?? "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(a);
  }

  return (
    <div className="space-y-2">
      {[...groups.entries()].map(([group, groupActions]) => (
        <div key={group}>
          {group && <div className="text-[11px] font-semibold text-muted-foreground mb-1">{group}</div>}
          <div className="flex flex-wrap gap-1.5">
            {groupActions.map((a) => (
              <Button
                key={a.id}
                size="sm"
                variant={a.destructive ? "destructive" : "outline"}
                disabled={busy !== null}
                onClick={() => void handleExecute(a)}
              >
                {busy === a.id ? "Running..." : a.label}
              </Button>
            ))}
          </div>
        </div>
      ))}
      {result && (
        <div className={`text-[11px] mt-1 ${result.ok ? "text-green" : "text-red"}`}>
          {result.message ?? (result.ok ? "Done" : "Failed")}
        </div>
      )}
    </div>
  );
}

function StatusDisplayWidget({ widget, projectPath }: { widget: Extract<PanelWidget, { type: "status-display" }>; projectPath?: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Support {projectPath} template in endpoint URL
  const endpoint = projectPath ? widget.statusEndpoint.replace(/\{projectPath\}/g, encodeURIComponent(projectPath)) : widget.statusEndpoint;

  useEffect(() => {
    fetch(endpoint)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Record<string, unknown>>; })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [endpoint]);

  if (error) return <div className="text-[11px] text-red">{error}</div>;
  if (!data) return <div className="text-[11px] text-muted-foreground">Loading...</div>;

  return (
    <div>
      {widget.title && <h4 className="text-[12px] font-semibold text-foreground mb-2">{widget.title}</h4>}
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="p-2 rounded-lg bg-surface0 border border-border">
            <div className="text-[10px] text-muted-foreground">{k}</div>
            <div className="text-[13px] font-semibold text-foreground">{String(v)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LogStreamWidget({ widget }: { widget: Extract<PanelWidget, { type: "log-stream" }> }) {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    fetch(widget.logSource)
      .then((r) => r.text())
      .then((text) => setLines(text.split("\n").slice(-(widget.lines ?? 50))))
      .catch(() => setLines(["Failed to load log"]));
  }, [widget.logSource, widget.lines]);

  return (
    <div>
      {widget.title && <h4 className="text-[12px] font-semibold text-foreground mb-2">{widget.title}</h4>}
      <pre className="bg-mantle border border-surface0 rounded-md p-3 text-[11px] font-mono text-foreground overflow-auto max-h-60">
        {lines.join("\n")}
      </pre>
    </div>
  );
}

function MarkdownWidget({ widget }: { widget: Extract<PanelWidget, { type: "markdown" }> }) {
  return (
    <ContentRenderer value={widget.content} format="markdown" />
  );
}

function TableWidget({ widget }: { widget: Extract<PanelWidget, { type: "table" }> }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(widget.dataEndpoint)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ rows: Record<string, unknown>[] }>; })
      .then((d) => setRows(d.rows ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [widget.dataEndpoint]);

  if (error) return <div className="text-[11px] text-red">{error}</div>;

  return (
    <div className="overflow-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr>
            {widget.columns.map((c) => (
              <th key={c.key} className="text-left text-[11px] font-semibold text-muted-foreground p-2 border-b border-border" style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {widget.columns.map((c) => (
                <td key={c.key} className="p-2 border-b border-border text-foreground">
                  {String(row[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricWidget({ widget }: { widget: Extract<PanelWidget, { type: "metric" }> }) {
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    fetch(widget.valueEndpoint)
      .then((r) => r.json() as Promise<{ value: unknown }>)
      .then((d) => setValue(String(d.value ?? "—")))
      .catch(() => setValue("—"));
  }, [widget.valueEndpoint]);

  return (
    <div className="p-3 rounded-lg bg-surface0 border border-border text-center">
      <div className="text-[10px] text-muted-foreground">{widget.label}</div>
      <div className="text-xl font-bold text-foreground">
        {value ?? "..."}
        {widget.unit && <span className="text-[11px] font-normal text-muted-foreground ml-1">{widget.unit}</span>}
      </div>
    </div>
  );
}

function IframeWidget({ widget, projectPath }: { widget: Extract<PanelWidget, { type: "iframe" }>; projectPath?: string }) {
  // Support {projectPath} template in src URL
  const src = projectPath ? widget.src.replace(/\{projectPath\}/g, encodeURIComponent(projectPath)) : widget.src;
  return (
    <div>
      {widget.title && <h4 className="text-[12px] font-semibold text-foreground mb-2">{widget.title}</h4>}
      <iframe
        src={src}
        title={widget.title ?? "Plugin content"}
        className="w-full border border-border rounded-md"
        style={{ height: widget.height ?? "500px" }}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// New widget sub-renderers (chart, timeline, kanban, editor, diagram)
// ---------------------------------------------------------------------------

function ChartWidget({ widget }: { widget: Extract<PanelWidget, { type: "chart" }> }) {
  const [data, setData] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(widget.dataEndpoint)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ data: unknown[] }>; })
      .then((d) => setData(d.data ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [widget.dataEndpoint]);

  if (error) return <div className="text-[11px] text-red">{error}</div>;

  const ChartComponent = {
    bar: Chart.Bar,
    line: Chart.Line,
    area: Chart.Area,
    pie: Chart.Pie,
    donut: Chart.Donut,
    sparkline: Chart.Sparkline,
  }[widget.chartType];

  return (
    <div>
      {widget.title && <h4 className="text-[12px] font-semibold text-foreground mb-2">{widget.title}</h4>}
      <div style={{ height: widget.height ?? 300 }}>
        {ChartComponent && <ChartComponent data={data} />}
      </div>
    </div>
  );
}

function TimelineWidget({ widget }: { widget: Extract<PanelWidget, { type: "timeline" }> }) {
  const [items, setItems] = useState<Array<{ id: string; title: string; date: string; description?: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(widget.dataEndpoint)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ items: typeof items }>; })
      .then((d) => setItems(d.items ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [widget.dataEndpoint]);

  if (error) return <div className="text-[11px] text-red">{error}</div>;

  return (
    <div>
      {widget.title && <h4 className="text-[12px] font-semibold text-foreground mb-2">{widget.title}</h4>}
      <Timeline>
        {items.map((item) => (
          <Timeline.Item key={item.id} title={item.title} date={item.date}>
            {item.description}
          </Timeline.Item>
        ))}
      </Timeline>
    </div>
  );
}

function KanbanWidget({ widget }: { widget: Extract<PanelWidget, { type: "kanban" }> }) {
  const [cards, setCards] = useState<Array<{ id: string; column: string; title: string; description?: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(widget.dataEndpoint)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ cards: typeof cards }>; })
      .then((d) => setCards(d.cards ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [widget.dataEndpoint]);

  if (error) return <div className="text-[11px] text-red">{error}</div>;

  return (
    <div>
      {widget.title && <h4 className="text-[12px] font-semibold text-foreground mb-2">{widget.title}</h4>}
      <Kanban>
        {widget.columns.map((col) => (
          <Kanban.Column key={col.id} title={col.title}>
            {cards
              .filter((c) => c.column === col.id)
              .map((card) => (
                <Kanban.Card key={card.id} title={card.title}>
                  {card.description}
                </Kanban.Card>
              ))}
          </Kanban.Column>
        ))}
      </Kanban>
    </div>
  );
}

function EditorWidget({ widget }: { widget: Extract<PanelWidget, { type: "editor" }> }) {
  return (
    <div>
      {widget.title && <h4 className="text-[12px] font-semibold text-foreground mb-2">{widget.title}</h4>}
      <Editor defaultValue={widget.defaultValue} outputFormat={widget.outputFormat ?? "markdown"}>
        <Editor.Toolbar />
        <Editor.Content />
      </Editor>
    </div>
  );
}

function CodeEditorWidget({ widget }: { widget: Extract<PanelWidget, { type: "code-editor" }> }) {
  const [value, setValue] = useState(widget.defaultValue ?? "");
  return (
    <div className="h-full flex flex-col">
      <CodeEditor
        value={value}
        onChange={setValue}
        language={widget.language ?? "javascript"}
        readOnly={widget.readOnly ?? false}
        theme="auto"
        className="flex-1 flex flex-col h-full"
      >
        <CodeEditor.Toolbar />
        <CodeEditor.Panel />
        <CodeEditor.StatusBar />
      </CodeEditor>
    </div>
  );
}

/** Convert FileNode[] to the shape expected by TreeNav. */
function toTreeNavNodes(nodes: FileNode[]): Array<Record<string, unknown>> {
  return nodes.map((n) => ({
    id: n.path,
    label: n.name,
    type: n.type === "dir" ? "folder" : "file",
    ext: n.ext,
    children: n.children ? toTreeNavNodes(n.children) : undefined,
  }));
}

function TreeNavWidget({ projectPath }: { widget: Extract<PanelWidget, { type: "tree-nav" }>; projectPath?: string }) {
  const [nodes, setNodes] = useState<Array<Record<string, unknown>>>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) return;
    fetchProjectFileTree(projectPath, false)
      .then((tree) => setNodes(toTreeNavNodes(tree)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [projectPath]);

  if (error) return <div className="text-red text-xs">{error}</div>;
  if (nodes.length === 0) return <div className="text-muted-foreground text-xs py-4 text-center">Loading file tree...</div>;

  return (
    <div className="border-r border-border overflow-auto h-full">
      <TreeNav
        nodes={nodes as never}
        selectedId={selectedId}
        onSelect={(id: string) => setSelectedId(id)}
        defaultExpandAll
        className="text-xs"
      />
    </div>
  );
}

// Legacy DiagramSchema shape — emitted by plugins against the pre-3.x
// react-fancy `Diagram` component (entities + relations). The component
// was removed in react-fancy 3.x; fancy-flow's FlowCanvas is the new
// canonical surface. This adapter transforms the legacy shape so existing
// plugin endpoints keep working without per-plugin migrations.
//
// FOLLOW-UP: filing an upstream issue/PR against fancy-flow to expose
// `legacySchemaToFlowGraph` (or an `ErdCanvas` preset) so every consumer
// doesn't reinvent this adapter. Mark with 🎨 UI when filed.
type LegacyDiagramSchema = {
  entities?: Array<{
    id: string;
    name: string;
    fields?: Array<{ name: string; type?: string }>;
    x?: number;
    y?: number;
  }>;
  relations?: Array<{ from: string; to: string; type?: string; label?: string }>;
};

function legacySchemaToFlowGraph(raw: unknown): { nodes: FlowNode[]; edges: FlowEdge[] } {
  if (raw === null || typeof raw !== "object") return { nodes: [], edges: [] };
  const s = raw as LegacyDiagramSchema;
  const nodes: FlowNode[] = (s.entities ?? []).map((e, i) => ({
    id: e.id,
    type: "note",
    position: { x: e.x ?? i * 240, y: e.y ?? Math.floor(i / 3) * 180 },
    data: {
      label: e.name,
      description: (e.fields ?? [])
        .map((f) => (f.type !== undefined ? `${f.name}: ${f.type}` : f.name))
        .join("\n") || undefined,
    },
  }));
  const edges: FlowEdge[] = (s.relations ?? []).map((r, i) => ({
    id: `e${i}-${r.from}-${r.to}`,
    source: r.from,
    target: r.to,
    label: r.label,
  }));
  return { nodes, edges };
}

function DiagramWidget({ widget }: { widget: Extract<PanelWidget, { type: "diagram" }> }) {
  const [schema, setSchema] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(widget.dataEndpoint)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<unknown>; })
      .then(setSchema)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [widget.dataEndpoint]);

  if (error) return <div className="text-[11px] text-red">{error}</div>;
  if (!schema) return <div className="text-[11px] text-muted-foreground">Loading diagram...</div>;

  const { nodes, edges } = legacySchemaToFlowGraph(schema);

  return (
    <div>
      {widget.title && <h4 className="text-[12px] font-semibold text-foreground mb-2">{widget.title}</h4>}
      <FlowCanvas nodes={nodes} edges={edges} height={400} showControls showMinimap />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export interface WidgetRendererProps {
  widgets: PanelWidget[];
  actions?: PluginAction[];
  projectPath?: string;
}

/** Render a single widget — extracted for recursive use by layout widgets. */
function renderWidget(widget: PanelWidget, i: number, actions: PluginAction[], projectPath?: string): React.ReactNode {
  switch (widget.type) {
    case "field-group":
      return <FieldGroupWidget key={i} widget={widget} />;
    case "action-bar":
      return <ActionBarWidget key={i} widget={widget} actions={actions} projectPath={projectPath} />;
    case "status-display":
      return <StatusDisplayWidget key={i} widget={widget} projectPath={projectPath} />;
    case "log-stream":
      return <LogStreamWidget key={i} widget={widget} />;
    case "markdown":
      return <MarkdownWidget key={i} widget={widget} />;
    case "table":
      return <TableWidget key={i} widget={widget} />;
    case "metric":
      return <MetricWidget key={i} widget={widget} />;
    case "iframe":
      return <IframeWidget key={i} widget={widget} projectPath={projectPath} />;
    case "chart":
      return <ChartWidget key={i} widget={widget} />;
    case "timeline":
      return <TimelineWidget key={i} widget={widget} />;
    case "kanban":
      return <KanbanWidget key={i} widget={widget} />;
    case "editor":
      return <EditorWidget key={i} widget={widget} />;
    case "diagram":
      return <DiagramWidget key={i} widget={widget} />;
    case "code-editor":
      return <CodeEditorWidget key={i} widget={widget} />;
    case "tree-nav":
      return <TreeNavWidget key={i} widget={widget} projectPath={projectPath} />;
    case "layout":
      return <LayoutWidget key={i} widget={widget} actions={actions} projectPath={projectPath} />;
    default:
      return null;
  }
}

/**
 * Layout widget — arranges child widgets in horizontal, vertical, or grid layouts.
 *
 * Props (from JSON):
 * - direction: "horizontal" | "vertical" | "grid"
 * - sizes: CSS grid template values per child (e.g. ["260px", "1fr"])
 * - gap: CSS gap value (default "0")
 * - height: CSS height for the container
 * - children: nested PanelWidget[]
 */
function LayoutWidget({ widget, actions, projectPath }: {
  widget: Extract<PanelWidget, { type: "layout" }>;
  actions: PluginAction[];
  projectPath?: string;
}) {
  const { direction, sizes, gap, height, children } = widget;

  const style: React.CSSProperties = {
    display: direction === "grid" ? "grid" : "flex",
    flexDirection: direction === "vertical" ? "column" : "row",
    gap: gap ?? "0",
    height: height ?? "100%",
    minHeight: 0,
  };

  if (direction === "horizontal" && sizes?.length) {
    style.display = "grid";
    style.gridTemplateColumns = sizes.join(" ");
    style.gridTemplateRows = "1fr"; // children fill full height
  } else if (direction === "grid" && sizes?.length) {
    style.gridTemplateColumns = sizes.join(" ");
  }

  return (
    <div style={style} className="flex-1 overflow-hidden">
      {children.map((child, i) => (
        <div key={i} className="overflow-auto min-w-0 min-h-0 h-full">
          {renderWidget(child, i, actions, projectPath)}
        </div>
      ))}
    </div>
  );
}

export function WidgetRenderer({ widgets, actions = [], projectPath }: WidgetRendererProps) {
  return (
    <div className="space-y-4 flex-1 flex flex-col min-h-0">
      {widgets.map((widget, i) => renderWidget(widget, i, actions, projectPath))}
    </div>
  );
}
