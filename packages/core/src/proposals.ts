import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  Extraction,
  Proposal,
  ProposalInput,
  type ProposalResolution,
  type RiskClass,
} from "@sitrep/contract";
import type { Db } from "./db/client.js";
import { auditLog, milestones, proposals, tasks } from "./db/schema.js";

type Actor = ProposalResolution["resolved_by"];
type ProposalRow = typeof proposals.$inferSelect;
type EntityKind = "project" | "milestone" | "task";

// --- risk classification ---------------------------------------------------

/**
 * PRD §3.1: milestone_shift, status_change -> "done", and task_update
 * owner-changes are always "high" regardless of agent-reported confidence.
 * v1's Extraction union has no task-deletion variant, so the PRD's "task
 * deletion" high-risk case has no code path to classify yet. risk_flag and
 * decision_log aren't in the PRD table; risk_flag is classified by its own
 * severity (severity "high" -> risk_class "high", feeding the "high-risk
 * proposal enqueued" alert in alerts.ts), decision_log is always "low" since
 * it logs an event and mutates no entity field.
 */
export function classifyRisk(extraction: Extraction): RiskClass {
  switch (extraction.type) {
    case "milestone_shift":
      return "high";
    case "status_change":
      return extraction.payload.state === "done" ? "high" : "low";
    case "task_update":
      return extraction.payload.patch.owner !== undefined ? "high" : "low";
    case "task_create":
      return "low";
    case "risk_flag":
      return extraction.payload.severity === "high" ? "high" : "low";
    case "decision_log":
      return "low";
  }
}

// --- row <-> contract-type mapping ------------------------------------------

function getProposalRow(db: Db, id: string): ProposalRow {
  const row = db.select().from(proposals).where(eq(proposals.id, id)).get();
  if (!row) throw new Error(`Proposal not found: ${id}`);
  return row;
}

function rowToProposal(row: ProposalRow): Proposal {
  const extraction = Extraction.parse({
    type: row.extractionType,
    target_refs: JSON.parse(row.targetRefs),
    payload: JSON.parse(row.payload),
    confidence: row.confidence,
  });
  const resolution: ProposalResolution | null =
    row.resolvedBy && row.resolvedAt
      ? {
          resolved_by: row.resolvedBy as Actor,
          resolved_at: row.resolvedAt,
          edit_diff: row.editDiff ? (JSON.parse(row.editDiff) as Record<string, unknown>) : null,
        }
      : null;
  return Proposal.parse({
    id: row.id,
    source: {
      channel: row.channel,
      raw_text: row.rawText,
      captured_at: row.capturedAt,
    },
    extraction,
    risk_class: row.riskClass,
    state: row.state,
    resolution,
  });
}

// --- audit -------------------------------------------------------------------

function writeAudit(
  db: Db,
  entry: {
    entityKind: EntityKind;
    entityId: string;
    field: string;
    oldValue: unknown;
    newValue: unknown;
    proposalId: string;
    actor: Actor;
    timestamp: string;
  },
): void {
  db.insert(auditLog)
    .values({
      id: randomUUID(),
      entityKind: entry.entityKind,
      entityId: entry.entityId,
      field: entry.field,
      oldValue: entry.oldValue === undefined || entry.oldValue === null ? null : JSON.stringify(entry.oldValue),
      newValue: JSON.stringify(entry.newValue),
      proposalId: entry.proposalId,
      actor: entry.actor,
      timestamp: entry.timestamp,
    })
    .run();
}

function resolveEntityKind(db: Db, id: string): "task" | "milestone" {
  if (db.select({ id: milestones.id }).from(milestones).where(eq(milestones.id, id)).get()) {
    return "milestone";
  }
  if (db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)).get()) {
    return "task";
  }
  throw new Error(`target_ref not found in milestones or tasks: ${id}`);
}

