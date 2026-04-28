import { defineConfig } from "drizzle-kit";

/**
 * Drizzle-kit generate config — emits reviewable SQL artifacts to ./drizzle/.
 *
 * Mirrors drizzle-push.config.ts but with `out: "./drizzle"` (the canonical
 * migrations dir) instead of the push-side scratch dir. Use this when you
 * want the SQL diff committed for review; use drizzle-push.config.ts when
 * you want the live test-VM agi_data DB synced directly.
 *
 * Why dist/ not src/: drizzle-kit's CJS require can't resolve NodeNext `.js`
 * extensions in TS source. The src/ files have `import { entities } from
 * "./entities.js"` which fails at module-load. Built dist/*.js files have
 * the same `.js` paths but they actually exist.
 *
 * Usage:
 *   pnpm --filter @agi/db-schema build
 *   pnpm --filter @agi/db-schema exec drizzle-kit generate \
 *     --config=drizzle-generate.config.ts
 *
 * Or use the shorthand npm script:
 *   pnpm --filter @agi/db-schema generate:dist
 *
 * t425 (s101) — option 2 from the task description: separate generate config
 * pointing at dist. Less elegant than a tsx loader (option 1) but ships a
 * working SQL-artifact workflow today without scope creep.
 */
export default defineConfig({
  schema: [
    "./dist/auth.js",
    "./dist/entities.js",
    "./dist/audit.js",
    "./dist/compliance.js",
    "./dist/platform.js",
    "./dist/marketplaces.js",
    "./dist/hf.js",
    "./dist/security.js",
    "./dist/cost-ledger.js",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://agi:aionima@localhost:5432/agi_data",
  },
  strict: true,
  verbose: true,
});
