import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "@particle-academy/react-fancy/styles.css";
import { App } from "./App.js";
import { isElectron } from "./lib/environment.js";
import { setupContentRendererExtensions } from "./lib/content-renderer-setup.js";

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
