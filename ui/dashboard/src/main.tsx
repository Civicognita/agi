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
// prompt mode with NO prompt handler: the SW registers for offline caching but
// never auto-reloads the page. After an upgrade, the gateway restarts, the WS
// drops, and the user reloads naturally — that page load picks up the new SW.
// No auto-update, no polling, no banners. The upgrade header button is the
// single notification surface.
if (!isElectron()) {
  import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW();
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
