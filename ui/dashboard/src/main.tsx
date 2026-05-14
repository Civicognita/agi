import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerAll as registerAllEChartTypes } from "@particle-academy/fancy-echarts";
import "./index.css";
import "@particle-academy/react-fancy/styles.css";
import "@particle-academy/fancy-whiteboard/styles.css";
import "@particle-academy/agent-integrations/styles.css";
import { App } from "./App.js";
import { isElectron } from "./lib/environment.js";
import { setupContentRendererExtensions } from "./lib/content-renderer-setup.js";

// fancy-echarts (renamed from react-echarts upstream, finalized 2026-05-14)
// requires explicit chart/component/renderer registration. Without this
// call, mounting any <EChart> throws `TypeError: ia[o] is not a constructor`
// from zrender's painterMap when it can't find the canvas/svg renderer.
// Call once at boot before any chart component mounts; idempotent.
registerAllEChartTypes();

// Register ContentRenderer custom tags (thinking, question, callout, highlight)
// so the chat — and any future consumer — can render agent-authored inline
// widgets without per-callsite component wiring.
setupContentRendererExtensions();

// Register PWA service worker (skip in Electron — it has its own update mechanism).
// autoUpdate mode: new SWs activate immediately via skipWaiting + clientsClaim.
// index.html is never precached, so navigation always hits the network and picks
// up fresh asset references after an upgrade. No manual unregister needed.
if (!isElectron()) {
  import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
  }).catch(() => {});
}

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
