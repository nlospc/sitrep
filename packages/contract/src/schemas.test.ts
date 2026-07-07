import { describe, expect, it } from "vitest";
import {
  Project,
  Milestone,
  Task,
  EntityRef,
  Proposal,
  ProposalInput,
  Job,
  JobResult,
  DigestData,
  FetchWorkInput,
  FetchWorkOutput,
  SubmitProposalInput,
  SubmitProposalOutput,
  ListEntitiesOutput,
  ReadStateOutput,
  ResolveProposalInput,
  ResolveProposalOutput,
} from "./index.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MILESTONE_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const PROPOSAL_ID = "44444444-4444-4444-8444-444444444444";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-07-06T12:00:00.000Z";
const TODAY = "2026-07-06";

describe("entity schemas", () => {
  it("round-trips a Project", () => {
    const project = { id: PROJECT_ID, name: "Sitrep", created_at: NOW };
    expect(Project.parse(project)).toEqual(project);
  });

  it("round-trips a Milestone without a stored rag_status", () => {
    const milestone = {
      id: MILESTONE_ID,
      project_ref: PROJECT_ID,
      name: "v0.1 closed loop",
      planned_date: TODAY,
      current_date: TODAY,
      last_signal_at: NOW,
    };
    expect(Milestone.parse(milestone)).toEqual(milestone);
    expect("rag_status" in milestone).toBe(false);
  });

  it("round-trips a Task with its provenance chain", () => {
    const task = {
      id: TASK_ID,
      title: "Write contract README",
      project_ref: PROJECT_ID,
      milestone_ref: MILESTONE_ID,
      owner: "bordzz",
      due_date: TODAY,
      priority: "high" as const,
      state: "done" as const,
      provenance: [PROPOSAL_ID],
    };
    expect(Task.parse(task)).toEqual(task);
  });

  it("round-trips an EntityRef", () => {
    const ref = { id: TASK_ID, kind: "task" as const, label: "Write contract README" };
    expect(EntityRef.parse(ref)).toEqual(ref);
  });
});

describe("proposal schema", () => {
  it("round-trips a low-risk task_create ProposalInput", () => {
    const input = {
      source: {
        channel: "inbox" as const,
        raw_text: "add a task to write the contract readme",
        captured_at: NOW,
      },
      extraction: {
        type: "task_create" as const,
        target_refs: [PROJECT_ID],
        payload: { title: "Write contract README", project_ref: PROJECT_ID },
        confidence: 0.92,
      },
    };
    expect(ProposalInput.parse(input)).toEqual(input);
  });

  it("round-trips a full persisted Proposal with a null resolution", () => {
    const proposal = {
      id: PROPOSAL_ID,
      source: {
        channel: "external" as const,
        raw_text: "milestone slipped to next friday",
        captured_at: NOW,
      },
      extraction: {
        type: "milestone_shift" as const,
        target_refs: [MILESTONE_ID],
        payload: { milestone_ref: MILESTONE_ID, new_date: "2026-07-17" },
        confidence: 0.71,
      },
      risk_class: "high" as const,
      state: "pending" as const,
      resolution: null,
    };
    expect(Proposal.parse(proposal)).toEqual(proposal);
  });

  it("rejects an extraction payload that doesn't match its declared type", () => {
    const bad = {
      source: { channel: "inbox", raw_text: "x", captured_at: NOW },
      extraction: {
        type: "task_create",
        target_refs: [],
        payload: { milestone_ref: MILESTONE_ID, new_date: TODAY }, // wrong shape
        confidence: 0.5,
      },
    };
    expect(() => ProposalInput.parse(bad)).toThrow();
  });
});

