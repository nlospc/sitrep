# Sitrep — Product Requirements Document

**A local-first PM workbench where your agent does the data entry**

| | |
|---|---|
| Version | 0.2 (Draft for open-source release) |
| Status | Pre-MVP |
| License | MIT |
| Author | Bordzz |
| Last updated | 2026-07-06 |

---

## 1. Vision

Project management tools fail for one reason: **the data inside them is always stale**, because humans hate updating status. Jira boards drift from reality within days. The PM becomes a human ETL pipeline — copying status from meetings, chats, and emails into tickets.

Sitrep inverts this. It is a **local-first, read-mostly PM workbench** that sits in front of whatever AI agent you already run. The agent — with whatever knowledge base or memory stack it uses — extracts project signals into structured change proposals; Sitrep renders them as Gantt timelines, todo boards, and digests, and gives the human exactly one job: **approve or reject proposed changes**. The Gantt chart updates itself.

**One-line positioning:** *Your agent already knows your project status. Sitrep is where it reports for duty.*

(A "sitrep" is a military situation report — the concise, current, actionable status brief. That is precisely what this tool turns your agent's knowledge into.)

### Design stance: radical agent-agnosticism

Sitrep is **not** built for any particular agent, framework, or memory layer. It talks to "an agent" through one narrow, versioned MCP contract (§6). Whether that agent is Hermes, Claude Code, Codex, or a homegrown loop — and whether its memory is GBrain, a plain vector store, a pile of markdown, or nothing at all — is **explicitly out of Sitrep's concern**. If the agent can implement the contract, Sitrep works.

This keeps the project small, durable, and honest: Sitrep does presentation, provenance, and human-in-the-loop approval. Everything intelligent happens on the agent's side of the wire.

### Why now

- Agents with persistent memory/RAG stacks are becoming commodity infrastructure — but they are all **headless**. Their project knowledge is trapped behind a chat box.
- SaaS PM tools (Linear, Motion, Notion AI) are racing toward AI auto-update, but all require your data to live in their cloud. **Regulated industries (pharma, finance) and privacy-conscious individuals cannot follow them there.** Local-first is the moat.
- No open-source project currently occupies the "agent-facing PM presentation layer" niche.

### What Sitrep is NOT (non-goals)

- **Not an agent, not a framework, not a memory layer.** Sitrep contains zero LLM calls and zero natural-language parsing. It never selects, configures, or assumes a RAG backend.
- **Not a chat client or IM gateway.** Messaging channels (Telegram, Discord, etc.) belong to the agent's existing gateways. Sitrep emits notification payloads to the agent; the agent delivers them. Sitrep implements no third-party IM integration.
- **Not a team collaboration suite (v1).** Single-user first.
- **Not a general-purpose dashboard.** Scope is deliberately PM-shaped: projects, milestones, tasks, risks, decisions.

---

## 2. Architecture

```
┌─────────────────────────────────────────────┐
│  SITREP (interaction & presentation layer)  │
│  Inbox · Proposal Queue · Gantt · Kanban    │
│  Provenance & audit log · Digest renderer   │
│  Local view-state store (SQLite)            │
└──────────────┬──────────────────────────────┘
               │ Sitrep Agent Contract (MCP, versioned)
┌──────────────┴──────────────────────────────┐
│  AGENT (any: Hermes / Claude Code / Codex / │
│  custom)                                    │
│  Parses signals → extracts structure →      │
│  maintains its own memory → generates       │
│  reports · owns all external gateways       │
└──────────────┬──────────────────────────────┘
               │ (agent's own business — not Sitrep's)
┌──────────────┴──────────────────────────────┐
│  MEMORY / KNOWLEDGE BASE (opaque to Sitrep) │
│  GBrain, vector DB, markdown repo, ...      │
└─────────────────────────────────────────────┘
```

**Boundary rule:** Sitrep communicates only across the top interface. It never reaches around the agent to touch a database or knowledge store. The bottom layer is drawn only to show it exists — its contents are invisible to Sitrep by design.

**Canonical data ownership:** Sitrep's local SQLite holds the *presentation truth* — projects, milestones, tasks, proposals, audit log, view state. The agent's memory holds whatever the agent wants. Sitrep is the system of record for *approved work state*; the agent is the system of intelligence.

**Deployment target:** local desktop app (Tauri preferred over Electron for footprint; final decision at implementation) or localhost web app. Zero cloud dependency.

**Ingestion channels (both converge on one queue):**

- **Channel A — Sitrep Inbox:** structured quick-capture UI (this product). Captures are handed to the agent for extraction.
- **Channel B — External:** anything the agent hears elsewhere (Telegram, chat sessions, email it reads). The agent extracts on its side and submits proposals through the same contract. Sitrep builds nothing here; it only guarantees both channels land in one Proposal Queue.

---

## 3. Core data objects

### 3.1 Proposal (the heart of the system)

Every structured change — from any channel — becomes a Proposal before it becomes truth.

```yaml
Proposal:
  id: uuid
  source:
    channel: inbox | external | scheduled_review
    raw_text: string          # verbatim original input
    captured_at: timestamp
  extraction:
    type: task_create | task_update | status_change |
          milestone_shift | risk_flag | decision_log
    target_refs: [ref]        # Sitrep-side entity IDs
    payload: object           # type-specific fields
    confidence: 0.0–1.0       # agent-reported
  risk_class: low | high      # see auto-approve policy
  state: pending | approved | rejected | edited_and_approved
  resolution:
    resolved_by: user | auto_policy
    resolved_at: timestamp
    edit_diff: object | null
```

**Audit trail is a first-class feature, not a byproduct.** Every task and milestone can answer: *what changed me, based on which source text, when, approved by whom.* (ALCOA-style provenance — attributable, legible, contemporaneous, original, accurate. This is the differentiator no consumer PM tool offers.)

**Auto-approve policy (user-configurable):**

| Risk class | Examples | Default behavior |
|---|---|---|
| Low | New todo, note attached to task, tag added | Auto-approve if confidence ≥ 0.85 |
| High | Milestone date change, status → done, task deletion, owner change | Always requires manual approval |

### 3.2 Project / Milestone / Task

Owned and stored by Sitrep (SQLite). Mutable only through approved Proposals or explicit manual edit (manual edits are themselves logged as user-authored proposals, keeping the audit chain unbroken).

```yaml
Milestone:
  planned_date / current_date     # dual-track: baseline vs. live
  rag_status: green | amber | red # computed, see §5.1
  last_signal_at: timestamp       # feeds staleness detection
Task:
  title, project_ref, owner, due_date, priority, state
  provenance: [proposal_id]       # full chain back to raw text
```

---

## 4. Input design (Inbox)

Design goal: **capture in under 5 seconds, structure optional.**

### 4.1 MVP scope (v0.1)

1. **Single free-text box.** One-liner or pasted wall of text. Submit = fire-and-forget; extraction is async on the agent side.
2. **Type-hint chips (optional):** `Task` `Status update` `Risk` `Decision` `Meeting notes` `Idea`. Tapping a chip adds a classification hint to the capture payload; skipping is fine — the agent classifies on its own.
3. **@-mention entity binding:** typing `@` pops a picker fed by Sitrep's own project/milestone/task registry. Explicit binding kills same-name ambiguity.
4. **Long-paste detection:** input over ~500 chars is treated as a document (meeting notes, email). Flagged for batch extraction — one paste may yield N tasks + M risks, each its own Proposal.

### 4.2 Later phases

- v0.2 — file drop (txt/md/docx → text → same pipeline)
- v0.3 — voice memo (record → transcribe → same pipeline), mobile PWA capture

---

## 5. Output design

Three delivery modes by frequency × initiative:

### 5.1 Persistent views (WebUI, pull)

| View | Contents |
|---|---|
| **Milestone Gantt** | Project → milestone timeline. Dual-track bars (baseline vs. current). RAG lamps. Slip markers. |
| **Todo board** | Kanban, three grouping modes: by project / by priority / by due date. Every card has a "provenance" popover → the raw source text it was extracted from. |
| **Proposal Inbox** | Pending proposals list. Three actions per item: Approve / Reject / Edit-then-approve. Batch approve for low-risk. Keyboard-first (j/k/a/r/e). |
| **Audit log** | Filterable, exportable change history per project/milestone/task. |

**RAG computation (v1 heuristic, computed by Sitrep from its own data):**
- Red: milestone slipped past planned date, or blocking task overdue
- Amber: `last_signal_at` > 14 days, or ≥1 open risk flag
- Green: otherwise

### 5.2 Scheduled outputs (agent-generated, Sitrep-rendered)

Sitrep exposes a `request_report` contract call; a scheduler (cron on either side) triggers it.

- **Morning digest (daily):** overnight changes · tasks due today · pending proposal count · newly flagged risks. Optimized for phone-glance length.
- **Weekly report (Fri):** agent-generated project health narrative per project — designed to be lightly edited and forwarded to stakeholders. *The weekly status report is the PM chore everyone hates; this is the killer feature.*

### 5.3 Event-triggered alerts (computed by Sitrep)

- Milestone entering 7-day countdown with unfinished predecessor tasks
- Date conflict detected (two proposals assert different deadlines) — always escalated
- High-risk proposal enqueued

### 5.4 Notification channels

| Priority | Channel | Notes |
|---|---|---|
| 1 | **Agent's own messaging gateway** (e.g., Telegram via Hermes) | Two-way. Sitrep emits a notification payload through the contract; the agent delivers it and can relay replies like "approve 3" back as resolution calls. **Sitrep implements no IM integration itself.** |
| 2 | WebUI notification center | Archive of all pushes; fallback that always works even with a gateway-less agent |
| 3 | Email | Weekly report only (formal artifact, forwardable); via local SMTP config, optional |

Native OS push (APNs/FCM) is explicitly out of scope.

---

## 6. The Sitrep Agent Contract (MCP)

The contract is the product's real API surface and its compatibility promise. Semantic-versioned, documented in `/contract/README.md`, with a reference implementation as an agent skill/prompt under `/reference-agent/`.

**Sitrep → Agent (tool calls the agent must expose or poll):**

| Call | Purpose |
|---|---|
| `extract(capture)` | Hand over a raw Inbox capture for extraction |
| `request_report(kind, scope)` | Ask for a digest/weekly narrative |
| `notify(payload)` | Ask the agent to deliver a notification via its gateways |

**Agent → Sitrep (tools Sitrep serves over MCP):**

| Call | Purpose |
|---|---|
| `submit_proposal(proposal)` | Enqueue an extracted change (from any channel) |
| `list_entities(query)` | Read the project/milestone/task registry (for entity binding) |
| `read_state(scope)` | Read approved work state (for report generation) |
| `resolve_proposal(id, action)` | Relay a human approval given via chat ("approve 3") |

**Compatibility promise:** any agent that can call four MCP tools is a first-class citizen. The repo ships reference prompts for Claude Code, Hermes, and Codex, but these are examples, not dependencies.

### Capture → Proposal → Approval sequence

```
User        Sitrep UI        Agent             (agent's memory)
 │ types note   │                │                    │
 ├─────────────▶│ extract{}      │                    │
 │              ├───────────────▶│ parse, enrich ────▶│
 │              │◀───────────────┤ submit_proposal[]  │
 │  reviews     │ (queue)        │                    │
 ├─ approve ───▶│ commit locally │                    │
 │              ├─ state event ─▶│ (agent may sync    │
 │              │                │  back to memory)   │
```

---

## 7. MVP cut (v0.1)

**In:** Inbox (text + chips + @mention) → Proposal Queue → Gantt + Todo board → morning digest via agent gateway → provenance popovers → audit log view → contract v1 with reference prompts for one agent.

**Out (deliberately):** file/voice input, weekly report, auto-approve policy engine (v0.1 = everything manual), email, multi-user.

**Success criteria for v0.1 (self-dogfooding):**
1. Zero manual status edits on the Gantt for 2 consecutive weeks — all changes arrive as approved proposals.
2. Capture-to-proposal latency < 60s median.
3. Proposal precision ≥ 80% (approved without edit / total approved).
4. Contract portability proven: the same Sitrep instance driven by two different agents with no code change.

## 8. Roadmap

| Phase | Theme | Highlights |
|---|---|---|
| v0.1 | Closed loop | MVP above |
| v0.2 | Trust & automation | Auto-approve policy, weekly report, file input, conflict-resolution UI |
| v0.3 | Reach | Voice capture, mobile PWA, email digest |
| v0.4 | Teams | Multi-user approval scopes, stakeholder read-only links |

## 9. Open-source & positioning notes

- **Repo hygiene as portfolio signal:** architecture diagram, this PRD, the contract spec, an `INSTALL_FOR_AGENTS.md` (agent-driven install instructions have become an ecosystem convention), and a demo GIF of the approve-from-phone flow.
- **Narrative for LinkedIn/resume:** "Designed and open-sourced Sitrep, an agent-agnostic, local-first PM workbench with a human-in-the-loop approval protocol and GxP-grade audit trails — turning any AI agent's knowledge base into a self-updating project cockpit." The audit-trail angle ties directly to pharma/regulated-industry credibility; the contract design demonstrates architecture judgment.
- **Ecosystem stance:** interoperable-with-everything, dependent-on-nothing. Compatibility pages ("Works with Hermes / Claude Code / Codex / GBrain-backed agents") are marketing surface, not architecture.

---

## Appendix A — Name

**Sitrep** /ˈsɪtrɛp/ — military shorthand for *situation report*: the concise, current, actionable status briefing.

- Says exactly what the product does: your agent reports the situation; you command.
- Native to PM vocabulary (status reporting is the job) yet distinctive and memorable.
- Short, pronounceable in EN/JP/CN, clean as a CLI name (`sitrep serve`).
- Recommended repo/scope: `sitrep-pm` if the bare name collides on a registry.

Rejected alternates: *Foreman* (Ruby process manager collision), *Cockpit* (Linux admin UI collision), *Tempo* (Jira ecosystem collision), *Standup* (descriptive but generic, weak trademark surface).
