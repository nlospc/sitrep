# Plan: Sitrep v0.1 — 0→1 Development

**Source PRD**: `sorrel-led.md` (PRD v0.2, 2026-07-06)
**Selected Milestone**: v0.1 "Closed loop" MVP (PRD §7)
**Complexity**: Medium-Large (~3 weeks build + 2 weeks dogfood)

## Summary

Build the v0.1 closed loop of Sitrep: a local-first, agent-agnostic PM workbench where
capture → agent extraction → proposal queue → human approval → self-updating Gantt/Kanban,
with an ALCOA-grade audit chain and a versioned MCP contract as the only agent interface.
Sitrep itself contains zero LLM calls; all intelligence lives on the agent side of the wire.

## Scope

**In (v0.1):** Inbox (free text + type-hint chips + @mention binding + long-paste flag) →
Proposal Queue (all-manual approval: approve / reject / edit-then-approve, batch, keyboard-first) →
Milestone Gantt (dual-track, RAG lamps, slip markers) + Todo board (3 groupings, provenance
popovers) → morning digest via agent gateway → audit log view → MCP contract v1 + reference
prompts for one agent + deterministic stub agent.

**Out (deliberately):** file/voice input, weekly report, auto-approve policy engine, email,
multi-user, any IM integration, native OS push, Tauri packaging (post-v0.1).

## Technical Proposal

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript end-to-end (Node ≥ 20) | `@modelcontextprotocol/sdk` is TS-first; one language maximizes solo 0→1 speed |
| Backend | Node + Fastify (HTTP API + SSE), single process | Small, fast, JSON-Schema validation generated from contract types |
| MCP transport | stdio + Streamable HTTP on one tool registry | stdio serves Claude Code/Codex; HTTP serves daemon agents (Hermes) |
| DB | SQLite via better-sqlite3 + Drizzle ORM | Sync, transactional, zero-config; typed schema + migrations |
| Frontend | React + Vite + TanStack Query; hand-rolled SVG Gantt | Dual-track milestone Gantt with RAG lamps is the signature view; off-the-shelf libs fight it |
| Packaging | `sitrep serve` localhost web app; Tauri deferred | Fastest path to dogfooding; PRD allows either |
| Validation | Zod schemas as single source of truth, exported to JSON Schema in `/contract/` | Contract is the real API surface; docs + runtime validation from one definition |

### Repo layout (pnpm workspace monorepo)

```
packages/core       # domain logic + DB (commitProposal, RAG calc, alert detectors)
packages/contract   # Zod schemas, JSON Schema generation, semver'd
packages/server     # Fastify HTTP + MCP server + `sitrep` CLI
packages/web        # React UI
contract/           # human-readable contract spec (README.md, generated schemas)
reference-agent/    # prompts for Claude Code + deterministic stub agent for tests
```

### Key design decision: Sitrep→Agent direction is an outbox, not a call

MCP is client-calls-server; Sitrep cannot push `extract`/`request_report`/`notify` into an
arbitrary agent. Per the PRD's own hint ("tools the agent must expose **or poll**"), all three
Sitrep→Agent calls become a **work-queue outbox**:

- Sitrep enqueues jobs (`extract`, `report_request`, `notification`) in a `jobs` table.
- Contract adds two Sitrep-served tools: `fetch_work(kinds, limit)` and
  `complete_work(job_id, result)`.
- Agent→Sitrep direction unchanged: `submit_proposal`, `list_entities`, `read_state`,
  `resolve_proposal`.

