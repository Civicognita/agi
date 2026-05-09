/**
 * Platform runtime state tables.
 *
 * Operational state that isn't auth, entities, audit, or compliance. Short-
 * to medium-lived rows. MagicApp instance state, in-app notification queue,
 * generic key/value metadata store, message queue.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const magicAppModeEnum = pgEnum("magic_app_mode", [
  "floating",
  "docked",
  "minimized",
  "maximized",
]);

/** MagicApp floating window state — persists across restarts. */
export const magicAppInstances = pgTable(
  "magic_app_instances",
  {
    instanceId: text("instance_id").primaryKey(),
    appId: text("app_id").notNull(),
    userEntityId: text("user_entity_id").notNull(),
    projectPath: text("project_path").notNull().default(""),
    mode: magicAppModeEnum("mode").notNull().default("floating"),
    state: jsonb("state").notNull(),
    position: jsonb("position"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("magic_app_instances_user_idx").on(t.userEntityId),
    projectIdx: index("magic_app_instances_project_idx").on(t.projectPath),
  }),
);

/** In-app notification queue — alerts, digests, push queue. */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    metadata: jsonb("metadata"),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("notifications_entity_idx").on(t.entityId),
    readIdx: index("notifications_read_idx").on(t.read),
    createdIdx: index("notifications_created_idx").on(t.createdAt),
  }),
);

/** Outbound message retry queue — idempotent, state-machine-driven. */
export const messageQueue = pgTable(
  "message_queue",
  {
    id: text("id").primaryKey(),
    channel: text("channel").notNull(),
    direction: text("direction").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    retries: integer("retries").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index("message_queue_status_idx").on(t.status),
    channelIdx: index("message_queue_channel_idx").on(t.channel),
  }),
);

/** Key/value metadata — feature flags, version info, system config. */
export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * UserNotes — first-class notes surface for end users (s152, 2026-05-09).
 *
 * Two scopes: per-project (projectPath set) and global (projectPath null).
 * Single mode for v1 (markdown notepad); whiteboard mode lands in a
 * follow-up. Aion reads these notes as context the same way Dev Notes
 * are consumed.
 *
 * Storage round-trips through agi_data per single-source-of-truth (see
 * memory `feedback_single_source_of_truth_db`) — never write notes to
 * disk-only locations like `~/.agi/notes/` that would drift from the DB.
 */
export const userNotes = pgTable(
  "user_notes",
  {
    id: text("id").primaryKey(),
    /** Owning user (entity id). Multi-user support arrives via Hive-ID;
     *  for the single-owner alpha, every note is owned by `~$U0`. */
    userEntityId: text("user_entity_id").notNull(),
    /** Per-project notes set this to the absolute project path. Global
     *  notes (the global scope from the s152 spec) leave it NULL. */
    projectPath: text("project_path"),
    /** Display title — short, single-line. */
    title: text("title").notNull(),
    /** Markdown body. */
    body: text("body").notNull().default(""),
    /** Sort order within a scope. Lower = earlier. */
    sortOrder: integer("sort_order").notNull().default(0),
    /** Optional pinned flag — pinned notes float to the top. */
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("user_notes_user_idx").on(t.userEntityId),
    projectIdx: index("user_notes_project_idx").on(t.projectPath),
    pinnedIdx: index("user_notes_pinned_idx").on(t.pinned),
  }),
);
