import type { Extraction, Priority, ProposalInput, TaskState } from "@sitrep/contract";
import { bootstrapMilestone, bootstrapProject } from "./admin.js";
import { createInMemoryDb, type Db } from "./db/client.js";

export function setupDb(): Db {
  return createInMemoryDb();
}

// Fixed anchor rather than real wall-clock time: rag.test.ts evaluates RAG
// status at fixed dates far in the future (2099), and staleness is relative
// to last_signal_at, not to whenever the test happens to run.
const FIXTURE_ANCHOR = "2099-01-01T00:00:00.000Z";

export function seedProjectAndMilestone(
  db: Db,
  plannedDate = "2099-01-01",
  now = FIXTURE_ANCHOR,
): { projectId: string; milestoneId: string } {
  const project = bootstrapProject(db, "Test Project", now);
  const milestone = bootstrapMilestone(db, { projectRef: project.id, name: "Test Milestone", plannedDate }, now);
  return { projectId: project.id, milestoneId: milestone.id };
}

function proposalInput(extraction: Extraction, rawText = "test capture"): ProposalInput {
  return {
    source: { channel: "inbox", raw_text: rawText, captured_at: new Date().toISOString() },
    extraction,
  };
}

export function taskCreateInput(opts: {
  projectRef: string;
  title?: string;
  owner?: string;
  dueDate?: string;
  priority?: Priority;
  confidence?: number;
}): ProposalInput {
  return proposalInput({
    type: "task_create",
    target_refs: [],
    confidence: opts.confidence ?? 0.9,
    payload: {
      title: opts.title ?? "Test task",
      project_ref: opts.projectRef,
      ...(opts.owner !== undefined ? { owner: opts.owner } : {}),
      ...(opts.dueDate !== undefined ? { due_date: opts.dueDate } : {}),
      ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
    },
  });
}

export function taskUpdateInput(opts: {
  taskRef: string;
  title?: string;
  owner?: string;
  dueDate?: string;
  priority?: Priority;
  confidence?: number;
}): ProposalInput {
  return proposalInput({
    type: "task_update",
    target_refs: [opts.taskRef],
    confidence: opts.confidence ?? 0.9,
    payload: {
      task_ref: opts.taskRef,
      patch: {
        ...(opts.title !== undefined ? { title: opts.title } : {}),
        ...(opts.owner !== undefined ? { owner: opts.owner } : {}),
        ...(opts.dueDate !== undefined ? { due_date: opts.dueDate } : {}),
        ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
      },
    },
  });
}

export function statusChangeInput(opts: { taskRef: string; state: TaskState; confidence?: number }): ProposalInput {
  return proposalInput({
    type: "status_change",
    target_refs: [opts.taskRef],
    confidence: opts.confidence ?? 0.9,
    payload: { task_ref: opts.taskRef, state: opts.state },
  });
}

export function milestoneShiftInput(opts: {
  milestoneRef: string;
  newDate: string;
  reason?: string;
  confidence?: number;
}): ProposalInput {
  return proposalInput({
    type: "milestone_shift",
    target_refs: [opts.milestoneRef],
    confidence: opts.confidence ?? 0.9,
    payload: {
      milestone_ref: opts.milestoneRef,
      new_date: opts.newDate,
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    },
  });
}

export function riskFlagInput(opts: {
  targetRef: string;
  description?: string;
  severity?: "low" | "medium" | "high";
  confidence?: number;
}): ProposalInput {
  return proposalInput({
    type: "risk_flag",
    target_refs: [opts.targetRef],
    confidence: opts.confidence ?? 0.9,
    payload: {
      target_ref: opts.targetRef,
      description: opts.description ?? "Something is at risk",
      ...(opts.severity !== undefined ? { severity: opts.severity } : {}),
    },
  });
}

export function decisionLogInput(opts: { targetRef: string; decisionText?: string; confidence?: number }): ProposalInput {
  return proposalInput({
    type: "decision_log",
    target_refs: [opts.targetRef],
    confidence: opts.confidence ?? 0.9,
    payload: { target_ref: opts.targetRef, decision_text: opts.decisionText ?? "We decided X" },
  });
}
