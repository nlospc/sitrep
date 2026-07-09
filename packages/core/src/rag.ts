import { and, eq, inArray, lt, ne } from "drizzle-orm";
import type { RagStatus } from "@sitrep/contract";
import type { Db } from "./db/client.js";
import { milestones, proposals, tasks } from "./db/schema.js";

const STALE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export interface RagInputs {
  plannedDate: string; // YYYY-MM-DD
  currentDate: string; // YYYY-MM-DD
  lastSignalAt: string; // ISO datetime
  hasOverdueBlockingTask: boolean;
  openRiskFlagCount: number;
  now: Date;
}

/**
 * PRD §5.1 v1 heuristic, pure over pre-gathered inputs:
 *   Red:   milestone slipped past planned_date, or a blocking task is overdue
 *   Amber: last_signal_at stale > 14 days, or >=1 open risk flag
 *   Green: otherwise
 */
export function computeRagStatus(input: RagInputs): RagStatus {
  const slipped = input.currentDate > input.plannedDate;
  if (slipped || input.hasOverdueBlockingTask) return "red";

  const daysSinceSignal = (input.now.getTime() - new Date(input.lastSignalAt).getTime()) / MS_PER_DAY;
  if (daysSinceSignal > STALE_DAYS || input.openRiskFlagCount > 0) return "amber";

  return "green";
}

/**
 * v1's Task has no predecessor/blocks field (no dependency graph), so "blocking
 * task overdue" is approximated as: any incomplete task under this milestone
 * whose due_date has passed. Documented simplification, not a hidden bug.
 */
export function getMilestoneRagStatus(db: Db, milestoneId: string, now: Date = new Date()): RagStatus {
  const milestone = db.select().from(milestones).where(eq(milestones.id, milestoneId)).get();
  if (!milestone) throw new Error(`Milestone not found: ${milestoneId}`);

  const today = now.toISOString().slice(0, 10);
  const overdueTasks = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.milestoneRef, milestoneId), ne(tasks.state, "done"), lt(tasks.dueDate, today)))
    .all();

  return computeRagStatus({
    plannedDate: milestone.plannedDate,
    currentDate: milestone.currentDate,
    lastSignalAt: milestone.lastSignalAt,
    hasOverdueBlockingTask: overdueTasks.length > 0,
    openRiskFlagCount: countOpenRiskFlags(db, milestoneId),
    now,
  });
}

/**
 * v0.1 has no mechanism to close a flagged risk (see proposals.ts risk_flag
 * comment), so "open" here means "ever approved" — every approved risk_flag
 * proposal targeting this milestone or one of its tasks counts.
 */
function countOpenRiskFlags(db: Db, milestoneId: string): number {
  const riskFlagProposals = db
    .select({ payload: proposals.payload })
    .from(proposals)
    .where(
      and(eq(proposals.extractionType, "risk_flag"), inArray(proposals.state, ["approved", "edited_and_approved"])),
    )
    .all();

  const milestoneTaskIds = new Set(
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.milestoneRef, milestoneId))
      .all()
      .map((t) => t.id),
  );

  let count = 0;
  for (const row of riskFlagProposals) {
    const payload = JSON.parse(row.payload) as { target_ref: string };
    if (payload.target_ref === milestoneId || milestoneTaskIds.has(payload.target_ref)) {
      count += 1;
    }
  }
  return count;
}
