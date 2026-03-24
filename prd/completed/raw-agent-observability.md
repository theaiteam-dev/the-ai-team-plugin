# PRD: Raw Agent Observability Dashboard

**Version:** 1.0.0
**Status:** Draft
**Author:** Josh / Claude
**Date:** 2026-02-10
**Package:** `@ai-team/kanban-viewer` + plugin hooks

---

## 1. Overview

### 1.1 Background

The A(i)-Team kanban-viewer provides mission-level observability: work items moving through stages, an activity feed of agent log messages, and agent status indicators. This tells you *what* the mission is doing — which items are in testing, which agent claimed what, and whether things are progressing.

But it tells you nothing about *how* agents are doing their work. When Murdock spends 3 minutes on a test file, you don't know if he's reading 40 files to understand the codebase, running a failing test in a loop, or waiting on a permission denial. When B.A. gets stuck, you can't see which tool call failed or what error he received. The activity feed shows curated summaries ("Created 5 test cases") but hides the 200+ tool calls that produced them.

### 1.2 Problem Statement

Operators running A(i)-Team missions have no visibility into agent-level tool activity. This causes three concrete problems:

1. **Debugging stuck agents is blind.** When an agent stops making progress, the only signal is that the kanban board stops moving. The operator must wait for a timeout or manually check Claude Code's terminal output — which scrolls past and is not searchable. There is no way to see the last tool call, whether it succeeded, or what the agent tried next.

2. **Performance bottlenecks are invisible.** Some missions take 2x longer than similar ones with no explanation. Without per-tool-call timing data, operators cannot identify whether the slowdown is from excessive file reads, long-running bash commands, permission denials causing retries, or MCP server latency.

3. **Permission denials are silent failures.** Background agents (`run_in_background: true`) auto-deny operations that require user approval. These denials are not logged anywhere visible. An agent may silently skip critical operations without the operator knowing until the final review catches missing work.

### 1.3 Business Context

The A(i)-Team is a developer tool — its users are developers and engineering leads who run missions to ship features. Tool trust requires transparency. When agents work in parallel across 3-5 features simultaneously, the operator needs confidence that work is proceeding correctly without micromanaging each agent.

Today, operators either:
- Watch Claude Code terminal output in real-time (defeating the purpose of automation)
- Trust the pipeline and only check results at the end (risking wasted compute on stuck agents)
- Use `/ai-team:status` periodically (shows board state, not agent behavior)

Raw agent observability fills the gap between "board-level progress" and "terminal-level noise" — structured, filterable, real-time visibility into what every agent is actually doing.

### 1.4 Solution

Add a "Raw Agent View" to the kanban-viewer that captures Claude Code hook events and displays them in real-time. Hook scripts fire on tool lifecycle events (PreToolUse, PostToolUse, etc.), POST structured JSON payloads to a new API endpoint, and the existing SSE infrastructure streams them to the UI.

### 1.5 Scope

**In Scope:**
- Hook scripts that capture tool lifecycle events and POST them to the kanban-viewer API
- New API endpoint to receive, store, and stream hook event data
- New SSE event type (`hook-event`) flowing through the existing infrastructure
- New dashboard view alongside the current mission kanban board
- Real-time feed of tool calls with agent swim lanes
- Filtering by agent, tool type, and status
- Tool call duration tracking (PreToolUse → PostToolUse pairing)
- Permission denial highlighting
- `/ai-team:setup` integration to auto-configure hook scripts

**Out of Scope:**
- Token usage tracking (Claude Code hooks do not currently expose token counts)
- Historical analytics or trend charts across missions (future PRD if observability proves valuable)
- Modifying Claude Code's hook system itself (we work within the existing hook contract)
- Alerting or notifications based on hook events (separate concern)
- Recording or replaying full tool input/output payloads (privacy and storage concerns — summaries only)

