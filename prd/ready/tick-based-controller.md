---
missionId: ~
---

# Tick-Based Mission Controller

**Author:** Josh / Codex  **Date:** 2026-05-16  **Status:** Ready (rev 2 — 2026-05-09)

## 1. Context & Background

Hannibal currently runs in the main Claude Code context. That keeps orchestration visible and gives the operator direct control, but it also means the main session carries mission state, orchestration rules, board snapshots, peer messages, tool outputs, and recovery logic for the full mission duration.

Recent local token telemetry from `packages/kanban-viewer/prisma/data/ateam.db` shows the cost profile clearly. For mission `M-20260507-001`, Hannibal was recorded on `claude-opus-4-7` with max observed cumulative counters around:

| Counter | Max observed |
|---|---:|
| Output tokens | 1,167,573 |
| Cache creation tokens | 25,438,618 |
| Cache read tokens | 534,314,011 |

The model-selection fix is already shipped: `/ai-team:run` and `/ai-team:resume` enforce Sonnet via frontmatter and a runtime check. Per-token price on Sonnet vs. Opus is ~5× cheaper, so that was the largest single cost lever. However, it does not address the architectural issue: a long-lived mission loop keeps reusing a large context window for deterministic bookkeeping, and volume of cache reads scales with mission length regardless of model.

**What the playbooks actually cost.** Reading the current codebase:
- `playbooks/orchestration-native.md` is **1,235 lines (~38 KB)** — loaded once at mission start, stays in Hannibal's context for the full mission.
- Every tool call result (deps-check, pool status, board state, agent FYI/ALERT messages) accumulates on top of this base.
- The 534 M cache-read tokens on a single mission represent this large context being re-read on every generation turn across hundreds of tool calls in the orchestration loop.

Eliminating the playbook from steady-state orchestration context is the highest-leverage architectural change remaining.

The A(i)-Team already has the right persistence boundary. Mission state, item stages, claims, work logs, activity, dependency state, and health signals live in the API/database. Claude Code is still required for Claude-native dispatch primitives (`Task`, `TeamCreate`, `SendMessage`, `ScheduleWakeup`), but the decision of *what deterministic action is legal next* does not need to be recomputed by a model on every loop.

## 2. Problem Statement

Hannibal spends too many model tokens performing deterministic orchestration work that can be computed from API state. This increases mission cost and makes long-running missions sensitive to context growth, even when the main model is Sonnet.

The current loop also couples three concerns in one long-lived context:

- Deterministic state management: WIP limits, dependency readiness, stale claims, active stage counts, legal transitions.
- Claude Code dispatch mechanics: spawning agents and sending messages with Claude-native tools.
- Judgment: ambiguous rejection routing, recovery choices, escalation to humans.

Only the third concern requires an LLM most of the time.

## 3. Goals & Success Metrics

| Goal | Metric | Target |
|---|---|---:|
| Reduce main-session token usage | Hannibal/main-session cache-read tokens per mission | 50–65% reduction vs. current Sonnet baseline (see note) |
| Eliminate playbook from steady-state context | Playbook lines loaded per tick in normal operation | 0 (playbook only loaded on `needsJudgment`) |
| Preserve Claude Code-native dispatch | Pipeline workers still launched through Claude Code `Task` / native teams | 100% |
| Avoid long-lived external LLM processes | No subprocess Claude workers required for MVP | 0 subprocess Claude instances |
| Keep mission recovery source-of-truth in API | `/ai-team:resume` can reconstruct from board/controller state | 100% of active stages |
| Limit orchestration latency | Median time from free lane + ready item to dispatch | < 30s in active mode |

> **Target rationale.** The 80% figure in the original draft assumed each tick fires in a fully isolated context. `ScheduleWakeup` fires in the *same* Claude Code session — context accumulates across ticks and autocompact determines how much is pruned between wakes. A 50–65% cache-read reduction is achievable without relying on autocompact timing; 80% is achievable only if autocompact consistently fires between ticks. Measuring real missions after Phase 2 rollout will tighten this range.

