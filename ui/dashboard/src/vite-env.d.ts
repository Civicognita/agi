/// <reference types="vite/client" />

/**
 * AGI version string injected at build time from the root package.json.
 * Changes every release, which forces the workbox precache partition
 * (namespaced by cacheId in vite.config.ts) to rotate — evicting any
 * stale cached assets that survived the previous SW upgrade.
 */
declare const __AGI_VERSION__: string;
