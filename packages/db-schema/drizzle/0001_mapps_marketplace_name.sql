-- s145 t598 cycle 189: add human-readable `name` column to mapps_marketplace.
-- Nullable for backward compat — older catalog rows synced before the
-- column existed return NULL; dashboard's humanize-id fallback (cycle 176)
-- covers those. New syncs populate name from the marketplace.json's
-- per-MApp entry when present.

ALTER TABLE "mapps_marketplace" ADD COLUMN IF NOT EXISTS "name" text;
