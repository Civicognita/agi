import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

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
    VitePWA({
      registerType: "autoUpdate",
      selfDestroying: false,
      // cacheId namespaces the workbox precache so upgrading the AGI version
      // forces the browser to adopt the new SW and evict any stale cache
      // partitions, even for static assets whose content hashes haven't changed.
      cacheId: `agi-${AGI_VERSION}`,
      includeAssets: ["favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png", "logo.png", "logo-small.png"],
      workbox: {
        // Never precache index.html — it must always come from the network
        // so it references the latest hashed JS/CSS filenames after an upgrade.
        // JS/CSS files have content hashes so cached versions are naturally unique.
        globPatterns: ["**/*.{js,css,ico,png,svg,woff2}"],
        navigateFallback: null,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globIgnores: ["**/echarts-*.js"],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/echarts-.*\.js$/,
            handler: "CacheFirst" as const,
            options: { cacheName: "echarts-cache", expiration: { maxEntries: 2, maxAgeSeconds: 30 * 24 * 60 * 60 } },
          },
        ],
      },
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
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      devOptions: { enabled: false },
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