## 4. Scope

### In Scope

- Add a deterministic `ateam controller tick --json` command.
- Make the controller read board, mission, dependency, claim, activity, and health state from the API.
- Make the controller return a small action plan for Claude Code to execute.
- Add a new `/ai-team:tick` command that runs one controller tick, executes returned Claude-required actions, and schedules the next tick.
- Update `/ai-team:run` and `/ai-team:resume` to start the tick loop instead of loading the full orchestration playbook for every decision.
- Persist controller checkpoint state outside Claude context.
- Support both legacy dispatch and native teams dispatch, with Claude Code still performing the actual dispatch calls.
- Add bounded `needsJudgment` responses for cases that require model reasoning.
- Keep existing worker agents and `ateam agents-stop agentStop` handoff semantics intact.

### Out of Scope

- Running worker Claude instances outside the current Claude Code session.
- Replacing Murdock, B.A., Lynch, Amy, Stockwell, or Tawnia with non-Claude processes.
- Removing the existing orchestration playbooks in the first iteration.
- Programmatically triggering `/compact` from the plugin. Claude Code does not expose that as a plugin API.
- Rebuilding the Kanban viewer UI around the controller in MVP.
- Full Pi/Ollama worker execution. The controller design should make that easier later, but does not require it.

## 5. Proposed Model

The controller is **tick-based**, not daemon-based.

It does not stay alive as a long-running process. Instead, Claude Code runs it at decision points:

```text
/ai-team:run
  -> initialize mission
  -> run /ai-team:tick

/ai-team:tick
  -> ateam controller tick --json
  -> Claude executes dispatch/message/wakeup actions
  -> ScheduleWakeup("/ai-team:tick", nextWakeSeconds)
```

The controller stays "alive" by persisting state externally:

- API database: mission, items, stages, claims, work logs, activity, health report.
- Pool directory: `/tmp/.ateam-pool/{missionId}` for native teams lane markers, if still used.
- Controller checkpoint: last tick timestamp, last activity cursor, pending dispatch records, last known lane state, and retry counters.

Claude Code remains the only component that calls Claude-native primitives:

- `Task(...)`
- `TeamCreate(...)`
- `SendMessage(...)`
- `ScheduleWakeup(...)`

The controller only returns the plan.

## 6. Controller Output Contract

`ateam controller tick --json` shall return a bounded JSON object:

```json
{
  "missionId": "M-20260507-001",
  "mode": "native-teams",
  "state": "coding",
  "nextWakeSeconds": 30,
  "summary": "1 dispatch, 2 active lanes, no stalls",
  "actions": [
    {
      "id": "M-20260507-001:WI-014:dispatch:murdock:1",
      "kind": "dispatch",
      "agent": "murdock",
      "name": "murdock-1",
      "itemId": "WI-014",
      "itemTitle": "Add rate-limiting middleware",
      "why": "WI-014 in ready; murdock-1 idle; testing WIP 1/3"
    }
  ],
  "messages": [],
  "needsJudgment": null
}
```

> **No prompts in the action JSON.** The controller returns only the item ID and enough metadata for Claude to construct the dispatch. Claude calls `ateam items renderItem --id {itemId}` at dispatch time to get the full rendered item. This keeps the tick JSON under 1 KB for a typical dispatch action and avoids embedding worker prompts (which can be 2–4 KB each) into the controller response. The rendered item is consumed once per dispatch, the same as in the current playbook.

**Action kinds:**

