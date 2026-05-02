import { useCallback, useEffect, useMemo, useState } from "react";
import type { DesktopMessage, DesktopWindow, MAppEntry } from "./types.js";
import { CategoryGrid } from "./components/CategoryGrid.js";
import { Window } from "./components/Window.js";
import { Taskbar } from "./components/Taskbar.js";

/**
 * MApp Desktop App — root.
 *
 * Phase 1 (s140 t599): owner-confirmed Option C. Single shared React
 * runtime that lists installed MApps in an Android-style category
 * icon grid, opens each as a draggable Window with focus/z-index
 * behavior, and shows a Taskbar at the bottom listing all open
 * windows. Multi-app desktop UX.
 *
 * Mock data shipping in phase 1; phase 2 fetches from the gateway
 * (project-scoped catalog by hostname). Phase 3 wires the
 * <projectPath>/k/mapps + <projectPath>/sandbox/mapps storage paths.
 */

/**
 * Mock catalog — phase 2.5 will replace with `/api/mapp-marketplace/catalog`
 * fetch (project-scoped + including panel URL from each manifest).
 *
 * Phase 2: panelUrl points at `<sandbox>/mapps/<id>/index.html` per
 * the cycle-176 owner-clarified storage layout. When a MApp's bundle
 * lives at `<projectPath>/sandbox/mapps/<id>/index.html`, the iframe
 * loads it from the cycle-176 sandbox auto-route. When absent, the
 * iframe still renders (with a 404 inside it) — so phase-2 dogfooding
 * doesn't require shipping any actual MApp content.
 */
const MOCK_MAPPS: MAppEntry[] = [
  { id: "admin-editor", name: "Admin Editor", description: "Document editor for administration projects.", icon: "📝", category: "production", panelUrl: "/sandbox/mapps/admin-editor/index.html" },
  { id: "code-browser", name: "Code Browser", description: "Source code viewer with syntax highlighting.", icon: "📂", category: "viewer", panelUrl: "/sandbox/mapps/code-browser/index.html" },
  { id: "dashboard-viewer", name: "Dashboard Viewer", description: "Status panels + log streams.", icon: "📊", category: "viewer", panelUrl: "/sandbox/mapps/dashboard-viewer/index.html" },
  { id: "code-ide", name: "Code IDE", description: "File tree + code editor + build tools.", icon: "🛠️", category: "production", panelUrl: "/sandbox/mapps/code-ide/index.html" },
  { id: "media-gallery", name: "Media Gallery", description: "Lightbox viewer for art projects.", icon: "🖼️", category: "viewer", panelUrl: "/sandbox/mapps/media-gallery/index.html" },
  { id: "media-workspace", name: "Media Workspace", description: "Batch image / video processing.", icon: "🎬", category: "production", panelUrl: "/sandbox/mapps/media-workspace/index.html" },
  { id: "story-mapper", name: "Story Mapper", description: "Visual mind-mapping for writers.", icon: "📖", category: "production", panelUrl: "/sandbox/mapps/story-mapper/index.html" },
  { id: "ops-monitor", name: "Ops Monitor", description: "Operations health check tool.", icon: "🔧", category: "tool", panelUrl: "/sandbox/mapps/ops-monitor/index.html" },
  { id: "code-analyzer", name: "Code Analyzer", description: "Dependency audit + complexity metrics.", icon: "🧪", category: "tool", panelUrl: "/sandbox/mapps/code-analyzer/index.html" },
  { id: "ereader", name: "E-reader", description: "Book-style layout for literature projects.", icon: "📚", category: "viewer", panelUrl: "/sandbox/mapps/ereader/index.html" },
  { id: "runbook-editor", name: "Runbook Editor", description: "Step-by-step procedures + playbooks.", icon: "📋", category: "production", panelUrl: "/sandbox/mapps/runbook-editor/index.html" },
];

export function App(): React.ReactElement {
  const [windows, setWindows] = useState<DesktopWindow[]>([]);
  const [topZ, setTopZ] = useState(10);

  // s140 t599 phase 2 — panelUrl lookup. Derived at render time so a
  // future catalog refresh updates open windows without re-keying.
  const panelUrlByMappId = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of MOCK_MAPPS) {
      if (e.panelUrl) m.set(e.id, e.panelUrl);
    }
    return m;
  }, []);

  // s140 t599 phase 2 — postMessage IPC primitive. Iframe MApps send
  // { protocol, mappId, type, payload } envelopes. Runtime echoes a
  // pong for ping (sanity probe) and ignores anything that doesn't
  // match the protocol field. Future phases route storage / chat
  // requests via the same channel.
  useEffect(() => {
    function onMessage(e: MessageEvent): void {
      const data = e.data as Partial<DesktopMessage> | null;
      if (!data || data.protocol !== "mapp-desktop/1") return;
      if (data.type === "ping" && e.source && "postMessage" in e.source) {
        const reply: DesktopMessage = {
          protocol: "mapp-desktop/1",
          mappId: data.mappId ?? "(unknown)",
          type: "pong",
          payload: { now: new Date().toISOString() },
        };
        // Reply to the specific iframe that sent the ping. Origin "*"
        // is acceptable here because the runtime intentionally
        // doesn't restrict which origin the iframe loaded from
        // (sandbox + CSP do that work).
        (e.source as Window).postMessage(reply, "*");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const openMApp = useCallback((mapp: MAppEntry) => {
    setTopZ((z) => z + 1);
    setWindows((ws) => {
      const id = `${mapp.id}-${String(ws.length)}`;
      const offset = ws.length * 32;
      return [
        ...ws,
        {
          id,
          mappId: mapp.id,
          title: mapp.name,
          icon: mapp.icon,
          x: 80 + offset,
          y: 80 + offset,
          w: 720,
          h: 480,
          z: topZ + 1,
          minimized: false,
        },
      ];
    });
  }, [topZ]);

  const closeWindow = useCallback((id: string) => {
    setWindows((ws) => ws.filter((w) => w.id !== id));
  }, []);

  const focusWindow = useCallback((id: string) => {
    setTopZ((z) => z + 1);
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, z: topZ + 1, minimized: false } : w)));
  }, [topZ]);

  const moveWindow = useCallback((id: string, x: number, y: number) => {
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, x, y } : w)));
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, minimized: true } : w)));
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-bg" data-testid="mapp-desktop">
      {/* Header */}
      <header className="px-8 py-4 border-b border-border">
        <h1 className="text-base font-semibold">MApp Desktop</h1>
        <p className="text-xs text-muted">Click an app to open it. Multiple apps can be open at once — drag the title bar to reposition.</p>
      </header>

      {/* Category icon grid */}
      <div className="absolute inset-x-0 top-[80px] bottom-[48px] overflow-y-auto px-8 py-6">
        <CategoryGrid mapps={MOCK_MAPPS} onOpen={openMApp} />
      </div>

      {/* Windows layer */}
      {windows.map((w) => (
        !w.minimized ? (
          <Window
            key={w.id}
            window={w}
            panelUrl={panelUrlByMappId.get(w.mappId)}
            onFocus={() => focusWindow(w.id)}
            onMove={(x, y) => moveWindow(w.id, x, y)}
            onClose={() => closeWindow(w.id)}
            onMinimize={() => minimizeWindow(w.id)}
          />
        ) : null
      ))}

      {/* Taskbar */}
      <Taskbar windows={windows} onFocus={focusWindow} onClose={closeWindow} />
    </div>
  );
}
