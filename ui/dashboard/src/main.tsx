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
// autoUpdate mode: the SW silently activates and reloads the page when new assets
// are detected. No separate banner — the existing upgrade button in the header is
// the single notification surface for updates.
if (!isElectron()) {
  import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({
      onRegisteredSW(_url, registration) {
        if (registration) {
          setInterval(() => { void registration.update(); }, 60_000);
        }
      },
    });
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
