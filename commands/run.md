---
model: sonnet
---
# /ai-team:run

Execute the mission with the pipeline flow.

## Usage

```
/ai-team:run [--wip N] [--max-wip M]
```

## Arguments

- `--wip N` (optional): Set WIP limit (default: 3)
- `--max-wip M` (optional): Set maximum WIP for adaptive scaling (default: 5)

## Pre-Flight: Model Check

Before doing anything else, check your current model. Your system prompt contains your model ID (e.g., "You are powered by the model named Opus 4.6").

```text
if model is NOT sonnet:
    Output to user:
    "Hannibal orchestration runs best on Sonnet — faster responses and lower
    overall mission costs. You're currently on [model name].

    Please switch first:  /model sonnet
    Then re-run:          /ai-team:run"

    STOP. Do not proceed.
```

Hannibal's job is coordination, not deep reasoning. Sonnet handles dispatch loops faster while the heavy thinking happens in subagents (which use their own models via frontmatter).

## Pipeline Flow (ALL STAGES MANDATORY)

Each feature MUST flow through ALL stages. **No shortcuts. No exceptions.**

```
briefings → ready → testing → implementing → review → probing → done
                       ↑           ↑            ↑         ↑       │
                    Murdock      B.A.        Lynch      Amy       │
                                                   (MANDATORY)    │
                                                                  ▼
                                                        ┌─────────────────┐
                                                        │  Final Review   │
                                                        │    (Lynch)      │
                                                        └────────┬────────┘
                                                                 │
                                                                 ▼
                                                        ┌─────────────────┐
                                                        │  Post-Checks    │
                                                        │ (lint,unit,e2e) │
                                                        └────────┬────────┘
                                                                 │
                                                                 ▼
                                                        ┌─────────────────┐
                                                        │  Documentation  │
                                                        │    (Tawnia)     │
                                                        │   (MANDATORY)   │
                                                        └─────────────────┘
```

**Stage transitions (ALL REQUIRED):**
1. `ready → testing`: Murdock writes tests (and types if specified)
2. `testing → implementing`: B.A. implements to pass tests
3. `implementing → review`: Lynch reviews ALL outputs together
4. `review → probing`: Lynch approves → **Amy MUST investigate** (NOT optional)
5. `probing → done`: Amy verifies (or back to ready if bugs found)
6. `all done → final review`: Lynch reviews entire codebase holistically
7. `final review → post-checks`: Run lint, unit, e2e tests
8. `post-checks → documentation`: **Tawnia MUST run** (NOT optional)
9. `documentation → complete`: Tawnia creates final commit, mission complete

## Pipeline Parallelism

Different features can be at different stages simultaneously:

```
Feature 001: [testing]  →  [implementing]  →  [review]  →  [probing]  →  done
Feature 002:      [testing]  →  [implementing]  →  [review]  →  [probing]
Feature 003:            [testing]  →  [implementing]  →  [review]
```

WIP limit controls how many features are in-flight (not in briefings, ready, or done stages).

## Behavior

1. **Validate mission exists**
   Run `ateam missions-current getCurrentMission --json` to check for active mission.
   ```
   if mission not found:
       error "No mission found. Run /ai-team:plan first."
       exit

   if mission.state == "precheck_failure":
       # Recoverable — re-run precheck (step 2) using the existing mission.
       # Do NOT re-plan. Proceed directly to step 2.
       [Hannibal] Previous precheck failed. Retrying checks...

   if mission.state not in ["initializing", "precheck_failure"]:
       if mission.state == "running":
           # Mission already prechecked and running — skip step 2, go to step 3
       else:
           error "Mission is in unexpected state: {state}"
           exit
   ```

