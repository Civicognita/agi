import { defineConfig } from "drizzle-kit";

/**
 * One-off drizzle push config for initial schema bootstrap.
 * Points at built dist/*.js so drizzle-kit's CJS require doesn't choke on
 * NodeNext .js extensions in the TS source. Use after `pnpm --filter @agi/db-schema build`.
 *
 * Usage (inside test VM):
 *   DATABASE_URL=postgres://agi:aionima@localhost:5432/agi_data \
 *     pnpm --filter @agi/db-schema exec drizzle-kit push --config=drizzle-push.config.ts
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
  ],
  out: "./drizzle-push-tmp",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://agi:aionima@localhost:5432/agi_data",
  },
  strict: true,
});
