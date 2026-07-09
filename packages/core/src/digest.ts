import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { DigestData, type EntityKind, type RiskFlagPayload } from "@sitrep/contract";
import type { Db } from "./db/client.js";
import { auditLog, milestones, proposals, tasks } from "./db/schema.js";

export interface DigestScope {
  projectRef?: string;
  since: Date;
}

function resolveEntityProjectRef(db: Db, kind: EntityKind, id: string): string | undefined {
  if (kind === "project") return id;
  if (kind === "milestone") {
    return db.select({ projectRef: milestones.projectRef }).from(milestones).where(eq(milestones.id, id)).get()?.projectRef;
  }
  return db.select({ projectRef: tasks.projectRef }).from(tasks).where(eq(tasks.id, id)).get()?.projectRef;
}

/** Best-effort project scoping for a proposal — v1 has no direct proposal->project column. */
function resolveProposalProjectRef(db: Db, extractionType: string, payload: unknown): string | undefined {
  switch (extractionType) {
    case "task_create":
      return (payload as { project_ref: string }).project_ref;
    case "task_update":
    case "status_change": {
      const taskRef = (payload as { task_ref: string }).task_ref;
      return db.select({ projectRef: tasks.projectRef }).from(tasks).where(eq(tasks.id, taskRef)).get()?.projectRef;
    }
    case "milestone_shift": {
      const milestoneRef = (payload as { milestone_ref: string }).milestone_ref;
      return db
        .select({ projectRef: milestones.projectRef })
        .from(milestones)
        .where(eq(milestones.id, milestoneRef))
        .get()?.projectRef;
    }
    case "risk_flag":
    case "decision_log": {
      const targetRef = (payload as { target_ref: string }).target_ref;
      const milestone = db
        .select({ projectRef: milestones.projectRef })
        .from(milestones)
        .where(eq(milestones.id, targetRef))
        .get();
      if (milestone) return milestone.projectRef;
      return db.select({ projectRef: tasks.projectRef }).from(tasks).where(eq(tasks.id, targetRef)).get()?.projectRef;
    }
    default:
      return undefined;
  }
}

/**
 * Assembles the report_request payload data (contract/README.md
 * "report_request payload — Sitrep-computed digest data"): Sitrep computes
 * this from its own state so the agent's only job is to narrate it, no
 * read_state round-trip needed. Satisfies PRD §5.2's morning digest contents.
 */
export function assembleDigest(db: Db, scope: DigestScope): DigestData {
  const sinceIso = scope.since.toISOString();
  const today = new Date().toISOString().slice(0, 10);

  // overnight_changes: audit rows since cutoff, grouped by (entity, proposal)
  // into one summary line per commit that touched that entity.
  const auditRows = db.select().from(auditLog).where(gte(auditLog.timestamp, sinceIso)).all();
  const grouped = new Map<
    string,
    { entityKind: EntityKind; entityId: string; proposalId: string; fields: string[] }
  >();
  for (const row of auditRows) {
    const key = `${row.entityKind}:${row.entityId}:${row.proposalId}`;
    const g = grouped.get(key) ?? {
      entityKind: row.entityKind as EntityKind,
      entityId: row.entityId,
      proposalId: row.proposalId,
      fields: [],
    };
    const oldVal: unknown = row.oldValue ? JSON.parse(row.oldValue) : null;
    const newVal: unknown = JSON.parse(row.newValue);
    g.fields.push(`${row.field}: ${JSON.stringify(oldVal)} -> ${JSON.stringify(newVal)}`);
    grouped.set(key, g);
  }

  const overnightChanges: DigestData["overnight_changes"] = [];
  for (const g of grouped.values()) {
    if (scope.projectRef) {
      const projectRef = resolveEntityProjectRef(db, g.entityKind, g.entityId);
      if (projectRef !== scope.projectRef) continue;
    }
    overnightChanges.push({
      entity_ref: g.entityId,
      entity_kind: g.entityKind,
      summary: g.fields.join("; "),
      proposal_id: g.proposalId,
    });
  }

  // tasks_due_today
  const taskConditions = [eq(tasks.dueDate, today), ne(tasks.state, "done")];
  if (scope.projectRef) taskConditions.push(eq(tasks.projectRef, scope.projectRef));
  const dueTasks = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(...taskConditions))
    .all();

  // pending_proposal_count
  const pendingRows = db
    .select({ id: proposals.id, extractionType: proposals.extractionType, payload: proposals.payload })
    .from(proposals)
    .where(eq(proposals.state, "pending"))
    .all();
  const pendingCount = scope.projectRef
    ? pendingRows.filter(
        (p) => resolveProposalProjectRef(db, p.extractionType, JSON.parse(p.payload)) === scope.projectRef,
      ).length
    : pendingRows.length;

  // new_risk_flags: approved risk_flag proposals resolved since cutoff.
  const riskFlagRows = db
    .select({ payload: proposals.payload, extractionType: proposals.extractionType, resolvedAt: proposals.resolvedAt })
    .from(proposals)
    .where(
      and(eq(proposals.extractionType, "risk_flag"), inArray(proposals.state, ["approved", "edited_and_approved"])),
    )
    .all();
  const newRiskFlags: RiskFlagPayload[] = [];
  for (const row of riskFlagRows) {
    if (!row.resolvedAt || row.resolvedAt < sinceIso) continue;
    const payload = JSON.parse(row.payload) as RiskFlagPayload;
    if (scope.projectRef) {
      const projectRef = resolveProposalProjectRef(db, row.extractionType, payload);
      if (projectRef !== scope.projectRef) continue;
    }
    newRiskFlags.push(payload);
  }

  return DigestData.parse({
    overnight_changes: overnightChanges,
    tasks_due_today: dueTasks.map((t) => t.id),
    pending_proposal_count: pendingCount,
    new_risk_flags: newRiskFlags,
  });
}
