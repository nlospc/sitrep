# Sitrep — UI Design Prompt (for claude-design)

Design the web UI for **Sitrep**, a local-first project-management workbench where an AI
agent does all the data entry and the human's only job is to **approve or reject proposed
changes**. Think "mission control for one PM," not a collaboration suite.

## Product context (read first)

- A "sitrep" is a military situation report: concise, current, actionable. The UI should
  feel like that — calm, dense-but-legible, information-forward, zero decoration for its
  own sake. Command-center energy, not gamer aesthetic.
- The agent extracts tasks/status/risks from notes and submits **Proposals**. Nothing
  becomes truth until the human approves it. The Gantt updates itself from approved
  proposals.
- Single user, runs on localhost, desktop-first (min 1280px; graceful down to ~1024px).
  Dark mode is the primary theme (this is a tool people keep open all day next to a
  terminal); provide a light variant.
- Every piece of data can answer "what changed me, from which source text, when, approved
  by whom." **Provenance is the differentiator — make it visible, one interaction away,
  everywhere.**

## Global shell

- Left nav rail (icons + labels, collapsible): Inbox, Proposals, Timeline (Gantt), Board,
  Audit Log, Notifications, Settings.
- Persistent badge on "Proposals" showing pending count — this is the app's heartbeat.
- Global capture: a keyboard shortcut (`c`) opens the capture box from anywhere as an
  overlay. Status bar shows agent connection state (connected / polling / unreachable —
  when unreachable, captures still work and quietly queue; show a subtle banner, never a
  blocking error).
- Keyboard-first throughout; every list navigable with j/k, every primary action has a
  single-key binding shown in a discoverable way (e.g., subtle key hints, `?` opens a
  shortcut sheet).

## Screens

### 1. Inbox (capture)
Goal: capture a thought in under 5 seconds, structure optional.
- One large free-text box, autofocused. Submit = fire-and-forget (optimistic toast:
  "Sent to agent for extraction").
- Optional type-hint chips below the box: `Task` `Status update` `Risk` `Decision`
  `Meeting notes` `Idea` — tap to tag, skippable.
- Typing `@` opens an entity picker (projects / milestones / tasks) inline, fuzzy search,
  selected entities render as tokens in the text.
- Pastes over ~500 chars flip the box into "document mode": visual cue that this will be
  batch-extracted into multiple proposals.
- Below the box: recent captures with their extraction status (pending / extracted → N
  proposals / failed).

### 2. Proposal Inbox (the core screen — invest the most here)
A vertical queue of pending proposal cards, keyboard-driven (j/k to move, a=approve,
r=reject, e=edit-then-approve, x=select for batch).
- Each card shows: proposal type badge (task_create, status_change, milestone_shift,
  risk_flag, decision_log…), a **diff-style rendering of what will change** (old → new),
  the agent's confidence as a subtle meter, risk class (high-risk gets a distinct visual
  weight and can never be batch-approved), and a collapsible "source" section showing the
  verbatim raw text it was extracted from, with the relevant span highlighted.
- Batch bar appears when ≥1 low-risk item selected: "Approve 6 low-risk proposals".
- Edit-then-approve opens an inline form pre-filled with the extraction; edited fields
  are visually marked (the edit diff is stored).
- Empty state is a moment of pride: "Inbox zero. The situation is under control."

### 3. Timeline (Milestone Gantt — the signature view)
Projects as swimlanes, milestones as bars on a time axis.
- **Dual-track bars**: a thin baseline bar (planned dates) under the live bar (current
  dates). When current slips past baseline, the slip region renders in a warning
  treatment with a slip marker ("+9d").
- RAG status lamp on each milestone (green/amber/red) — design lamps that also work for
  color-blind users (shape + color).
- "Today" line. Milestones within a 7-day countdown that still have unfinished
  predecessor tasks get an alert affordance.
- Clicking a bar opens a side panel: milestone details, its tasks, and its provenance
  timeline (chain of approved proposals that moved it).
- No drag-to-edit — deliberate. Changes arrive as proposals; the Gantt is read-only truth.

### 4. Board (todo Kanban)
- Three grouping modes (segmented control): by project / by priority / by due date.
- Cards: title, project tag, owner, due date (overdue = warning treatment), priority.
- Every card has a provenance affordance (small icon) → popover showing the raw source
  text each field came from, with timestamps and who approved.

### 5. Audit Log
- Filterable table (entity, type, actor, date range), append-only feel — like a flight
  recorder. Each row: timestamp, entity, field-level before→after, source proposal link,
  approver. Export CSV/JSON button. Monospace where it helps scanability.

### 6. Notification Center
- Reverse-chron archive of everything pushed (digests, alerts, high-risk enqueued,
  date conflicts). Date-conflict alerts render both competing values side by side with a
  jump-to-proposal action.

## Visual direction

- Personality: precise, calm, trustworthy. References: Linear's density and keyboard
  culture, a military briefing document's typographic austerity. Avoid: SaaS-marketing
  gradients, playful illustration, rounded-bubble cheerfulness.
- Typography: a crisp UI sans for chrome + a good monospace for data (dates, IDs, raw
  source text, audit rows). Strong hierarchy from weight/size, not color.
- Color: restrained neutral base; color is reserved for meaning — RAG states, risk class,
  diff added/removed, agent confidence. Ensure the RAG triad is distinguishable without
  hue (add shape/pattern) and everything meets WCAG AA in both themes.
- Motion: minimal and functional — proposal cards leave the queue with a quick, decisive
  exit; approved changes pulse once on the Gantt when they land.

## Deliverables

High-fidelity mockups (dark theme primary, light variant) for screens 1–4 at minimum,
plus the proposal card component in all its states (pending / selected / high-risk /
editing / approving), the provenance popover, and the global shell with keyboard-hint
treatment. Component naming should assume a React implementation.