---

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Reduce time to diagnose stuck agents | Time from agent stall to operator awareness | < 30 seconds (currently minutes) |
| Surface permission denials | % of auto-denied operations visible in UI | 100% (currently 0%) |
| Enable performance analysis | Per-agent tool call duration data available | Yes, for all tool calls |
| Maintain mission view performance | Page load and SSE latency with hook events enabled | No measurable degradation |

**Negative metric (must NOT degrade):**
- Mission execution speed shall not be measurably affected by hook event reporting. Hook scripts must be non-blocking — a failed POST to the API shall not block or delay the agent's tool call.

---

## 3. User Stories

**As an** operator running a multi-feature mission, **I want** to see which tools each agent is calling in real-time **so that** I can verify agents are making productive progress without watching terminal output.

**As an** operator debugging a stuck agent, **I want** to see the agent's last N tool calls, their status (success/failure/denied), and any error messages **so that** I can quickly identify what went wrong.

**As a** developer optimizing mission performance, **I want** to see how long each tool call takes per agent **so that** I can identify which operations are bottlenecks (e.g., slow Bash commands, excessive file reads).

**As an** operator, **I want** to see permission denials highlighted prominently **so that** I can update `.claude/settings.local.json` and avoid agents silently skipping work.

---

## 4. Requirements

### 4.1 Functional Requirements

#### Hook Event Capture

1. The system shall capture the following Claude Code hook events via hook scripts configured in the project's settings:
   - **PreToolUse** — tool name, input parameters (summarized, not full content), agent name, timestamp
   - **PostToolUse** — tool name, duration (elapsed since matching PreToolUse), output summary, status (success), agent name
   - **PostToolUseFailure** — tool name, error message, whether the failure was a permission denial, agent name
   - **SubagentStart** — agent name, subagent type, model, timestamp
   - **SubagentStop** — agent name, summary, timestamp
   - **Stop** — agent name, timestamp

2. Each hook event shall be delivered to the kanban-viewer API as a JSON payload via HTTP POST. The POST shall be fire-and-forget (non-blocking) — the hook script shall not wait for a response before exiting.

3. Hook scripts shall include the `X-Project-ID` header in all POST requests, read from the `ATEAM_PROJECT_ID` environment variable.

4. If the API is unreachable, the hook script shall silently exit with code 0 (allow the tool call to proceed). Hook event capture is observability, not enforcement.

#### API Endpoint

5. The system shall expose a `POST /api/hooks/events` endpoint that accepts hook event payloads, validates them, and stores them in the database.

6. The endpoint shall accept batch payloads (array of events) to support hooks that buffer multiple events before sending.

7. Stored hook events shall be associated with the current active mission (if one exists) and the project ID from the request header.

#### Real-Time Streaming

8. The existing SSE endpoint (`/api/board/events`) shall emit a new `hook-event` event type when new hook events are stored.

9. The `useBoardEvents` React hook shall support a new `onHookEvent` callback for components to receive hook events.

10. Hook events shall be streamed with the same polling mechanism as other board events (1-second poll interval).

#### Dashboard View

11. The kanban-viewer shall provide a "Raw Agent View" accessible via a toggle or tab alongside the existing mission board view.

12. The Raw Agent View shall display a real-time feed of all hook events, ordered by timestamp (newest at bottom, matching the live feed convention).

13. The view shall organize events into **swim lanes per agent** — each active agent gets a visual column or lane showing its tool call stream.

14. Each tool call event shall display:
    - Timestamp (HH:MM:SS format)
    - Tool name (Read, Write, Edit, Bash, MCP tool names, etc.)
    - Duration (if PostToolUse received — shown as elapsed milliseconds or seconds)
    - Status indicator: success (green), failure (red), denied (yellow), in-progress (blue/pulsing)
    - Summarized context (file path for Read/Write/Edit, command snippet for Bash, tool name for MCP calls)

15. Permission denials (`PostToolUseFailure` where the cause is a permission denial) shall be visually prominent — highlighted row, distinct color, and a label indicating what permission was missing.