| `kind` | When returned | Claude action |
|---|---|---|
| `dispatch` | Ready item + idle agent instance | `renderItem`, then `Task` or `SendMessage` |
| `release` | Stale claim: stale > threshold, zero activity, health flagged | `ateam board-release releaseItem` |
| `message` | Pending alert drain: item queued for next-stage agent | `SendMessage` to named instance |
| `final-review` | All items in `done` stage | Dispatch Stockwell via `Task` |
| `move` | Item in `briefings`, deps satisfied | `ateam board-move moveItem --toStage ready` (Phase 3+) |
```

When no Claude action is needed:

```json
{
  "missionId": "M-20260507-001",
  "mode": "native-teams",
  "state": "coding",
  "nextWakeSeconds": 60,
  "summary": "All lanes busy; next health check in 60s",
  "actions": [],
  "messages": [],
  "needsJudgment": null
}
```

When model judgment is needed:

```json
{
  "missionId": "M-20260507-001",
  "mode": "native-teams",
  "state": "coding",
  "nextWakeSeconds": null,
  "summary": "Ambiguous rejection routing requires Hannibal judgment",
  "actions": [],
  "messages": [],
  "needsJudgment": {
    "type": "rejection-routing",
    "itemId": "WI-018",
    "reason": "Amy flagged both missing test coverage and implementation behavior",
    "options": ["return-to-testing", "return-to-implementing"],
    "evidence": "..."
  }
}
```

## 7. Functional Requirements

1. The system shall provide `ateam controller tick --json`.
2. The controller shall read the current mission via the existing mission API or CLI client.
3. The controller shall read the board state, item dependencies, active claims, recent activity, and mission health before producing actions.
4. The controller shall never call Claude Code `Task`, `TeamCreate`, `SendMessage`, or `ScheduleWakeup` directly.
5. The controller shall return all Claude-required work as explicit JSON `actions`.
6. `/ai-team:tick` shall execute controller actions using Claude Code tools and then schedule the next tick when `nextWakeSeconds` is present.
7. `/ai-team:tick` shall keep its model prompt small: it shall not read the full orchestration playbook unless `needsJudgment` requires Hannibal reasoning.
8. The controller shall preserve existing stage transition rules from `packages/shared/src/stages.ts`.
9. The controller shall respect WIP limits and dependency readiness before returning dispatch actions.
10. The controller shall support active-mode tick cadence:
    - ready item + free lane: return `nextWakeSeconds` <= 5 after action execution.
    - all lanes busy: return `nextWakeSeconds` between 30 and 60.
    - no active work and waiting on dependencies: return `nextWakeSeconds` between 120 and 300.
    - suspected stall: return immediate recovery action or `needsJudgment`.
11. The controller shall detect stale claims from health-report data and return recovery actions when deterministic recovery is safe.
12. The controller shall return `needsJudgment` instead of guessing when safe recovery requires interpretation beyond encoded rules.
13. The controller shall persist a checkpoint after every tick, including timestamp, mission ID, mode, action IDs returned, and activity cursor.
14. The controller shall make tick actions idempotent. Re-running the same tick after Claude interruption shall not double-dispatch the same item.
15. `/ai-team:run` shall initialize the controller tick loop after mission setup/precheck.
16. `/ai-team:resume` shall clear stale transient state, rehydrate controller checkpoint state from the API, and run `/ai-team:tick`.
17. The controller shall expose a dry-run mode for tests: `ateam controller tick --json --dry-run`.
18. The controller shall log every returned action to `ActivityLog` with enough detail to audit why it was selected.

## 8. Non-Functional Requirements

1. A controller tick shall complete in < 2s for missions with <= 100 items.
2. The controller JSON response should remain < 8KB in normal operation.
3. Dispatch prompts returned by the controller should include only the rendered item, relevant rejection/work-log context, and agent-specific instruction needed for that handoff.
4. The tick command shall not require a long-lived daemon or background service.
5. The design shall continue to work if Claude Code is interrupted between ticks.
6. The design shall continue to work if Claude Code compacts between ticks.
7. The controller shall fail closed for unsafe actions: if state is ambiguous, return `needsJudgment` rather than dispatching.
8. Existing legacy orchestration commands shall remain available behind a fallback flag for at least one release.

## 9. Edge Cases & Error States

- **Claude executes a dispatch action, then crashes before the next tick.** The next `/ai-team:resume` reads claims/activity and continues from board state. The controller checkpoint records that the action was emitted; the board/claim state records whether it actually took effect.
- **Controller emits an action but Claude does not execute it.** The action has an ID and remains pending until a future tick confirms the corresponding board/claim state or expires it.
- **A worker finishes between controller tick and Claude action execution.** Claude runs the action against fresh API state where possible. If the action is stale, the CLI/API rejects it and `/ai-team:tick` immediately runs another tick.
- **Native teams lane marker disagrees with API claim.** API claim wins. The controller repairs or recreates pool markers from API state.
- **No ready items but active work exists.** Controller schedules a longer tick and does not wake Hannibal for reasoning.
- **Amy/Lynch rejection is ambiguous.** Controller returns `needsJudgment` with the minimal evidence packet.
- **Final review rejects multiple items.** Controller does not route broad mission rollback unless the Stockwell rejection is already structured in the API. Otherwise it returns `needsJudgment`.
- **Controller cannot reach API.** `/ai-team:tick` reports the API failure and schedules a short retry or asks the operator to restart the kanban service.
- **Claude model is Opus.** `/ai-team:run`, `/ai-team:resume`, and `/ai-team:tick` keep the existing model check and ask the operator to switch to Sonnet before running orchestration.

## 10. Design Principles

- **Claude dispatches; code decides.** Claude Code keeps ownership of Claude-native tools. Deterministic state decisions move to code.
- **No daemon until proven necessary.** Stateless ticks are easier to recover, test, and reason about than a long-running process.
- **API state is the source of truth.** The controller may cache cursors and action IDs, but it must reconstruct from API state.
- **Small prompts by default.** The normal tick path should not load the full orchestration playbook or long board dumps into Claude context.
- **Escalate ambiguity, not bookkeeping.** Hannibal remains valuable for judgment, recovery, and operator-facing decisions, not repeated WIP accounting.
- **Preserve current worker contracts.** Pipeline agents should not need to know whether Hannibal or the controller selected their dispatch.

## 11. Technical Approach

### CLI

Add a controller command group to `packages/ateam-cli`. The existing `cmd/` directory has 88 Go files; new files follow the same `{resource}_{command}.go` naming pattern. The existing `internal/client/client.go` HTTP client handles all API calls — no new HTTP machinery needed.

**New files:**

```text
packages/ateam-cli/cmd/controller_tick.go
packages/ateam-cli/cmd/controller_checkpoint_get.go
packages/ateam-cli/cmd/controller_checkpoint_put.go
```

**Commands exposed:**

```text
ateam controller tick --json [--dry-run] [--mission-id <id>]
ateam controller checkpoint get --json [--mission-id <id>]
ateam controller checkpoint put --json --data '...'
```

**What `controller_tick.go` does (read-only calls the CLI already supports):**

```text
1. GET /api/missions/current                → mission ID, mode, state
2. GET /api/items?stage=ready               → items available for dispatch
3. GET /api/missions/{id}/health-report     → stale claims, stuck items
4. GET /api/deps-check                      → readyItems (briefings → ready candidates)
5. GET /api/stages                          → current WIP limits and per-stage counts
6. GET /api/pool/status (if native mode)    → idle/busy instance state
7. GET /api/controller-checkpoint/{id}      → last tick state (action IDs, cursor, retries)
```

The tick applies the stage transition rules from `packages/shared/src/stages.ts` — duplicated as a Go constant map in `cmd/controller_tick.go` so the CLI has no Node.js dependency. The API already validates transitions on `board-move`; the controller uses the map only to compute which actions are legal before returning them, not as an authoritative source.

**Checkpoint persistence — API-backed (preferred):**

New API endpoint on the kanban-viewer server:

```
GET  /api/controller-checkpoint/:missionId   → returns checkpoint JSON
POST /api/controller-checkpoint/:missionId   → upserts checkpoint JSON
```

Checkpoint schema:

```json
{
  "missionId": "M-20260507-001",
  "tickedAt": "2026-05-09T14:22:00Z",
  "activityCursor": 487,
  "pendingActionIds": ["M-20260507-001:WI-014:dispatch:murdock:1"],
  "confirmedActionIds": ["M-20260507-001:WI-013:dispatch:murdock:1"],
  "retryCounters": { "WI-014": 1 },
  "lastLaneState": { "murdock-1": "busy", "murdock-2": "idle" }
}
```

API persistence survives working-directory changes and is visible to the Kanban dashboard. A local-file fallback (`/tmp/.ateam-controller/{missionId}/checkpoint.json`) is acceptable if the API endpoint is not available (older server version), using the same schema.

**Idempotency via action IDs:**

Every action in the tick response carries a stable ID composed of `missionId:itemId:kind:agent:sequence`. Before returning a dispatch action, the controller checks `pendingActionIds` in the checkpoint. If the action ID is already pending (emitted in a previous tick but not yet confirmed), the controller skips re-emitting it. Claude confirms an action by calling `ateam controller checkpoint put` after executing it, moving the ID from `pendingActionIds` to `confirmedActionIds`.

**Transition matrix (Go constant — mirrors `packages/shared/src/stages.ts`):**

```go
var validTransitions = map[string][]string{
    "briefings":    {"ready", "blocked"},
    "ready":        {"testing", "implementing", "probing", "blocked", "briefings"},
    "testing":      {"implementing", "blocked"},
    "implementing": {"review", "blocked"},
    "probing":      {"ready", "done", "blocked"},
    "review":       {"testing", "implementing", "probing", "blocked"},
    "done":         {},
    "blocked":      {"ready"},
}

