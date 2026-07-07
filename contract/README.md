# The Sitrep Agent Contract

**Version: 1.0.0-draft** · Status: Phase 0 draft, not yet frozen · Transport: MCP (stdio + Streamable HTTP)

This is Sitrep's real API surface and its compatibility promise. Any agent — Hermes, Claude
Code, Codex, or a custom loop — that implements this contract is a first-class citizen of
the ecosystem. Sitrep contains zero LLM calls; every tool below is either served by Sitrep
(the agent calls it) or polled by the agent from Sitrep's outbox (see "Design decision"
below for why there is no reverse-call direction).

Machine-readable schemas for every type mentioned here live in
[`packages/contract/src`](../packages/contract/src) and are exported as both Zod schemas
(source of truth) and generated, version-controlled JSON Schema
([`contract/schema/*.json`](./schema)) via `pnpm --filter @sitrep/contract gen:schema`.
Committing the generated schema means a non-TS agent implementation never needs to import
this package, and schema drift shows up as a diff in review.

## Design decision: the outbox, not a reverse call (v1)

The PRD's original sketch (§6) proposed two call directions: Sitrep → Agent
(`extract`, `request_report`, `notify`) and Agent → Sitrep (`submit_proposal`,
`list_entities`, `read_state`, `resolve_proposal`). MCP's transport model is
client-calls-server; a server (Sitrep) cannot reach out and invoke a tool on an arbitrary,
possibly-offline agent process.

Contract v1 resolves this by making every Sitrep → Agent call an **outbox entry** instead
of a direct call:

- Sitrep enqueues a `Job` (`kind: extract | report_request | notification`) whenever it
  would otherwise have called the agent.
- The agent — whether a long-running daemon (Hermes) or an on-demand CLI session
  (Claude Code, Codex) — calls `fetch_work` to pull pending jobs and `complete_work` to
  acknowledge them.
- This keeps the contract agnostic to whether the agent is always-on or invoked
  periodically, which is the whole point of radical agent-agnosticism (PRD §1).

**Net effect:** the four-call table in PRD §6 becomes six tools, all served by Sitrep.
There is no tool the agent must expose. This is the single deliberate deviation from the
PRD's literal contract table, made explicit here per the PRD's own instruction to treat
the contract as versioned and documented.

## Tool surface (all served by Sitrep, called by the agent)

| Tool | Direction | Purpose |
|---|---|---|
| `fetch_work(kinds?, limit?)` | Agent pulls | Poll the outbox for pending `extract` / `report_request` / `notification` jobs |
| `complete_work(job_id, result)` | Agent acks | Mark a job done; `result` carries the agent's output (proposals submitted, report text, delivery status) |
| `submit_proposal(proposal)` | Agent pushes | Enqueue an extracted change from any channel (Inbox or external) |
| `list_entities(query)` | Agent reads | Read the project/milestone/task registry, used for `@`-mention resolution and report generation |
| `read_state(scope)` | Agent reads | Read approved work state for a project/milestone, used for report generation |
| `resolve_proposal(id, action)` | Agent pushes | Relay a human approval given out-of-band via chat (e.g., "approve 3" in Telegram) |

### `fetch_work`

```ts
Input:  { kinds?: Array<"extract" | "report_request" | "notification">; limit?: number }
Output: { jobs: Job[] }

Job:
  id: string (uuid)
  kind: "extract" | "report_request" | "notification"
  payload: CapturePayload | ReportRequestPayload | NotificationPayload
  enqueued_at: string (ISO 8601)
```

**Delivery semantics: at-least-once, not exactly-once.** A job stays fetchable — it may be
returned by `fetch_work` again — until the agent calls `complete_work` for it. There is no
lease or visibility timeout in v1: a slow or crashed agent simply re-polls and re-receives
the same job on its next `fetch_work` call. Consequences for agent implementations:

- `complete_work` handlers must be idempotent (e.g. re-submitting the same proposal twice
  for one `extract` job should not create duplicate proposals — Sitrep dedupes by
  `capture_id`).
- An agent that fetches a job and then crashes before `complete_work` will see that job
  again; this is intentional (no work is silently dropped) and is why every job payload
  carries enough context (`capture_id`, `job.id`) to detect a re-delivery.