16. The view shall be filterable by:
    - Agent name (multi-select)
    - Tool type (multi-select: Read, Write, Edit, Bash, MCP, etc.)
    - Status (success, failure, denied)

17. SubagentStart and SubagentStop events shall appear as distinct markers in the feed — showing when agents were spawned and when they completed, with their subagent type and model.

#### Setup Integration

18. The `/ai-team:setup` command shall offer to configure hook scripts in the project's `.claude/settings.json` (or equivalent hook configuration location).

19. Setup shall detect whether the kanban-viewer API is reachable before enabling hook event reporting. If the API is not running, setup shall warn the user and skip hook configuration.

20. Hook scripts shall be installed in the plugin's `scripts/hooks/` directory (not the target project), so they are available to all projects using the plugin.

### 4.2 Non-Functional Requirements

1. Hook scripts shall complete execution in under 100ms. They must not perceptibly delay agent tool calls.

2. The `POST /api/hooks/events` endpoint shall respond in under 50ms for single events and under 200ms for batch payloads of up to 100 events.

3. Hook event storage shall be bounded — events older than the current mission (or 24 hours if no active mission) shall be prunable. The system shall not accumulate unbounded hook event data.

4. The Raw Agent View shall render smoothly with up to 10,000 hook events loaded. Older events shall be paginated or virtualized.

5. The SSE stream shall not send full hook event payloads for every event. Instead, it shall send event IDs; the client shall fetch details only for visible events (lazy loading).

---

## 5. Hook Event Schema

Each hook event shall conform to this structure:

```
HookEvent:
  id              Auto-generated unique identifier
  projectId       From X-Project-ID header
  missionId       Current active mission (nullable)
  eventType       One of: pre_tool_use, post_tool_use, post_tool_use_failure,
                  subagent_start, subagent_stop, stop
  agentName       Name of the agent (murdock, ba, lynch, amy, hannibal, etc.)
  toolName        Tool name (nullable — not present for subagent/stop events)
  status          success | failure | denied | pending
  durationMs      Milliseconds elapsed (nullable — only for post_tool_use)
  summary         Short human-readable summary of the event
  payload         JSON blob with event-specific detail (tool input summary, error message, etc.)
  timestamp       ISO 8601 timestamp
  correlationId   Shared ID between PreToolUse and its matching PostToolUse (for duration pairing)
```

The `correlationId` enables pairing PreToolUse with its PostToolUse/PostToolUseFailure to calculate duration. The hook scripts generate a UUID at PreToolUse time and pass it through to the matching post-hook via a shared temporary file or environment mechanism.

---

## 6. Edge Cases & Error States

- **API unreachable during hook execution:** Hook script exits silently with code 0. The tool call proceeds. Events are lost (not queued). This is acceptable — observability is best-effort, not guaranteed delivery.

- **No active mission:** Hook events are still stored with a null `missionId`. They can be viewed in the Raw Agent View without mission context. When a mission starts, subsequent events are associated with it.

- **Agent name not recognized:** Store the raw agent name string as-is. The UI should display unknown agents in a default color rather than failing.

- **PreToolUse without matching PostToolUse:** This happens when a tool call is in progress or when the agent crashes. The UI shall show these as "in-progress" with a pulsing indicator. After a configurable timeout (default 5 minutes), they shall be marked as "timed out."

- **High event volume:** A busy mission with 5 agents can generate 50+ events per second. The SSE system polls every 1 second. Events shall be batched by the polling cycle — one SSE message may contain multiple new hook events.

- **Hook script crash:** If a hook script throws an uncaught exception, Claude Code allows the tool call to proceed (hooks are non-blocking by design). The event is lost. The hook script should catch all exceptions and exit cleanly.

- **Concurrent missions across projects:** Each hook event includes `projectId`. The UI already filters by project. Hook events for other projects are stored but not displayed.

- **Duplicate events:** Network retries could cause duplicate POSTs. The API shall deduplicate by `correlationId + eventType` combination (a PreToolUse and PostToolUse with the same correlationId are distinct events, but two PreToolUse events with the same correlationId are duplicates).

