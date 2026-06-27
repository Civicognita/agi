/// <reference types="vite/client" />

/**
 * AGI version string injected at build time from the root package.json.
 * Exposed to runtime code (diagnostics / about). PWA cache versioning is now
 * handled by fancy-pwa (keyed by its own build hash in src/sw.ts), not cacheId.
 */
declare const __AGI_VERSION__: string;