// Pipeline stage → dispatching agent
var stageAgent = map[string]string{
    "testing":      "murdock",
    "implementing": "ba",
    "review":       "lynch",
    "probing":      "amy",
}
```

These are compile-time constants; any divergence from the shared TypeScript source should be caught by cross-language fixture tests (see §7, requirement 8).

### Shared Rules

The shared TypeScript layer (`packages/shared/src/stages.ts`) already exports:
- `TRANSITION_MATRIX` — legal from/to stage pairs
- `PIPELINE_STAGES` — stage → agent mapping, nextStage
- `ALL_STAGES` — ordered pipeline

The controller **duplicates the transition matrix and agent mapping as Go constants** (`cmd/controller_tick.go`) rather than calling into Node.js at runtime. The duplication surface is small (~15 lines of constants) and must be kept in sync via fixture tests that compare the Go constants against the TypeScript exports.

The following logic moves from the playbook into Go:
- **WIP capacity check**: compare current stage item count against `wip_limits` from `/api/stages`
- **Dependency readiness**: call `/api/deps-check` and filter `readyItems` to items still in `briefings`
- **Stale-claim detection**: read `health-report` stale signals; safe recovery (stale > threshold, zero activity, health flagged) = `release` action; ambiguous = `needsJudgment`
- **All-items-done detection**: check board for all items in `done`; return `final-review` action kind
- **Pool state reading**: call `ateam pool status --json` (API-backed) — not raw `ls $POOL_DIR`. Pipeline agents still use file-based claims for peer handoffs; the controller reads the API mirror of that state for health checks and idle-instance detection.
- **Agent mapping**: `stageAgent` map above, no inference needed
- **Tick cadence**: `nextWakeSeconds` rules from FR #10

Dispatch prompt rendering stays in Claude (via `ateam items renderItem`) — not in Go. The controller does not synthesize prompts.

### Slash Commands

**New: `commands/tick.md`** (target: ~60 lines, no playbook load)

1. Run `ateam controller tick --json`.
2. **Always** print `[Hannibal] {summary}` — even on quiet ticks with no actions.
3. If `actions` is non-empty, execute each in order by `kind`:
   - `dispatch`: call `ateam items renderItem --id {itemId}`, then `Task` or `SendMessage` per mode.
   - `message`: call `SendMessage` with the provided recipient and content.
   - `release`: call `ateam board-release releaseItem --itemId {itemId}`.
   - `final-review`: fetch `prdPath` from `ateam missions-current --json`, dispatch Stockwell via `Task`.
   - `move`: call `ateam board-move moveItem --itemId {itemId} --toStage ready` (Phase 3+).
   - After each action, call `ateam controller checkpoint put` to confirm the action ID.
4. If `needsJudgment` is present (and `actions` is empty), load only the evidence packet from `needsJudgment.evidence` and reason over it. Load the relevant playbook section only if judgment requires it.
5. If `nextWakeSeconds` is present, call `ScheduleWakeup(delaySeconds: nextWakeSeconds, prompt: "/ai-team:tick")`.

The tick command must NOT load either orchestration playbook in the default (no-judgment) path. The playbook sections for recovery and routing exist only for `needsJudgment` cases.

**Update `commands/run.md`:**
- After precheck passes and mission transitions to `running`, enter tick loop instead of loading the orchestration playbook.
- The playbook load (`Read("$CLAUDE_PLUGIN_ROOT/playbooks/orchestration-native.md")`) moves from step 3 of `run.md` to a conditional load inside `tick.md` only when `needsJudgment` is returned.
- Steps 1–2 (validate mission, run precheck) remain unchanged.

**Update `commands/resume.md`:**
- After clearing stale agent assignments, call `ateam controller checkpoint get --json` to rehydrate pending action state.
- Then enter the tick loop (`/ai-team:tick`) rather than loading the playbook.
- The playbook load in step 4 of the current `resume.md` is removed.

**Update `commands/healthcheck.md`:**
- Replace the manual health inspection steps with `ateam controller tick --json` (the controller already reads health-report as part of its state assessment).
- Keep the ScheduleWakeup re-arm at the top of healthcheck — this is already correct.

### Action IDs

Every action returned by the controller includes a stable ID (see CLI section for format). Action ID lifecycle:

1. Controller emits action with ID → ID added to `pendingActionIds` in checkpoint.
2. Claude executes action → calls `ateam controller checkpoint put` to move ID to `confirmedActionIds`.
3. Next tick sees confirmed ID → skips re-emitting. After board/claim state matches the action's intent, the ID is pruned from confirmed list.

On crash between steps 1 and 2: the next `ateam controller tick` sees `pendingActionIds` and re-emits only actions whose board/claim state has not yet reflected the intended change. If board state already reflects the action (item was claimed, stage was advanced), the controller skips re-emission even if the ID is still pending.

### Prompt Rendering

Dispatch prompts stay in Claude's hands, not the controller's. The tick command calls `ateam items renderItem --id {itemId}` at dispatch time and uses the rendered output as the item context block in the agent `Task` prompt. This is identical to the current playbook pattern — the change is that the *decision* of which item to dispatch is made in Go, while the *construction* of the prompt remains in Claude's context turn.

The controller does not return prompts. This keeps the tick JSON under 1 KB for normal dispatch actions and avoids bloating the JSON with 2–4 KB per-agent prompt content that Claude would need to read anyway to pass to `Task`.

## 12. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Tick polling adds dead time | Medium | Medium | Adaptive cadence; immediate tick after dispatch; shorter ticks when lanes are free |
| Controller duplicates subtle playbook behavior incorrectly | Medium | High | Port rules incrementally; keep legacy playbook fallback; add fixture tests from real missions; Go constants mirror TypeScript source with cross-language tests |
| Claude fails to execute a returned action | Medium | Medium | Action IDs, pending action checkpoint, stale-action detection on next tick via board/claim state comparison |
| `needsJudgment` cases are more common than expected, offsetting savings | Medium | Medium | Accept partial savings; `needsJudgment` still loads less context than the full playbook (evidence packet only) |
| Token savings depend on autocompact timing between ticks | High | Medium | Adopt 50–65% target rather than 80%; measure actual savings across two missions before committing to a specific target |
| Go transition matrix diverges from `stages.ts` | Low | High | Fixture test that loads both and compares the resulting maps; fails build on divergence |
| Debuggability worsens because logic moves from visible Hannibal reasoning into code | Medium | Medium | Log action rationale field to ActivityLog (`why: "WI-014 ready, murdock-1 idle, testing WIP 1/3"`); expose dry-run output |

### Open Questions

All questions resolved:

1. ~~Checkpoint location?~~ **API DB via `/api/controller-checkpoint/:missionId`, local `/tmp/` fallback for older servers.**
2. ~~Tick visibility?~~ **Print `summary` line on every tick, always. Operator always knows the loop is alive.**
3. ~~Stockwell dispatch scope?~~ **Controller detects all-items-done and returns a `kind: "final-review"` dispatch action. Consistent — all dispatch decisions live in the controller.**
4. ~~Pool state boundary?~~ **Hybrid: pipeline agents keep file-based claims for zero-latency peer handoffs; the API additionally tracks pool state for dashboard visibility and controller health checks. `ateam pool status` already writes to the API — the controller reads that endpoint, not raw `ls`.**
5. ~~Controller read-only vs. mutations?~~ **Action plans only in Phase 1–2. Board mutations (release, pool cleanup) move to the controller in Phase 3.**
6. ~~Stale-claim release timing?~~ **Auto-release in Phase 2 for clear-cut stalls: stale > threshold AND zero activity AND health report flags it → `release` action. Ambiguous cases (recent activity, short stall, incomplete signal) → `needsJudgment`.**

## 13. Rollout Plan

### Phase 1: Tick Command + Playbook Removal (Highest Value)

This phase delivers the largest token reduction with no Go CLI work required.

- Add `commands/tick.md` (~60 lines).
- Update `commands/run.md`: remove step 3 playbook load; after precheck, call `/ai-team:tick` instead.
- Update `commands/resume.md`: remove playbook load; after stale-claim cleanup, call `/ai-team:tick`.
- The tick command in Phase 1 executes with a stub controller: calls `ateam board getBoard --json`, `ateam deps-check checkDeps --json`, and applies hardcoded logic inline to produce the same action set the playbook would produce, without the 1,200-line context.
- Measure cache-read token delta on first real mission. This establishes the savings baseline before the Go controller is built.

### Phase 2: Go Controller — Read-Only

- Implement `ateam controller tick --json --dry-run` in `cmd/controller_tick.go`.
- Implement checkpoint commands (`cmd/controller_checkpoint_get.go`, `cmd/controller_checkpoint_put.go`).
- Add API endpoint `GET/POST /api/controller-checkpoint/:missionId` to the kanban-viewer server.
- Add fixture tests comparing Go output against real board state snapshots.
- Add cross-language test confirming Go transition map equals TypeScript `TRANSITION_MATRIX`.
- Switch `commands/tick.md` to call `ateam controller tick --json` instead of inline logic.
- Keep existing playbook commands available behind `--legacy` flag on `/ai-team:run`.

### Phase 3: Health and Recovery Actions

- Add `release` and `move` action kinds to the controller output.
- Controller handles deterministic stale-claim release and safe re-dispatch.
- Ambiguous recovery (timeout without ALERT, multi-item rejection, degraded lanes) returns `needsJudgment`.
- Update `commands/healthcheck.md` to delegate to `ateam controller tick --json`.

### Phase 4: Default Path

- Make tick-based orchestration the default for `/ai-team:run` and `/ai-team:resume`.
- Remove legacy playbook load from both commands entirely.
- Keep legacy playbook files in `playbooks/` for one release (documentation and fallback only).
- Measure final token and latency impact across two representative missions and compare against Phase 1 baseline.

## 14. Measurement Plan

- Record main-session token usage before and after rollout.
- Track controller tick count, dispatch latency, and number of `needsJudgment` escalations.
- Compare mission wall-clock time against legacy/native playbook runs.
- Compare worker failure/rejection rates to make sure smaller prompts do not degrade quality.
- Track API errors for stale action execution and idempotency conflicts.

## 15. Rollback Criteria

- Any regression that causes duplicate worker dispatch for the same item.
- Any regression that moves items through illegal stage transitions.
- Any regression that strands active items without a recoverable `/ai-team:resume` path.
- Main-session token savings below 30% after two representative missions.
- Median dispatch latency over 90s when ready items and free lanes exist.

