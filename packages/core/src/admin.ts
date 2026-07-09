import { randomUUID } from "node:crypto";
import type { Db } from "./db/client.js";
import { milestones, projects } from "./db/schema.js";

/**
 * Project/milestone creation has no Extraction variant in the v1 contract
 * (only task_create/task_update/status_change/milestone_shift/risk_flag/
 * decision_log exist — see packages/contract/src/proposal.ts) because
 * projects and milestones are structural setup, not agent-extracted
 * signals. These are the only entity writes in this package that do not go
 * through the proposal audit door: there is no prior state to attribute a
 * creation to. Every subsequent mutation (e.g. a milestone_shift proposal)
 * still goes through commitProposal like everything else.
 */
export function bootstrapProject(db: Db, name: string, now: string = new Date().toISOString()): { id: string } {
  const id = randomUUID();
  db.insert(projects).values({ id, name, createdAt: now }).run();
  return { id };
}

export function bootstrapMilestone(
  db: Db,
  input: { projectRef: string; name: string; plannedDate: string },
  now: string = new Date().toISOString(),
): { id: string } {
  const id = randomUUID();
  db.insert(milestones)
    .values({
      id,
      projectRef: input.projectRef,
      name: input.name,
      plannedDate: input.plannedDate,
      currentDate: input.plannedDate,
      lastSignalAt: now,
    })
    .run();
  return { id };
}
