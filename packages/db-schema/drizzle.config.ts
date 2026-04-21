import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration for the unified agi_data database.
 *
 * Every AGI service + Local-ID connects to this one database via the shared
 * schema in `src/`. Single source of truth per `feedback_single_source_of_truth_db`
 * memory — no per-service schemas, no duplicated tables across data stores.
 *
 * Connection URL priority: DATABASE_URL env var → default localhost agi_data.
 */
export default defineConfig({
  // Drizzle-kit loads schema files through CJS require, which doesn't resolve
  // NodeNext `.js` extensions in TS imports. Pointing at each schema file
  // directly (not index.ts) sidesteps the re-export chain entirely — kit
  // introspects the pgTable definitions in each file without needing to
  // traverse imports.
  schema: [
    "./src/auth.ts",
    "./src/entities.ts",
    "./src/audit.ts",
    "./src/compliance.ts",
    "./src/platform.ts",
    "./src/marketplaces.ts",
    "./src/hf.ts",
    "./src/security.ts",
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
