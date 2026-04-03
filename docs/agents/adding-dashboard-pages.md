# Adding Dashboard Pages: Routes, Sidebar, Components

This guide covers everything needed to add a new page to the Aionima dashboard — a React 19 + Vite 6 + Tailwind CSS 4 + TanStack Query (React Query) SPA.

## Architecture Overview

The dashboard uses React Router v7 with a nested layout. All pages share the `RootLayout` at `ui/dashboard/src/routes/root.tsx`, which renders `AppSidebar` and an `<Outlet />` for page content.

```
ui/dashboard/src/
  routes/
    root.tsx              # RootLayout — AppSidebar + Outlet
    overview.tsx          # Example: Overview page
    docs.tsx              # Example: Two-column docs viewer
    comms-telegram.tsx    # Example: Thin wrapper around ChannelPage
  components/
    AppSidebar.tsx        # Sidebar navigation
    ChannelPage.tsx       # Reusable per-channel page
    FileTree.tsx          # Reusable file tree
    ui/                   # shadcn/ui components (Button, Badge, etc.)
  lib/
    markdown.tsx          # Shared markdown renderer components
    utils.ts              # cn() Tailwind class merger
  api.ts                  # HTTP fetch wrappers
  types.ts                # Shared TypeScript types
  router.tsx              # createBrowserRouter config
```

## Step 1: Create a Route File

Create a new file in `ui/dashboard/src/routes/`. The file exports a default React component.

### Minimal page

```tsx
// ui/dashboard/src/routes/my-page.tsx
export default function MyPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">My Page</h1>
      <p className="text-muted-foreground">Content here.</p>
    </div>
  );
}
```

### Page with data fetching (TanStack Query pattern)

```tsx
// ui/dashboard/src/routes/my-page.tsx
import { useQuery } from "@tanstack/react-query";
import { fetchMyData } from "@/api.js";

export default function MyPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["my-data"],
    queryFn: () => fetchMyData(),
    refetchInterval: 30_000,  // poll every 30 seconds
  });

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">Loading...</div>;
  }

  if (error) {
    return (
      <div className="text-red text-sm">
        {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-card border border-border p-4">
        {/* Render data */}
      </div>
    </div>
  );
}
```

### Page with local state + manual fetch (non-TanStack pattern)

Some existing pages (like `docs.tsx`) use `useState` + `useEffect` directly. Use this when you need finer control over loading state:

```tsx
import { useEffect, useState } from "react";
import { fetchMyData } from "@/api.js";

export default function MyPage() {
  const [data, setData] = useState<MyType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMyData()
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ... render
}
```

## Step 2: Add to router.tsx

Import your page component and add a route object:

```tsx
// ui/dashboard/src/router.tsx
import MyPage from "./routes/my-page.js";

// Inside createBrowserRouter children array:
{ path: "my-section/my-page", element: <MyPage /> },
```

The router file is at `ui/dashboard/src/router.tsx`. Add your route in the appropriate position — group related routes together (Gateway, System, Comms, etc.).

### Nested routes

If your feature has multiple sub-pages:

```tsx
{ path: "my-section", element: <MySectionIndexPage /> },
{ path: "my-section/detail", element: <MySectionDetailPage /> },
{ path: "my-section/settings", element: <MySectionSettingsPage /> },
```

React Router v7 does not require an explicit index — just list all paths flat under the root layout's `children`.

## Step 3: Add to AppSidebar.tsx

`ui/dashboard/src/components/AppSidebar.tsx` defines the `sections` array at the top of the file. Each section has a `title` and `items` array.

### Adding to an existing section

```tsx
// ui/dashboard/src/components/AppSidebar.tsx
const sections: NavSection[] = [
  // ...existing sections...
  {
    title: "My Section",
    items: [
      { to: "/my-section", label: "Overview", exact: true },
      { to: "/my-section/detail", label: "Detail" },
    ],
  },
];
```

### Adding to the Gateway section (for gateway-related features)

```tsx
{
  title: "Gateway",
  items: [
    { to: "/gateway/plugins", label: "Plugins" },
    { to: "/gateway/workflows", label: "Workflows" },
    { to: "/gateway/logs", label: "Logs" },
    { to: "/gateway/settings", label: "Settings" },
    { to: "/gateway/my-feature", label: "My Feature" },  // add here
  ],
},
```

### NavItem structure

```ts
interface NavItem {
  to: string;     // Route path (must match router.tsx)
  label: string;  // Display text in sidebar
  exact?: boolean; // Use exact matching for active state (default: prefix match)
}
```

Use `exact: true` for index/overview routes where prefix matching would always be active (e.g., `"/"` or `"/comms"`).

## Step 4: Component Patterns

