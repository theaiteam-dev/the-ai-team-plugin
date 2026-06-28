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

## Pre-Flight: CLI Version Check

The `ateam` CLI wrapper auto-downloads and updates the binary when needed. Run a quick smoke test to verify it's working:

```bash
${CLAUDE_PLUGIN_ROOT}/bin/ateam --version
```

```text
if the command fails:
    Output to user:
    "⚠ ateam CLI failed to initialize. Check network connectivity and try again,
    or run /ai-team:setup for manual installation."

    STOP. Do not proceed.
```

If the version check passes, continue silently — no output needed.

## Pre-Flight: Environment Check

Verify the A(i)-Team environment is configured before attempting any API calls.

```bash
# Check ATEAM_PROJECT_ID is set
echo $ATEAM_PROJECT_ID
```

```text
if empty or "default":
    Output to user:
    "⚠ ATEAM_PROJECT_ID is not configured. The API requires a project ID
    to isolate your mission data.

    Run /ai-team:setup to configure your project, then restart Claude Code."
    STOP.
```

```bash
# Check API is reachable
${CLAUDE_PLUGIN_ROOT}/bin/ateam board getBoard --json 2>&1 | head -5
```

```text
if connection refused or timeout:
    Output to user:
    "⚠ Cannot reach the A(i)-Team API at ${ATEAM_API_URL:-http://localhost:3000}.

    Make sure the kanban-viewer is running, or run /ai-team:setup to configure."
    STOP.
```

If all checks pass, continue silently.

## Pre-Flight: WIP Limit Check

Read the board to see current per-stage WIP limits and apply the `--wip` argument if provided.

```bash
# Get current board state (includes wip_limits)
${CLAUDE_PLUGIN_ROOT}/bin/ateam board getBoard --json
```

Extract `wip_limits` from the response. Display current limits to the user:

```text
[Hannibal] Per-stage WIP limits:
  testing:       {N}
  implementing:  {N}
  review:        {N}
  probing:       {N}
```

**If `--wip N` was provided**, update each pipeline stage's WIP limit to N via the API.
The pipeline stages to update are: `testing`, `implementing`, `review`, `probing`.

For each stage, call:
```bash
curl -s -X PATCH "${ATEAM_API_URL:-http://localhost:3000}/api/stages/{stageId}" \
  -H "Content-Type: application/json" \
  -H "X-Project-ID: ${ATEAM_PROJECT_ID}" \
  -d '{"wipLimit": N}'
```

After updating, display the new limits:
```text
[Hannibal] Updated per-stage WIP limits to {N}:
  testing:       {N}
  implementing:  {N}
  review:        {N}
  probing:       {N}
```

**IMPORTANT:** WIP limits are **per stage** (per column), NOT global across the pipeline.
Each stage independently caps how many items can be in that stage simultaneously.
An idle agent instance should ALWAYS be dispatched work if its stage has capacity —
do not block dispatch because other stages are full.

## Pre-Flight: Model Check

Before doing anything else, check your current model. Your system prompt contains your model ID (e.g., "You are powered by the model named Opus 4.6").

```text
if model is NOT sonnet:
    Output to user:
    "Hannibal orchestration runs on Sonnet. You're currently on [model name].

    Please switch first:  /model sonnet
    Then re-run:          /ai-team:run"

    STOP. Do not proceed.
```

Hannibal's job is coordination, not deep reasoning — but it must reliably drive the tick loop to completion. Haiku was trialed for the tick loop and produced a runaway that never converged (it kept ticking while the pipeline sat idle), so Sonnet is the required floor. The heavy thinking still happens in subagents, which set their own models via frontmatter.

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
                                                        │  (Stockwell)    │
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

WIP limits are **per stage** — each pipeline column independently caps how many items can be in it. An idle agent should always get work if its stage has capacity.

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

3. **Enter the tick controller loop — DEFAULT PATH ENDS HERE**

   Output to user:
   ```
   [Hannibal] Tick controller engaged. Watching mission via /ai-team:tick.
   ```

   Use the **Skill tool** to invoke the tick command now:
   ```
   Skill({"skill": "ai-team:tick"})
   ```

   **⛔ STOP. This is the end of /ai-team:run for the default path.**
   The tick skill handles everything from here: reading the action plan, dispatching
   agents, confirming actions, and scheduling the next wake. Do NOT load any playbook.
   Do NOT execute the legacy steps below. Do NOT dispatch any agents yourself.

---

## Legacy Mode (`--legacy` flag only)

> **Only read this section if `--legacy` was explicitly passed as an argument.**
> If `--legacy` was NOT passed, you already finished at step 3. Stop here.

**Step L1 — Load the orchestration playbook:**

Check the environment variables:
```
Bash("echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS")
Bash("echo $CLAUDE_PLUGIN_ROOT")
```

Find and load ONE playbook:
- If `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`: `Read("$CLAUDE_PLUGIN_ROOT/playbooks/orchestration-native.md")` (or search for it with `find`)
- Otherwise: `Read("$CLAUDE_PLUGIN_ROOT/playbooks/orchestration-legacy.md")`

**Read exactly ONE playbook. Do not read both.**

**Step L2 — Orchestration loop:**
Follow the loaded playbook for the complete loop, dispatch patterns, and completion detection.

**Step L3 — Final Mission Review (Stockwell):**
When ALL items reach `done`, dispatch Stockwell. If FINAL APPROVED → proceed to post-checks.

**Step L4 — Post-Mission Checks:**
Run checks via Bash (per `ateam.config.json`), then call `ateam missions-postcheck missionPostcheck`.

**Step L5 — Documentation Phase (Tawnia):**
When all items done + final review passed + post-checks passed, dispatch Tawnia for CHANGELOG and final commit.

**Step L6 — Completion:**
Mission complete only when: all items done ✓, final review passed ✓, post-checks passed ✓, Tawnia committed ✓.
"I love it when a plan comes together."

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

The dispatch mode (legacy Task/TaskOutput vs. native Agent/SendMessage) is determined by the orchestration playbook loaded in step 3.

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
