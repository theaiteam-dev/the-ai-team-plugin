# PRD: Recoverable Precheck Failure

**Version:** 1.0.0
**Status:** Draft
**Author:** Josh / Claude
**Date:** 2026-02-27
**Package:** `@ai-team/kanban-viewer` + `packages/mcp-server`

---

## Problem Statement

When a mission precheck fails, the mission is permanently marked `failed` — a terminal state. The only recovery path is `mission_init(force: true)`, which archives the entire mission and all its work items. This destroys hours of planning work (Face decomposition, Sosa review, Face refinement) and forces the operator to re-run `/ai-team:plan` from scratch.

This just happened in production: a transient bug in the item ID generator caused `item_create` to fail during the planning phase. The mission was marked `failed` before any code was written. The planning artifacts (8 work items, dependency graph, parallel groups, acceptance criteria) were all trapped behind a terminal state with no recovery path.

## Business Context

The A(i)-Team planning phase is the most expensive part of a mission in both tokens and human time:

- **Face (Opus, first pass):** Reads the PRD, audits the project, decomposes into work items — ~100K tokens
- **Sosa (Opus):** Reviews every item, asks human questions, produces refinement report — ~100K tokens
- **Face (Opus, second pass):** Applies refinements, moves items to ready — ~50K tokens
- **Human time:** Answering Sosa's clarifying questions, reviewing the decomposition

A single precheck failure throws all of this away. At Opus pricing, that's ~$4-5 in API costs per lost planning cycle, plus 5-15 minutes of human attention. More importantly, it erodes operator trust — the system should not destroy work due to a transient infrastructure issue.

Precheck failures are inherently recoverable. They fail because the codebase has lint errors or test failures — things the operator can fix without re-planning the mission. The state machine should reflect this.

---

## Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Preserve planning work across precheck failures | Planning phase re-runs after precheck failure | 0 (never re-plan due to precheck) |
| Enable retry without re-planning | Operator can retry precheck after fixing issue | 100% of precheck failures are retryable |
| Distinguish transient from terminal failures | `failed` state only reached during execution | Precheck never sets `failed` |

**Negative metric (must NOT degrade):**
- Mission state integrity. A mission in `precheck_failure` must not be startable without passing prechecks. The safety guarantees of the precheck gate must be preserved.

---

## User Stories

**As an** operator whose mission precheck just failed due to a lint error, **I want** to fix the lint error and retry the precheck **so that** I don't have to re-run the entire planning phase.

**As an** operator debugging a flaky test that caused precheck failure, **I want** the mission and all its work items to remain intact **so that** I can retry once the test is fixed.

**As a** Hannibal orchestrator, **I want** to distinguish between "precheck failed, retryable" and "mission failed during execution" **so that** I can present the correct recovery options to the operator.

---

## Scope

### In Scope

- New `precheck_failure` mission state
- State transition: `prechecking` -> `precheck_failure` (on failure) instead of `prechecking` -> `failed`
- State transition: `precheck_failure` -> `prechecking` (on retry)
- Updated `mission_precheck` API to accept calls from `precheck_failure` state (not just `initializing`)
- Updated MCP tool (`mission_precheck`) to support retry
- Kanban UI indication of `precheck_failure` state with retry affordance
- Orchestration playbook updates for both legacy and native teams modes

### Out of Scope

- Postcheck failure recovery (similar problem, separate PRD — postchecks have different semantics because code has already been written)
- Automatic retry logic (operator must explicitly retry after fixing the issue)
- Precheck failure notifications or alerts
- Partial precheck retry (re-run only failed checks) — always re-runs all checks on retry

---

## Requirements

### Functional Requirements

#### Mission State Machine

1. The system shall add a `precheck_failure` state to the `MissionState` type.

2. When `mission_precheck` checks fail, the mission state shall transition to `precheck_failure` instead of `failed`.

3. The `mission_precheck` endpoint shall accept missions in either `initializing` or `precheck_failure` state. Missions in any other state shall be rejected with a 400 error.

4. When retrying from `precheck_failure`, the mission shall transition through `prechecking` as normal: `precheck_failure` -> `prechecking` -> `running` (on success) or `precheck_failure` -> `prechecking` -> `precheck_failure` (on failure again).

5. The `failed` state shall be reserved for failures that occur during mission execution (`running` or `postchecking` phases). Prechecks shall never set `failed`.

6. `mission_init(force: true)` shall archive missions in `precheck_failure` state, same as it handles `failed` missions today.

#### Work Item Preservation

7. Work items shall remain in their current stage (`briefings` or `ready`) when the mission enters `precheck_failure`. Items shall not be archived, deleted, or modified.

8. The dependency graph shall remain intact across precheck retries. `deps_check` shall continue to return valid results for a mission in `precheck_failure` state.