/** A milestone's last_signal_at resets whenever anything happens to it or one of its tasks. */
function stampMilestoneSignal(
  db: Db,
  milestoneRef: string | null,
  proposalId: string,
  actor: Actor,
  now: string,
): void {
  if (!milestoneRef) return;
  const existing = db.select().from(milestones).where(eq(milestones.id, milestoneRef)).get();
  if (!existing) return;
  db.update(milestones).set({ lastSignalAt: now }).where(eq(milestones.id, milestoneRef)).run();
  writeAudit(db, {
    entityKind: "milestone",
    entityId: milestoneRef,
    field: "last_signal_at",
    oldValue: existing.lastSignalAt,
    newValue: now,
    proposalId,
    actor,
    timestamp: now,
  });
}

function stampSignalForTarget(
  db: Db,
  targetKind: "task" | "milestone",
  targetId: string,
  proposalId: string,
  actor: Actor,
  now: string,
): void {
  if (targetKind === "milestone") {
    stampMilestoneSignal(db, targetId, proposalId, actor, now);
    return;
  }
  const task = db.select().from(tasks).where(eq(tasks.id, targetId)).get();
  if (task?.milestoneRef) {
    stampMilestoneSignal(db, task.milestoneRef, proposalId, actor, now);
  }
}

// --- entity mutation (called only from within a commit transaction) ---------

