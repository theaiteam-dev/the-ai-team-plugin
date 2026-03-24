# Orchestration Playbook: Legacy Mode

> **You are in LEGACY mode.** Use `Task` with `run_in_background: true` and poll with `TaskOutput`.

Read `docs/ORCHESTRATION.md` for environment setup, permissions, and dispatch reference.

This playbook contains the complete orchestration loop, agent dispatch patterns, completion detection, and concrete examples for legacy (Task/TaskOutput) dispatch mode.

## Task Tracking

Maintain a map of active tasks:
```
active_tasks = {
  "001": "task_abc123",  // item_id → task_id from Task tool
  "002": "task_def456"
}
```

When dispatching agents with `run_in_background: true`, the Task tool returns a task_id. Store this to poll individual items later.

## Precheck Flow

Hannibal runs precheck by executing commands and forwarding results to the API — the API does not run commands itself.

```
1. Read ateam.config.json to get check commands
2. Run each command via Bash (capturing stdout, stderr, exit code)
3. Build the result payload:
     passed   = all exit codes were 0
     blockers = human-readable failure messages for each failed check
     output   = { lint: {stdout,stderr,timedOut}, tests: {stdout,stderr,timedOut} }
4. Run: ateam missions-precheck missionPrecheck --passed {passed} --blockers [...] --output {...}
```

### precheck_failure: Recoverable State

`precheck_failure` is a **non-terminal, recoverable** state. It means the checks ran but found problems. The mission is NOT failed — it can be retried.

**When `ateam missions-current getCurrentMission` returns `precheck_failure`:**
- The mission state is `precheck_failure` — blockers from the last run are stored in the API database.
  Fetch them via `GET /api/missions/current` (REST endpoint) with header `X-Project-ID: <ATEAM_PROJECT_ID>`
  — this returns the full mission record including the `precheckBlockers` array. The
  `ateam missions-current getCurrentMission` command returns a simplified object without the
  `precheckBlockers` field; use the REST endpoint or the `ateam missions-precheck` response instead.
- Display the blockers to the operator:
  ```
  [Hannibal] Previous precheck failed. Blockers:
  - {blocker 1}
  - {blocker 2}
  Fix these issues and re-run /ai-team:run to retry.
  ```
- When `/ai-team:run` is called again: skip re-planning, re-run precheck directly
- On retry pass: mission transitions to `running`, pipeline begins normally
- On retry fail: mission stays in `precheck_failure`, operator is shown new blockers

**Terminal vs. non-terminal mission states:**
- Non-terminal (recoverable): `initializing`, `prechecking`, `precheck_failure`, `running`, `postchecking`
- Terminal: `completed`, `failed`, `archived`

## Mission-Active Marker

The API server automatically manages a marker file (`/tmp/.ateam-mission-active-{projectId}`) that tells enforcement hooks a mission is running:

- **`ateam missions-precheck missionPrecheck`** sets the marker when all checks pass
- **`ateam missions-archive archiveMission`** clears the marker
- **`ateam missions createMission`** clears any stale marker from a previous crashed session

No manual `Bash` commands needed — the marker lifecycle is handled at the code level.

## The Orchestration Loop

**Check for precheck retry at start of run:**
If mission state is `precheck_failure`:
  - Display blockers to operator (fetch from `GET /api/missions/current` REST endpoint with header `X-Project-ID: <ATEAM_PROJECT_ID>`)
  - Re-run the precheck flow (same steps as in the Precheck Flow section above)
  - If passed: continue to main orchestration loop below
  - If failed: run `ateam missions-precheck missionPrecheck` with `passed: false` to update blockers and exit — operator must fix issues before retrying

**Two concerns, handled differently:**
1. **Dependency gates** - items wait in `ready` stage for deps (between waves)
2. **Pipeline flow** - items advance immediately on completion (within waves)