- v0.1 has no maximum retry count or dead-letter queue; a permanently-unprocessable job
  stays visible forever. This is an accepted v0.1 gap, not a design decision — revisit in
  v0.2 once real failure modes are observed.

### `report_request` payload — Sitrep-computed digest data

Unlike `extract` (where the agent does the structuring) and `notification` (already fully
formed), a `report_request` job carries data Sitrep has already computed from its own
state, so the agent's only job is to narrate it — no `read_state` round-trip is required
to answer "what happened":

```ts
ReportRequestPayload:
  kind: "morning_digest" | "weekly_report"
  scope: { project_ref?: string }
  data:
    overnight_changes: Array<{ entity_ref, entity_kind, summary, proposal_id }>
    tasks_due_today: string[]          # task refs
    pending_proposal_count: number
    new_risk_flags: RiskFlagPayload[]
```

This directly satisfies PRD §5.2's morning digest contents (overnight changes, tasks due
today, pending proposal count, newly flagged risks) without requiring the agent to
independently reconstruct RAG status or proposal state via `read_state`.

### `complete_work`

```ts
Input:  { job_id: string; result: ExtractResult | ReportResult | NotifyResult }
Output: { acknowledged: true }
```

### `submit_proposal`

```ts
Input:  { proposal: ProposalInput }
Output: { proposal_id: string; state: "pending" | "approved" }

ProposalInput:
  source:
    channel: "inbox" | "external" | "scheduled_review"
    raw_text: string
    captured_at: string (ISO 8601)
  extraction:
    type: "task_create" | "task_update" | "status_change" | "milestone_shift" |
          "risk_flag" | "decision_log"
    target_refs: string[]
    payload: object            # type-specific, see packages/contract/src/proposal.ts
    confidence: number         # 0.0-1.0
```

`state` in the output is `"approved"` only when Sitrep's auto-approve policy accepts it
immediately. **v0.1 ships with auto-approve disabled** (PRD §7 "Out"), so v0.1 always
returns `"pending"`; the field exists now so v0.2's policy engine is a config change, not a
contract change.

### `list_entities`

```ts
Input:  { query?: string; kind?: "project" | "milestone" | "task"; limit?: number }
Output: { entities: EntityRef[] }

EntityRef:
  id: string
  kind: "project" | "milestone" | "task"
  label: string        # for @-mention display
  project_ref?: string  # present on milestone/task refs
```

### `read_state`

```ts
Input:  { scope: { project_ref?: string; since?: string (ISO 8601) } }
Output: { projects: Project[]; milestones: Milestone[]; tasks: Task[] }
```

### `resolve_proposal`

```ts
Input:  { id: string; action: "approve" | "reject" | { edit: object } }
Output: { proposal_id: string; state: "approved" | "rejected" | "edited_and_approved" }
```

## Capture → Proposal → Approval sequence (v1, outbox model)

```
User          Sitrep UI         Sitrep (outbox)        Agent
 │ types note    │                    │                   │
 ├──────────────▶│ POST /captures     │                   │
 │               ├───────────────────▶│ enqueue "extract" │
 │               │                    │◀── fetch_work ────┤ (agent polls)
 │               │                    ├── job payload ───▶│
 │               │                    │                   │ parses, enriches
 │               │                    │◀── submit_proposal[] ┤
 │               │                    │◀── complete_work ─┤
 │  reviews      │  (queue updated)   │                   │
 ├─ approve ────▶│ commit locally     │                   │
 │               │                    │                   │
```

Digest/report and notification delivery follow the same shape: Sitrep enqueues a
`report_request` or `notification` job; the agent's next `fetch_work` picks it up,
generates or delivers it, and acknowledges via `complete_work`.

## Compatibility promise

Any agent that implements `fetch_work` and `complete_work` (to receive work) plus
`submit_proposal`, `list_entities`, `read_state`, and `resolve_proposal` (to act on
Sitrep's data) is fully compatible. Reference prompts live in
[`/reference-agent`](../reference-agent) for Claude Code and a deterministic no-LLM stub
agent used in the contract compliance test suite — these are examples, not dependencies.

## Versioning

This contract follows semver. Breaking changes to any tool's input/output shape bump the
major version. v1.0.0 will be tagged once the compliance test suite
(`packages/server/src/mcp.test.ts`, Phase 2) passes against both the stub agent and one
real agent, per PRD §7 success criterion 4.
