import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DesktopMessage,
  DesktopWindow,
  MAppEntry,
  StorageReqPayload,
  StorageReplyPayload,
} from "./types.js";
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

// s140 t599 phase 4 cycle 193 — localStorage key for window-state
// persistence. Per-project so multiple projects don't trample each
// other's open MApps.
function persistedStateKey(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "default";
  return `mapp-desktop-windows::${host}`;
}

function loadPersistedWindows(): DesktopWindow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(persistedStateKey());
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as DesktopWindow[];
    if (!Array.isArray(parsed)) return [];
    // Re-resolve icon + title from MOCK_MAPPS in case the catalog has
    // changed since persistence (icon/name are display-only; persisted
    // x/y/w/h/minimized are the load-bearing state).
    return parsed
      .map((w) => {
        const mapp = MOCK_MAPPS.find((m) => m.id === w.mappId);
        if (mapp === undefined) return null; // MApp uninstalled — drop
        return { ...w, title: mapp.name, icon: mapp.icon };
      })
      .filter((w): w is DesktopWindow => w !== null);
  } catch {
    return [];
  }
}

export function App(): React.ReactElement {
  const [windows, setWindows] = useState<DesktopWindow[]>(() => loadPersistedWindows());
  const [topZ, setTopZ] = useState(() => {
    // Hydrate topZ from the highest persisted z so newly-opened windows
    // sit above hydrated ones, not below.
    const initial = loadPersistedWindows();
    return initial.length === 0 ? 10 : Math.max(10, ...initial.map((w) => w.z));
  });

  // s140 t599 phase 4 cycle 193 — persist window state to localStorage.
  // Debounced via React's natural batching; no explicit timer needed
  // since localStorage.setItem is synchronous + cheap. Empty windows[]
  // writes "[]" which clears stale state when user closes everything.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(persistedStateKey(), JSON.stringify(windows));
    } catch {
      // Quota exceeded or storage disabled — ignore. State stays in
      // memory; persistence is opportunistic.
    }
  }, [windows]);

  // s140 t599 phase 2 — panelUrl lookup. Derived at render time so a
  // future catalog refresh updates open windows without re-keying.
  const panelUrlByMappId = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of MOCK_MAPPS) {
      if (e.panelUrl) m.set(e.id, e.panelUrl);
    }
    return m;
  }, []);

  // s140 t599 phase 3.5 — derive the project slug from location.hostname
  // so storage routes can be addressed without the iframe needing to know
  // it. "civicognita-ops.ai.on" → "civicognita_ops" (dashes back to
  // underscores to match the on-disk dir basename used by the gateway's
  // slug resolver). Memoized so a hostname change (rare) re-runs once.
  const projectSlug = useMemo(() => {
    const host = typeof window !== "undefined" ? window.location.hostname : "";
    const head = host.split(".")[0] ?? "";
    return head.replace(/-/g, "_");
  }, []);

  // s140 t599 phase 3.5 — bound-mappId resolution. When a postMessage
  // arrives, e.source is the iframe's contentWindow but tells us
  // nothing about *which* MApp it represents. We resolve it by matching
  // against the iframe DOM (Window.tsx tags each iframe with
  // data-mapp-id). Trusting this DOM-side binding — not the envelope's
  // mappId field — is what stops a hostile MApp from impersonating
  // another to read its storage. Cached in a ref so the lookup doesn't
  // re-run for every message.
  const iframeRefMap = useRef<Map<Window, string>>(new Map());

  function resolveBoundMappId(source: MessageEventSource | null): string | null {
    if (source === null) return null;
    const cached = iframeRefMap.current.get(source as Window);
    if (cached !== undefined) return cached;
    // Cache miss — sweep the DOM for iframe[data-mapp-id] and find a
    // contentWindow match. Refreshes on every miss; the map cleans
    // itself on iframe close because the contentWindow ref becomes
    // detached from the DOM. (Map keys are weak only via WeakMap; for
    // typical desktop sessions with <20 open windows the leak is
    // bounded.)
    const iframes = document.querySelectorAll<HTMLIFrameElement>("iframe[data-mapp-id]");
    for (const el of Array.from(iframes)) {
      if (el.contentWindow === source) {
        const id = el.dataset["mappId"] ?? null;
        if (id !== null) {
          iframeRefMap.current.set(source as Window, id);
          return id;
        }
      }
    }
    return null;
  }

  async function dispatchStorageVerb(
    verb: "GET" | "PUT" | "DELETE",
    req: StorageReqPayload,
    boundMappId: string,
  ): Promise<StorageReplyPayload> {
    if (req.area !== "k" && req.area !== "sandbox") {
      return { ok: false, status: 0, error: `invalid area: ${String(req.area)}` };
    }
    const filepath = req.filepath ?? "";
    const segs = filepath.split("/").filter((s) => s.length > 0);
    for (const seg of segs) {
      if (seg === "." || seg === ".." || seg.includes("\\") || seg.includes("\0")) {
        return { ok: false, status: 0, error: `unsafe filepath segment: ${seg}` };
      }
    }
    // Bare-dir read forces the trailing slash (the gateway's list route).
    const tail = segs.length === 0 ? "/" : `/${segs.join("/")}`;
    const url = `/api/projects/${projectSlug}/${req.area}/mapps/${boundMappId}${tail}`;

    try {
      const init: RequestInit =
        verb === "PUT"
          ? {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(req.body ?? null),
            }
          : { method: verb };
      const res = await fetch(url, init);
      let data: unknown;
      // Try JSON first; fall back to text. The gateway returns
      // application/octet-stream for file reads, JSON for everything
      // else.
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!res.ok) {
        const errMsg =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : `HTTP ${String(res.status)}`;
        return { ok: false, status: res.status, error: errMsg };
      }
      return { ok: true, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // s140 t599 phase 2 — postMessage IPC primitive. Iframe MApps send
  // { protocol, mappId, type, payload, requestId? } envelopes. Runtime
  // echoes a pong for ping (sanity probe). Phase 3.5 adds storage-{read,
  // write,list,delete} ops mediated through the parent runtime — runtime
  // ignores the envelope's mappId and uses the iframe's bound mappId
  // (resolved via DOM lookup) to scope every gateway call.
  useEffect(() => {
    function postReply(
      source: MessageEventSource,
      type: string,
      mappId: string,
      requestId: string | undefined,
      payload: unknown,
    ): void {
      const reply: DesktopMessage = {
        protocol: "mapp-desktop/1",
        mappId,
        type,
        ...(requestId !== undefined ? { requestId } : {}),
        payload,
      };
      (source as Window).postMessage(reply, "*");
    }

    function onMessage(e: MessageEvent): void {
      const data = e.data as Partial<DesktopMessage> | null;
      if (!data || data.protocol !== "mapp-desktop/1") return;
      const source = e.source;
      if (!source || !("postMessage" in source)) return;

      // Phase 2 — ping/pong sanity probe. Doesn't require bound mappId.
      if (data.type === "ping") {
        postReply(source, "pong", data.mappId ?? "(unknown)", data.requestId, {
          now: new Date().toISOString(),
        });
        return;
      }

      // Phase 3.5 — storage ops. Resolve the iframe's BOUND mappId from
      // the DOM and use that for the gateway scope; the envelope's
      // claimed mappId is informational only.
      if (
        data.type === "storage-read" ||
        data.type === "storage-write" ||
        data.type === "storage-list" ||
        data.type === "storage-delete"
      ) {
        const boundMappId = resolveBoundMappId(source);
        if (boundMappId === null) {
          postReply(source, `${data.type}-reply`, data.mappId ?? "(unknown)", data.requestId, {
            ok: false,
            status: 0,
            error: "iframe is not a registered MApp window",
          } satisfies StorageReplyPayload);
          return;
        }
        const req = (data.payload as StorageReqPayload | undefined) ?? { area: "sandbox" };
        const verb: "GET" | "PUT" | "DELETE" =
          data.type === "storage-write" ? "PUT" : data.type === "storage-delete" ? "DELETE" : "GET";
        // Fire-and-forget; the async reply arrives via postMessage.
        // Capturing the source narrowing in the closure prevents lint
        // from complaining about `e` outliving the handler.
        const replySource = source;
        void dispatchStorageVerb(verb, req, boundMappId).then((result) => {
          postReply(replySource, `${data.type}-reply`, boundMappId, data.requestId, result);
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug]);

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
      <Taskbar windows={windows} onFocus={focusWindow} onClose={closeWindow} onMinimize={minimizeWindow} />
    </div>
  );
}
