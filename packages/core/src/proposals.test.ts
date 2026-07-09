import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  classifyRisk,
  commitProposal,
  createProposal,
  editAndApprove,
  manualEdit,
  rejectProposal,
} from "./proposals.js";
import { auditLog, milestones, proposals, tasks } from "./db/schema.js";
import {
  decisionLogInput,
  milestoneShiftInput,
  riskFlagInput,
  seedProjectAndMilestone,
  setupDb,
  taskCreateInput,
  taskUpdateInput,
} from "./test-fixtures.js";

describe("classifyRisk", () => {
  it("task_create is always low", () => {
    expect(classifyRisk({ type: "task_create", target_refs: [], confidence: 1, payload: { title: "x", project_ref: "p" } })).toBe(
      "low",
    );
  });

  it("task_update is high only when the patch changes owner", () => {
    expect(
      classifyRisk({ type: "task_update", target_refs: [], confidence: 1, payload: { task_ref: "t", patch: { owner: "alice" } } }),
    ).toBe("high");
    expect(
      classifyRisk({ type: "task_update", target_refs: [], confidence: 1, payload: { task_ref: "t", patch: { title: "new" } } }),
    ).toBe("low");
  });

  it("status_change is high only for -> done", () => {
    expect(classifyRisk({ type: "status_change", target_refs: [], confidence: 1, payload: { task_ref: "t", state: "done" } })).toBe(
      "high",
    );
    expect(
      classifyRisk({ type: "status_change", target_refs: [], confidence: 1, payload: { task_ref: "t", state: "in_progress" } }),
    ).toBe("low");
  });

  it("milestone_shift is always high", () => {
    expect(
      classifyRisk({
        type: "milestone_shift",
        target_refs: [],
        confidence: 1,
        payload: { milestone_ref: "m", new_date: "2099-01-01" },
      }),
    ).toBe("high");
  });

  it("risk_flag is high only when severity is high", () => {
    expect(
      classifyRisk({
        type: "risk_flag",
        target_refs: [],
        confidence: 1,
        payload: { target_ref: "t", description: "d", severity: "high" },
      }),
    ).toBe("high");
    expect(
      classifyRisk({
        type: "risk_flag",
        target_refs: [],
        confidence: 1,
        payload: { target_ref: "t", description: "d", severity: "low" },
      }),
    ).toBe("low");
  });

  it("decision_log is always low", () => {
    expect(
      classifyRisk({ type: "decision_log", target_refs: [], confidence: 1, payload: { target_ref: "t", decision_text: "d" } }),
    ).toBe("low");
  });
});

describe("createProposal", () => {
  it("always starts pending (v0.1 auto-approve disabled)", () => {
    const db = setupDb();
    const { projectId } = seedProjectAndMilestone(db);
    const proposal = createProposal(db, taskCreateInput({ projectRef: projectId }));
    expect(proposal.state).toBe("pending");
    expect(proposal.resolution).toBeNull();
  });

  it("classifies risk on insert", () => {
    const db = setupDb();
    const { milestoneId } = seedProjectAndMilestone(db);
    const proposal = createProposal(db, milestoneShiftInput({ milestoneRef: milestoneId, newDate: "2099-06-01" }));
    expect(proposal.risk_class).toBe("high");
  });
});

