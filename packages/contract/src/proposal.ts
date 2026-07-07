import { z } from "zod";
import { Priority, TaskState } from "./entities.js";

export const ProposalChannel = z.enum(["inbox", "external", "scheduled_review"]);
export type ProposalChannel = z.infer<typeof ProposalChannel>;

export const RiskClass = z.enum(["low", "high"]);
export type RiskClass = z.infer<typeof RiskClass>;

export const ProposalState = z.enum([
  "pending",
  "approved",
  "rejected",
  "edited_and_approved",
]);
export type ProposalState = z.infer<typeof ProposalState>;

// Extraction payloads, discriminated by extraction.type.
// High-risk changes per PRD Table (3.1): milestone_shift, status_change -> "done",
// task_update carrying a delete/owner-change, are always risk_class "high" regardless
// of agent-reported confidence; enforced in packages/core, not here.

export const TaskCreatePayload = z.object({
  title: z.string().min(1),
  project_ref: z.string().uuid(),
  owner: z.string().optional(),
  due_date: z.string().date().optional(),
  priority: Priority.optional(),
});

export const TaskUpdatePayload = z.object({
  task_ref: z.string().uuid(),
  patch: z.object({
    title: z.string().min(1).optional(),
    owner: z.string().optional(),
    due_date: z.string().date().optional(),
    priority: Priority.optional(),
  }),
});

export const StatusChangePayload = z.object({
  task_ref: z.string().uuid(),
  state: TaskState,
});

export const MilestoneShiftPayload = z.object({
  milestone_ref: z.string().uuid(),
  new_date: z.string().date(),
  reason: z.string().optional(),
});

export const RiskFlagPayload = z.object({
  target_ref: z.string().uuid(),
  description: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]).optional(),
});

export const DecisionLogPayload = z.object({
  target_ref: z.string().uuid(),
  decision_text: z.string().min(1),
});

function extractionVariant<Type extends string, Payload extends z.ZodTypeAny>(
  type: Type,
  payload: Payload,
) {
  return z.object({
    type: z.literal(type),
    target_refs: z.array(z.string().uuid()),
    payload,
    confidence: z.number().min(0).max(1),
  });
}

export const Extraction = z.discriminatedUnion("type", [
  extractionVariant("task_create", TaskCreatePayload),
  extractionVariant("task_update", TaskUpdatePayload),
  extractionVariant("status_change", StatusChangePayload),
  extractionVariant("milestone_shift", MilestoneShiftPayload),
  extractionVariant("risk_flag", RiskFlagPayload),
  extractionVariant("decision_log", DecisionLogPayload),
]);
export type Extraction = z.infer<typeof Extraction>;

export const ProposalSource = z.object({
  channel: ProposalChannel,
  raw_text: z.string().min(1),
  captured_at: z.string().datetime({ offset: true }),
});
export type ProposalSource = z.infer<typeof ProposalSource>;

export const ProposalResolution = z.object({
  resolved_by: z.enum(["user", "auto_policy"]),
  resolved_at: z.string().datetime({ offset: true }),
  edit_diff: z.record(z.unknown()).nullable(),
});
export type ProposalResolution = z.infer<typeof ProposalResolution>;

// What the agent sends via submit_proposal.
export const ProposalInput = z.object({
  source: ProposalSource,
  extraction: Extraction,
});
export type ProposalInput = z.infer<typeof ProposalInput>;

// The full persisted Proposal (PRD §3.1).
export const Proposal = z.object({
  id: z.string().uuid(),
  source: ProposalSource,
  extraction: Extraction,
  risk_class: RiskClass,
  state: ProposalState,
  resolution: ProposalResolution.nullable(),
});
export type Proposal = z.infer<typeof Proposal>;