#### API Changes

9. The `POST /api/missions/precheck` endpoint shall validate that the mission is in `initializing` or `precheck_failure` state before proceeding.

10. The `POST /api/missions/precheck` endpoint shall **accept agent-reported check results** in the request body, not execute check commands itself. The request body shall carry:
    - `passed: boolean` — overall pass/fail
    - `blockers: string[]` — human-readable blocker messages (empty if passed)
    - `output: { lint?: { stdout, stderr, timedOut }, tests?: { stdout, stderr, timedOut } }` — raw command output per check

11. The precheck response shall include a `retryable: true` field when the mission enters `precheck_failure`, indicating to the caller that retry is available. It shall also include `allPassed: boolean` at the top level (aliasing `passed`) so the MCP server can read it without nested access.

12. The `GET /api/missions/current` endpoint shall return `precheck_failure` as a valid state. No changes to the response schema beyond the new state value.

#### MCP Tool Changes

13. The `mission_precheck` MCP tool input schema shall change from `{ checks: string[] }` to carry agent-reported results:
    ```
    passed: boolean
    blockers: string[]
    output: { lint?: { stdout, stderr, timedOut }, tests?: { stdout, stderr, timedOut } }
    ```
    The tool forwards this payload to `POST /api/missions/precheck`.

14. The `mission_precheck` MCP tool shall support being called multiple times for the same mission. Subsequent calls after a `precheck_failure` trigger a retry.

15. The `mission_current` MCP tool shall return `precheck_failure` as a valid state in its response.

#### Orchestration

16. Hannibal shall run precheck commands locally via the Bash tool in the target project directory before calling `mission_precheck`. It shall:
    - Read `ateam.config.json` from the project root to determine which commands to run (e.g. `checks.lint`, `checks.unit`)
    - Execute each command via Bash, capturing stdout, stderr, exit code, and timeout status
    - Determine `passed` (all commands exited 0) and `blockers` (human-readable summary per failure)
    - Call `mission_precheck` MCP tool with the results

17. Hannibal shall recognize `precheck_failure` as a non-terminal state and present the operator with a clear message: precheck failed, here's what failed, fix it and retry.

18. The `/ai-team:run` command shall handle missions in `precheck_failure` state by re-running the precheck (steps in req 16), not by requiring re-planning.

#### Dashboard

19. The kanban-viewer shall display `precheck_failure` missions with a distinct visual treatment (not the same as `failed`) indicating the mission is recoverable.

20. The mission status area shall show the precheck failure details (which checks failed, error output) when the mission is in `precheck_failure` state.

### Non-Functional Requirements

1. State transitions shall remain atomic (single database update per transition).

2. The mission-active marker (`/tmp/.ateam-mission-active-{projectId}`) shall NOT be set when the mission is in `precheck_failure` state. It shall only be set when transitioning to `running`.

3. No additional API calls or database queries shall be required for the retry path beyond what the initial precheck already performs. (Note: Hannibal re-executes check commands via Bash on every retry — this is expected, not overhead.)

---

## State Machine (Updated)

```
initializing
    |
    v
prechecking  <----+
    |              |
    +---> running  |  (checks passed)
    |              |
    +---> precheck_failure  (checks failed, retryable)
               |
               +---> prechecking  (retry)
               +---> archived     (force init or manual archive)

running
    |
    v
postchecking
    |
    +---> completed  (checks passed)
    +---> failed     (checks failed — terminal for now)

completed/failed
    |
    v
archived
```

**Key difference from current:** `prechecking` failure goes to `precheck_failure` (recoverable) instead of `failed` (terminal). The `failed` state is reserved for execution-phase failures only.

---

## Edge Cases & Error States

- **Multiple consecutive precheck failures.** The operator fixes one issue but another check fails. The mission stays in `precheck_failure` and can be retried again. There is no limit on retry attempts — the operator retries until checks pass or abandons the mission.

- **Precheck failure followed by `mission_init(force: true)`.** The operator decides to start over. `force: true` archives the `precheck_failure` mission and its items, same as it would for a `failed` mission. Planning work is lost, but this is an explicit operator choice.

- **Work items modified while in `precheck_failure`.** Work items remain fully accessible via MCP tools. Face could theoretically update items while in this state. This is acceptable — the items were created during planning, and the operator may want to adjust them before retrying.

- **Concurrent precheck calls.** If `mission_precheck` is called while the mission is already in `prechecking` state (e.g., double-click), the second call shall be rejected with a 400 error ("mission is already prechecking").

- **Session restart during `precheck_failure`.** The mission persists in the database. A new Claude Code session can pick up the mission in `precheck_failure` state and retry. No session-level state is required.

