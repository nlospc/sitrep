import { eq, ne } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { milestones, proposals, tasks } from "./db/schema.js";

const COUNTDOWN_DAYS = 7;
const MS_PER_DAY = 86_400_000;

export type Alert =
  | { kind: "milestone_countdown"; milestoneId: string; daysRemaining: number }
  | {
      kind: "date_conflict";
      targetRef: string;
      field: "due_date" | "current_date";
      proposalIds: string[];
      values: string[];
    }
  | { kind: "high_risk_proposal"; proposalId: string };

/** PRD §5.3 item 1: milestone within 7 days of planned_date with >=1 incomplete task under it. */
export function detectMilestoneCountdownAlerts(
  milestoneRows: Array<{ id: string; plannedDate: string }>,
  incompleteTaskMilestoneIds: Set<string>,
  now: Date,
): Alert[] {
  const alerts: Alert[] = [];
  for (const m of milestoneRows) {
    const daysRemaining = (new Date(m.plannedDate).getTime() - now.getTime()) / MS_PER_DAY;
    if (daysRemaining > 0 && daysRemaining <= COUNTDOWN_DAYS && incompleteTaskMilestoneIds.has(m.id)) {
      alerts.push({ kind: "milestone_countdown", milestoneId: m.id, daysRemaining: Math.ceil(daysRemaining) });
    }
  }
  return alerts;
}

/**
 * PRD §5.3 item 2: two pending proposals asserting different deadlines for
 * the same target — always escalated, unlike the other two alert kinds
 * which are informational. Only milestone_shift and task_update(due_date)
 * carry a date assertion in v1's Extraction union.
 */
export function detectDateConflicts(
  pendingProposals: Array<{ id: string; extractionType: string; payload: string }>,
): Alert[] {
  const byKey = new Map<string, Array<{ proposalId: string; value: string }>>();

  for (const p of pendingProposals) {
    let key: string | null = null;
    let value: string | null = null;
    if (p.extractionType === "milestone_shift") {
      const payload = JSON.parse(p.payload) as { milestone_ref: string; new_date: string };
      key = `milestone:${payload.milestone_ref}:current_date`;
      value = payload.new_date;
    } else if (p.extractionType === "task_update") {
      const payload = JSON.parse(p.payload) as { task_ref: string; patch: { due_date?: string } };
      if (payload.patch.due_date !== undefined) {
        key = `task:${payload.task_ref}:due_date`;
        value = payload.patch.due_date;
      }
    }
    if (key === null || value === null) continue;
    const list = byKey.get(key) ?? [];
    list.push({ proposalId: p.id, value });
    byKey.set(key, list);
  }

  const alerts: Alert[] = [];
  for (const [key, entries] of byKey) {
    const distinctValues = new Set(entries.map((e) => e.value));
    if (distinctValues.size > 1) {
      const parts = key.split(":");
      const targetRef = parts[1] as string;
      const field = parts[2] as "due_date" | "current_date";
      alerts.push({
        kind: "date_conflict",
        targetRef,
        field,
        proposalIds: entries.map((e) => e.proposalId),
        values: entries.map((e) => e.value),
      });
    }
  }
  return alerts;
}

/** PRD §5.3 item 3: every pending high-risk proposal is its own alert. */
export function detectHighRiskAlerts(pendingHighRiskProposals: Array<{ id: string }>): Alert[] {
  return pendingHighRiskProposals.map((p) => ({ kind: "high_risk_proposal", proposalId: p.id }));
}

export function detectAlerts(db: Db, now: Date = new Date()): Alert[] {
  const milestoneRows = db.select({ id: milestones.id, plannedDate: milestones.plannedDate }).from(milestones).all();

  const incompleteTasks = db.select({ milestoneRef: tasks.milestoneRef }).from(tasks).where(ne(tasks.state, "done")).all();
  const incompleteTaskMilestoneIds = new Set(
    incompleteTasks.map((t) => t.milestoneRef).filter((id): id is string => id !== null),
  );

  const pendingProposalRows = db
    .select({
      id: proposals.id,
      extractionType: proposals.extractionType,
      payload: proposals.payload,
      riskClass: proposals.riskClass,
    })
    .from(proposals)
    .where(eq(proposals.state, "pending"))
    .all();

  const pendingHighRisk = pendingProposalRows.filter((p) => p.riskClass === "high");

  return [
    ...detectMilestoneCountdownAlerts(milestoneRows, incompleteTaskMilestoneIds, now),
    ...detectDateConflicts(pendingProposalRows),
    ...detectHighRiskAlerts(pendingHighRisk),
  ];
}
