import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { computeRagStatus, getMilestoneRagStatus } from "./rag.js";
import { commitProposal, createProposal } from "./proposals.js";
import { tasks } from "./db/schema.js";
import { riskFlagInput, seedProjectAndMilestone, setupDb, taskCreateInput } from "./test-fixtures.js";

describe("computeRagStatus (pure)", () => {
  const base = {
    plannedDate: "2099-06-01",
    currentDate: "2099-06-01",
    lastSignalAt: "2099-05-25T00:00:00.000Z",
    hasOverdueBlockingTask: false,
    openRiskFlagCount: 0,
    now: new Date("2099-05-26T00:00:00.000Z"),
  };

  it("green when nothing is wrong", () => {
    expect(computeRagStatus(base)).toBe("green");
  });

  it("red when the milestone slipped past its planned date", () => {
    expect(computeRagStatus({ ...base, currentDate: "2099-06-02" })).toBe("red");
  });

  it("red when a blocking task is overdue, even if not slipped", () => {
    expect(computeRagStatus({ ...base, hasOverdueBlockingTask: true })).toBe("red");
  });

  it("amber when last_signal_at is stale (>14 days)", () => {
    expect(computeRagStatus({ ...base, now: new Date("2099-06-10T00:00:00.000Z") })).toBe("amber");
  });

  it("amber when there is an open risk flag", () => {
    expect(computeRagStatus({ ...base, openRiskFlagCount: 1 })).toBe("amber");
  });

  it("red takes priority over amber conditions", () => {
    expect(computeRagStatus({ ...base, currentDate: "2099-06-02", openRiskFlagCount: 1 })).toBe("red");
  });
});

describe("getMilestoneRagStatus (DB-backed)", () => {
  it("is green for a freshly created milestone with no tasks", () => {
    const db = setupDb();
    const { milestoneId } = seedProjectAndMilestone(db, "2099-06-01");
    expect(getMilestoneRagStatus(db, milestoneId, new Date("2099-01-05"))).toBe("green");
  });

  it("is red when an incomplete task under the milestone is overdue", () => {
    const db = setupDb();
    const { projectId, milestoneId } = seedProjectAndMilestone(db, "2099-06-01");
    const proposal = createProposal(db, taskCreateInput({ projectRef: projectId, dueDate: "2099-01-01" }));
    commitProposal(db, proposal.id, "user");
    const task = db.select().from(tasks).where(eq(tasks.projectRef, projectId)).get()!;
    db.update(tasks).set({ milestoneRef: milestoneId }).where(eq(tasks.id, task.id)).run();

    expect(getMilestoneRagStatus(db, milestoneId, new Date("2099-02-01"))).toBe("red");
  });

  it("is amber when an approved risk_flag targets the milestone", () => {
    const db = setupDb();
    const { milestoneId } = seedProjectAndMilestone(db, "2099-06-01");
    const proposal = createProposal(db, riskFlagInput({ targetRef: milestoneId }));
    commitProposal(db, proposal.id, "user", "2099-05-30T00:00:00.000Z");

    expect(getMilestoneRagStatus(db, milestoneId, new Date("2099-05-31"))).toBe("amber");
  });
});