```
active_tasks = {}  # item_id → task_id

LOOP CONTINUOUSLY:

    # ═══════════════════════════════════════════════════════════
    # PHASE 1: POLL ACTIVE TASKS - ADVANCE IMMEDIATELY ON COMPLETION
    # ═══════════════════════════════════════════════════════════
    for item_id, task_id in list(active_tasks.items()):
        result = TaskOutput(task_id, block=false, timeout=500)

        if result shows completion:
            # === ADVANCE THIS ITEM RIGHT NOW ===
            del active_tasks[item_id]

            if item was in testing:
                Bash("ateam board-move moveItem --itemId {item_id} --toStage implementing --agent B.A.")
                new_task = dispatch B.A. in background
                active_tasks[item_id] = new_task.id
                # Don't wait for other testing items!

            elif item was in implementing:
                Bash("ateam board-move moveItem --itemId {item_id} --toStage review --agent Lynch")
                new_task = dispatch Lynch in background
                active_tasks[item_id] = new_task.id

            elif item was in review:
                if APPROVED:
                    # ═══ MANDATORY: Amy probes EVERY approved feature ═══
                    Bash("ateam board-move moveItem --itemId {item_id} --toStage probing --agent Amy")
                    new_task = dispatch Amy in background
                    active_tasks[item_id] = new_task.id
                    # DO NOT skip probing! DO NOT move directly to done!
                if REJECTED: Bash("ateam items rejectItem --id {item_id}")

            elif item was in probing:
                # Amy has completed investigation
                if VERIFIED: Bash("ateam board-move moveItem --itemId {item_id} --toStage done")
                if FLAG: Bash("ateam items rejectItem --id {item_id}")
                # Moving to done may unlock Wave 2 items!

    # ═══════════════════════════════════════════════════════════
    # PHASE 2: CHECK DEPENDENCY GATES - UNLOCK NEXT WAVE ITEMS
    # ═══════════════════════════════════════════════════════════
    # Check for newly ready items
    deps_result = Bash("ateam deps-check checkDeps --json")

    for item_id in deps_result.readyItems:
        if item is in briefings stage:
            Bash("ateam board-move moveItem --itemId {item_id} --toStage ready")
            # This item's deps are now satisfied

    # ═══════════════════════════════════════════════════════════
    # PHASE 3: FILL PIPELINE FROM READY (per-column WIP limits)
    # ═══════════════════════════════════════════════════════════
    # No global WIP throttle — each column enforces its own limit.
    # board-move rejects moves when the target column is full.
    while ready stage not empty:
        pick ONE item from ready stage
        result = Bash("ateam board-move moveItem --itemId {item_id} --toStage testing --agent Murdock")
        if result is WIP error: break  # testing column is full
        new_task = dispatch Murdock in background
        active_tasks[item_id] = new_task.id

    # When finalReviewReady: true → dispatch Lynch for Final Review

    # Brief pause then repeat
```

**KEY BEHAVIORS:**
- Phase 1: Advance items IMMEDIATELY - no waiting for siblings
- Phase 2: Unlock next-wave items when deps complete (correct waiting)
- Phase 3: Keep pipeline full — per-column WIP limits enforced by board-move

## Minimizing Per-Cycle Token Spend

- Use `ateam deps-check checkDeps --json` (default) in the orchestration loop. Only add `--verbose` for debugging stuck dependencies.
- Run `ateam board getBoard --json` only when you need the full board state (start of loop, after wave completion). Between those, track state from agent completion results instead of re-reading the full board.
- Use `ateam items listItems --json` filtered to `stage=ready` instead of `ateam board getBoard` when you only need to check the ready queue.

## TaskOutput Polling Pattern

Use the Claude Code `TaskOutput` tool to poll background agents:
```
TaskOutput(task_id: "...", block: false, timeout: 500)
```

- `task_id` = ID returned when dispatching agent with `run_in_background: true`
- `block: false` = non-blocking, returns immediately with current status
- `timeout: 500` = wait max 500ms for any output
- Returns: agent output if complete, OR timeout/still-running indicator

**Poll each task individually - don't batch:**
```
# CORRECT
result_a = TaskOutput(task_a, block: false)
if result_a.complete: advance(001)
result_b = TaskOutput(task_b, block: false)
if result_b.complete: advance(002)

# WRONG - don't collect then batch
results = [TaskOutput(t) for t in tasks]
completed = [r for r in results if r.complete]
for c in completed: advance(c)  # BATCH!
```

## Concrete Example: Dependency Waves + Pipeline Parallelism

Setup:
- Wave 0: 001, 002 (no deps)
- Wave 1: 003 (depends on 001), 004 (depends on 001, 002)

