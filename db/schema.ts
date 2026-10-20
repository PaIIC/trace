import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const aiConnections = sqliteTable("ai_connections", {
  ownerId: text("owner_id").primaryKey(),
  model: text("model").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  keyHint: text("key_hint").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const ideas = sqliteTable(
  "ideas",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    tags: text("tags").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    revision: integer("revision").notNull().default(1),
    bookmarked: integer("bookmarked").notNull().default(0),
    status: text("status").notNull().default("pending"),
    analysis: text("analysis"),
    analysisStale: integer("analysis_stale").notNull().default(0),
    analysisModel: text("analysis_model"),
    analyzedAt: text("analyzed_at"),
    analysisStartedAt: text("analysis_started_at"),
    analysisJob: text("analysis_job"),
    error: text("error"),
  },
  (table) => [
    index("ideas_owner_created_idx").on(table.ownerId, table.createdAt),
  ],
);