---

## 7. Dependencies

### Internal

| Dependency | Owner | Status |
|------------|-------|--------|
| Existing SSE infrastructure (`/api/board/events`) | kanban-viewer | Stable, in production |
| `useBoardEvents` React hook | kanban-viewer | Stable, supports multiple event callbacks |
| Claude Code hook system (PreToolUse, Stop) | Claude Code | Stable, used by existing enforcement hooks |
| `/ai-team:setup` command | plugin commands/ | Stable, needs extension |

### External

| Dependency | Notes |
|------------|-------|
| Claude Code PostToolUse hook | Must verify this hook type is available and receives duration/output data |
| Claude Code PostToolUseFailure hook | Must verify this hook type exists and includes denial reason |
| Claude Code SubagentStart/SubagentStop hooks | Must verify availability and payload format |

### Data

| Dependency | Notes |
|------------|-------|
| New Prisma model for hook events | Migration required |
| SQLite storage growth | Hook events generate significantly more rows than activity logs — monitor DB size |

---

## 8. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PostToolUse/PostToolUseFailure hooks may not exist or may lack needed data | Medium | Cannot track tool duration or failure reasons | Verify hook availability before implementation; fall back to PreToolUse-only if post-hooks unavailable |
| Hook scripts add latency to tool calls | Low | Agents run slower | Scripts are fire-and-forget (non-blocking POST, no response wait); benchmark at < 100ms |
| SQLite write contention from high-frequency hook events | Medium | API 500s during busy missions | Use WAL mode (already default for kanban-viewer), batch inserts, or buffer in memory |
| SubagentStart/SubagentStop hooks may not provide model or agent type | Medium | Swim lanes lack context | Degrade gracefully — show "unknown" for missing fields |
| Large payload sizes from tool input/output | Low | Storage bloat, slow API | Store only summaries (first 200 chars of command, file path only for Read/Write), not full content |

### Open Questions

- [ ] Does Claude Code's hook system support PostToolUse and PostToolUseFailure events? What data do they provide? (Critical — determines whether duration tracking is possible.)
- [ ] Is there a mechanism for passing data between PreToolUse and PostToolUse hooks for the same tool call (e.g., correlation ID, shared temp file, environment variable)? If not, duration pairing may require timestamp-based heuristics.
- [ ] Should the Raw Agent View replace one of the existing LiveFeedPanel tabs, or should it be a separate full-page view toggled from the header?
- [ ] What is the expected hook event volume for a typical 10-item mission? This determines storage and pagination strategy.
- [ ] Should hook events be archived with the mission (via `mission_archive`), or discarded after mission completion?

---

## 9. Architecture Overview

### 9.1 Data Flow

```
Claude Code Agent
       │
       ├─ PreToolUse ──► hook script ──► POST /api/hooks/events
       │                                        │
       ├─ [tool executes]                       ▼
       │                                  ┌──────────┐
       ├─ PostToolUse ─► hook script ─►   │  SQLite   │
       │                                  │ HookEvent │
       │                                  └─────┬─────┘
       │                                        │ poll (1s)
       │                                        ▼
       │                                  ┌──────────┐
       │                                  │   SSE     │
       │                                  │ endpoint  │
       │                                  └─────┬─────┘
       │                                        │ hook-event
       │                                        ▼
       │                                  ┌──────────┐
       │                                  │  Browser  │
       │                                  │   UI      │
       └──────────────────────────────────└──────────┘
```

### 9.2 Integration Points

The design reuses existing infrastructure:

| Component | Existing | New |
|-----------|----------|-----|
| SSE endpoint | `/api/board/events` with polling | Add `hook-event` type to emitter |
| React hook | `useBoardEvents` with callbacks | Add `onHookEvent` callback |
| Database | Prisma + SQLite | Add `HookEvent` model |
| Hook scripts | `scripts/hooks/` (5 existing) | Add 3-6 new observer scripts |
| Setup command | `commands/setup.md` | Add hook configuration step |
| LiveFeedPanel | Tabbed panel with 5 tabs | Add "Agent Activity" tab or separate view |

