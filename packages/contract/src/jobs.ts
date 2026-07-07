import { z } from "zod";
import { EntityKind } from "./entities.js";
import { ProposalInput, RiskFlagPayload } from "./proposal.js";

// The Sitrep -> Agent outbox. See /contract/README.md "Design decision: the outbox,
// not a reverse call" for why this replaces a direct Sitrep-calls-agent model.

export const JobKind = z.enum(["extract", "report_request", "notification"]);
export type JobKind = z.infer<typeof JobKind>;

export const CapturePayload = z.object({
  capture_id: z.string().uuid(),
  raw_text: z.string().min(1),
  type_hint: z
    .enum(["task", "status_update", "risk", "decision", "meeting_notes", "idea"])
    .optional(),
  mentioned_refs: z.array(z.string().uuid()),
  is_batch: z.boolean(), // long-paste detection, PRD §4.1 item 4
  captured_at: z.string().datetime({ offset: true }),
});
export type CapturePayload = z.infer<typeof CapturePayload>;

// Sitrep computes the digest data (it owns the presentation truth, PRD §2); the agent's
// only job is to narrate it into prose and deliver it. This makes read_state unnecessary
// for report generation and keeps every digest line traceable back to a proposal_id.
export const DigestData = z.object({
  overnight_changes: z.array(
    z.object({
      entity_ref: z.string().uuid(),
      entity_kind: EntityKind,
      summary: z.string().min(1),
      proposal_id: z.string().uuid(),
    }),
  ),
  tasks_due_today: z.array(z.string().uuid()),
  pending_proposal_count: z.number().int().nonnegative(),
  new_risk_flags: z.array(RiskFlagPayload),
});
export type DigestData = z.infer<typeof DigestData>;

export const ReportRequestPayload = z.object({
  kind: z.enum(["morning_digest", "weekly_report"]),
  scope: z.object({ project_ref: z.string().uuid().optional() }),
  data: DigestData,
});
export type ReportRequestPayload = z.infer<typeof ReportRequestPayload>;

export const NotificationPayload = z.object({
  priority: z.enum(["digest", "alert", "high_risk", "date_conflict"]),
  title: z.string().min(1),
  body: z.string().min(1),
  deep_link: z.string().optional(), // e.g. sitrep://proposals/{id}
});
export type NotificationPayload = z.infer<typeof NotificationPayload>;

const jobBase = {
  id: z.string().uuid(),
  enqueued_at: z.string().datetime({ offset: true }),
};

export const JobPayload = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("extract"), payload: CapturePayload }),
  z.object({ kind: z.literal("report_request"), payload: ReportRequestPayload }),
  z.object({ kind: z.literal("notification"), payload: NotificationPayload }),
]);
export type JobPayload = z.infer<typeof JobPayload>;

export const Job = z.discriminatedUnion("kind", [
  z.object({ ...jobBase, kind: z.literal("extract"), payload: CapturePayload }),
  z.object({ ...jobBase, kind: z.literal("report_request"), payload: ReportRequestPayload }),
  z.object({ ...jobBase, kind: z.literal("notification"), payload: NotificationPayload }),
]);
export type Job = z.infer<typeof Job>;

export const ExtractResult = z.object({
  proposal_ids: z.array(z.string().uuid()),
});
export const ReportResult = z.object({
  text: z.string().min(1),
});
export const NotifyResult = z.object({
  delivered: z.boolean(),
  channel: z.string().optional(), // agent-defined, e.g. "telegram"
});

export const JobResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("extract"), result: ExtractResult }),
  z.object({ kind: z.literal("report_request"), result: ReportResult }),
  z.object({ kind: z.literal("notification"), result: NotifyResult }),
]);
export type JobResult = z.infer<typeof JobResult>;

// re-exported for tools.ts convenience
export { ProposalInput };