```
T=0s    ateam deps-check checkDeps --json → readyItems: [001, 002], 003/004 blocked
        ateam board-move moveItem --itemId 001 --toStage ready
        ateam board-move moveItem --itemId 002 --toStage ready
        ateam board-move moveItem --itemId 001 --toStage testing --agent Murdock → dispatch Murdock (task_a)
        ateam board-move moveItem --itemId 002 --toStage testing --agent Murdock → dispatch Murdock (task_b)
        active_tasks = {001: a, 002: b}

T=30s   Poll a → COMPLETE!
        → IMMEDIATELY: ateam board-move moveItem --itemId 001 --toStage implementing --agent B.A., dispatch B.A. (task_c)
        active_tasks = {001: c, 002: b}
        (002 still in testing - that's fine, don't wait!)

T=55s   Poll b → COMPLETE!
        → IMMEDIATELY: ateam board-move moveItem --itemId 002 --toStage implementing --agent B.A., dispatch B.A. (task_d)
        active_tasks = {001: c, 002: d}

T=60s   Poll c → COMPLETE!
        → IMMEDIATELY: ateam board-move moveItem --itemId 001 --toStage review --agent Lynch, dispatch Lynch (task_e)
        active_tasks = {001: e, 002: d}

T=90s   Poll e → COMPLETE! (Lynch approved)
        → ateam board-move moveItem --itemId 001 --toStage probing --agent Amy, dispatch Amy (task_f)
        active_tasks = {001: f, 002: d}

T=100s  Poll f → COMPLETE! (Amy verified)
        → ateam board-move moveItem --itemId 001 --toStage done
        ateam deps-check checkDeps --json → readyItems: [003]  ← 003's dep (001) now satisfied!
        ateam board-move moveItem --itemId 003 --toStage ready  (004 still blocked - needs 002 done too)
        ateam board-move moveItem --itemId 003 --toStage testing --agent Murdock → dispatch Murdock (task_g)
        active_tasks = {002: d, 003: g}

T=105s  Poll d → COMPLETE!
        → IMMEDIATELY: ateam board-move moveItem --itemId 002 --toStage review --agent Lynch, dispatch Lynch (task_h)
        active_tasks = {002: h, 003: g}

T=120s  Poll h → COMPLETE! (Lynch approved 002)
        → ateam board-move moveItem --itemId 002 --toStage probing --agent Amy, dispatch Amy (task_i)
        active_tasks = {002: i, 003: g}

T=130s  Poll i → COMPLETE! (Amy verified 002)
        → ateam board-move moveItem --itemId 002 --toStage done
        ateam deps-check checkDeps --json → readyItems: [004]  ← 004's deps (001,002) now satisfied!
        ateam board-move moveItem --itemId 004 --toStage ready
```

**KEY INSIGHTS:**
1. Within Wave 0: 001 advances to review while 002 is still implementing (no stage batching)
2. Between waves: 003 unlocks when 001 hits done, 004 unlocks when both 001+002 hit done
3. Pipeline stays full - new items enter as deps are satisfied

## Agent Dispatch Workflows

### Dispatching Murdock (testing stage)

```
# Move to testing AND claim for Murdock
ateam board-move moveItem --itemId 001 --toStage testing --agent Murdock
```

Then dispatch:
```
Task(
  subagent_type: "ai-team:murdock",
  run_in_background: true,
  description: "Murdock: {feature title}",
  prompt: "... [Murdock prompt from agents/murdock.md]

  Feature Item:
  [Full content of the work item]

  Create the test file at: {outputs.test}
  If outputs.types is specified, also create: {outputs.types}

  STOP after creating these files. Do NOT create {outputs.impl} - B.A. handles implementation in the next stage."
)
```

### Dispatching B.A. (implementing stage)

```
# Move to implementing AND claim for B.A. (auto-releases Murdock's claim)
ateam board-move moveItem --itemId 001 --toStage implementing --agent B.A.
```

Then dispatch:
```
Task(
  subagent_type: "ai-team:ba",
  run_in_background: true,
  description: "B.A.: {feature title}",
  prompt: "... [B.A. prompt from agents/ba.md]

  Feature Item:
  [Full content of the work item]

  Test file is at: {outputs.test}
  Create the implementation at: {outputs.impl}"
)
```

**On retry (item was previously rejected):** Use agent name `ba-{id}-r{n}` and prepend rejection context:
```
Task(
  subagent_type: "ai-team:ba",
  run_in_background: true,
  description: "B.A.: {feature title} (retry {n})",
  name: "ba-{id}-r{n}",
  prompt: "... [B.A. prompt from agents/ba.md]

  ## Prior Rejection
  Lynch rejected this item: {rejection reason from work log}
  {Amy diagnosis if available}
  Address this specifically before anything else.

  Feature Item:
  [Full content of the work item]

  Test file is at: {outputs.test}
  Update the implementation at: {outputs.impl}"
)
```

### Dispatching Lynch (review stage)

```
# Move to review AND claim for Lynch (auto-releases B.A.'s claim)
ateam board-move moveItem --itemId 001 --toStage review --agent Lynch
```

