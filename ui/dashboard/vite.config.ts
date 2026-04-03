import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Load echarts on demand instead of precaching (too large for SW cache)
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
