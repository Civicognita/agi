import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "@particle-academy/react-fancy/styles.css";
import { App } from "./App.js";
import { isElectron } from "./lib/environment.js";

// Register PWA service worker (skip in Electron — it has its own update mechanism)
if (!isElectron()) {
  import("virtual:pwa-register");
}

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
