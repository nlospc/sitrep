import { z } from "zod";
import { EntityKind, EntityRef, Project, Milestone, Task } from "./entities.js";
import { ProposalInput } from "./proposal.js";
import { Job, JobKind, JobResult } from "./jobs.js";

// The six MCP tools Sitrep serves. See /contract/README.md for the full spec and the
// outbox design rationale.

export const FetchWorkInput = z.object({
  kinds: z.array(JobKind).optional(),
  limit: z.number().int().positive().optional(),
});
export type FetchWorkInput = z.infer<typeof FetchWorkInput>;

export const FetchWorkOutput = z.object({ jobs: z.array(Job) });
export type FetchWorkOutput = z.infer<typeof FetchWorkOutput>;

export const CompleteWorkInput = z.object({
  job_id: z.string().uuid(),
  result: JobResult,
});
export type CompleteWorkInput = z.infer<typeof CompleteWorkInput>;

export const CompleteWorkOutput = z.object({ acknowledged: z.literal(true) });
export type CompleteWorkOutput = z.infer<typeof CompleteWorkOutput>;

export const SubmitProposalInput = z.object({ proposal: ProposalInput });
export type SubmitProposalInput = z.infer<typeof SubmitProposalInput>;

export const SubmitProposalOutput = z.object({
  proposal_id: z.string().uuid(),
  state: z.enum(["pending", "approved"]),
});
export type SubmitProposalOutput = z.infer<typeof SubmitProposalOutput>;

export const ListEntitiesInput = z.object({
  query: z.string().optional(),
  kind: EntityKind.optional(),
  limit: z.number().int().positive().optional(),
});
export type ListEntitiesInput = z.infer<typeof ListEntitiesInput>;

export const ListEntitiesOutput = z.object({ entities: z.array(EntityRef) });
export type ListEntitiesOutput = z.infer<typeof ListEntitiesOutput>;

export const ReadStateInput = z.object({
  scope: z.object({
    project_ref: z.string().uuid().optional(),
    since: z.string().datetime({ offset: true }).optional(),
  }),
});
export type ReadStateInput = z.infer<typeof ReadStateInput>;

export const ReadStateOutput = z.object({
  projects: z.array(Project),
  milestones: z.array(Milestone),
  tasks: z.array(Task),
});
export type ReadStateOutput = z.infer<typeof ReadStateOutput>;

export const ResolveProposalInput = z.object({
  id: z.string().uuid(),
  action: z.union([
    z.literal("approve"),
    z.literal("reject"),
    z.object({ edit: z.record(z.unknown()) }),
  ]),
});
export type ResolveProposalInput = z.infer<typeof ResolveProposalInput>;

export const ResolveProposalOutput = z.object({
  proposal_id: z.string().uuid(),
  state: z.enum(["approved", "rejected", "edited_and_approved"]),
});
export type ResolveProposalOutput = z.infer<typeof ResolveProposalOutput>;

export const CONTRACT_VERSION = "1.0.0-draft";