2. **Run pre-mission checks**

   First, check the current mission state. If it is already `precheck_failure`, skip re-planning
   and proceed directly to re-running the checks below.

   Read `ateam.config.json` to get the list of check names (`config.precheck`) and their commands
   (`config.checks`). Run each check via Bash, capturing stdout, stderr, and exit code.
   Then call `ateam missions-precheck missionPrecheck` with the computed result:

   ```
   config = Read("ateam.config.json")  # parse JSON

   passed   = true
   blockers = []
   output   = {}

   # config.precheck lists the check names to run (e.g. ["lint", "unit"] by default).
   # config.checks maps each name to its shell command.
   # Results are stored in output keyed by check name: output["lint"], output["unit"], etc.
   for checkName in config.precheck:
       if checkName not in config.checks:
           blockers.append("Check '" + checkName + "' is listed in config.precheck but has no command in config.checks")
           passed = false
           continue

       result = Bash(config.checks[checkName], capture: stdout+stderr+exitcode, timeout: 300s)
       timedOut = (result.exitcode == TIMEOUT_CODE)
       output[checkName] = { stdout: result.stdout, stderr: result.stderr, timedOut }

       if timedOut:
           passed = false
           blockers.append(checkName + " timed out after 5 minutes")
       elif result.exitcode != 0:
           passed = false
           blockers.append(checkName + " failed: " + result.stdout.slice(0,200))

   ateam missions-precheck missionPrecheck --passed {passed} --blockers {blockers} --output {output}
   ```

   - If `passed = true`: mission transitions to `running`, proceed to next step
   - If `passed = false`: mission transitions to `precheck_failure`. Report to user:
     ```
     [Hannibal] Precheck FAILED. Blockers:
     - {blocker 1}
     - {blocker 2}

     Fix the issues above, then re-run /ai-team:run to retry.
     ```
     STOP. Do not start the pipeline.

3. **Detect dispatch mode and load orchestration playbook**

   First, get the plugin root path from the `CLAUDE_PLUGIN_ROOT` environment variable:
   ```
   Bash("echo $CLAUDE_PLUGIN_ROOT")
   ```

   Then check the environment variable:
   ```
   Bash("echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS")
   ```

   Using the plugin root path from above:
   - If output is "1": `Read("$CLAUDE_PLUGIN_ROOT/playbooks/orchestration-native.md")`
   - Otherwise: `Read("$CLAUDE_PLUGIN_ROOT/playbooks/orchestration-legacy.md")`

   **Read exactly ONE playbook. Do not read both.**
   The playbook contains your complete orchestration loop, dispatch
   patterns, completion detection, and concrete examples.

4. **Main Claude becomes Hannibal**
   - Orchestration runs in the main context (visible to user)
   - Worker agents dispatched as direct subagents

5. **Orchestration loop:**
   Follow the loaded orchestration playbook for the complete loop,
   dispatch patterns, and completion detection.
   - Use `ateam board-move moveItem` to advance items between stages
   - Use `ateam deps-check checkDeps` to find items ready to move from briefings → ready
   - Start new features if under WIP limit

6. **Final Mission Review:**
   - When ALL items reach `done` stage, trigger final review
   - Lynch reviews entire codebase for cross-cutting issues
   - Focus: readability, security, race conditions, code quality
   - If FINAL APPROVED → proceed to post-checks
   - If FINAL REJECTED → specified items return to pipeline

7. **Post-Mission Checks:**
   Run `ateam missions-postcheck missionPostcheck --json`.
   - Run after final review approves
   - Verifies lint, unit tests, and e2e tests all pass
   - Updates mission state with postcheck results
   - If checks fail, items return to pipeline for fixes

8. **Documentation Phase (Tawnia):**
   - Dispatch Tawnia when ALL three conditions are met:
     1. All items in `done` stage
     2. Final review passed
     3. Post-checks passed
   - Tawnia updates CHANGELOG.md (always)
   - Tawnia updates README.md (if user-facing changes)
   - Tawnia creates/updates docs/ entries (for complex features)
   - Tawnia makes the **final commit** bundling all mission work + documentation
   - Updates mission state with documentation completion and commit hash