Contract v1 tool surface = 6 tools, all served by Sitrep. This stays agnostic to whether the
agent is a long-running daemon or an on-demand CLI session. Ratified in `/contract/README.md`
as a v1 decision (deviation from the PRD's literal 4+3 table).

### Data model (SQLite)

`projects` · `milestones` (planned_date, current_date, last_signal_at) · `tasks` (title,
project_ref, owner, due_date, priority, state) · `captures` (raw text, chips, mentions,
batch flag) · `proposals` (source, extraction payload JSON, confidence, risk_class, state,
resolution, edit_diff) · `audit_log` (append-only field-level diffs, proposal_id, actor,
timestamp) · `jobs` (outbox) · `notifications` (WebUI center archive).

- **RAG status computed at read time, never stored** (storing it recreates the staleness the
  product exists to kill).
- **Single mutation door:** entities mutate only through `commitProposal()` in
  `packages/core` — one transaction applies the payload, writes audit rows, stamps
  `last_signal_at`. Manual UI edits construct a user-authored proposal and use the same door.

## Patterns to Mirror

Greenfield — no existing code. No patterns invented from thin air; conventions above are
proposed and become the codebase patterns from Phase 0 onward.

## Files to Change

| File | Action | Why |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` | CREATE | Monorepo scaffold |
| `contract/README.md` | CREATE | Contract v1.0.0-draft spec + outbox decision |
| `packages/contract/src/*.ts` | CREATE | Zod schemas (Proposal, entities, tool I/O) |
| `packages/core/src/db/*` | CREATE | Drizzle schema + migrations |
| `packages/core/src/proposals.ts` | CREATE | commitProposal / reject / editAndApprove |
| `packages/core/src/rag.ts`, `alerts.ts`, `digest.ts` | CREATE | Pure functions over DB state |
| `packages/server/src/mcp.ts`, `http.ts`, `cli.ts` | CREATE | 6-tool MCP server, Fastify API + SSE, `sitrep serve/init` |
| `packages/web/src/*` | CREATE | Inbox, Proposal Inbox, Gantt, Todo board, Audit log, notification center |
| `reference-agent/*` | CREATE | Claude Code prompt + stub agent |
| `INSTALL_FOR_AGENTS.md`, `README.md`, `LICENSE` | CREATE | Repo hygiene (PRD §9) |

## Tasks

### Phase 0 — Foundation (~1 day)
- **Action**: git init; pnpm workspace; TS strict; Vitest; ESLint/Prettier; write
  `/contract/README.md` v1.0.0-draft; define all Zod schemas; generate JSON Schema artifacts.
- **Validate**: `pnpm check` green; contract schemas round-trip sample payloads in unit tests.

### Phase 1 — Domain core + persistence (2–3 days)
- **Action**: Drizzle schema + migrations; `commitProposal()` / `rejectProposal()` /
  `editAndApprove()` (stores edit_diff); manual-edit-as-proposal path; RAG computation;
  alert detectors (7-day countdown w/ unfinished predecessors, date conflict → always
  escalate, high-risk enqueued); digest data assembler.
- **Validate**: unit tests proving the audit invariant — every entity field value traceable
  to a proposal ID; test that no code path writes entities directly.

### Phase 2 — Contract server (2–3 days)
- **Action**: MCP server (6 tools) over stdio + Streamable HTTP; Fastify HTTP API for the
  web UI (UI does not use MCP) + SSE for live queue updates; `sitrep serve` / `sitrep init` CLI.
- **Validate**: integration test scripting a fake agent over MCP stdio: capture →
  `fetch_work` → `submit_proposal`×N → `resolve_proposal` → assert state + audit rows.
  This test IS the contract compliance suite.

### Phase 3 — Web UI (5–7 days; parallel with Phase 2 after Phase 1)
- **Action**: Inbox (text box, chips, @-picker via list_entities, long-paste flag,
  optimistic fire-and-forget); Proposal Inbox (diff-style preview w/ raw source, j/k/a/r/e
  keyboard model, batch approve, edit-then-approve form); SVG Gantt (dual-track bars, RAG
  lamps, slip markers); Todo board (3 groupings, provenance popover); Audit log view
  (filter, CSV/JSON export); notification center.
- **Validate**: Playwright E2E of full loop against stub agent; keyboard-flow test.

### Phase 4 — Reference agent + digest loop (2–3 days; needs Phase 2)
- **Action**: `/reference-agent/` Claude Code skill/prompt (poll fetch_work, extract,
  digest on report_request, deliver notification payloads); deterministic no-LLM stub agent;
  node-cron scheduler in `sitrep serve` enqueuing morning digest; `INSTALL_FOR_AGENTS.md` + README.
- **Validate**: portability — same DB driven by stub agent and Claude Code, zero code change
  (PRD success criterion 4).

### Phase 5 — Dogfood & release (2 weeks calendar, ~2 days work)
- **Action**: manage Sitrep's own dev in Sitrep for 2 weeks; measure capture→proposal
  latency (<60s median) and precision (≥80%); empty states; agent-unreachable banner
  (captures queue silently); DB backup command; MIT license; demo GIF; tag contract v1.0.0.
- **Validate**: PRD §7 success criteria 1–4 all met.

## Validation

```bash
pnpm check            # typecheck + lint across workspace
pnpm test             # Vitest unit tests (core invariants, contract round-trips)
pnpm test:contract    # scripted-agent MCP compliance suite
pnpm test:e2e         # Playwright full-loop against stub agent
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| MCP push-direction mismatch discovered late | HIGH (pre-empted) | Outbox design ratified in contract v1 at Phase 0, before any server code |
| Hand-rolled Gantt scope creep | MEDIUM | Milestone-level only; no drag-editing in v0.1 (edits go through proposals anyway) |
| Contract churn after reference agents exist | MEDIUM | Zod-first schemas + compliance test; semver from day one |
| Proposal precision <80% blamed on Sitrep | LOW | Precision is agent-side by design; Sitrep only measures (edit-rate metric in audit log) |
| better-sqlite3 native build pain | LOW | Fallback to `node:sqlite` (Node ≥ 22) |

## Acceptance

- [ ] All phase tasks complete
- [ ] All validation commands pass
- [ ] Contract v1.0.0 tagged; two different agents drive the same instance with no code change
- [ ] 2-week dogfood meets PRD §7 criteria (zero manual Gantt edits, <60s latency, ≥80% precision)
