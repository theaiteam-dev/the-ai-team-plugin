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

## Mission-Active Marker

The MCP server automatically manages a marker file (`/tmp/.ateam-mission-active-{projectId}`) that tells enforcement hooks a mission is running:

- **`mission_precheck`** sets the marker when all checks pass
- **`mission_archive(complete: true)`** clears the marker
- **`mission_init`** clears any stale marker from a previous crashed session

No manual `Bash` commands needed — the marker lifecycle is handled at the code level.

## The Orchestration Loop

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
                board_move(itemId=item_id, to="implementing", agent="B.A.")
                new_task = dispatch B.A. in background
                active_tasks[item_id] = new_task.id
                # Don't wait for other testing items!

            elif item was in implementing:
                board_move(itemId=item_id, to="review", agent="Lynch")
                new_task = dispatch Lynch in background
                active_tasks[item_id] = new_task.id

            elif item was in review:
                if APPROVED:
                    # ═══ MANDATORY: Amy probes EVERY approved feature ═══
                    board_move(itemId=item_id, to="probing", agent="Amy")
                    new_task = dispatch Amy in background
                    active_tasks[item_id] = new_task.id
                    # DO NOT skip probing! DO NOT move directly to done!
                if REJECTED: item_reject(itemId=item_id, reason=..., agent="Lynch")

            elif item was in probing:
                # Amy has completed investigation
                if VERIFIED: board_move(itemId=item_id, to="done")
                if FLAG: item_reject(itemId=item_id, reason=..., agent="Amy")
                # Moving to done may unlock Wave 2 items!

    # ═══════════════════════════════════════════════════════════
    # PHASE 2: CHECK DEPENDENCY GATES - UNLOCK NEXT WAVE ITEMS
    # ═══════════════════════════════════════════════════════════
    # Check for newly ready items
    deps_result = deps_check()

    for item_id in deps_result.readyItems:
        if item is in briefings stage:
            board_move(itemId=item_id, to="ready")
            # This item's deps are now satisfied

    # ═══════════════════════════════════════════════════════════
    # PHASE 3: FILL PIPELINE FROM READY (per-column WIP limits)
    # ═══════════════════════════════════════════════════════════
    # No global WIP throttle — each column enforces its own limit.
    # board_move rejects moves when the target column is full.
    while ready stage not empty:
        pick ONE item from ready stage
        result = board_move(itemId=item_id, to="testing", agent="Murdock")
        if result is WIP error: break  # testing column is full
        new_task = dispatch Murdock in background
        active_tasks[item_id] = new_task.id

    # When finalReviewReady: true → dispatch Lynch for Final Review

    # Brief pause then repeat