- **Stale mission-active marker.** If a previous session crashed during `running` and left a marker, `mission_init` already clears stale markers. The `precheck_failure` state does not interact with the marker at all (marker is only set on successful precheck).

---

## Dependencies

### Internal

| Dependency | Owner | Status |
|------------|-------|--------|
| Mission state machine (`MissionState` type) | kanban-viewer | Shipped — needs new state |
| `POST /api/missions/precheck` | kanban-viewer | Shipped — needs architectural rewrite (accept results, not run commands) |
| `mission_precheck` MCP tool | mcp-server | Shipped — needs schema change (carry results, not check names) |
| Orchestration playbooks | Plugin | Shipped — needs `precheck_failure` handling + Hannibal runs checks via Bash |
| Kanban UI mission status | kanban-viewer | Shipped — needs new state rendering |

### External

None. This is entirely internal to the A(i)-Team system.

---

## Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Operators get stuck in retry loop without understanding what to fix | Medium | Wasted time | Precheck response includes specific failure details (lint output, test names) |
| State machine complexity increases | Low | Maintenance burden | `precheck_failure` has exactly two transitions (retry or archive) — minimal complexity |
| Existing tooling doesn't recognize new state | Low | UI/API errors | `MissionState` type update propagates to all consumers via TypeScript |

### Open Questions

- [x] ~~Should there be a retry limit before auto-transitioning to `failed`?~~ **Decision:** No. The operator controls when to give up. Artificial retry limits add complexity without value — if the operator wants to retry 10 times, let them.
- [x] ~~Should `postcheck_failure` be added at the same time?~~ **Decision:** No. Postcheck failure has different semantics (code has been written, tests may be partially passing). Separate PRD if needed.
- [x] ~~Should the precheck failure details be stored on the mission record?~~ **Decision:** Yes. Store the `blockers` array and check output on the mission record so it's available across sessions and in the dashboard.
- [x] ~~Should full stdout/stderr be stored or just the summary blocker messages?~~ **Decision:** Both. Two separate nullable fields on the Mission DB record: `precheckBlockers` (JSON-encoded `string[]` of human-readable summary messages) and `precheckOutput` (JSON-encoded object with raw `stdout`, `stderr`, `timedOut` per check). Dashboard shows summary by default with expandable raw output. SQLite stores both as `TEXT` columns (no native array type).
- [x] ~~Should `mission_init` without `force` reject or archive a `precheck_failure` mission?~~ **Decision:** Reject with 409. The operator must either fix and retry or explicitly use `force: true` to archive. Creating a new mission should never silently destroy an in-progress `precheck_failure` mission. Error message: `"A mission is in precheck_failure state. Fix the issues and retry, or use force: true to archive and start over."`
- [x] ~~Dashboard: dropdown, tab, or slide-out drawer for mission history (req 24)?~~ **Decision:** Slide-out drawer (Option A). Master-detail layout: mission list on left rail, metadata detail on right when a row is selected. Triggered by a `History` icon button in the HeaderBar (right of the timer). Does not navigate away from the board.
- [x] ~~Dashboard: how to display `precheck_failure` state (req 16)?~~ **Decision:** Inline amber banner (Option A). Rendered between `ConnectionStatusIndicator` and `DashboardNav` in `page.tsx`. Amber left-border stripe, "PRECHECK FAILED / RECOVERABLE" label, blocker list, expandable raw output, "Retry Precheck" CTA button. Visually distinct from terminal `failed` (red) to signal recoverability.

---

## Additional Requirement: Mission History & Archive Access

### Problem

When `mission_init(force: true)` archives a mission, the old mission metadata (name, PRD path, state, timestamps) becomes inaccessible. There is no way to list past missions for a project or retrieve details about archived missions. This was discovered when a PRD 008 mission was accidentally overwritten by initializing PRD 009 — the operator had no way to confirm what the previous mission was or recover its metadata.

### Requirements

#### API Endpoints

18. The system shall provide a `GET /api/missions` endpoint that lists all missions for a project (active, completed, failed, archived), ordered by `startedAt` descending.

19. The `GET /api/missions` endpoint shall support filtering by state (e.g., `?state=archived`, `?state=completed`).

20. The system shall provide a `GET /api/missions/:missionId` endpoint that returns full details for any mission, including archived missions.

#### MCP Tools

21. A `mission_list` MCP tool shall be added that lists all missions for the current project. It shall support an optional `state` filter parameter.

22. The `mission_list` tool shall return: id, name, state, prdPath, startedAt, completedAt, archivedAt for each mission.

23. The existing `mission_current` tool behavior is unchanged — it returns only the active (non-archived) mission.

#### Dashboard