### Layout conventions

Most pages use `<div className="space-y-6">` as the root container. The `RootLayout` provides `p-6` padding and a scrollable main area.

For full-bleed pages (like `docs.tsx` which needs `height: calc(100vh - 57px)`), use `margin: "-24px"` to cancel the parent padding:

```tsx
// Full-bleed two-column layout
<div style={{ display: "flex", margin: "-24px", height: "calc(100vh - 57px)", overflow: "hidden" }}>
  {/* Left sidebar */}
  <div style={{ width: 256, borderRight: "1px solid var(--color-border)", background: "var(--color-card)" }}>
    {/* ... */}
  </div>
  {/* Main content */}
  <div style={{ flex: 1, overflow: "auto" }}>
    {/* ... */}
  </div>
</div>
```

### Card pattern

```tsx
<div className="rounded-xl bg-card border border-border p-4">
  <div className="flex items-center justify-between mb-2">
    <h2 className="text-sm font-semibold text-foreground">Section Title</h2>
    <span className="text-xs text-muted-foreground">metadata</span>
  </div>
  {/* content */}
</div>
```

### Using shared components

```tsx
// FileTree — shows a recursive tree of FileNode items
import { FileTree } from "@/components/FileTree.js";
// Props: nodes, selectedPath, onSelect

// ChannelPage — full channel status + log page
import { ChannelPage } from "@/components/ChannelPage.js";
// Props: channelId, channelName

// Markdown rendering
import { markdownComponents } from "@/lib/markdown.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
const mdComponents = useMemo(() => markdownComponents({ prose: true }), []);
<ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{markdownText}</ReactMarkdown>

// shadcn/ui primitives
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
```

### Class merging

Use `cn()` from `@/lib/utils` (re-exported from `clsx` + `tailwind-merge`):

```tsx
import { cn } from "@/lib/utils";
<div className={cn("base-class", condition && "conditional-class", "another")} />
```

## Step 5: Catppuccin Theme Variables

The dashboard uses Catppuccin Mocha (dark) / Latte (light). CSS custom properties:

| Variable | Usage |
|----------|-------|
| `--color-background` | Page background |
| `--color-foreground` | Primary text |
| `--color-card` | Card / sidebar background |
| `--color-border` | Dividers, card borders |
| `--color-muted-foreground` | Secondary text, labels |
| `--color-primary` | Active nav item, buttons |
| `--color-primary-foreground` | Text on primary background |
| `--color-secondary` | Hover states, subtle backgrounds |
| `--color-mantle` | Code block background |
| `--color-surface0` | Code block border, table headers |
| `--color-blue` | Links, info |
| `--color-green` | Success, running status |
| `--color-red` | Errors |
| `--color-yellow` | Warnings |
| `--color-overlay0` | Disabled / muted badges |
| `--color-subtext0` | Dimmer secondary text |

Use these via Tailwind classes (e.g., `text-foreground`, `bg-card`, `border-border`) or via `var(--color-X)` in inline styles for cases Tailwind does not cover.

## Step 6: Adding an API Function

Add a fetch wrapper to `ui/dashboard/src/api.ts`:

```ts
// ui/dashboard/src/api.ts

export interface MyData {
  id: string;
  value: string;
}

export async function fetchMyData(): Promise<MyData[]> {
  const res = await fetch("/api/my-endpoint");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<MyData[]>;
}
```

If the API requires query parameters:

```ts
export async function fetchMyData(id: string, limit = 50): Promise<MyData> {
  const url = new URL("/api/my-endpoint", window.location.origin);
  url.searchParams.set("id", id);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<MyData>;
}
```

## Files to Modify

| File | Change |
|------|--------|
| `ui/dashboard/src/routes/<name>.tsx` | Create — page component |
| `ui/dashboard/src/router.tsx` | Add route entry |
| `ui/dashboard/src/components/AppSidebar.tsx` | Add sidebar section or item |
| `ui/dashboard/src/api.ts` | Add fetch wrapper functions if new API endpoints |
| `ui/dashboard/src/types.ts` | Add TypeScript types for API responses |

## Verification Checklist

- [ ] Route file exports a default React component
- [ ] Route added to `router.tsx` with correct path
- [ ] Sidebar item added with matching `to` path
- [ ] `pnpm build` — no compile errors
- [ ] `pnpm typecheck` — passes
- [ ] `pnpm dev:dashboard` — navigate to the page, renders without white-screen error
- [ ] Active state highlights correctly in sidebar (check with `exact` flag if needed)
- [ ] Loading and error states render gracefully
- [ ] Data fetching works (inspect Network tab, API returns 200)
- [ ] Page looks correct in both dark and light Catppuccin themes
