import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assembleDigest } from "./digest.js";
import { commitProposal, createProposal } from "./proposals.js";
import { tasks } from "./db/schema.js";
import { riskFlagInput, seedProjectAndMilestone, setupDb, taskCreateInput } from "./test-fixtures.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("assembleDigest", () => {
  it("collects overnight changes, due-today tasks, pending count, and new risk flags", () => {
    const db = setupDb();
    const { projectId, milestoneId } = seedProjectAndMilestone(db, "2099-06-01");
    const since = new Date("2099-01-01T00:00:00.000Z");

    // an overnight (approved, after `since`) change, due today
    const created = createProposal(db, taskCreateInput({ projectRef: projectId, title: "Due today", dueDate: today() }));
    commitProposal(db, created.id, "user", "2099-01-02T00:00:00.000Z");
    const dueTask = db.select().from(tasks).where(eq(tasks.title, "Due today")).get()!;

    // a pending proposal — counts toward pending_proposal_count, not overnight_changes
    createProposal(db, taskCreateInput({ projectRef: projectId, title: "Still pending" }));

    // a new risk flag resolved after `since`
    const riskProposal = createProposal(db, riskFlagInput({ targetRef: milestoneId, description: "Vendor delay", severity: "high" }));
    commitProposal(db, riskProposal.id, "user", "2099-01-03T00:00:00.000Z");

    const digest = assembleDigest(db, { since });

    expect(digest.overnight_changes.some((c) => c.proposal_id === created.id)).toBe(true);
    expect(digest.tasks_due_today).toContain(dueTask.id);
    expect(digest.pending_proposal_count).toBe(1);
    expect(digest.new_risk_flags).toEqual([{ target_ref: milestoneId, description: "Vendor delay", severity: "high" }]);
  });

  it("excludes changes and risk flags resolved before `since`", () => {
    const db = setupDb();
    const { projectId } = seedProjectAndMilestone(db, "2099-06-01");
    const proposal = createProposal(db, taskCreateInput({ projectRef: projectId, title: "Old news" }));
    commitProposal(db, proposal.id, "user", "2099-01-01T00:00:00.000Z");

    const digest = assembleDigest(db, { since: new Date("2099-01-02T00:00:00.000Z") });
    expect(digest.overnight_changes).toEqual([]);
  });

  it("scopes pending_proposal_count to a single project when project_ref is given", () => {
    const db = setupDb();
    const { projectId: projectA } = seedProjectAndMilestone(db);
    const { projectId: projectB } = seedProjectAndMilestone(db);
    createProposal(db, taskCreateInput({ projectRef: projectA }));
    createProposal(db, taskCreateInput({ projectRef: projectB }));

    const digest = assembleDigest(db, { since: new Date("2099-01-01"), projectRef: projectA });
    expect(digest.pending_proposal_count).toBe(1);
  });
});
