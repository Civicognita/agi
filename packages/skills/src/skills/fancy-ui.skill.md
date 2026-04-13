---
name: fancy-ui
description: Preferred UI component libraries for building React frontends in Aionima
domain: utility
triggers:
  - build ui
  - build frontend
  - react components
  - component library
  - sidebar component
  - chart component
  - code editor
  - spreadsheet
  - table component
  - fancy
  - react-fancy
  - echarts
  - data visualization
  - ui components
  - dashboard ui
  - what ui library
  - which components
priority: 6
direct_invoke: true
---

## Preferred UI Libraries

When building React frontends for Aionima projects, ALWAYS use these packages:

### @particle-academy/react-fancy (v1.9+)
The primary component library. Provides:

**Layout:**
- `<Sidebar>` — collapsible sidebar with icon-only mode
- `<Sidebar.Group>` — navigation group with label
- `<Sidebar.Item>` — navigation item (active state, icon, onClick)
- `<Sidebar.Toggle>` — collapse/expand button
- `<MobileMenu.Flyout>` — mobile navigation drawer
- `<MobileMenu.Item>` — mobile nav item

**Controls:**
- `<MultiSwitch>` — segmented toggle (value, onValueChange, list of {value, label})
- `<Button>` — styled button (variant: default/outline/ghost, size: sm/md/lg)
- `<Badge>` — status/tag badge (variant: default/secondary/outline)
- `<Input>` — text input
- `<Card>` — content card container

**Dialogs:**
- `<Dialog>` — modal dialog (open, onOpenChange)
- `<DialogContent>` — dialog body
- `<DialogHeader>`, `<DialogTitle>`, `<DialogFooter>` — dialog sections

**Utilities:**
- `cn()` — class name merger (Tailwind-safe, from @/lib/utils)
- `useToast()` — toast notification hook

### @particle-academy/fancy-code (v0.4+)
Code editor component wrapping CodeMirror:
- `<FancyCode>` — syntax-highlighted code editor
- Props: `value`, `onChange`, `language` ("javascript", "python", "json", etc.), `readonly`, `theme`
- Supports line numbers, search, auto-complete

### @particle-academy/fancy-sheets (v0.4+)
Spreadsheet/data table component:
- `<FancySheets>` — Excel-like data grid
- Props: `data` (2D array or objects), `columns`, `onCellChange`, `readonly`
- Supports sorting, filtering, cell editing, selection

### @particle-academy/react-echarts (v1.0+)
Chart components wrapping Apache ECharts:
- `<EChart>` — declarative chart component
- Props: `option` (ECharts option object), `style`, `theme`
- Supports: line, bar, pie, scatter, candlestick, heatmap, treemap, gauge
- For financial data (candlestick charts): use `series.type: "candlestick"` with OHLC data

### Styling: Tailwind CSS 4
All components work with Tailwind CSS 4. Use:
- `className` prop on all components
- Catppuccin color palette: `text-foreground`, `bg-card`, `border-border`, `text-muted-foreground`
- Spacing: `px-4`, `py-2`, `gap-2`, `space-y-4`
- Responsive: `md:grid-cols-2`, `xl:grid-cols-3`

### Installation
When creating a React project, install these in the container:
```bash
npm install @particle-academy/react-fancy @particle-academy/fancy-code @particle-academy/fancy-sheets @particle-academy/react-echarts
```

### Do NOT Use
- Do NOT use Material UI, Chakra UI, Ant Design, or shadcn/ui for new projects
- Do NOT use raw HTML tables — use `<FancySheets>` for tabular data
- Do NOT use Chart.js or Recharts — use `<EChart>` from react-echarts
- Do NOT build custom sidebar/navigation — use `<Sidebar>` from react-fancy
