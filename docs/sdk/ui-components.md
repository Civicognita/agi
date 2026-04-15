# UI Components

Three packages provide UI components for MApps, plugins, and the dashboard:

- **`@particle-academy/react-fancy`** (v1.9.1) — Core component library
- **`@particle-academy/fancy-code`** (v0.4.2) — Code editor with syntax highlighting
- **`@particle-academy/fancy-sheets`** (v0.4.5) — Spreadsheet / data grid
- **`@particle-academy/react-echarts`** (v1.0.0) — Chart components (ECharts wrapper)

---

## ContentRenderer

The primary component for rendering markdown and HTML content.

```tsx
import { ContentRenderer } from "@particle-academy/react-fancy";

<ContentRenderer value="## Hello\n\n**Bold** text." format="markdown" />
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | required | Content to render |
| `format` | `"markdown" \| "html" \| "auto"` | `"auto"` | Format detection |
| `lineSpacing` | `number` | — | Line height multiplier |
| `className` | `string` | — | CSS class |
| `extensions` | `RenderExtension[]` | — | Custom tag renderers |

---

## CodeEditor

Full-featured code editor with syntax highlighting, toolbar, and status bar.

```tsx
import { CodeEditor } from "@particle-academy/fancy-code";

<CodeEditor
  value={code}
  onChange={setCode}
  language="typescript"
  theme="auto"
  className="h-full"
>
  <CodeEditor.Toolbar />
  <CodeEditor.Panel />
  <CodeEditor.StatusBar />
</CodeEditor>
```

Supported languages: `typescript`, `javascript`, `html`, `css`, `json`, `markdown`, `yaml`, `php`, `python`, `go`, `rust`, `sql`, `shell`, `toml`, `plaintext`.

---

## Spreadsheet

Data grid component for tabular data editing and display.

```tsx
import { Spreadsheet } from "@particle-academy/fancy-sheets";

<Spreadsheet
  data={rows}
  columns={columns}
  onChange={setRows}
/>
```

---

## TreeNav

Hierarchical file/folder tree with expand/collapse, selection, context menus, and extension-based icons.

```tsx
import { TreeNav } from "@particle-academy/react-fancy";

<TreeNav
  nodes={treeData}
  selectedId={selected}
  onSelect={(id, node) => { /* handle selection */ }}
  onNodeContextMenu={(e, node) => { /* right-click menu */ }}
  showIcons
  indentSize={14}
  defaultExpandAll
/>
```

---

## ContextMenu

Right-click context menu with items and separators.

```tsx
import { ContextMenu } from "@particle-academy/react-fancy";

<ContextMenu>
  <ContextMenu.Trigger>
    <div>Right-click me</div>
  </ContextMenu.Trigger>
  <ContextMenu.Content>
    <ContextMenu.Item onClick={handleNew}>New File</ContextMenu.Item>
    <ContextMenu.Separator />
    <ContextMenu.Item danger onClick={handleDelete}>Delete</ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu>
```

---

## Toast

Notification toasts with variants.

```tsx
import { useToast } from "@particle-academy/react-fancy";

const { toast } = useToast();
toast({ title: "Saved", description: "Changes saved successfully.", variant: "success" });
```

Variants: `"success"`, `"error"`, `"info"`, `"warning"`.

---

## Component Categories

### Layout
`Card`, `Separator`, `Tabs`, `Accordion`, `Sidebar`, `Modal`, `Portal`, `Pillbox`

### Content
`ContentRenderer`, `Heading`, `Text`, `Callout`, `Badge`, `Icon`, `Emoji`, `EmojiSelect`, `Profile`, `Brand`, `Avatar`, `Skeleton`

### Forms
`Input`, `Textarea`, `Select`, `Autocomplete`, `MultiSwitch`, `Checkbox`, `CheckboxGroup`, `RadioGroup`, `Switch`, `Slider`, `ColorPicker`, `DatePicker`, `TimePicker`, `OtpInput`, `Field`, `FileUpload`

### Data
`Table`, `Diagram`, `Timeline`, `Kanban`, `Progress`, `Calendar`, `Canvas`

### Navigation
`TreeNav`, `Navbar`, `MobileMenu`, `Breadcrumbs`, `Pagination`, `Menu`, `Sidebar`

### Overlay
`Modal`, `Popover`, `Dropdown`, `Tooltip`, `Toast`, `Command`, `ContextMenu`

### Media
`Carousel`, `Canvas`, `Composer`, `Editor`

### Code & Data
`CodeEditor` (fancy-code), `Spreadsheet` (fancy-sheets)

### Charts (ECharts)
`Chart.Line`, `Chart.Bar`, `Chart.Area`, `Chart.Pie`, `Chart.Donut`, `Chart.Sparkline`, `Chart.StackedBar`, `Chart.HorizontalBar`

---

## MApp Widget Types

These widget types are available in MApp `panel.widgets` arrays:

| Widget Type | Key Props |
|-------------|-----------|
| `markdown` | `content` |
| `iframe` | `src`, `height` |
| `status-display` | `statusEndpoint`, `title` |
| `field-group` | `fields` |
| `action-bar` | `actionIds` |
| `table` | `dataEndpoint`, `columns` |
| `metric` | `label`, `valueEndpoint`, `unit` |
| `chart` | `chartType`, `dataEndpoint` |
| `log-stream` | `logSource`, `lines` |
| `timeline` | `dataEndpoint` |
| `kanban` | `dataEndpoint`, `columns` |
| `editor` | `title`, `defaultValue` |
| `diagram` | `dataEndpoint`, `diagramType` |

---

## Import Paths

```tsx
// Core UI components
import { ContentRenderer, Card, Table, TreeNav, ContextMenu, ... } from "@particle-academy/react-fancy";
import "@particle-academy/react-fancy/styles.css";

// Code editor
import { CodeEditor } from "@particle-academy/fancy-code";

// Spreadsheet
import { Spreadsheet } from "@particle-academy/fancy-sheets";

// Charts
import { Chart } from "@particle-academy/react-echarts";
```
