# Orchestration Playbook: Native Teams Mode

> **You are in NATIVE TEAMS mode.** Use `TeamCreate`, `Task` with `team_name`/`name` params, and `SendMessage` for coordination.

Read `docs/ORCHESTRATION.md` for environment setup, permissions, and dispatch reference.

This playbook contains the complete orchestration loop, agent dispatch patterns, completion detection, and concrete examples for native teams dispatch mode.

## API Reference

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `TeamCreate` | Create a team for the mission | `team_name`, `description` |
| `Task` | Spawn a teammate agent | `team_name`, `name`, `subagent_type`, `prompt` |
| `SendMessage` | Send messages to teammates | `type`, `recipient`, `content`, `summary` |
| `SendMessage` (broadcast) | Message all teammates | `type: "broadcast"`, `content`, `summary` |
| `SendMessage` (shutdown) | Request teammate shutdown | `type: "shutdown_request"`, `recipient` |
| `TeamDelete` | Clean up team resources | (no params) |

### SendMessage Types

```
# Direct message to a specific teammate
SendMessage(type: "message", recipient: "murdock", content: "...", summary: "Brief 5-10 word summary")

# Broadcast to all teammates (use sparingly - expensive)
SendMessage(type: "broadcast", content: "...", summary: "Brief summary")

# Request teammate shutdown
SendMessage(type: "shutdown_request", recipient: "murdock", content: "Work complete")

# Approve/reject plan from teammate
SendMessage(type: "plan_approval_response", request_id: "...", recipient: "ba", approve: true)
```

## Precheck Flow

Hannibal runs precheck by executing commands and forwarding results to the API — the API does not run commands itself.

```
1. Read ateam.config.json to get check commands
2. Run each command via Bash (capturing stdout, stderr, exit code)
3. Build the result payload:
     passed   = all exit codes were 0
     blockers = human-readable failure messages for each failed check
     output   = { lint: {stdout,stderr,timedOut}, tests: {stdout,stderr,timedOut} }
4. Call mission_precheck({ passed, blockers, output })
```

### precheck_failure: Recoverable State

`precheck_failure` is a **non-terminal, recoverable** state. It means the checks ran but found problems. The mission is NOT failed — it can be retried.

**When `mission_current` returns `precheck_failure`:**
- The mission state is `precheck_failure` — blockers from the last run are stored in the API database.
  Fetch them via `GET /api/missions/current` (REST endpoint) with header `X-Project-ID: <ATEAM_PROJECT_ID>`
  — this returns the full mission record including the `precheckBlockers` array. The `mission_current`
  MCP tool returns a simplified object without the `precheckBlockers` field; use the REST endpoint or
  the `mission_precheck` response instead.
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

The MCP server automatically manages a marker file (`/tmp/.ateam-mission-active-{projectId}`) that tells enforcement hooks a mission is running:

- **`mission_precheck`** sets the marker when all checks pass
- **`mission_archive(complete: true)`** clears the marker
- **`mission_init`** clears any stale marker from a previous crashed session

No manual `Bash` commands needed — the marker lifecycle is handled at the code level.

## Team Initialization

At mission start, create a team:

```
TeamCreate(team_name: "mission-{missionId}", description: "A(i)-Team mission: {mission name}")
```

This creates the team container.

## Agent Pre-Warming

Spawn all pipeline agents immediately after team creation, before dispatching any work. This caches their prompts so subsequent `SendMessage` calls are cheap (cached prefix).

```
Task(team_name: "mission-{id}", name: "murdock", subagent_type: "ai-team:murdock",
     description: "Murdock: standby",
     prompt: "You are Murdock. Await work item assignments from Hannibal via SendMessage.")

Task(team_name: "mission-{id}", name: "ba", subagent_type: "ai-team:ba",
     description: "B.A.: standby",
     prompt: "You are B.A. Await work item assignments from Hannibal via SendMessage.")

Task(team_name: "mission-{id}", name: "lynch", subagent_type: "ai-team:lynch",
     description: "Lynch: standby",
     prompt: "You are Lynch. Await review assignments from Hannibal via SendMessage.")

Task(team_name: "mission-{id}", name: "amy", subagent_type: "ai-team:amy",
     description: "Amy: standby",
     prompt: "You are Amy. Await probing assignments from Hannibal via SendMessage.")
```