### 9.3 Hook Script Design

Each hook script follows this pattern:

1. Read environment variables (`TOOL_INPUT`, `AGENT_NAME`, `ATEAM_API_URL`, `ATEAM_PROJECT_ID`)
2. Construct a HookEvent JSON payload
3. Fire-and-forget POST to `${ATEAM_API_URL}/api/hooks/events`
4. Exit with code 0 (never block the tool call)

Observer hooks are distinct from enforcement hooks — they always allow the operation. They are configured alongside enforcement hooks in agent frontmatter but serve a different purpose.

---

## 10. Work Items

### 10.1 Wave 0: Verify Hook Availability

#### WI-001: Audit Claude Code hook types and payloads

**Type:** task
**Priority:** critical

**Description:**
Before any implementation, verify which Claude Code hook events are available and what data they provide. The existing codebase uses PreToolUse and Stop hooks. This PRD assumes PostToolUse, PostToolUseFailure, SubagentStart, and SubagentStop are also available.

**Verification steps:**
1. Create a test hook script that logs all environment variables to a temp file
2. Configure it for each hook type in a test agent
3. Run a simple mission and inspect the logged data
4. Document the exact payload format for each hook type
5. Determine if there's a correlation mechanism between Pre and Post hooks

**Acceptance Criteria:**
- [ ] Documented list of available hook types with example payloads
- [ ] Confirmed whether PostToolUse provides duration data or requires manual timing
- [ ] Confirmed whether PostToolUseFailure distinguishes permission denials from other errors
- [ ] Confirmed SubagentStart/SubagentStop payload format
- [ ] Open questions in Section 8 are answered

---

### 10.2 Wave 1: Backend — Storage and API

#### WI-002: Add HookEvent Prisma model and migration

**Type:** task
**Priority:** high
**Dependencies:** WI-001

**Description:**
Add a new `HookEvent` model to the kanban-viewer Prisma schema. The model stores individual hook events with fields matching the schema in Section 5.

**Acceptance Criteria:**
- [ ] `HookEvent` model added to `prisma/schema.prisma`
- [ ] Migration runs successfully against SQLite
- [ ] Indexes on `projectId`, `missionId`, `agentName`, `timestamp`, and `correlationId`
- [ ] `bun run build` succeeds in `packages/kanban-viewer`

---

#### WI-003: Implement POST /api/hooks/events endpoint

**Type:** feature
**Priority:** high
**Dependencies:** WI-002

**Description:**
Create the API endpoint that receives hook event payloads from hook scripts. The endpoint shall accept both single events and arrays (batch mode). It shall validate the payload, associate with the current mission if one is active, and store in the database.

**Acceptance Criteria:**
- [ ] `POST /api/hooks/events` accepts single event JSON
- [ ] `POST /api/hooks/events` accepts array of events (batch)
- [ ] Events are stored with correct `projectId` from `X-Project-ID` header
- [ ] Events are associated with the current active mission (if any)
- [ ] Duplicate detection by `correlationId + eventType`
- [ ] Response time under 50ms for single events
- [ ] Invalid payloads return 400 with descriptive error

---

#### WI-004: Add hook-event to SSE emitter

**Type:** feature
**Priority:** high
**Dependencies:** WI-002

**Description:**
Extend the SSE polling logic in `/api/board/events` to detect new `HookEvent` rows and emit `hook-event` SSE messages. Track `lastHookEventId` alongside existing change detection.

**Acceptance Criteria:**
- [ ] SSE endpoint emits `hook-event` when new HookEvent rows appear
- [ ] Events are batched per poll cycle (one SSE message per poll, containing all new events)
- [ ] `useBoardEvents` hook supports `onHookEvent` callback
- [ ] Existing SSE event types are unaffected
- [ ] No performance degradation on the SSE polling loop