describe("job (outbox) schema", () => {
  it("round-trips an extract Job", () => {
    const job = {
      id: JOB_ID,
      enqueued_at: NOW,
      kind: "extract" as const,
      payload: {
        capture_id: PROJECT_ID,
        raw_text: "note from standup",
        mentioned_refs: [],
        is_batch: false,
        captured_at: NOW,
      },
    };
    expect(Job.parse(job)).toEqual(job);
  });

  it("round-trips a report_request Job carrying Sitrep-computed digest data", () => {
    const digestData = {
      overnight_changes: [
        {
          entity_ref: TASK_ID,
          entity_kind: "task" as const,
          summary: "moved to in_progress",
          proposal_id: PROPOSAL_ID,
        },
      ],
      tasks_due_today: [TASK_ID],
      pending_proposal_count: 2,
      new_risk_flags: [{ target_ref: MILESTONE_ID, description: "vendor slip" }],
    };
    expect(DigestData.parse(digestData)).toEqual(digestData);

    const job = {
      id: JOB_ID,
      enqueued_at: NOW,
      kind: "report_request" as const,
      payload: {
        kind: "morning_digest" as const,
        scope: { project_ref: PROJECT_ID },
        data: digestData,
      },
    };
    expect(Job.parse(job)).toEqual(job);
  });

  it("accepts timestamps with a non-Z timezone offset", () => {
    const job = {
      id: JOB_ID,
      enqueued_at: "2026-07-06T21:00:00.000+09:00",
      kind: "extract" as const,
      payload: {
        capture_id: PROJECT_ID,
        raw_text: "note from standup",
        mentioned_refs: [],
        is_batch: false,
        captured_at: "2026-07-06T21:00:00.000+09:00",
      },
    };
    expect(Job.parse(job)).toEqual(job);
  });

  it("round-trips a JobResult for each kind", () => {
    const extractResult = { kind: "extract" as const, result: { proposal_ids: [PROPOSAL_ID] } };
    const reportResult = { kind: "report_request" as const, result: { text: "all green" } };
    const notifyResult = { kind: "notification" as const, result: { delivered: true } };
    expect(JobResult.parse(extractResult)).toEqual(extractResult);
    expect(JobResult.parse(reportResult)).toEqual(reportResult);
    expect(JobResult.parse(notifyResult)).toEqual(notifyResult);
  });
});

describe("tool I/O schemas (contract v1 six-tool surface)", () => {
  it("validates fetch_work input/output", () => {
    expect(FetchWorkInput.parse({ kinds: ["extract"], limit: 10 })).toEqual({
      kinds: ["extract"],
      limit: 10,
    });
    expect(FetchWorkInput.parse({})).toEqual({});
    expect(FetchWorkOutput.parse({ jobs: [] })).toEqual({ jobs: [] });
  });

  it("validates submit_proposal input/output", () => {
    const input = {
      proposal: {
        source: { channel: "inbox" as const, raw_text: "x", captured_at: NOW },
        extraction: {
          type: "decision_log" as const,
          target_refs: [PROJECT_ID],
          payload: { target_ref: PROJECT_ID, decision_text: "use SQLite" },
          confidence: 0.99,
        },
      },
    };
    expect(SubmitProposalInput.parse(input)).toEqual(input);
    expect(SubmitProposalOutput.parse({ proposal_id: PROPOSAL_ID, state: "pending" })).toEqual({
      proposal_id: PROPOSAL_ID,
      state: "pending",
    });
  });

  it("validates list_entities and read_state outputs", () => {
    expect(
      ListEntitiesOutput.parse({ entities: [{ id: TASK_ID, kind: "task", label: "t" }] }),
    ).toBeTruthy();
    expect(ReadStateOutput.parse({ projects: [], milestones: [], tasks: [] })).toEqual({
      projects: [],
      milestones: [],
      tasks: [],
    });
  });

  it("validates resolve_proposal input/output for all three actions", () => {
    expect(ResolveProposalInput.parse({ id: PROPOSAL_ID, action: "approve" })).toBeTruthy();
    expect(ResolveProposalInput.parse({ id: PROPOSAL_ID, action: "reject" })).toBeTruthy();
    expect(
      ResolveProposalInput.parse({ id: PROPOSAL_ID, action: { edit: { owner: "alice" } } }),
    ).toBeTruthy();
    expect(
      ResolveProposalOutput.parse({ proposal_id: PROPOSAL_ID, state: "edited_and_approved" }),
    ).toBeTruthy();
  });
});