function applyExtraction(
  db: Db,
  extraction: Extraction,
  proposalId: string,
  actor: Actor,
  now: string,
): void {
  switch (extraction.type) {
    case "task_create": {
      const p = extraction.payload;
      const taskId = randomUUID();
      const priority = p.priority ?? "medium";
      db.insert(tasks)
        .values({
          id: taskId,
          title: p.title,
          projectRef: p.project_ref,
          owner: p.owner ?? null,
          dueDate: p.due_date ?? null,
          priority,
          state: "todo",
        })
        .run();
      writeAudit(db, { entityKind: "task", entityId: taskId, field: "title", oldValue: null, newValue: p.title, proposalId, actor, timestamp: now });
      writeAudit(db, { entityKind: "task", entityId: taskId, field: "project_ref", oldValue: null, newValue: p.project_ref, proposalId, actor, timestamp: now });
      writeAudit(db, { entityKind: "task", entityId: taskId, field: "priority", oldValue: null, newValue: priority, proposalId, actor, timestamp: now });
      writeAudit(db, { entityKind: "task", entityId: taskId, field: "state", oldValue: null, newValue: "todo", proposalId, actor, timestamp: now });
      if (p.owner !== undefined) {
        writeAudit(db, { entityKind: "task", entityId: taskId, field: "owner", oldValue: null, newValue: p.owner, proposalId, actor, timestamp: now });
      }
      if (p.due_date !== undefined) {
        writeAudit(db, { entityKind: "task", entityId: taskId, field: "due_date", oldValue: null, newValue: p.due_date, proposalId, actor, timestamp: now });
      }
      break;
    }
    case "task_update": {
      const p = extraction.payload;
      const existing = db.select().from(tasks).where(eq(tasks.id, p.task_ref)).get();
      if (!existing) throw new Error(`task_update: task not found: ${p.task_ref}`);

      if (p.patch.title !== undefined) {
        db.update(tasks).set({ title: p.patch.title }).where(eq(tasks.id, p.task_ref)).run();
        writeAudit(db, { entityKind: "task", entityId: p.task_ref, field: "title", oldValue: existing.title, newValue: p.patch.title, proposalId, actor, timestamp: now });
      }
      if (p.patch.owner !== undefined) {
        db.update(tasks).set({ owner: p.patch.owner }).where(eq(tasks.id, p.task_ref)).run();
        writeAudit(db, { entityKind: "task", entityId: p.task_ref, field: "owner", oldValue: existing.owner, newValue: p.patch.owner, proposalId, actor, timestamp: now });
      }
      if (p.patch.due_date !== undefined) {
        db.update(tasks).set({ dueDate: p.patch.due_date }).where(eq(tasks.id, p.task_ref)).run();
        writeAudit(db, { entityKind: "task", entityId: p.task_ref, field: "due_date", oldValue: existing.dueDate, newValue: p.patch.due_date, proposalId, actor, timestamp: now });
      }
      if (p.patch.priority !== undefined) {
        db.update(tasks).set({ priority: p.patch.priority }).where(eq(tasks.id, p.task_ref)).run();
        writeAudit(db, { entityKind: "task", entityId: p.task_ref, field: "priority", oldValue: existing.priority, newValue: p.patch.priority, proposalId, actor, timestamp: now });
      }
      stampMilestoneSignal(db, existing.milestoneRef, proposalId, actor, now);
      break;
    }
    case "status_change": {
      const p = extraction.payload;
      const existing = db.select().from(tasks).where(eq(tasks.id, p.task_ref)).get();
      if (!existing) throw new Error(`status_change: task not found: ${p.task_ref}`);
      db.update(tasks).set({ state: p.state }).where(eq(tasks.id, p.task_ref)).run();
      writeAudit(db, { entityKind: "task", entityId: p.task_ref, field: "state", oldValue: existing.state, newValue: p.state, proposalId, actor, timestamp: now });
      stampMilestoneSignal(db, existing.milestoneRef, proposalId, actor, now);
      break;
    }
    case "milestone_shift": {
      const p = extraction.payload;
      const existing = db.select().from(milestones).where(eq(milestones.id, p.milestone_ref)).get();
      if (!existing) throw new Error(`milestone_shift: milestone not found: ${p.milestone_ref}`);
      db.update(milestones).set({ currentDate: p.new_date, lastSignalAt: now }).where(eq(milestones.id, p.milestone_ref)).run();
      writeAudit(db, { entityKind: "milestone", entityId: p.milestone_ref, field: "current_date", oldValue: existing.currentDate, newValue: p.new_date, proposalId, actor, timestamp: now });
      writeAudit(db, { entityKind: "milestone", entityId: p.milestone_ref, field: "last_signal_at", oldValue: existing.lastSignalAt, newValue: now, proposalId, actor, timestamp: now });
      break;
    }
    case "risk_flag": {
      // No dedicated risk entity exists in the v0.1 data model (PRD §3.2). A
      // risk flag is logged as an event against its target and treated as a
      // staleness-clock signal for whichever milestone the target belongs to.
      // alerts.ts / digest.ts re-derive "open risk flags" by querying
      // approved risk_flag proposals directly, since v0.1 has no mechanism
      // to close a flagged risk (documented v0.1 gap, not a design decision).
      const p = extraction.payload;
      const targetKind = resolveEntityKind(db, p.target_ref);
      writeAudit(db, {
        entityKind: targetKind,
        entityId: p.target_ref,
        field: "risk_flag",
        oldValue: null,
        newValue: { description: p.description, severity: p.severity ?? null },
        proposalId,
        actor,
        timestamp: now,
      });
      stampSignalForTarget(db, targetKind, p.target_ref, proposalId, actor, now);
      break;
    }
    case "decision_log": {
      const p = extraction.payload;
      const targetKind = resolveEntityKind(db, p.target_ref);
      writeAudit(db, {
        entityKind: targetKind,
        entityId: p.target_ref,
        field: "decision_log",
        oldValue: null,
        newValue: p.decision_text,
        proposalId,
        actor,
        timestamp: now,
      });
      break;
    }
  }
}

// --- public API: the single mutation door ------------------------------------

/** Enqueues a proposal (v0.1: always "pending" — auto-approve ships disabled, PRD §7). */
export function createProposal(db: Db, input: ProposalInput): Proposal {
  const parsed = ProposalInput.parse(input);
  const id = randomUUID();
  const riskClass = classifyRisk(parsed.extraction);
  db.insert(proposals)
    .values({
      id,
      channel: parsed.source.channel,
      rawText: parsed.source.raw_text,
      capturedAt: parsed.source.captured_at,
      extractionType: parsed.extraction.type,
      targetRefs: JSON.stringify(parsed.extraction.target_refs),
      payload: JSON.stringify(parsed.extraction.payload),
      confidence: parsed.extraction.confidence,
      riskClass,
      state: "pending",
    })
    .run();
  return rowToProposal(getProposalRow(db, id));
}