9. **Completion (ALL conditions required):**
   - ✓ All items in `done` stage
   - ✓ Final review passed
   - ✓ Post-checks passed
   - ✓ Tawnia documentation committed ← **REQUIRED**
   - Then and ONLY then: "I love it when a plan comes together."


   **Mission is NOT complete until Tawnia commits. No exceptions.**

   - Items in `blocked` stage → Needs human intervention
   - Post-checks fail → Fix issues before documentation can run

## Progress Updates

```
[Hannibal] Feature 001 → testing, dispatching Murdock
[Murdock] 001 complete - test file created
[Hannibal] Feature 001 → implementing, dispatching B.A.
[Hannibal] Feature 002 → testing, dispatching Murdock
[B.A.] 001 complete - implementation ready
[Hannibal] Feature 001 → review, dispatching Lynch
[Murdock] 002 complete - test file created
[Lynch] 001 APPROVED
[Hannibal] Feature 001 → probing, dispatching Amy
[Amy] 001 VERIFIED - no bugs found
[Hannibal] Feature 001 → done
...
[Hannibal] All features complete. Dispatching final review.
[Lynch] FINAL MISSION REVIEW - reviewing 12 files
[Lynch] VERDICT: FINAL APPROVED
[Hannibal] Running post-mission checks...
[Hannibal] Post-checks PASSED (lint ✓, unit ✓, e2e ✓)
[Hannibal] Dispatching Tawnia for documentation and final commit.
[Tawnia] Updated CHANGELOG.md with 4 entries
[Tawnia] Updated README.md
[Tawnia] COMMITTED a1b2c3d - feat: Mission Name
[Hannibal] Documentation complete.
"I love it when a plan comes together."
```

## Example

```
# Default WIP of 3
/ai-team:run

# Higher parallelism
/ai-team:run --wip 4 --max-wip 6

# Sequential (one at a time)
/ai-team:run --wip 1 --max-wip 1
```

## Implementation Notes

**Hannibal runs in the MAIN context, not as a subagent.**

The main Claude session becomes Hannibal and orchestrates directly:

```
Main Claude (as Hannibal)
    ├── subagent → Murdock (testing stage)
    ├── subagent → B.A. (implementing stage)
    ├── subagent → Lynch (review stage, final review)
    ├── subagent → Amy (probing stage)
    └── subagent → Tawnia (documentation, after post-checks pass)
```

This flat structure:
- Gives user visibility into orchestration
- Allows mid-run intervention
- Avoids nested subagent memory overhead

The dispatch mode (legacy Task/TaskOutput vs. native TeamCreate/SendMessage) is determined by the orchestration playbook loaded in step 3.

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam missions-current getCurrentMission --json` | Check mission exists and get state |
| `ateam missions-precheck missionPrecheck` | Run lint/tests before starting |
| `ateam missions-postcheck missionPostcheck --json` | Run lint/tests after all done |
| `ateam board getBoard --json` | Get current board state |
| `ateam board-move moveItem --itemId <id> --toStage <stage>` | Move items between stages |
| `ateam board-claim claimItem --itemId <id> --agent <name>` | Assign agent to item |
| `ateam board-release releaseItem --itemId <id>` | Release agent assignment |
| `ateam items listItems --json` | List items by stage |
| `ateam deps-check checkDeps --json` | Find items ready to advance |
| `ateam agents-start agentStart --itemId <id> --agent <name>` | Signal agent beginning work |
| `ateam agents-stop agentStop --itemId <id> --agent <name> --status success --summary "..."` | Signal agent completed work |
| `ateam activity createActivityEntry --agent <name> --message "..." --level info` | Write to activity feed |

## Errors

- **No mission found**: Run `/ai-team:plan` first
- **Precheck failure**: Fix lint/test issues reported, then re-run `/ai-team:run` — the mission is recoverable, no re-planning needed
- **All items blocked**: Human intervention needed via `/ai-team:unblock`
- **Agent failure**: Item returned to previous stage for retry
- **API unavailable**: Cannot connect to A(i)-Team server
