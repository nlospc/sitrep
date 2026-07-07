import { z } from "zod";

export const EntityKind = z.enum(["project", "milestone", "task"]);
export type EntityKind = z.infer<typeof EntityKind>;

export const RagStatus = z.enum(["green", "amber", "red"]);
export type RagStatus = z.infer<typeof RagStatus>;

export const TaskState = z.enum(["todo", "in_progress", "blocked", "done"]);
export type TaskState = z.infer<typeof TaskState>;

export const Priority = z.enum(["low", "medium", "high"]);
export type Priority = z.infer<typeof Priority>;

export const Project = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  created_at: z.string().datetime({ offset: true }),
});
export type Project = z.infer<typeof Project>;

export const Milestone = z.object({
  id: z.string().uuid(),
  project_ref: z.string().uuid(),
  name: z.string().min(1),
  planned_date: z.string().date(),
  current_date: z.string().date(),
  last_signal_at: z.string().datetime({ offset: true }),
  // rag_status is computed at read time by packages/core; never persisted.
});
export type Milestone = z.infer<typeof Milestone>;

export const Task = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  project_ref: z.string().uuid(),
  milestone_ref: z.string().uuid().optional(),
  owner: z.string().optional(),
  due_date: z.string().date().optional(),
  priority: Priority,
  state: TaskState,
  provenance: z.array(z.string().uuid()), // ordered chain of proposal ids
});
export type Task = z.infer<typeof Task>;

export const EntityRef = z.object({
  id: z.string().uuid(),
  kind: EntityKind,
  label: z.string(),
  project_ref: z.string().uuid().optional(),
});
export type EntityRef = z.infer<typeof EntityRef>;
