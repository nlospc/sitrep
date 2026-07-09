import { describe, expect, it } from "vitest";
import { detectAlerts, detectDateConflicts, detectHighRiskAlerts, detectMilestoneCountdownAlerts } from "./alerts.js";
import { createProposal } from "./proposals.js";
import { milestoneShiftInput, seedProjectAndMilestone, setupDb } from "./test-fixtures.js";

describe("detectMilestoneCountdownAlerts (pure)", () => {
  it("fires when a milestone is within 7 days and has an incomplete task", () => {
    const now = new Date("2099-01-01T00:00:00.000Z");
    const alerts = detectMilestoneCountdownAlerts([{ id: "m1", plannedDate: "2099-01-05" }], new Set(["m1"]), now);
    expect(alerts).toEqual([{ kind: "milestone_countdown", milestoneId: "m1", daysRemaining: 4 }]);
  });

  it("does not fire when there is no incomplete task", () => {
    const now = new Date("2099-01-01T00:00:00.000Z");
    expect(detectMilestoneCountdownAlerts([{ id: "m1", plannedDate: "2099-01-05" }], new Set(), now)).toEqual([]);
  });

  it("does not fire once the planned date has already passed", () => {
    const now = new Date("2099-01-10T00:00:00.000Z");
    expect(detectMilestoneCountdownAlerts([{ id: "m1", plannedDate: "2099-01-05" }], new Set(["m1"]), now)).toEqual([]);
  });
});

describe("detectDateConflicts (pure)", () => {
  it("flags two pending proposals asserting different milestone dates", () => {
    const alerts = detectDateConflicts([
      { id: "p1", extractionType: "milestone_shift", payload: JSON.stringify({ milestone_ref: "m1", new_date: "2099-02-01" }) },
      { id: "p2", extractionType: "milestone_shift", payload: JSON.stringify({ milestone_ref: "m1", new_date: "2099-03-01" }) },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "date_conflict", targetRef: "m1", field: "current_date" });
  });

  it("does not flag when both proposals agree on the date", () => {
    const alerts = detectDateConflicts([
      { id: "p1", extractionType: "milestone_shift", payload: JSON.stringify({ milestone_ref: "m1", new_date: "2099-02-01" }) },
      { id: "p2", extractionType: "milestone_shift", payload: JSON.stringify({ milestone_ref: "m1", new_date: "2099-02-01" }) },
    ]);
    expect(alerts).toEqual([]);
  });

  it("does not flag conflicts across different targets", () => {
    const alerts = detectDateConflicts([
      { id: "p1", extractionType: "milestone_shift", payload: JSON.stringify({ milestone_ref: "m1", new_date: "2099-02-01" }) },
      { id: "p2", extractionType: "milestone_shift", payload: JSON.stringify({ milestone_ref: "m2", new_date: "2099-03-01" }) },
    ]);
    expect(alerts).toEqual([]);
  });
});

describe("detectHighRiskAlerts (pure)", () => {
  it("emits one alert per pending high-risk proposal", () => {
    expect(detectHighRiskAlerts([{ id: "p1" }, { id: "p2" }])).toEqual([
      { kind: "high_risk_proposal", proposalId: "p1" },
      { kind: "high_risk_proposal", proposalId: "p2" },
    ]);
  });
});

describe("detectAlerts (DB-backed)", () => {
  it("surfaces a pending high-risk proposal end to end", () => {
    const db = setupDb();
    const { milestoneId } = seedProjectAndMilestone(db, "2099-06-01");
    const proposal = createProposal(db, milestoneShiftInput({ milestoneRef: milestoneId, newDate: "2099-07-01" }));

    const alerts = detectAlerts(db, new Date("2099-01-01"));
    expect(alerts).toContainEqual({ kind: "high_risk_proposal", proposalId: proposal.id });
  });
});
