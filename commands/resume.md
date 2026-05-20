---
model: haiku
---
# /ai-team:resume

Resume an interrupted mission from where it left off.

## Usage

```
/ai-team:resume
```

## Pre-Flight: Model Check

Before doing anything else, check your current model. Your system prompt contains your model ID (e.g., "You are powered by the model named Opus 4.6").

```
if model is NOT haiku AND model is NOT sonnet:
    Output to user:
    "Hannibal orchestration runs on Haiku (tick loop) or Sonnet (legacy).
    You're currently on [model name].

    Please switch first:  /model haiku
    Then re-run:          /ai-team:resume"

    STOP. Do not proceed.
```

Hannibal's job is now mechanical tick execution — the Go controller handles all orchestration reasoning. Haiku is sufficient and ~75% cheaper on cache reads.

## Behavior

1. **Validate mission exists**
   Run `ateam missions-current getCurrentMission --json` to check for active mission.
   ```
   if mission not found:
       error "No mission found. Nothing to resume."
       exit
   ```

2. **Check mission state**
   - Run `ateam board getBoard --json` to get current state
   - Count items in each stage
   - Identify interrupted work

3. **Recover interrupted work**

   Items in active stages stay at their current stage. Clear stale agent assignments
   and re-dispatch the appropriate agent to resume work. This avoids backward moves
   that are not allowed by VALID_TRANSITIONS in board.ts.

   Run `ateam board-release releaseItem --itemId <id>` to clear stale assignments, then re-dispatch agents:
   ```
   for item in testing stage:
       ateam board-release releaseItem --itemId <id>   # Clear stale Murdock assignment
       dispatch Murdock on item                         # Re-run tests from current state

   for item in implementing stage:
       ateam board-release releaseItem --itemId <id>   # Clear stale B.A. assignment
       dispatch B.A. on item                            # Resume implementation (tests already exist)

   for item in review stage:
       ateam board-release releaseItem --itemId <id>   # Clear stale Lynch assignment
       dispatch Lynch on item                           # Re-review (tests + impl already exist)

   for item in probing stage:
       ateam board-release releaseItem --itemId <id>   # Clear stale Amy assignment
       dispatch Amy on item                             # Re-probe (tests + impl + review done)
   ```

   **Rationale:** Re-dispatching at the current stage is safe because:
   - `testing`: Murdock can re-run or complete partial test suites
   - `implementing`: B.A. can pick up where partial implementation left off (tests exist)
   - `review`: Lynch can re-review (tests + implementation exist, review is idempotent)
   - `probing`: Amy can re-probe (all prior work exists, probing is idempotent)

4. **Enter the tick controller loop — DEFAULT PATH ENDS HERE**

   Output to user:
   ```
   [Hannibal] Tick controller engaged. Watching mission via /ai-team:tick.
   ```

   Use the **Skill tool** to invoke the tick command now:
   ```
   Skill({"skill": "ai-team:tick"})
   ```

   **⛔ STOP. This is the end of /ai-team:resume for the default path.**
   The tick skill picks up from the current board state, dispatches pending work,
   confirms actions, and schedules the next wake. Do NOT load any playbook.
   Do NOT re-dispatch agents yourself. Do NOT execute the legacy steps below.

---

## Legacy Mode (`--legacy` flag only)

> **Only read this section if `--legacy` was explicitly passed as an argument.**
> If `--legacy` was NOT passed, you already finished at step 4. Stop here.

**Step L1 — Load the orchestration playbook:**
```
Bash("echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS")
Bash("echo $CLAUDE_PLUGIN_ROOT")
```
- If `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`: `Read("$CLAUDE_PLUGIN_ROOT/playbooks/orchestration-native.md")`
- Otherwise: `Read("$CLAUDE_PLUGIN_ROOT/playbooks/orchestration-legacy.md")`

**Step L2 — Validate board integrity:**
Run `ateam deps-check checkDeps --json`. Check for orphaned items.

**Step L3 — Display recovery summary and resume orchestration:**
Follow the playbook's resume/recovery section to re-dispatch agents at their current stages.
API state is the source of truth — board positions and work logs are preserved.

## Recovery Rules

All active items stay at their current stage. Stale agent assignments are cleared
and agents are re-dispatched to resume work. No backward board moves are needed.

### Items in `testing` stage
- Stay in `testing` stage, re-dispatch Murdock
- Murdock re-runs or completes partial test suites
- Any partial test files from the interrupted session are preserved

### Items in `implementing` stage
- Stay in `implementing` stage, re-dispatch B.A.
- B.A. picks up where implementation left off (tests already exist from Murdock)
- Any partial implementation files are preserved

### Items in `review` stage
- Stay in `review` stage, re-dispatch Lynch
- Lynch re-reviews tests + implementation (review is idempotent)

### Items in `probing` stage
- Stay in `probing` stage, re-dispatch Amy
- Amy re-probes for bugs (tests + impl + review all exist, probing is idempotent)

### Items in `done` stage
- Never re-done
- Already approved by Lynch

### Items in `blocked` stage
- Stay blocked
- Require human intervention via `/ai-team:unblock`

## Example

```
# Original run was interrupted
^C

# Later, resume
/ai-team:resume
```

Output:
```
The A(i)-Team is back. Resuming mission...

Recovered state:
- 3 items in active stages, agents re-dispatched at current stage
- 1 in testing (Murdock), 1 in implementing (B.A.), 1 in review (Lynch), 0 in probing (Amy)

Current state:
- Briefings: 3
- Ready:     4
- Done:      7
- Blocked:   0

[Hannibal] "Time to get back to work."
[Hannibal] Re-dispatching Murdock on WI-015 (testing)
[Hannibal] Re-dispatching B.A. on WI-021 (implementing)
[Hannibal] Re-dispatching Lynch on WI-018 (review)
...
```

## Implementation Notes

**Hannibal runs in the MAIN context, not as a subagent.**

This command:

1. Runs `ateam board getBoard --json` to get current state
2. Runs `ateam board-release releaseItem` to clear stale agent assignments
3. Loads the orchestration playbook (same env var check as `/ai-team:run`)
4. Re-dispatches agents at their current stage using the playbook's resume/recovery section
5. Main Claude BECOMES Hannibal and continues orchestration

**Architecture:**
```
Main Claude (as Hannibal)
    ├── subagent → Murdock (testing)
    ├── subagent → B.A. (implementing)
    ├── subagent → Lynch (review)
    ├── subagent → Amy (probing)
    └── subagent → Tawnia (documentation)
```

The dispatch mode (legacy Task/TaskOutput vs. native TeamCreate/SendMessage) is determined by the orchestration playbook loaded in step 4.

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam missions-current getCurrentMission --json` | Check mission exists |
| `ateam board getBoard --json` | Get current board state |
| `ateam board-release releaseItem --itemId <id>` | Clear stale agent assignments |
| `ateam deps-check checkDeps --json` | Verify dependency graph integrity |

## Errors

- **No mission found**: Nothing to resume
- **All items blocked**: No work to resume (use `/ai-team:unblock`)
- **API unavailable**: Cannot connect to A(i)-Team server
- **Orphaned team**: Previous team session lost on restart (normal behavior, auto-recovered)
