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

// Register PWA service worker with update prompt (skip in Electron)
if (!isElectron()) {
  import("virtual:pwa-register").then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh() {
        // Show a non-blocking banner at the top of the page
        const banner = document.createElement("div");
        banner.id = "pwa-update-banner";
        banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#1d4ed8;color:#fff;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-size:13px;font-family:system-ui;";
        banner.innerHTML = `
          <span>A new version of the dashboard is available.</span>
          <button id="pwa-update-btn" style="background:#fff;color:#1d4ed8;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:600;font-size:12px;">Update now</button>
        `;
        document.body.prepend(banner);
        document.getElementById("pwa-update-btn")?.addEventListener("click", () => {
          banner.remove();
          void updateSW(true);
        });
      },
      onOfflineReady() {
        // Silently ready for offline — no UI needed
      },
      onRegisteredSW(_url, registration) {
        // Check for updates periodically (every 60s)
        if (registration) {
          setInterval(() => { void registration.update(); }, 60_000);
        }
      },
    });
  }).catch(() => {
    // SW registration failed — non-fatal, app works without it
  });
}

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