---

### 10.3 Wave 2: Hook Scripts

#### WI-005: Create observer hook scripts for tool lifecycle events

**Type:** feature
**Priority:** high
**Dependencies:** WI-001, WI-003

**Description:**
Create hook scripts in `scripts/hooks/` that observe tool lifecycle events and POST them to the kanban-viewer API. Each script reads environment variables, constructs a HookEvent payload, and fires a non-blocking HTTP POST.

Scripts to create (exact set depends on WI-001 findings):
- `observe-pre-tool-use.js` — Captures tool name, summarized input, agent name
- `observe-post-tool-use.js` — Captures tool name, duration, success status
- `observe-post-tool-use-failure.js` — Captures tool name, error, denial flag
- `observe-subagent-start.js` — Captures agent spawn details
- `observe-subagent-stop.js` — Captures agent completion summary

**Acceptance Criteria:**
- [ ] Each hook script completes in under 100ms
- [ ] Scripts exit with code 0 regardless of POST success/failure
- [ ] Scripts include `X-Project-ID` header from `ATEAM_PROJECT_ID` env var
- [ ] Scripts generate correlation IDs for Pre/Post pairing (mechanism determined by WI-001)
- [ ] Scripts summarize tool input (file paths, command first 200 chars) — never send full file content

---

#### WI-006: Add observer hooks to agent frontmatter

**Type:** task
**Priority:** high
**Dependencies:** WI-005

**Description:**
Update all agent `.md` files in `agents/` to include observer hook configurations alongside existing enforcement hooks. Observer hooks must not interfere with enforcement hooks — both run for the same events.

**Acceptance Criteria:**
- [ ] All working agents (Murdock, B.A., Lynch, Amy, Tawnia) have observer hooks configured
- [ ] Hannibal has observer hooks configured
- [ ] Observer hooks run in addition to (not instead of) existing enforcement hooks
- [ ] Agent files parse correctly with both hook types

---

#### WI-007: Update /ai-team:setup to configure observer hooks

**Type:** enhancement
**Priority:** medium
**Dependencies:** WI-005

**Description:**
Extend the `/ai-team:setup` command to offer hook event reporting configuration. Setup shall check if the kanban-viewer API is reachable and offer to enable observability hooks.

**Acceptance Criteria:**
- [ ] Setup detects API availability before offering hook configuration
- [ ] Setup explains what hook events will be captured
- [ ] Hook configuration is optional (operators can decline)
- [ ] Setup works correctly when API is not running (skips with warning)

---

### 10.4 Wave 3: Frontend — Raw Agent View

#### WI-008: Create Raw Agent View component with swim lanes

**Type:** feature
**Priority:** high
**Dependencies:** WI-004

**Description:**
Build the main Raw Agent View component that displays hook events organized by agent swim lanes. Each lane shows a chronological stream of tool calls for one agent with timestamps, tool names, status indicators, and duration.

**Acceptance Criteria:**
- [ ] Each active agent has a distinct visual swim lane
- [ ] Tool call events show timestamp, tool name, status, and duration
- [ ] Permission denials are visually prominent (distinct color, label)
- [ ] SubagentStart/Stop appear as lane markers
- [ ] Auto-scrolls to newest events (with scroll-lock when user scrolls up)
- [ ] Renders smoothly with 1,000+ events visible

---

#### WI-009: Add filtering controls to Raw Agent View

**Type:** feature
**Priority:** medium
**Dependencies:** WI-008

**Description:**
Add filter controls to the Raw Agent View matching the requirements in Section 4.1 item 16: filter by agent name, tool type, and status.

**Acceptance Criteria:**
- [ ] Multi-select agent name filter
- [ ] Multi-select tool type filter (Read, Write, Edit, Bash, MCP tools)
- [ ] Status filter (success, failure, denied)
- [ ] Filters apply immediately (no submit button)
- [ ] Active filters shown as indicators with clear button

