# UI Components

Available UI components for MApps and plugins. All come from `@particle-academy/react-fancy` and `@particle-academy/react-echarts`.

## ContentRenderer

The primary component for rendering markdown and HTML content. Use this instead of raw ReactMarkdown.

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

### Custom Extensions

Register custom tags that render as React components:

```tsx
const extensions = [{
  tag: "questions",
  component: ({ innerHTML }) => <QuestionForm json={innerHTML} />,
  block: true,
}];

<ContentRenderer value={content} extensions={extensions} />
```

## MApp Widget Types

These widget types are available in MApp `panel.widgets` arrays:

| Widget Type | Renders With | Key Props |
|-------------|-------------|-----------|
| `markdown` | ContentRenderer | `content` |
| `iframe` | Native iframe | `src`, `height` |
| `status-display` | Fetch → Card grid | `statusEndpoint`, `title` |
| `field-group` | Field + Input | `fields` |
| `action-bar` | Action buttons | `actionIds` |
| `table` | Table | `dataEndpoint`, `columns` |
| `metric` | Card + fetch | `label`, `valueEndpoint`, `unit` |
| `chart` | EChart | `chartType`, `dataEndpoint` |
| `log-stream` | Fetch + pre | `logSource`, `lines` |
| `timeline` | Timeline | `dataEndpoint` |
| `kanban` | Kanban | `dataEndpoint`, `columns` |
| `editor` | Editor | `title`, `defaultValue` |
| `diagram` | Diagram | `dataEndpoint`, `diagramType` |

## Component Categories

### Layout
`Card`, `Separator`, `Tabs`, `Accordion`, `Sidebar`, `Modal`, `Portal`

### Content
`ContentRenderer`, `Heading`, `Text`, `Callout`, `Badge`, `Icon`, `Emoji`, `EmojiSelect`, `Profile`, `Brand`

### Forms
`Input`, `Textarea`, `Select`, `MultiSwitch`, `Checkbox`, `CheckboxGroup`, `RadioGroup`, `Switch`, `Slider`, `ColorPicker`, `DatePicker`, `TimePicker`, `EmojiSelect`, `Field`, `FileUpload`, `OtpInput`, `Autocomplete`

### Data
`Table`, `Chart`, `Diagram`, `Timeline`, `Kanban`, `Progress`, `Skeleton`

### Navigation
`Navbar`, `MobileMenu`, `Breadcrumbs`, `Pagination`, `Menu`, `ContextMenu`

### Overlay
`Modal`, `Popover`, `Dropdown`, `Tooltip`, `Toast`, `Command`

### Media
`Avatar`, `Carousel`, `Canvas`, `Composer`, `Editor`

### Charts (ECharts)
`EChart`, `EChart3D`, `BarChart`, `LineChart`, `PieChart`, `RadarChart`, `ScatterChart`, `HeatmapChart`, `TreemapChart`, `SunburstChart`, `GaugeChart`, `FunnelChart`, `SankeyChart`, `GraphChart`, `BoxplotChart`, `CandlestickChart`, `MapChart`

## Usage in MApps

MApps define widgets declaratively in JSON:

```json
{
  "panel": {
    "label": "My App",
    "widgets": [
      { "type": "markdown", "content": "## Welcome\n\nThis is rendered with ContentRenderer." },
      { "type": "chart", "chartType": "bar", "dataEndpoint": "/api/data" }
    ]
  }
}
```

## Usage in Plugins

Plugins import components directly:

```tsx
import { ContentRenderer, Card, Table } from "@particle-academy/react-fancy";
import { EChart } from "@particle-academy/react-echarts";

api.registerProjectPanel({
  id: "my-panel",
  label: "Analytics",
  projectTypes: ["web-app"],
  widgets: [
    { type: "markdown", content: "## Analytics Dashboard" },
    { type: "chart", chartType: "line", dataEndpoint: "/api/plugins/my-plugin/metrics" },
  ],
});
```

## Import Paths

```tsx
// UI components
import { ContentRenderer, Card, Table, ... } from "@particle-academy/react-fancy";
import "@particle-academy/react-fancy/styles.css";

// Charts
import { EChart, BarChart, LineChart, ... } from "@particle-academy/react-echarts";

// SDK catalog (for programmatic discovery)
import { UI_COMPONENTS, WIDGET_COMPONENT_MAP } from "@aionima/sdk";
```