24. The kanban-viewer shall include a mission history slide-out drawer (triggered from HeaderBar) that shows past missions for the project, sorted by `startedAt` descending.

25. Selecting a mission in the history drawer shall show its metadata (name, PRD path, state badge, started/completed/archived dates, duration) in a read-only detail pane within the same drawer.

---

## Implementation Notes (from pre-implementation review)

These notes capture findings from codebase exploration that implementors should be aware of.

### Architectural correction: Hannibal runs checks, API stores results

**Current (broken) design:** `POST /api/missions/precheck` executes shell commands (`npm run lint`, `npm test`) inside the Docker container where the kanban-viewer runs. This is fundamentally wrong — the target project is never mounted into that container. The commands run in `/app` (the kanban-viewer source), not the user's project. The `ateam.config.json` `checks` configuration is silently ignored. The request body (including any `checks` parameter) is never read.

**Correct design:** The API is a state machine and result store — it should not execute anything. The agent (Hannibal) is the right place to run checks, because it has:
- Access to the Bash tool pointed at the target project
- Access to `ateam.config.json` to know what commands to run
- The correct working directory

**Implementation change:** Delete the `executeCommand` function and all command execution code from `packages/kanban-viewer/src/app/api/missions/precheck/route.ts`. Replace with logic that reads `passed`, `blockers`, and `output` from the request body and writes them to the database.

The `MissionPrecheckInputSchema` in `packages/mcp-server/src/tools/missions.ts` changes from `{ checks: z.array(z.string()).optional() }` to:
```typescript
{
  passed: z.boolean(),
  blockers: z.array(z.string()).default([]),
  output: z.object({
    lint: z.object({ stdout: z.string(), stderr: z.string(), timedOut: z.boolean() }).optional(),
    tests: z.object({ stdout: z.string(), stderr: z.string(), timedOut: z.boolean() }).optional(),
  }).default({}),
}
```

Hannibal's precheck flow (in orchestration playbooks):
1. Read `ateam.config.json` → get check commands (e.g. `checks.lint`, `checks.unit`)
2. Run each command via Bash in target project directory; capture stdout, stderr, exit code
3. Build `blockers` array (one message per failed check) and `output` object
4. Call `mission_precheck` MCP tool with `{ passed, blockers, output }`

**Note:** The postcheck route (`POST /api/missions/postcheck`) has the identical architectural flaw — it also runs shell commands inside the container. That will be addressed in a follow-up PRD.

### Pre-existing bug: mission-active marker never set

The MCP `mission_precheck` tool (`packages/mcp-server/src/tools/missions.ts` line 263) checks `result.data.allPassed` to decide whether to set the mission-active marker. The current API returns `{ success, data: { passed, ... } }` — a nested structure where `result.data.allPassed` is always `undefined`. The marker is therefore **never set** today.

Fix as part of this PRD: the API response shall include `allPassed: boolean` at the top level (see req 11), so the existing MCP check works correctly after the schema migration.

### Schema storage approach

Prisma + SQLite does not support native array columns. `precheckBlockers` and `precheckOutput` are stored as nullable `TEXT` columns containing JSON-encoded values:
- `precheckBlockers`: `JSON.stringify(string[])` — e.g. `'["Lint failed with 3 error(s)","Tests failed: 2 test(s) failed"]'`
- `precheckOutput`: `JSON.stringify({ lint?: { stdout, stderr, timedOut }, tests?: { stdout, stderr, timedOut } })`

Both are cleared (set to `null`) when transitioning from `precheck_failure` back to `prechecking` on retry.

### What already exists vs. what needs building

**Already implemented:**
- `GET /api/missions` — exists, returns all missions unfiltered. Needs `?state=` filter added (req 19).
- `mission-active` marker management — correctly handled in MCP server; no changes needed for the marker logic itself.
- `force: true` archival — correctly finds and archives `precheck_failure` missions (via `archivedAt: null` query). No special handling needed.

**Needs building:**
- `precheck_failure` state in `MissionState` type and Prisma schema fields (`precheckBlockers`, `precheckOutput`)
- Precheck route rewrite: remove `executeCommand` and all command execution; accept `{ passed, blockers, output }` from request body; transition state and store results
- `MissionPrecheckInputSchema` change in MCP server: replace `checks: string[]` with `{ passed, blockers, output }`
- `POST /api/missions` 409 guard for `precheck_failure` without force
- `?state=` filter on `GET /api/missions`
- `GET /api/missions/:missionId` (new route — only `[missionId]/token-usage` exists today)
- `mission_list` MCP tool
- `PrecheckFailureBanner` and `MissionHistoryPanel` + `MissionHistoryTrigger` UI components
- Orchestration playbook and `commands/run.md` updates (Hannibal reads `ateam.config.json`, runs checks via Bash, reports results)
