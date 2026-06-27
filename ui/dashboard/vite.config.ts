import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fancyPwa } from "@particle-academy/fancy-pwa/vite";

const require = createRequire(import.meta.url);
// Read the root package.json version so the SW cache name is versioned.
// When version bumps (every code-change commit), any stale precache partition
// is evicted by cleanupOutdatedCaches even if individual asset hashes match.
const rootPkg = require("../../package.json") as { version: string };
const AGI_VERSION = rootPkg.version;

export default defineConfig({
  define: {
    // Exposes the AGI version to runtime code (e.g. for diagnostics / about page).
    __AGI_VERSION__: JSON.stringify(AGI_VERSION),
  },
  plugins: [
    react(),
    tailwindcss(),
    // fancy-diff@0.1.0 imports `Button` from react-fancy which was renamed to
    // `Action` in v3. The wishborn/react-fancy fork exports both, but the
    // published 3.2.1 only exports Action. This plugin patches the fancy-diff
    // bundle at build time to use Action instead.
    // TODO: remove once fancy-diff publishes against react-fancy ≥ 3.2.1 or
    //       Particle-Academy/react-fancy merges the dual Button/Action export.
    {
      name: "fancy-diff-button-compat",
      transform(code: string, id: string) {
        if (id.includes("fancy-diff") && code.includes("{ Badge, Button, Separator, Card }")) {
          return code.replace(
            "{ Badge, Button, Separator, Card }",
            "{ Badge, Action as Button, Separator, Card }",
          );
        }
      },
    },
    // fancy-pwa: framework-agnostic, Workbox-free PWA layer. Bundles src/sw.ts
    // (injecting the hashed precache list + a version hash) and emits the
    // manifest. registerSw:false — the React <FancyPwaProvider> registers the SW
    // (and skips it in Electron). Caching behaviour lives in src/sw.ts.
    fancyPwa({
      sw: "src/sw.ts",
      registerSw: false,
      manifest: {
        name: "Aionima",
        short_name: "Aionima",
        description: "Autonomous AI Gateway Dashboard",
        theme_color: "#1e1e2e",
        background_color: "#11111b",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3001,
    proxy: {
      "/api": "http://localhost:3100",
      "/ws": {
        target: "ws://localhost:3100",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ["echarts", "echarts/charts", "echarts/components", "echarts/renderers"],
        },
      },
    },
  },
});
