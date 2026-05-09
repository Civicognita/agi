import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative asset URLs so the build is portable: works at /, at
  // /sandbox/mapp-desktop/ (cycle-176 phase-1.5 dogfood deploy via the
  // sandbox auto-route), and at whatever final path the runtime ends
  // up served from. Avoids the absolute /assets/* 404 trap.
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