```

**KEY BEHAVIORS:**
- Phase 1: Advance items IMMEDIATELY - no waiting for siblings
- Phase 2: Unlock next-wave items when deps complete (correct waiting)
- Phase 3: Keep pipeline full — per-column WIP limits enforced by board_move

## Minimizing Per-Cycle Token Spend

- Use `deps_check()` (without `verbose: true`) in the orchestration loop. Only use `deps_check(verbose: true)` for debugging stuck dependencies.
- Call `board_read()` only when you need the full board state (start of loop, after wave completion). Between those, track state from agent completion results instead of re-reading the full board.
- Use `item_list(stage: "ready")` instead of `board_read()` when you only need to check the ready queue.

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
T=0s    deps_check() → readyItems: [001, 002], 003/004 blocked
        Move 001, 002 to ready stage
        Dispatch Murdock for 001 (task_a), 002 (task_b)
        active_tasks = {001: a, 002: b}

T=30s   Poll a → COMPLETE!
        → IMMEDIATELY: board_move(itemId="001", to="implementing", agent="B.A."), dispatch B.A. (task_c)
        active_tasks = {001: c, 002: b}
        (002 still in testing - that's fine, don't wait!)

T=55s   Poll b → COMPLETE!
        → IMMEDIATELY: board_move(itemId="002", to="implementing", agent="B.A."), dispatch B.A. (task_d)
        active_tasks = {001: c, 002: d}

T=60s   Poll c → COMPLETE!
        → IMMEDIATELY: board_move(itemId="001", to="review", agent="Lynch"), dispatch Lynch (task_e)
        active_tasks = {001: e, 002: d}

T=90s   Poll e → COMPLETE! (Lynch approved)
        → board_move(itemId="001", to="probing", agent="Amy"), dispatch Amy (task_f)
        active_tasks = {001: f, 002: d}

T=100s  Poll f → COMPLETE! (Amy verified)
        → board_move(itemId="001", to="done")
        deps_check() → readyItems: [003]  ← 003's dep (001) now satisfied!
        board_move(itemId="003", to="ready")  (004 still blocked - needs 002 done too)
        Dispatch Murdock for 003 (task_g)
        active_tasks = {002: d, 003: g}

T=105s  Poll d → COMPLETE!
        → IMMEDIATELY: board_move(itemId="002", to="review", agent="Lynch"), dispatch Lynch (task_h)
        active_tasks = {002: h, 003: g}

T=120s  Poll h → COMPLETE! (Lynch approved 002)
        → board_move(itemId="002", to="probing", agent="Amy"), dispatch Amy (task_i)
        active_tasks = {002: i, 003: g}

T=130s  Poll i → COMPLETE! (Amy verified 002)
        → board_move(itemId="002", to="done")
        deps_check() → readyItems: [004]  ← 004's deps (001,002) now satisfied!
        board_move(itemId="004", to="ready")
```

**KEY INSIGHTS:**
1. Within Wave 0: 001 advances to review while 002 is still implementing (no stage batching)
2. Between waves: 003 unlocks when 001 hits done, 004 unlocks when both 001+002 hit done
3. Pipeline stays full - new items enter as deps are satisfied

## Agent Dispatch Workflows

### Dispatching Murdock (testing stage)

```
# Move to testing AND claim for Murdock
board_move(itemId: "001", to: "testing", agent: "Murdock")
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
board_move(itemId: "001", to: "implementing", agent: "B.A.")
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

### Dispatching Lynch (review stage)

```
# Move to review AND claim for Lynch (auto-releases B.A.'s claim)
board_move(itemId: "001", to: "review", agent: "Lynch")
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
board_move(itemId: "001", to: "probing", agent: "Amy")
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
board_read(filter: "agents")
```

## Final Mission Review Dispatch

When ALL items reach `done` stage, fetch `prdPath` from the `mission_current` response, then dispatch:

```
Task(
  subagent_type: "ai-team:lynch-final",
  run_in_background: true,
  description: "Lynch: Final Mission Review",
  prompt: "You are Colonel Lynch conducting a FINAL MISSION REVIEW.

  PRD path: {prdPath from mission_current}

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

1. Read board state with `board_read()`
2. Initialize `active_tasks = {}` (fresh start - old task IDs are invalid)
3. For each item in an active stage, clear stale assignment and re-dispatch:

```
for item in testing stage:
    board_release(itemId)
    task = Task(subagent_type: "ai-team:murdock", run_in_background: true, ...)
    active_tasks[item_id] = task.id

for item in implementing stage:
    board_release(itemId)
    task = Task(subagent_type: "ai-team:ba", run_in_background: true, ...)
    active_tasks[item_id] = task.id

for item in review stage:
    board_release(itemId)
    task = Task(subagent_type: "ai-team:lynch", run_in_background: true, ...)
    active_tasks[item_id] = task.id

for item in probing stage:
    board_release(itemId)
    task = Task(subagent_type: "ai-team:amy", run_in_background: true, ...)
    active_tasks[item_id] = task.id
```

4. Enter normal orchestration loop with populated `active_tasks`

**No backward board moves needed** - agents resume at the current stage. Partial work from the interrupted session is preserved on disk.