function commitProposalTx(db: Db, proposalId: string, resolvedBy: Actor, now: string): Proposal {
  const row = getProposalRow(db, proposalId);
  if (row.state !== "pending") {
    throw new Error(`commitProposal: proposal ${proposalId} is not pending (state=${row.state})`);
  }
  const proposal = rowToProposal(row);
  applyExtraction(db, proposal.extraction, proposalId, resolvedBy, now);
  db.update(proposals).set({ state: "approved", resolvedBy, resolvedAt: now }).where(eq(proposals.id, proposalId)).run();
  return rowToProposal(getProposalRow(db, proposalId));
}

/** Approves a pending proposal: applies its payload to entities and writes audit rows, in one transaction. */
export function commitProposal(
  db: Db,
  proposalId: string,
  resolvedBy: Actor,
  now: string = new Date().toISOString(),
): Proposal {
  return db.transaction((tx) => commitProposalTx(tx, proposalId, resolvedBy, now));
}

/** Rejects a pending proposal. No entity mutation, no audit rows — only the proposal's own state changes. */
export function rejectProposal(
  db: Db,
  proposalId: string,
  resolvedBy: Actor,
  now: string = new Date().toISOString(),
): Proposal {
  return db.transaction((tx) => {
    const row = getProposalRow(tx, proposalId);
    if (row.state !== "pending") {
      throw new Error(`rejectProposal: proposal ${proposalId} is not pending (state=${row.state})`);
    }
    tx.update(proposals).set({ state: "rejected", resolvedBy, resolvedAt: now }).where(eq(proposals.id, proposalId)).run();
    return rowToProposal(getProposalRow(tx, proposalId));
  });
}

function editAndApproveTx(
  db: Db,
  proposalId: string,
  edit: Record<string, unknown>,
  resolvedBy: Actor,
  now: string,
): Proposal {
  const row = getProposalRow(db, proposalId);
  if (row.state !== "pending") {
    throw new Error(`editAndApprove: proposal ${proposalId} is not pending (state=${row.state})`);
  }
  const original = rowToProposal(row);
  const editedPayload = { ...(original.extraction.payload as Record<string, unknown>), ...edit };
  const editedExtraction = Extraction.parse({
    type: original.extraction.type,
    target_refs: original.extraction.target_refs,
    payload: editedPayload,
    confidence: original.extraction.confidence,
  });
  applyExtraction(db, editedExtraction, proposalId, resolvedBy, now);
  db.update(proposals)
    .set({
      state: "edited_and_approved",
      resolvedBy,
      resolvedAt: now,
      editDiff: JSON.stringify(edit),
      payload: JSON.stringify(editedPayload),
    })
    .where(eq(proposals.id, proposalId))
    .run();
  return rowToProposal(getProposalRow(db, proposalId));
}

/**
 * Approves a pending proposal after merging `edit` into its extraction payload.
 * `edit` is stored verbatim as `resolution.edit_diff` — the audit chain keeps
 * both the agent's original payload (via the pre-edit raw_text/confidence)
 * and the human's override.
 */
export function editAndApprove(
  db: Db,
  proposalId: string,
  edit: Record<string, unknown>,
  resolvedBy: Actor,
  now: string = new Date().toISOString(),
): Proposal {
  return db.transaction((tx) => editAndApproveTx(tx, proposalId, edit, resolvedBy, now));
}

/**
 * Records a manual UI edit as a user-authored proposal and commits it
 * immediately (PRD §3.2: "manual edits are themselves logged as user-authored
 * proposals, keeping the audit chain unbroken"). v1's ProposalChannel enum
 * has no dedicated "manual UI edit" value, so this uses "scheduled_review" —
 * the closest existing channel semantically (a human-initiated review
 * action, not an inbox capture or agent-sourced change).
 */
export function manualEdit(
  db: Db,
  extraction: Extraction,
  actorNote: string,
  now: string = new Date().toISOString(),
): Proposal {
  return db.transaction((tx) => {
    const proposal = createProposal(tx, {
      source: {
        channel: "scheduled_review",
        raw_text: actorNote,
        captured_at: now,
      },
      extraction,
    });
    return commitProposalTx(tx, proposal.id, "user", now);
  });
}
