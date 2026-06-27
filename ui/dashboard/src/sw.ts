/// <reference lib="webworker" />
/**
 * Service worker entry — bundled by the `fancyPwa()` Vite plugin, which injects
 * `self.__FANCY_PRECACHE` (the build's hashed asset filenames) and
 * `self.__FANCY_VERSION` (a build hash). Replaces the previous vite-plugin-pwa
 * (Workbox) setup with the framework-agnostic fancy-pwa toolkit.
 *
 * Behaviour preserved from the old config:
 *  - Hashed JS/CSS/asset shell is precached on install; stale-version caches are
 *    evicted on activate automatically (no manual cacheId namespacing needed —
 *    fancy-pwa keys caches by `__FANCY_VERSION`).
 *  - index.html / navigations are network-first, so a fresh build's hashed asset
 *    references are picked up after an upgrade (never serve a stale shell).
 *  - The large echarts chunk is cache-first with a small entry cap.
 */
import { precache, registerRoute, networkFirst, cacheFirst } from "@particle-academy/fancy-pwa/sw";

// Cache exactly the build's hashed assets (the injected __FANCY_PRECACHE list).
precache();

// echarts chunk: cache-first, keep at most 2 (current + one prior hash).
registerRoute(/\/assets\/echarts-.*\.js$/, cacheFirst({ max: 2, cacheName: "echarts" }));

// Navigations (index.html): network-first so post-upgrade asset refs are fresh.
registerRoute((request) => request.mode === "navigate", networkFirst());
