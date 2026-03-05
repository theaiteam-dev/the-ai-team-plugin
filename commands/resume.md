---
model: sonnet
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
if model is NOT sonnet:
    Output to user:
    "Hannibal orchestration runs best on Sonnet — faster responses and lower
    overall mission costs. You're currently on [model name].

    Please switch first:  /model sonnet
    Then re-run:          /ai-team:resume"

    STOP. Do not proceed.
```

Hannibal's job is coordination, not deep reasoning. Sonnet handles dispatch loops faster while the heavy thinking happens in subagents (which use their own models via frontmatter).

## Behavior

1. **Validate mission exists**
   Use `mission_current` MCP tool to check for active mission.
   ```
   if mission not found:
       error "No mission found. Nothing to resume."
       exit
   ```

2. **Check mission state**
   - Use `board_read` MCP tool to get current state
   - Count items in each stage
   - Identify interrupted work

3. **Recover interrupted work**

   Items in active stages stay at their current stage. Clear stale agent assignments
   and re-dispatch the appropriate agent to resume work. This avoids backward moves
   that are not allowed by VALID_TRANSITIONS in board.ts.

   Use `board_release` to clear stale assignments, then re-dispatch agents:
   ```
   for item in testing stage:
       board_release(itemId)          # Clear stale Murdock assignment
       dispatch Murdock on item       # Re-run tests from current state

   for item in implementing stage:
       board_release(itemId)          # Clear stale B.A. assignment
       dispatch B.A. on item          # Resume implementation (tests already exist)

   for item in review stage:
       board_release(itemId)          # Clear stale Lynch assignment
       dispatch Lynch on item         # Re-review (tests + impl already exist)

   for item in probing stage:
       board_release(itemId)          # Clear stale Amy assignment
       dispatch Amy on item           # Re-probe (tests + impl + review done)
   ```

   **Rationale:** Re-dispatching at the current stage is safe because:
   - `testing`: Murdock can re-run or complete partial test suites
   - `implementing`: B.A. can pick up where partial implementation left off (tests exist)
   - `review`: Lynch can re-review (tests + implementation exist, review is idempotent)
   - `probing`: Amy can re-probe (all prior work exists, probing is idempotent)

4. **Load dispatch playbook and re-dispatch agents**

   First, get the plugin root path:
   ```
   plugin_root()  # MCP tool - returns the absolute path to the plugin directory
   ```

   Then check the environment variable (same as `/ai-team:run`):
   ```
   Bash("echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS")
   ```

   Using the plugin root path from above:
   - If "1": `Read("{plugin_root}/playbooks/orchestration-native.md")`
   - Otherwise: `Read("{plugin_root}/playbooks/orchestration-legacy.md")`

   Follow the playbook's resume/recovery section for dispatch mechanics.

   **MCP state is the source of truth:**
   - Work items track all progress via `work_log`
   - Board stage positions are preserved in the database
   - Only the agent sessions are lost - not the work state
   - Agents pick up from the current board state, not from memory

5. **Validate board integrity**
   - Use `deps_check` MCP tool to verify dependency graph
   - Check for orphaned items
   - Ensure no items are "lost"

6. **Display recovery summary**
   ```
   The A(i)-Team is back. Resuming mission...

   Recovered state:
   - {n} items in active stages, agents re-dispatched at current stage
   - {t} in testing (Murdock), {i} in implementing (B.A.), {r} in review (Lynch), {p} in probing (Amy)
   - Native teams: respawned from board state (if teams mode)

   Current state:
   - Briefings: {x}
   - Ready:     {y}
   - Done:      {z}
   - Blocked:   {b}

   Resuming orchestration...
   ```

7. **Start Hannibal orchestration**
   - Same as `/ai-team:run` from recovered state
   - Hannibal picks up from current board state

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

1. Uses `board_read` MCP tool to get current state
2. Uses `board_release` MCP tool to clear stale agent assignments
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

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `mission_current` | Check mission exists |
| `board_read` | Get current board state |
| `board_release` | Clear stale agent assignments |
| `deps_check` | Verify dependency graph integrity |

## Errors

- **No mission found**: Nothing to resume
- **All items blocked**: No work to resume (use `/ai-team:unblock`)
- **API unavailable**: Cannot connect to A(i)-Team server
- **Orphaned team**: Previous team session lost on restart (normal behavior, auto-recovered)
