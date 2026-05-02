import { useCallback, useState } from "react";
import type { DesktopWindow, MAppEntry } from "./types.js";
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

// Mock catalog — phase 2 fetches from /api/mapp-marketplace/catalog
const MOCK_MAPPS: MAppEntry[] = [
  { id: "admin-editor", name: "Admin Editor", description: "Document editor for administration projects.", icon: "📝", category: "production" },
  { id: "code-browser", name: "Code Browser", description: "Source code viewer with syntax highlighting.", icon: "📂", category: "viewer" },
  { id: "dashboard-viewer", name: "Dashboard Viewer", description: "Status panels + log streams.", icon: "📊", category: "viewer" },
  { id: "code-ide", name: "Code IDE", description: "File tree + code editor + build tools.", icon: "🛠️", category: "production" },
  { id: "media-gallery", name: "Media Gallery", description: "Lightbox viewer for art projects.", icon: "🖼️", category: "viewer" },
  { id: "media-workspace", name: "Media Workspace", description: "Batch image / video processing.", icon: "🎬", category: "production" },
  { id: "story-mapper", name: "Story Mapper", description: "Visual mind-mapping for writers.", icon: "📖", category: "production" },
  { id: "ops-monitor", name: "Ops Monitor", description: "Operations health check tool.", icon: "🔧", category: "tool" },
  { id: "code-analyzer", name: "Code Analyzer", description: "Dependency audit + complexity metrics.", icon: "🧪", category: "tool" },
  { id: "ereader", name: "E-reader", description: "Book-style layout for literature projects.", icon: "📚", category: "viewer" },
  { id: "runbook-editor", name: "Runbook Editor", description: "Step-by-step procedures + playbooks.", icon: "📋", category: "production" },
];

export function App(): React.ReactElement {
  const [windows, setWindows] = useState<DesktopWindow[]>([]);
  const [topZ, setTopZ] = useState(10);

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