Then dispatch:
```
Task(
  subagent_type: "ai-team:lynch",
  run_in_background: true,
  description: "Lynch: {feature title}",
  prompt: "... [Lynch prompt from agents/lynch.md]

  Feature Item:
  [Full content of the work item]

  Review ALL these files together:
  - Test: {outputs.test}
  - Implementation: {outputs.impl}
  - Types (if exists): {outputs.types}"
)
```

### Dispatching Amy (probing stage)

```
# Move to probing AND claim for Amy (auto-releases Lynch's claim)
ateam board-move moveItem --itemId 001 --toStage probing --agent Amy
```

Then dispatch:
```
Task(
  subagent_type: "ai-team:amy",
  run_in_background: true,
  description: "Amy: {feature title}",
  prompt: "... [Amy prompt from agents/amy.md]

  Feature Item:
  [Full content of the work item]

  Files to probe:
  - Test: {outputs.test}
  - Implementation: {outputs.impl}
  - Types (if exists): {outputs.types}

  Execute the Raptor Protocol. Respond with VERIFIED or FLAG."
)
```

**Hook enforcement:** Amy's `enforce-browser-verification` Stop hook will block her from completing without performing browser verification on UI features. The `track-browser-usage` PreToolUse hook tracks whether Amy has used agent-browser or Playwright tools during her session.

## Tracking Active Agents

Use `run_in_background: true` for pipeline parallelism. The Task tool returns a task_id.

Check on agents with `TaskOutput(task_id, block: false)`.

Read current assignments from board:
```
ateam board getBoard --json
```

## Final Mission Review Dispatch

When ALL items reach `done` stage, fetch `prdPath` from `ateam missions-current getCurrentMission --json`, then dispatch:

```
Task(
  subagent_type: "ai-team:stockwell",
  run_in_background: true,
  description: "Stockwell: Final Mission Review",
  prompt: "You are Stockwell conducting a FINAL MISSION REVIEW.

  PRD path: {prdPath from ateam missions-current getCurrentMission}

  Review scope: Read the PRD, then run `git diff main...HEAD` to see what
  this mission changed. Review the diff against the PRD requirements.

  Do NOT read the entire codebase. Focus on:
  1. PRD requirements — is each one addressed in the diff?
  2. The mission's commits — correct, consistent, secure?
  3. Integration — do changes wire into the existing codebase?

  Respond with:
  VERDICT: FINAL APPROVED
  or
  VERDICT: FINAL REJECTED
  Items requiring fixes: 003, 007
  Issues: [detailed list]"
)
```

Poll with TaskOutput as usual.

## Tawnia Dispatch

After post-checks pass:

```
Task(
  subagent_type: "ai-team:tawnia",
  run_in_background: true,
  description: "Tawnia: Documentation and final commit",
  prompt: "... [Tawnia prompt from agents/tawnia.md]

  Mission: {mission name from mission state}

  Completed items:
  - #001: {title}
  - #002: {title}
  ...

  Implementation files:
  - {all outputs.impl files}

  Update documentation and create the final commit."
)
```

### Wait for Tawnia

Poll Tawnia's task like any other agent:

```
result = TaskOutput(task_id, block: false, timeout: 500)
```

When Tawnia completes, she reports:
- Files modified/created
- Commit hash
- Summary of documentation changes

## Resume Recovery (Legacy Mode)

When resuming an interrupted mission with `/ai-team:resume`:

1. Run `ateam board getBoard --json` to read board state
2. Initialize `active_tasks = {}` (fresh start - old task IDs are invalid)
3. For each item in an active stage, clear stale assignment and re-dispatch:

```
for item in testing stage:
    ateam board-release releaseItem --itemId {item_id}
    task = Task(subagent_type: "ai-team:murdock", run_in_background: true, ...)
    active_tasks[item_id] = task.id

for item in implementing stage:
    ateam board-release releaseItem --itemId {item_id}
    task = Task(subagent_type: "ai-team:ba", run_in_background: true, ...)
    active_tasks[item_id] = task.id

for item in review stage:
    ateam board-release releaseItem --itemId {item_id}
    task = Task(subagent_type: "ai-team:lynch", run_in_background: true, ...)
    active_tasks[item_id] = task.id

for item in probing stage:
    ateam board-release releaseItem --itemId {item_id}
    task = Task(subagent_type: "ai-team:amy", run_in_background: true, ...)
    active_tasks[item_id] = task.id
```

4. Enter normal orchestration loop with populated `active_tasks`

**No backward board moves needed** - agents resume at the current stage. Partial work from the interrupted session is preserved on disk.