describe("commitProposal — audit invariant", () => {
  it("task_create: entity fields are all traceable to the committing proposal", () => {
    const db = setupDb();
    const { projectId } = seedProjectAndMilestone(db);
    const proposal = createProposal(db, taskCreateInput({ projectRef: projectId, title: "Ship it", owner: "alice", dueDate: "2099-01-15" }));
    const committed = commitProposal(db, proposal.id, "user");

    expect(committed.state).toBe("approved");
    expect(committed.resolution?.resolved_by).toBe("user");

    const task = db.select().from(tasks).where(eq(tasks.projectRef, projectId)).get();
    expect(task).toBeDefined();
    expect(task?.title).toBe("Ship it");
    expect(task?.owner).toBe("alice");

    const rows = db.select().from(auditLog).where(eq(auditLog.entityId, task!.id)).all();
    const fields = new Set(rows.map((r) => r.field));
    expect(fields).toEqual(new Set(["title", "project_ref", "priority", "state", "owner", "due_date"]));
    for (const row of rows) {
      expect(row.proposalId).toBe(proposal.id);
      const proposalRow = db.select().from(proposals).where(eq(proposals.id, row.proposalId)).get();
      expect(proposalRow).toBeDefined();
      // every audited field's new_value matches the field's current value on the entity
      const currentValue = (task as unknown as Record<string, unknown>)[toCamel(row.field)];
      expect(JSON.parse(row.newValue)).toEqual(currentValue);
    }
  });

  it("task_update: writes old/new audit rows and stamps the parent milestone's last_signal_at", () => {
    const db = setupDb();
    const { projectId, milestoneId } = seedProjectAndMilestone(db);
    const created = commitProposal(db, createProposal(db, taskCreateInput({ projectRef: projectId, title: "Original" })).id, "user");
    const taskId = (db.select().from(tasks).where(eq(tasks.projectRef, projectId)).get() as { id: string }).id;
    // manually attach task to the milestone to exercise the stamp path
    db.update(tasks).set({ milestoneRef: milestoneId }).where(eq(tasks.id, taskId)).run();
    const before = db.select().from(milestones).where(eq(milestones.id, milestoneId)).get()!;

    const updateProposal = createProposal(db, taskUpdateInput({ taskRef: taskId, title: "Updated title" }));
    commitProposal(db, updateProposal.id, "user", "2099-01-02T00:00:00.000Z");

    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    expect(task?.title).toBe("Updated title");

    const auditRow = db
      .select()
      .from(auditLog)
      .where(eq(auditLog.proposalId, updateProposal.id))
      .all()
      .find((r) => r.field === "title");
    expect(auditRow?.oldValue).toBe(JSON.stringify("Original"));
    expect(auditRow?.newValue).toBe(JSON.stringify("Updated title"));

    const after = db.select().from(milestones).where(eq(milestones.id, milestoneId)).get()!;
    expect(after.lastSignalAt).not.toBe(before.lastSignalAt);
    void created;
  });

  it("milestone_shift updates current_date and last_signal_at with audit rows", () => {
    const db = setupDb();
    const { milestoneId } = seedProjectAndMilestone(db, "2099-03-01");
    const proposal = createProposal(db, milestoneShiftInput({ milestoneRef: milestoneId, newDate: "2099-04-01" }));
    commitProposal(db, proposal.id, "user");

    const milestone = db.select().from(milestones).where(eq(milestones.id, milestoneId)).get();
    expect(milestone?.currentDate).toBe("2099-04-01");

    const rows = db.select().from(auditLog).where(eq(auditLog.proposalId, proposal.id)).all();
    const fields = new Set(rows.map((r) => r.field));
    expect(fields).toEqual(new Set(["current_date", "last_signal_at"]));
  });

  it("risk_flag logs an event and stamps the target's signal clock, with no dedicated entity mutation", () => {
    const db = setupDb();
    const { milestoneId } = seedProjectAndMilestone(db);
    const before = db.select().from(milestones).where(eq(milestones.id, milestoneId)).get()!;
    const proposal = createProposal(db, riskFlagInput({ targetRef: milestoneId, severity: "high" }));
    commitProposal(db, proposal.id, "user", "2099-01-02T00:00:00.000Z");

    const after = db.select().from(milestones).where(eq(milestones.id, milestoneId)).get()!;
    expect(after.lastSignalAt).toBe("2099-01-02T00:00:00.000Z");
    expect(after.lastSignalAt).not.toBe(before.lastSignalAt);

    const rows = db.select().from(auditLog).where(eq(auditLog.proposalId, proposal.id)).all();
    expect(rows.some((r) => r.field === "risk_flag")).toBe(true);
  });

  it("decision_log logs an event without mutating an entity field", () => {
    const db = setupDb();
    const { milestoneId } = seedProjectAndMilestone(db);
    const proposal = createProposal(db, decisionLogInput({ targetRef: milestoneId }));
    const committed = commitProposal(db, proposal.id, "user");
    expect(committed.state).toBe("approved");
    const rows = db.select().from(auditLog).where(eq(auditLog.proposalId, proposal.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.field).toBe("decision_log");
  });

  it("throws when committing a non-pending proposal", () => {
    const db = setupDb();
    const { projectId } = seedProjectAndMilestone(db);
    const proposal = createProposal(db, taskCreateInput({ projectRef: projectId }));
    commitProposal(db, proposal.id, "user");
    expect(() => commitProposal(db, proposal.id, "user")).toThrow();
  });
});

describe("rejectProposal", () => {
  it("changes only the proposal's own state — no entity mutation, no audit rows", () => {
    const db = setupDb();
    const { projectId } = seedProjectAndMilestone(db);
    const proposal = createProposal(db, taskCreateInput({ projectRef: projectId }));
    const rejected = rejectProposal(db, proposal.id, "user");

    expect(rejected.state).toBe("rejected");
    expect(db.select().from(tasks).all()).toHaveLength(0);
    expect(db.select().from(auditLog).all()).toHaveLength(0);
  });
});

describe("editAndApprove", () => {
  it("commits the edited payload, not the original, and records edit_diff", () => {
    const db = setupDb();
    const { projectId } = seedProjectAndMilestone(db);
    const proposal = createProposal(db, taskCreateInput({ projectRef: projectId, title: "Agent's title" }));
    const edited = editAndApprove(db, proposal.id, { title: "Human's title" }, "user");

    expect(edited.state).toBe("edited_and_approved");
    expect(edited.resolution?.edit_diff).toEqual({ title: "Human's title" });

    const task = db.select().from(tasks).where(eq(tasks.projectRef, projectId)).get();
    expect(task?.title).toBe("Human's title");

    const titleAudit = db.select().from(auditLog).where(eq(auditLog.proposalId, proposal.id)).all().find((r) => r.field === "title");
    expect(JSON.parse(titleAudit!.newValue)).toBe("Human's title");
  });
});

describe("manualEdit", () => {
  it("logs the manual change as a user-authored, already-approved proposal", () => {
    const db = setupDb();
    const { projectId } = seedProjectAndMilestone(db);
    const seedProposal = createProposal(db, taskCreateInput({ projectRef: projectId, title: "Original" }));
    commitProposal(db, seedProposal.id, "user");
    const taskId = (db.select().from(tasks).where(eq(tasks.projectRef, projectId)).get() as { id: string }).id;

    const manual = manualEdit(
      db,
      { type: "task_update", target_refs: [taskId], confidence: 1, payload: { task_ref: taskId, patch: { title: "Manually fixed" } } },
      "Corrected typo in the Gantt cell",
    );

    expect(manual.state).toBe("approved");
    expect(manual.source.channel).toBe("scheduled_review");
    expect(manual.resolution?.resolved_by).toBe("user");

    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    expect(task?.title).toBe("Manually fixed");

    const rows = db.select().from(auditLog).where(eq(auditLog.proposalId, manual.id)).all();
    expect(rows.some((r) => r.field === "title" && r.actor === "user")).toBe(true);
  });
});

function toCamel(field: string): string {
  return field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