---

#### WI-010: Integrate Raw Agent View into dashboard navigation

**Type:** task
**Priority:** medium
**Dependencies:** WI-008

**Description:**
Add navigation between the existing Mission Board view and the new Raw Agent View. This could be a tab in the header, a toggle switch, or a new tab in the LiveFeedPanel — the exact UI treatment is a design decision.

**Acceptance Criteria:**
- [ ] User can switch between Mission Board and Raw Agent View
- [ ] Both views receive SSE updates simultaneously (switching doesn't cause reconnection)
- [ ] URL reflects current view (bookmarkable)
- [ ] Mission Board remains the default view

---

### 10.5 Wave 4: Duration Pairing and Polish

#### WI-011: Implement PreToolUse → PostToolUse duration pairing

**Type:** feature
**Priority:** medium
**Dependencies:** WI-003, WI-005

**Description:**
Pair PreToolUse events with their matching PostToolUse/PostToolUseFailure events using correlation IDs to calculate tool call duration. Update the HookEvent records with computed duration.

**Acceptance Criteria:**
- [ ] PreToolUse events are paired with their matching PostToolUse by correlationId
- [ ] Duration is computed and stored on the PostToolUse event
- [ ] Unpaired PreToolUse events show as "in-progress" in the UI
- [ ] Events unpaired for 5+ minutes show as "timed out"

---

#### WI-012: Add hook event pruning and archival

**Type:** task
**Priority:** low
**Dependencies:** WI-002

**Description:**
Implement a pruning mechanism for hook events to prevent unbounded storage growth. Events older than the current mission (or 24 hours with no active mission) shall be eligible for deletion.

**Acceptance Criteria:**
- [ ] Pruning runs automatically (on mission archive or on schedule)
- [ ] Events associated with the current active mission are never pruned
- [ ] Pruning is idempotent and safe to run concurrently
- [ ] Storage does not grow unbounded over multiple missions

---

## 11. Wave Dependencies

```
Wave 0
WI-001 (audit hooks) ─────────────────────────────┐
                                                    │
Wave 1                                              │
WI-002 (Prisma model) ◄────────────────────────────┘
  │
  ├──► WI-003 (POST endpoint)
  │       │
  ├──► WI-004 (SSE hook-event)
  │       │
  │       │     Wave 2
  │       ├──► WI-005 (observer scripts) ◄── WI-001
  │       │       │
  │       │       ├──► WI-006 (agent frontmatter)
  │       │       └──► WI-007 (setup integration)
  │       │
  │       │     Wave 3
  │       └──► WI-008 (Raw Agent View) ◄── WI-004
  │               │
  │               ├──► WI-009 (filters)
  │               └──► WI-010 (navigation)
  │
  │     Wave 4
  ├──► WI-011 (duration pairing) ◄── WI-003, WI-005
  └──► WI-012 (pruning)
```

Wave 0 is a prerequisite for everything — its findings may alter the design of subsequent waves. Waves 1 and 2 can overlap once WI-002 and WI-003 are complete. Wave 3 requires Wave 1's SSE work. Wave 4 is polish that can happen in parallel with Wave 3.

---

## 12. Success Criteria

The Raw Agent Observability Dashboard is complete when:

1. **Real-time visibility** — An operator can see every tool call from every active agent in the kanban-viewer UI within 2 seconds of the call occurring
2. **Permission denial surface** — All auto-denied operations appear prominently in the Raw Agent View with the denied permission identified
3. **Duration tracking** — Tool call durations are displayed for completed operations (if Post hooks are available)
4. **Filterable** — The view can be filtered by agent, tool type, and status
5. **Non-intrusive** — Hook scripts add no perceptible delay to agent operations (< 100ms overhead)
6. **Zero regression** — The existing mission board, activity feed, and SSE infrastructure work identically with hook events enabled
7. **Self-configuring** — `/ai-team:setup` configures hook event reporting automatically when the API is available