Tawnia is NOT pre-warmed (only runs once at mission end — caching won't help).

## Teammate Tracking

Maintain a map of active teammates:
```
active_teammates = {
  "001": "murdock",   // item_id → teammate name handling it
  "002": "ba"
}
```

Unlike legacy mode, you do NOT need task IDs for polling. Teammates send messages when they complete work - messages are automatically delivered to you.

## Spawning Teammates

| Agent | Name | Subagent Type | Description |
|-------|------|---------------|-------------|
| Murdock | `murdock` | `ai-team:murdock` | QA Engineer - writes tests |
| B.A. | `ba` | `ai-team:ba` | Implementer - writes code |
| Lynch | `lynch` | `ai-team:lynch` | Reviewer - per-feature reviews |
| Lynch (Final) | `lynch-final` | `ai-team:lynch-final` | Final Mission Review (PRD+diff) |
| Amy | `amy` | `ai-team:amy` | Investigator - probes for bugs |
| Tawnia | `tawnia` | `ai-team:tawnia` | Documentation writer |

Spawn syntax:
```
Task(
  team_name: "mission-{missionId}",
  name: "murdock",
  subagent_type: "ai-team:murdock",
  description: "Murdock: {feature title}",
  prompt: "... [agent prompt + work item context] ..."
)
```

**Teammates persist across items.** Once spawned, a teammate stays active and can receive new work via `SendMessage`. You do NOT need to re-spawn for each item - send a message with the new work item details instead. However, if a teammate has shut down or was never spawned, use `Task` with `team_name` to spawn them.

## The Orchestration Loop

**Check for precheck retry at start of run:**
If mission state is `precheck_failure`:
  - Display blockers to operator (fetch from `GET /api/missions/current` REST endpoint with header `X-Project-ID: <ATEAM_PROJECT_ID>`)
  - Re-run the precheck flow (same steps as in the Precheck Flow section above)
  - If passed: continue to main orchestration loop below
  - If failed: call `mission_precheck({ passed: false, blockers, output })` to update blockers and exit — operator must fix issues before retrying

**Two concerns, handled differently:**
1. **Dependency gates** - items wait in `ready` stage for deps (between waves)
2. **Pipeline flow** - items advance immediately on completion (within waves)

```
active_teammates = {}  # item_id → teammate_name

LOOP CONTINUOUSLY:

    # ═══════════════════════════════════════════════════════════
    # PHASE 1: PROCESS INCOMING MESSAGES - ADVANCE ON COMPLETION
    # ═══════════════════════════════════════════════════════════
    # Messages from teammates are AUTO-DELIVERED to you.
    # When a teammate completes work, they call agent_stop and
    # then SendMessage to you. The message arrives as a new
    # conversation turn - you do NOT need to poll.
    #
    # When you receive a completion message from a teammate:

    on message from teammate about item completion:
        item_id = extract item_id from message
        del active_teammates[item_id]

        if item was in testing:
            board_move(itemId=item_id, to="implementing", agent="B.A.")
            spawn or message B.A. with new work
            active_teammates[item_id] = "ba"
            # Don't wait for other testing items!

        elif item was in implementing:
            board_move(itemId=item_id, to="review", agent="Lynch")
            spawn or message Lynch with new work
            active_teammates[item_id] = "lynch"

        elif item was in review:
            if APPROVED:
                # ═══ MANDATORY: Amy probes EVERY approved feature ═══
                board_move(itemId=item_id, to="probing", agent="Amy")
                spawn or message Amy with new work
                active_teammates[item_id] = "amy"
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
    deps_result = deps_check()

    for item_id in deps_result.readyItems:
        if item is in briefings stage:
            board_move(itemId=item_id, to="ready")

    # ═══════════════════════════════════════════════════════════
    # PHASE 3: FILL PIPELINE FROM READY (per-column WIP limits)
    # ═══════════════════════════════════════════════════════════
    # No global WIP throttle — each column enforces its own limit.
    # board_move rejects moves when the target column is full.
    while ready stage not empty:
        pick ONE item from ready stage
        result = board_move(itemId=item_id, to="testing", agent="Murdock")
        if result is WIP error: break  # testing column is full
        spawn or message Murdock with new work
        active_teammates[item_id] = "murdock"

    # When finalReviewReady: true → dispatch Lynch for Final Review
```

**KEY BEHAVIORS:**
- Phase 1: Messages arrive automatically - no polling required
- Phase 2: Unlock next-wave items when deps complete (correct waiting)
- Phase 3: Keep pipeline full — per-column WIP limits enforced by board_move

## Minimizing Per-Cycle Token Spend

- Use `deps_check()` (without `verbose: true`) in the orchestration loop. Only use `deps_check(verbose: true)` for debugging stuck dependencies.
- Call `board_read()` only when you need the full board state (start of loop, after wave completion). Between those, track state from teammate completion messages instead of re-reading the full board.
- Use `item_list(stage: "ready")` instead of `board_read()` when you only need to check the ready queue.

## Message-Based Completion Detection

In native teams mode, completion works differently from legacy polling:

1. **Teammate finishes work** → calls `agent_stop` MCP tool → calls `SendMessage` to Hannibal
2. **Message auto-delivered** → appears as a new conversation turn in your context
3. **You process immediately** → advance the item, dispatch next agent

**You do NOT poll.** Messages arrive automatically when teammates complete work. Your orchestration loop is event-driven: each incoming message triggers Phase 1 processing, then you check Phases 2-3.

### What Teammate Messages Look Like

Teammates send messages like:
```
"DONE: WI-001 - Created 4 test cases covering happy path and edge cases"
"DONE: WI-003 - APPROVED - All tests pass, implementation matches spec"
"DONE: WI-002 - VERIFIED - All probes pass, wiring confirmed"
"DONE: WI-005 - FLAG - Race condition found in concurrent access"
"BLOCKED: WI-004 - Cannot write tests, missing type definitions"
```

Parse the message to determine:
- **Item ID** (WI-XXX)
- **Status** (DONE/BLOCKED)
- **Verdict** (for Lynch: APPROVED/REJECTED; for Amy: VERIFIED/FLAG)

## Idle State Handling

**Idle is normal.** When a teammate's turn ends, the system sends an idle notification. This does NOT mean the teammate is done or broken.

- A teammate sending "DONE: WI-001..." and then going idle is the **normal flow** - they sent their message and are waiting
- You can send new work to an idle teammate with `SendMessage` and they will wake up
- Do NOT treat idle notifications as errors or completion signals
- Do NOT re-spawn a teammate just because they went idle

**When to re-spawn vs. message:**
- **Message** (preferred): Teammate is idle but still alive → `SendMessage(type: "message", recipient: "murdock", content: "New work: WI-005...", summary: "New test work for WI-005")`
- **Re-spawn** (fallback): Teammate has shut down or was never spawned → `Task(team_name: ..., name: "murdock", ...)`

## Agent Dispatch Workflows

### Dispatching Murdock (testing stage)

```
# Move to testing AND claim for Murdock
board_move(itemId: "001", to: "testing", agent: "Murdock")
```

Then spawn (first time) or message (if already active):

**First spawn:**
```
Task(
  team_name: "mission-{missionId}",
  name: "murdock",
  subagent_type: "ai-team:murdock",
  description: "Murdock: {feature title}",
  prompt: "... [Murdock prompt from agents/murdock.md]

  Feature Item:
  [Full content of the work item]

  Create the test file at: {outputs.test}
  If outputs.types is specified, also create: {outputs.types}

  STOP after creating these files. Do NOT create {outputs.impl}.

  When done, call agent_stop, then notify Hannibal:
  SendMessage(type: 'message', recipient: 'hannibal', content: 'DONE: {itemId} - summary', summary: 'Tests complete for {itemId}')"
)
```

**Subsequent work (teammate already spawned):**
```
SendMessage(
  type: "message",
  recipient: "murdock",
  content: "New work: WI-005 - {title}\nTest file: {outputs.test}\nTypes file: {outputs.types}\nFetch full details with item_get(id: 'WI-005') or item_render(id: 'WI-005').",
  summary: "New test work for WI-005"
)
```

### Dispatching B.A. (implementing stage)

```
# Move to implementing AND claim for B.A. (auto-releases Murdock's claim)
board_move(itemId: "001", to: "implementing", agent: "B.A.")
```

**First spawn:**
```
Task(
  team_name: "mission-{missionId}",
  name: "ba",
  subagent_type: "ai-team:ba",
  description: "B.A.: {feature title}",
  prompt: "... [B.A. prompt from agents/ba.md]

  Feature Item:
  [Full content of the work item]

  Test file is at: {outputs.test}
  Create the implementation at: {outputs.impl}

  When done, call agent_stop, then notify Hannibal:
  SendMessage(type: 'message', recipient: 'hannibal', content: 'DONE: {itemId} - summary', summary: 'Implementation complete for {itemId}')"
)
```

**Subsequent work:**
```
SendMessage(
  type: "message",
  recipient: "ba",
  content: "New work: WI-005 - {title}\nTest file: {outputs.test}\nImpl file: {outputs.impl}\nFetch full details with item_get(id: 'WI-005') or item_render(id: 'WI-005').",
  summary: "New implementation work for WI-005"
)
```

### Dispatching Lynch (review stage)

```
# Move to review AND claim for Lynch (auto-releases B.A.'s claim)
board_move(itemId: "001", to: "review", agent: "Lynch")
```

**First spawn:**
```
Task(
  team_name: "mission-{missionId}",
  name: "lynch",
  subagent_type: "ai-team:lynch",
  description: "Lynch: {feature title}",
  prompt: "... [Lynch prompt from agents/lynch.md]

  Feature Item:
  [Full content of the work item]

  Review ALL these files together:
  - Test: {outputs.test}
  - Implementation: {outputs.impl}
  - Types (if exists): {outputs.types}

  When done, call agent_stop, then notify Hannibal:
  SendMessage(type: 'message', recipient: 'hannibal', content: 'DONE: {itemId} - APPROVED/REJECTED - summary', summary: 'Review complete for {itemId}')"
)
```

**Subsequent work:**
```
SendMessage(
  type: "message",
  recipient: "lynch",
  content: "New review: WI-005 - {title}\nTest: {outputs.test}\nImpl: {outputs.impl}\nTypes: {outputs.types}\nFetch full details with item_get(id: 'WI-005') or item_render(id: 'WI-005').",
  summary: "New review work for WI-005"
)
```

### Dispatching Amy (probing stage)

```
# Move to probing AND claim for Amy (auto-releases Lynch's claim)
board_move(itemId: "001", to: "probing", agent: "Amy")
```

**First spawn:**
```
Task(
  team_name: "mission-{missionId}",
  name: "amy",
  subagent_type: "ai-team:amy",
  description: "Amy: {feature title}",
  prompt: "... [Amy prompt from agents/amy.md]

  Feature Item:
  [Full content of the work item]

  Files to probe:
  - Test: {outputs.test}
  - Implementation: {outputs.impl}
  - Types (if exists): {outputs.types}

  Execute the Raptor Protocol. Respond with VERIFIED or FLAG.

  When done, call agent_stop, then notify Hannibal:
  SendMessage(type: 'message', recipient: 'hannibal', content: 'DONE: {itemId} - VERIFIED/FLAG - summary', summary: 'Probing complete for {itemId}')"
)
```

**Hook enforcement:** Amy's `enforce-browser-verification` Stop hook will block her from completing without performing browser verification on UI features. The `track-browser-usage` PreToolUse hook tracks whether Amy has used agent-browser or Playwright tools during her session.

**Subsequent work:**
```
SendMessage(
  type: "message",
  recipient: "amy",
  content: "New probe: WI-005 - {title}\nTest: {outputs.test}\nImpl: {outputs.impl}\nTypes: {outputs.types}\nFetch full details with item_get(id: 'WI-005') or item_render(id: 'WI-005').",
  summary: "New probing work for WI-005"
)
```

### Dispatching Tawnia (documentation)

After post-checks pass:

```
Task(
  team_name: "mission-{missionId}",
  name: "tawnia",
  subagent_type: "ai-team:tawnia",
  description: "Tawnia: Documentation and final commit",
  prompt: "... [Tawnia prompt from agents/tawnia.md]

  Mission: {mission name}

  Completed items:
  - #001: {title}
  - #002: {title}

  Implementation files:
  - {all outputs.impl files}

  Update documentation and create the final commit.

  When done, call agent_stop, then notify Hannibal:
  SendMessage(type: 'message', recipient: 'hannibal', content: 'DONE: docs - summary with commit hash', summary: 'Documentation and commit complete')"
)
```

Wait for Tawnia's completion message (auto-delivered).

## Final Mission Review Dispatch

When ALL items reach `done` stage, fetch `prdPath` from the `mission_current` response.

**Always spawn a new Lynch-Final agent** for the final review (it uses a different, slimmer prompt optimized for PRD+diff review):

```
Task(
  team_name: "mission-{missionId}",
  name: "lynch-final",
  subagent_type: "ai-team:lynch-final",
  description: "Lynch: Final Mission Review",
  prompt: "You are Colonel Lynch conducting a FINAL MISSION REVIEW.

  PRD path: {prdPath from mission_current}

  Review scope: Read the PRD, then run `git diff main...HEAD` to see what
  this mission changed. Review the diff against the PRD requirements.

  Do NOT read the entire codebase. Focus on:
  1. PRD requirements — is each one addressed in the diff?
  2. The mission's commits — correct, consistent, secure?
  3. Integration — do changes wire into the existing codebase?

  When done, call agent_stop, then notify Hannibal:
  SendMessage(type: 'message', recipient: 'hannibal', content: 'DONE: FINAL-REVIEW - FINAL APPROVED/REJECTED - summary', summary: 'Final mission review complete')"
)
```

Wait for Lynch-Final's completion message with the verdict.

## Concrete Example: Dependency Waves + Pipeline Parallelism

Setup:
- Wave 0: 001, 002 (no deps)
- Wave 1: 003 (depends on 001), 004 (depends on 001, 002)

```
T=0s    deps_check() → readyItems: [001, 002], 003/004 blocked
        Move 001, 002 to ready stage
        board_move(itemId="001", to="testing", agent="Murdock")
        Task(team_name: "mission-M1", name: "murdock", subagent_type: "ai-team:murdock", ...)
        active_teammates = {001: "murdock"}

        board_move(itemId="002", to="testing", agent="Murdock")
        # Murdock already spawned - send message with new work
        SendMessage(type: "message", recipient: "murdock",
          content: "New work: WI-002...", summary: "Test work for WI-002")
        active_teammates = {001: "murdock", 002: "murdock"}

        # Wait for messages...

T=30s   MESSAGE from murdock: "DONE: WI-001 - Created 3 test cases"
        → IMMEDIATELY: board_move(itemId="001", to="implementing", agent="B.A.")
        Task(team_name: "mission-M1", name: "ba", subagent_type: "ai-team:ba", ...)
        active_teammates = {001: "ba", 002: "murdock"}
        # 002 still in testing - that's fine!

T=45s   MESSAGE from murdock: "DONE: WI-002 - Created 4 test cases"
        → IMMEDIATELY: board_move(itemId="002", to="implementing", agent="B.A.")
        SendMessage(type: "message", recipient: "ba",
          content: "New work: WI-002...", summary: "Implement WI-002")
        active_teammates = {001: "ba", 002: "ba"}

T=60s   MESSAGE from ba: "DONE: WI-001 - All tests passing"
        → IMMEDIATELY: board_move(itemId="001", to="review", agent="Lynch")
        Task(team_name: "mission-M1", name: "lynch", subagent_type: "ai-team:lynch", ...)
        active_teammates = {001: "lynch", 002: "ba"}

T=90s   MESSAGE from lynch: "DONE: WI-001 - APPROVED"
        → board_move(itemId="001", to="probing", agent="Amy")
        Task(team_name: "mission-M1", name: "amy", subagent_type: "ai-team:amy", ...)
        active_teammates = {001: "amy", 002: "ba"}

T=100s  MESSAGE from amy: "DONE: WI-001 - VERIFIED"
        → board_move(itemId="001", to="done")
        deps_check() → readyItems: [003]  ← 003's dep (001) satisfied!
        board_move(itemId="003", to="ready")
        board_move(itemId="003", to="testing", agent="Murdock")
        SendMessage(type: "message", recipient: "murdock",
          content: "New work: WI-003...", summary: "Test work for WI-003")
        active_teammates = {002: "ba", 003: "murdock"}

T=105s  MESSAGE from ba: "DONE: WI-002 - All tests passing"
        → board_move(itemId="002", to="review", agent="Lynch")
        SendMessage(type: "message", recipient: "lynch",
          content: "Review WI-002...", summary: "Review WI-002")
        active_teammates = {002: "lynch", 003: "murdock"}

        ... and so on until all items reach done ...
```

**KEY INSIGHTS:**
1. Teammates are reused - Murdock handles WI-001, then WI-002, then WI-003 sequentially
2. Messages drive the loop - no polling needed
3. Same pipeline parallelism as legacy - items advance independently
4. Between waves: 003 unlocks when 001 hits done, 004 when both 001+002 done

## Team Shutdown

When the mission is complete (all conditions met):

1. **Shutdown each active teammate:**
```
SendMessage(type: "shutdown_request", recipient: "murdock", content: "Mission complete")
SendMessage(type: "shutdown_request", recipient: "ba", content: "Mission complete")
SendMessage(type: "shutdown_request", recipient: "lynch", content: "Mission complete")
SendMessage(type: "shutdown_request", recipient: "amy", content: "Mission complete")
SendMessage(type: "shutdown_request", recipient: "tawnia", content: "Mission complete")
```

2. **Wait for shutdown approvals** (teammates auto-approve unless busy)

3. **Delete the team:**
```
TeamDelete()
```

Only send shutdown requests to teammates that were actually spawned. Skip any that were never needed.

## Resume Recovery (Native Teams Mode)

Native teams are ephemeral - they don't survive session restarts. On resume:

1. **Log warning:**
   ```
   [Hannibal] Previous team session lost. Spawning fresh teammates from board state.
   ```

2. **Create fresh team:**
   ```
   TeamCreate(team_name: "mission-{missionId}", description: "Resumed A(i)-Team mission")
   ```

3. **Read board state and re-spawn at current stages:**
   ```
   board = board_read()
   active_teammates = {}

   for item in testing stage:
       board_release(itemId)
       Task(team_name: "mission-{missionId}", name: "murdock",
            subagent_type: "ai-team:murdock", ...)
       active_teammates[item_id] = "murdock"

   for item in implementing stage:
       board_release(itemId)
       Task(team_name: "mission-{missionId}", name: "ba",
            subagent_type: "ai-team:ba", ...)
       active_teammates[item_id] = "ba"

   for item in review stage:
       board_release(itemId)
       Task(team_name: "mission-{missionId}", name: "lynch",
            subagent_type: "ai-team:lynch", ...)
       active_teammates[item_id] = "lynch"

   for item in probing stage:
       board_release(itemId)
       Task(team_name: "mission-{missionId}", name: "amy",
            subagent_type: "ai-team:amy", ...)
       active_teammates[item_id] = "amy"
   ```

4. **Enter normal orchestration loop** with populated `active_teammates`

**MCP state is the source of truth.** Work items, board positions, and work logs are all preserved in the database. Only the teammate sessions are lost - not the work state.
