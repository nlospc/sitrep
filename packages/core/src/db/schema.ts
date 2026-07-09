import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// Presentation-truth tables (PRD §2, §3.2). Mutated only through
// packages/core/src/proposals.ts — see the audit invariant tests in
// proposals.test.ts. Every JSON-shaped column stores a JSON-serialized
// string; better-sqlite3 has no native JSON type.

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const milestones = sqliteTable("milestones", {
  id: text("id").primaryKey(),
  projectRef: text("project_ref")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  plannedDate: text("planned_date").notNull(),
  currentDate: text("current_date").notNull(),
  lastSignalAt: text("last_signal_at").notNull(),
  // rag_status is never persisted — computed at read time by packages/core/src/rag.ts.
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  projectRef: text("project_ref")
    .notNull()
    .references(() => projects.id),
  milestoneRef: text("milestone_ref").references(() => milestones.id),
  owner: text("owner"),
  dueDate: text("due_date"),
  priority: text("priority").notNull(),
  state: text("state").notNull(),
});

export const captures = sqliteTable("captures", {
  id: text("id").primaryKey(),
  rawText: text("raw_text").notNull(),
  typeHint: text("type_hint"),
  mentionedRefs: text("mentioned_refs").notNull(), // JSON string[]
  isBatch: integer("is_batch", { mode: "boolean" }).notNull(),
  capturedAt: text("captured_at").notNull(),
});

export const proposals = sqliteTable("proposals", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  rawText: text("raw_text").notNull(),
  capturedAt: text("captured_at").notNull(),
  extractionType: text("extraction_type").notNull(),
  targetRefs: text("target_refs").notNull(), // JSON string[]
  payload: text("payload").notNull(), // JSON object, shape per extraction_type
  confidence: real("confidence").notNull(),
  riskClass: text("risk_class").notNull(),
  state: text("state").notNull(),
  resolvedBy: text("resolved_by"), // "user" | "auto_policy" | null while pending
  resolvedAt: text("resolved_at"),
  editDiff: text("edit_diff"), // JSON object | null
});

// Append-only. One row per mutated (or event-logged) entity field per commit.
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  entityKind: text("entity_kind").notNull(), // "project" | "milestone" | "task"
  entityId: text("entity_id").notNull(),
  field: text("field").notNull(),
  oldValue: text("old_value"), // JSON | null
  newValue: text("new_value").notNull(), // JSON
  proposalId: text("proposal_id")
    .notNull()
    .references(() => proposals.id),
  actor: text("actor").notNull(), // "user" | "auto_policy"
  timestamp: text("timestamp").notNull(),
});

// Sitrep -> Agent outbox (contract/README.md "the outbox, not a reverse call").
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // "extract" | "report_request" | "notification"
  payload: text("payload").notNull(), // JSON, shape per kind
  enqueuedAt: text("enqueued_at").notNull(),
  completedAt: text("completed_at"),
  result: text("result"), // JSON | null, shape per kind once completed
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  priority: text("priority").notNull(), // "digest" | "alert" | "high_risk" | "date_conflict"
  title: text("title").notNull(),
  body: text("body").notNull(),
  deepLink: text("deep_link"),
  createdAt: text("created_at").notNull(),
  readAt: text("read_at"),
});
