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

**If `--wip N` was provided**, update each pipeline stage's WIP limit to N with the
`ateam` CLI. The pipeline stages to update are: `testing`, `implementing`, `review`,
`probing`. Use the CLI verb — never a raw `curl`, which carries no auth headers and is
rejected by zero-trust (Cloudflare Access / Authentik):

```bash
WIP=<N from --wip>   # substitute the actual number before running
for stage in testing implementing review probing; do
  ateam stages updateStage "$stage" --wipLimit "$WIP"
done
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
                                                        │  Frankie Walk   │
                                                        │ (mission tail)  │
                                                        └────────┬────────┘
                                                                 │
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
                                                        └────────┬────────┘
                                                                 │
                                                                 ▼
                                                        ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
                                                        ╎    Debrief      ╎
                                                        ╎    (Retro)      ╎
                                                        ╎ detached, best- ╎
                                                        ╎     effort      ╎
                                                        └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

**Stage transitions (ALL REQUIRED):**
1. `ready → testing`: Murdock writes tests (and types if specified)

   **Exception — NO_TEST_NEEDED items:** items with an empty `outputs.test`
   (e.g. deletion/cleanup tasks) have nothing for Murdock to do. Enter these
   directly at `implementing` (`ready → implementing`, skipping `testing`)
   and dispatch B.A. — don't burn a Murdock slot on a no-op.
2. `testing → implementing`: B.A. implements to pass tests
3. `implementing → review`: Lynch reviews ALL outputs together
4. `review → probing`: Lynch approves → **Amy MUST investigate** (NOT optional)
5. `probing → done`: Amy verifies (or back to ready if bugs found)
6. `all done → Frankie's mission-tail walk → final review`: Frankie walks the mission's full Definition of Done against the running app first (a fresh, non-pre-warmed agent). A failure halts the tail and surfaces to the operator — reopening a `done` item is a manual operator action, not an automated bounce. Once Frankie's walk is clean, Stockwell reviews entire codebase holistically (including Frankie's evidence bundle and graduated specs). Any rework that returns items to `done` — from a Frankie failure or a Stockwell rejection — restarts the tail at Frankie, who re-walks the FULL Definition of Done.
7. `final review → post-checks`: Run lint, unit, e2e tests
8. `post-checks → documentation`: **Tawnia MUST run** (NOT optional)
9. `documentation → complete`: Tawnia creates final commit, mission complete
10. `complete → debrief`: retro agent dispatched **detached, non-blocking** — not a gate on completion (see step 10 below)

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

   **Telemetry preflight (before the project checks):** verify observer telemetry will actually
   land, using the status the SessionStart hook recorded from the real hook environment:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/observer-preflight.js --check
   ```

   This catches the silent black-hole where the `ateam` CLI works (Bash shells source the user
   profile) but hook processes lack `ATEAM_PROJECT_ID` / CF-Access creds (they inherit only the
   harness env) — a mission then completes green with ZERO hook/token/cost telemetry. On FAIL:
   do NOT abort the mission — log it loudly and tell the operator, then continue:

   ```bash
   ateam activity createActivityEntry --agent hannibal --level warn \
     --message "OBSERVER PREFLIGHT FAILED: mission will run but hook/token telemetry will not land. <first FAIL reason>"
   ```

   Also surface the failure in your status output so the operator sees it at mission start, not
   after 5 hours of untracked burn.

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
   - Start new features if per-stage WIP limits allow (check instance availability, not global count)

6. **Frankie's Mission-Tail Walk, then Final Mission Review (Stockwell):**
   - **Drivability precondition (check FIRST):** read `surfaces` from the target repo's `ateam.config.json` — `scripts/hooks/lib/qa-contract.js` is the executable definition, exporting `readExecutionContract()` and `canFrankieDrive(surfaces)`. Only `web` is drivable today; `api`, `fixture-flow`, `golden-pair`, `cli`, `hardware`, and an empty/absent list are not. **If the repo has no drivable surface, SKIP Frankie entirely and go straight to Stockwell's final review** — dispatching him there deadlocks the tail (he reports a blocked walk, and the failure path below halts with no way forward). Same exemption the completion-gate hook (`scripts/hooks/enforce-final-review.js`) already enforces and the loaded playbook's Frankie section spells out (a skipped Frankie satisfies the documentation agent's precondition vacuously); say so in your status output so the skip reads as deliberate
   - Otherwise, when ALL items reach `done` stage, dispatch Frankie FIRST for the mission-tail QA walk — a fresh, non-pre-warmed agent (see the loaded orchestration playbook's "Frankie Mission-Tail Dispatch" section)
   - If Frankie's walk fails (names failing work items): HALT the tail here — do NOT dispatch Stockwell. Surface the failing items to the operator; reopening a `done` item is a manual operator action, not an automated bounce (`done` is terminal in `TRANSITION_MATRIX`)
   - Once Frankie's walk is clean, dispatch Stockwell for final review
   - Stockwell reviews PRD + diff for cross-cutting issues, including Frankie's evidence bundle and graduated specs
   - Focus: PRD compliance, consistency, security, integration
   - If FINAL APPROVED → proceed to post-checks
   - If FINAL REJECTED → surface the named items to the operator and stop. Reopening a `done` item is a manual operator action outside the pipeline, not an automated bounce — same as Frankie's failure path above (`done` is terminal in `TRANSITION_MATRIX`; see `adr/0005-done-is-terminal-no-in-mission-rework.md`). Once the operator has reworked every named item and it is back in `done`, the mission tail RESTARTS at Frankie (not post-checks) — Frankie re-walks the FULL Definition of Done

7. **Post-Mission Checks:**
   **GATE: Stockwell's Final Mission Review MUST have completed before running postchecks.**
   If Stockwell was not dispatched or did not return a verdict, STOP and dispatch Stockwell first.
   This is not optional — postchecks without a final review means cross-cutting issues go undetected.

   Run checks via Bash first (like precheck), then call `ateam missions-postcheck missionPostcheck` with results.

   Read `ateam.config.json` to get the list of check names (`config.postcheck`) and their commands
   (`config.checks`). Run each check via Bash, capturing stdout, stderr, and exit code.
   Then call `ateam missions-postcheck missionPostcheck` with the computed result:

   ```text
   config = Read("ateam.config.json")  # parse JSON

   passed   = true
   blockers = []
   output   = {}

   # config.postcheck lists the check names to run (e.g. ["lint", "unit"] by default).
   # config.checks maps each name to its shell command.
   # Results are stored in output keyed by check name: output["lint"], output["unit"], etc.
   for checkName in config.postcheck:
       if checkName not in config.checks:
           passed = false
           blockers.append("Check '" + checkName + "' is listed in config.postcheck but has no command in config.checks")
           continue
       if config.checks[checkName] is null:
           # Skip null commands (e.g. e2e: null means no e2e checks)
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

   ateam missions-postcheck missionPostcheck --passed {passed} --blockers {blockers} --output {output}
   ```

   - If `passed = true`: mission transitions to `completed`.
   - If `passed = false`: mission transitions to `failed`. Report blockers to user.
     Items that caused the failure return to pipeline for fixes.

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

10. **Debrief (Retro) — detached, best-effort:**

    Immediately after Tawnia's final commit lands (same moment as step 8, not gated on step 9's
    completion announcement), dispatch the retro agent (`agents/retro.md`) as a **detached,
    non-blocking** background agent:

    - Reuse whichever background-agent dispatch pattern your active orchestration playbook
      already uses for spawning pipeline agents — **do not introduce a new dispatch mechanism**.
      Native teams: `Agent(..., run_in_background: true)`, the same fire-and-forget pattern used
      to pre-warm pipeline lanes. No `SendMessage` ACK is expected back to `/ai-team:run`, and
      Hannibal does **not** wait for a DONE message from retro before finishing this command.
    - The Debrief adds **zero blocking latency** to mission completion. Step 9's completion
      declaration ("I love it when a plan comes together.") happens on schedule whether or not
      the Debrief has started, is still running, or has finished.
    - **A Debrief failure or kill never blocks mission completion or merge.** If the retro agent
      errors, times out, or is killed mid-run, the mission remains `completed` and any PR/merge
      proceeds unaffected — Debrief is diagnostic, not a pipeline gate.
    - **No silent gap:** if the Debrief is skipped (e.g. dispatch itself fails to spawn) or fails,
      log it to the activity feed so the absence is visible rather than silent:
      ```bash
      ateam activity createActivityEntry --agent hannibal --message "Debrief skipped/failed for mission {missionId}: {reason}" --level warn
      ```
    - **Manual re-run stays available.** `/ai-team:retro` remains fully documented
      (`commands/retro.md`) for regenerating or re-running the Debrief independently of a mission
      run — e.g. if the detached Debrief was killed, skipped, or the user wants to rerun it later.

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
[Hannibal] All features complete. Dispatching Frankie for the mission-tail QA walk.
[Frankie] Walking Definition of Done - 6 statements against http://localhost:3000
[Frankie] WALK PASSED - evidence bundle at .qa-evidence/M-20240115-001/report.md
[Hannibal] Frankie's walk clean. Dispatching Stockwell for Final Mission Review.
[Stockwell] FINAL MISSION REVIEW - reviewing 12 files
[Stockwell] VERDICT: FINAL APPROVED
[Hannibal] Running post-mission checks...
[Hannibal] Post-checks PASSED (lint ✓, unit ✓, e2e ✓)
[Hannibal] Dispatching Tawnia for documentation and final commit.
[Tawnia] Updated CHANGELOG.md with 4 entries
[Tawnia] Updated README.md
[Tawnia] COMMITTED a1b2c3d - feat: Mission Name
[Hannibal] Documentation complete.
[Hannibal] Dispatching Debrief (retro) detached — not blocking completion.
[Hannibal] Tip: run /ai-team:sweep for an independent branch review that captures and fixes what the pipeline missed.
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
    ├── subagent → Lynch (review stage)
    ├── subagent → Amy (probing stage)
    ├── subagent → Frankie (mission-tail QA walk, after all items reach done)
    ├── subagent → Stockwell (Final Mission Review, after Frankie's walk succeeds)
    ├── subagent → Tawnia (documentation, after post-checks pass)
    └── subagent → Retro (Debrief, detached/non-blocking, dispatched right after Tawnia's commit)
```

This flat structure:
- Gives user visibility into orchestration
- Allows mid-run intervention
- Avoids nested subagent memory overhead

The dispatch mode (legacy Task/TaskOutput vs. native Agent/SendMessage) is determined by the orchestration playbook loaded in step 3.

**Native teams messaging address:** in native teams mode, the main session
(Hannibal) is addressable as `team-lead`, not `hannibal`. Worker agents'
FYI/ALERT messages must target `team-lead` — a message addressed to
`hannibal` will not reach the orchestrating session. If you see any dispatch
prompt or playbook step reference `hannibal` as a message target, treat it
as a bug and use `team-lead` instead.

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
