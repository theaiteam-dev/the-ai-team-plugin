# Orchestration Reference

This document contains Hannibal-only reference material for mission orchestration. Read this at mission start alongside your orchestration playbook.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code                              │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐   │
│  │   Hannibal  │     │   Murdock   │     │    B.A.     │   │
│  │ (main ctx)  │     │ (subagent)  │     │ (subagent)  │   │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘   │
│         │                   │                   │           │
│         └───────────────────┼───────────────────┘           │
│                             │                               │
│                    ┌────────▼────────┐                      │
│                    │   ateam CLI     │                      │
│                    │  (Bash calls)   │                      │
│                    └────────┬────────┘                      │
└─────────────────────────────┼───────────────────────────────┘
                              │ HTTP + X-Project-ID header
                              ▼
                    ┌─────────────────┐
                    │  A(i)-Team API  │
                    │    (Database)   │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Kanban UI     │
                    │ (Web Dashboard) │
                    └─────────────────┘
```

### With Native Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)

Pipeline agents communicate directly with each other (peer-to-peer handoffs) and each pipeline role runs as a **pool of N parallel instances** (`murdock-1`, `murdock-2`, ..., `ba-1`, ...) sized by `ateam scaling compute`. Hannibal dispatches the initial pool and then receives only FYI/ALERT messages — it is NOT in the handoff path. Idle/busy state is tracked via a file-based pool directory on the local filesystem; completing agents claim an idle peer atomically and the `ateam` CLI returns the claimed instance name in its JSON response.

```
┌──────────────────────────────────────────────────────────────────┐
│                         Claude Code                               │
│                                                                   │
│  ┌─────────────┐                                                  │
│  │   Hannibal  │─── Task(Murdock) ──────────────────────────┐    │
│  │ (team lead) │◀── FYI/ALERT ──────────────────────────────┤    │
│  └─────────────┘                                            │    │
│                                                             │    │
│  ┌──────────┐  START  ┌──────┐  START  ┌───────┐  START  ┌─▼──┐ │
│  │ Murdock  │────────▶│ B.A. │────────▶│ Lynch │────────▶│Amy │ │
│  │ (tester) │◀── ACK ─│(coder│◀── ACK ─│(review│◀── ACK ─│(inv│ │
│  └──────────┘         └──────┘         └───────┘         └────┘ │
│       │                  │                  │                │   │
│       └──────────────────┴──────────────────┴────────┐      │   │
│                                                       │      │   │
│                                              ┌────────▼──────▼─┐ │
│                                              │   ateam CLI     │ │
│                                              │  (agentStop     │ │
│                                              │   --advance)    │ │
│                                              └────────┬────────┘ │
└───────────────────────────────────────────────────────┤──────────┘
                                                        │
                                                        ▼
                                              ┌─────────────────┐
                                              │  A(i)-Team API  │
                                              │ (stage advance, │
                                              │  WIP check)     │
                                              └─────────────────┘
```

**Peer-to-peer handoff protocol (happy path):**
1. Agent calls `ateam agents-stop agentStop --advance --json` → API advances the item in a transaction (claim delete + WIP check + item update are atomic), and the `ateam` CLI then claims an idle next-stage instance from the pool by atomically renaming its `.idle` file to `.busy`
2. CLI returns `claimedNext` (e.g. `"ba-2"`) in the JSON response; on an empty pool it returns `poolAlert` instead
3. Agent sends START message directly to `claimedNext` (e.g., `murdock-1` → `ba-2`)
4. Next agent ACKs within 20 seconds
5. Agent sends FYI to Hannibal ("handoff confirmed")
6. If no ACK within 20s, or if `poolAlert` is set: agent sends ALERT to Hannibal — Hannibal intervenes only on ALERT

**WIP limit handling:**
- If `agentStop --advance` returns `WIP_LIMIT_EXCEEDED` (409): use `--advance=false` to release the claim, then send ALERT to Hannibal
- Hannibal re-dispatches when WIP capacity opens
- WIP limits are **per stage** — never sum in-flight work across stages. An idle agent should be dispatched if its stage has capacity regardless of how full other stages are.

Native teams + the pool directory handle orchestration and routing; `ateam` CLI handles persistence, stage transitions, and pool claim/release.

### Hannibal Heartbeat Health Check

Because peer-to-peer handoffs leave Hannibal mostly asleep, a silent stall (e.g., a teammate finishes and goes idle without successfully handing off) can sit undetected indefinitely. To guard against this, Hannibal arms a self-wake every 1500s using the `ScheduleWakeup` primitive with the prompt `"/ai-team:healthcheck"`. The wake fires the `/ai-team:healthcheck` slash command (`commands/healthcheck.md`), which deterministically re-arms the next wake, pulls `GET /api/missions/current/health-report` (CLI: `ateam missions-health getHealthReport --json`) — returning per-in-flight-item activity signals (`claimedAt`, `lastActivityAt`, `lastActivitySource`, `idleSeconds`, `lastWorkLogEntry`, `recentActivity`) plus an aggregate `missionIdle` boolean derived from a 600-second per-item idle threshold — inspects the local `/tmp/.ateam-pool/${ATEAM_MISSION_ID}/` directory for the suspect agent, and either pings `STATUS?` or re-dispatches. The endpoint exposes raw timestamps and counts; the only threshold is the 600s cutoff used to compute `missionIdle`. Using a slash command (not a freeform `HEARTBEAT:` string) guarantees the routine runs every fire — a prior run shipped 6 wakes but only ran the routine once because the freeform prompt was easy to skim past. See `commands/healthcheck.md`, `agents/hannibal.md` ("Heartbeat health check"), and `playbooks/orchestration-native.md` ("Heartbeat Health Check") for the full procedure.

## Pipeline Parallelism & Instance Pools

Each pipeline role (Murdock, B.A., Lynch, Amy) runs as a pool of N parallel instances, where N is computed per mission by `ateam scaling compute` (see below). When N=1, instance names are the base names (`murdock`, `ba`, `lynch`, `amy`) and behaviour is identical to single-instance mode. When N>1, instances are suffixed numerically: `murdock-1`..`murdock-N`, `ba-1`..`ba-N`, etc. Different work items flow through the pipeline concurrently; within each stage, up to N items can be processed in parallel.

### Pool Directory

Hannibal creates a pool directory at mission start for zero-latency peer discovery:

```
/tmp/.ateam-pool/{missionId}/
  murdock-1.idle
  murdock-2.idle
  ba-1.idle
  ba-2.idle
  lynch-1.idle
  amy-1.idle
```

- **Claim**: atomic `os.Rename` from `{instance}.idle` → `{instance}.busy` (race-safe; the winner is whichever process succeeds at the rename)
- **Release**: `agentStop` always self-releases the caller's `.busy` → `.idle` via a `defer`, even on API errors — this prevents orphaned claims from leaking pool slots
- **Next claim**: after a successful forward `--advance`, the CLI claims an idle slot of the next pipeline stage and returns `{"claimedNext": "ba-2"}` or `{"poolAlert": "no idle ba instance available"}`
- **Hannibal MUST NOT touch pool files** after initialization except during ALERT recovery — pool state is owned exclusively by the pipeline agents
- **Ephemeral**: the pool lives in `/tmp/` and does not survive reboots; the `ATEAM_MISSION_ID` env var scopes each mission's pool into its own subdirectory. Tawnia removes the pool directory after the final commit.

No instance-number affinity exists — `murdock-2` completing WI-008 may hand off to `ba-1` or `ba-2`, whichever is idle first.

## Adaptive Scaling

`ateam scaling compute --json` determines how many parallel instances to spawn per pipeline role. The result is persisted on the Mission row (`Mission.scalingRationale`, JSON blob) and rendered in the Kanban UI's scaling modal.

**Formula** (`packages/shared/src/adaptive-scaling.ts`):

```
instanceCount = min(depGraphMax, memoryCeiling, wipLimit)
```

Inputs:
- **`depGraphMax`** — maximum items per stage as derived from the dependency graph (`dep-graph-analysis`). Sets the natural ceiling imposed by work shape.
- **`memoryCeiling`** — `floor(freeMemMB * 0.8 / 400 / 4)`. Reserves 20% of free memory for the OS, assumes ~400 MB per subagent instance, and divides by the 4 pipeline agent types (`packages/shared/src/memory-budget.ts`). Always at least 1.
- **`wipLimit`** — per-stage WIP limit from the board configuration.
- **`concurrencyOverride`** (optional) — manual `--concurrency N` override that bypasses the min() entirely.

**Binding constraint** is reported in the rationale and identifies which value won: `'dep_graph' | 'memory' | 'wip' | 'override'`. This tells operators whether the mission is limited by its dependency shape, host memory, the configured WIP limits, or a manual override.

**CLI flags:**

```bash
ateam scaling compute --json                      # adaptive, auto-detected
ateam scaling compute --concurrency 4 --json      # force N=4, bypass formula
ateam scaling compute --memory 8192 --json        # override detected free MB
```

Hannibal runs this once per mission during init and persists the rationale via `PATCH /api/missions/{missionId}` with `{scalingRationale: result.data}`.

## Rejection Flow

Rejections are handled directly by `ateam agents-stop agentStop`. The legacy `ateam items rejectItem` command has been removed.

When Lynch (or any pipeline agent) rejects an item:

```bash
ateam agents-stop agentStop \
  --itemId WI-007 \
  --agent lynch-1 \
  --outcome rejected \
  --return-to testing \
  --advance=false \
  --summary "Missing negative-path coverage; see comments"
```

- The API atomically increments `rejectionCount`, moves the item back to the `--return-to` stage, and logs the rejection to the work log.
- When `rejectionCount` hits the configured rejection cap (default `4`, override via `ATEAM_REJECTION_CAP` on the API server) the item is escalated to `blocked`.
- The working agent then sends a REJECTED peer message to the correct recipient so the rework starts immediately — Hannibal is notified via FYI only.
- `--advance=false` is required on rejection: the item is moving backward, not forward, so the default forward `--advance=true` pool claim must be skipped.

**Valid rejection routes** (enforced by `scripts/hooks/enforce-handoff.js` REJECTION_TARGETS):

| Rejector | --return-to | REJECTED recipient | Use case |
|----------|-------------|--------------------|----------|
| `lynch`  | `testing`       | `murdock-N` | Tests miss an AC or assert wrong behavior (test gap, with or without an impl bug — earliest-flagged-stage) |
| `lynch`  | `implementing`  | `ba-N`      | Tests OK; impl is wrong (impl-only) |
| `amy`    | `testing`       | `murdock-N` | FLAG names any test gap (alone or with an impl bug) — earliest-flagged-stage |
| `amy`    | `implementing`  | `ba-N`      | FLAG names only an impl bug (probing found a bug beyond test coverage) |
| `ba`     | `testing`       | `murdock-N` | TEST BUG only — test won't compile / throws on valid input / asserts impossible behavior. Summary must start with `TEST BUG:` |

B.A.'s self-rejection is restricted to `--return-to testing` and uses the `TEST BUG:` summary prefix; any other rejection target from B.A. will be blocked by the handoff hook. This path exists to prevent the "B.A. blocks waiting for Hannibal to manually re-dispatch Murdock" stall pattern. See `agents/ba.md` "When the Test Is Wrong" for the narrow trigger criteria.

## Final Review Persistence

Stockwell's Final Mission Review is stored in the database on the Mission row (`Mission.finalReview`, Markdown) rather than on the filesystem, so the full review is visible in the Kanban UI and survives session restarts.

- Write: `ateam missions-final-review writeFinalReview --missionId <id> --report <markdown>` (`POST /api/missions/{id}/final-review`)
- Read: `ateam missions-final-review getFinalReview --missionId <id>` (`GET /api/missions/{id}/final-review`)

Stockwell writes the review as its last step before post-checks run; Tawnia reads it when drafting release notes and the final commit message.

**Frankie's evidence, by contrast, is filesystem-based** — his walk runs BEFORE Stockwell (once all items reach `staged`, the per-item pipeline's real terminal stage — WI-786/787, not `done`), and his evidence bundle (`.qa-evidence/<mission>/report.md`) and any graduated `specs/` files land in the repo itself rather than the database, so Stockwell's diff review already includes them and Tawnia commits them alongside the feature work.

## Item Commits and the Mission Pull Request

Each item's code is committed by the `ateam` CLI as the item reaches `staged`. Tawnia's final commit no longer carries item code.

### When the item commit happens

The commit runs once, right after the API confirms an item moved into `staged`. That covers `ateam agents-stop agentStop` (Amy's VERIFIED handoff) and `ateam board-move moveItem --toStage staged`. It lands on the branch that is checked out, and it is never amended.

An item that is rejected out of `staged` and later returns gets a new commit. The earlier commit stays in history. The latest SHA is recorded on the item (`commitSha`).

### What the commit includes

The CLI reads `git status` and commits these paths:

- The item's own declared outputs (`outputs.test`, `outputs.impl`, `outputs.types`).
- Changed paths that no unfinished item declares. These are listed in the commit body under "Undeclared paths included".

It leaves out:

- Paths declared by any sibling item that is not yet `done` or `archived`. This includes siblings in `staged`, because a staged sibling's own commit may not have run yet, so its files still belong to it. Only `done` and `archived` siblings release their declared files.
- `.qa-evidence/` and `specs/`, unless the item declares them. Tawnia commits those.
- Every path in the pre-mission baseline (see below).

If nothing is left to commit, no commit is made and a note goes in the item's work log.

### Commit message

The subject follows Conventional Commits with a prefix taken from the item type: `feat` for `feature` and `enhancement`, `fix` for `bug`, `chore` for `task`. The last paragraph holds trailers:

```
feat: <item title>

Item: WI-123
Mission: M-20261011-001
PRD: item-commits
Lanes: murdock-1 ba-3 lynch-2 amy-1
```

- `Item`: the work item id.
- `Mission`: the mission id.
- `PRD`: the PRD file name without its extension. Omitted when the mission has no PRD path.
- `Lanes`: the agent instances that completed or rejected the item, in time order. Omitted when the work log has none. A reworked item lists the lanes of each pass.

Item commits carry no `Co-authored-by` lines. Tawnia's final commit still does.

### Squash merges and the GitHub setting

The draft PR is meant to be squash-merged. GitHub builds the squash commit message from the setting "Default commit message" under Settings, General, Pull Requests. Set it to **Pull request title and description**. With that setting the body of the PR description is the commit message. That description is the file `ateam missions-pr describe` writes (`.qa-evidence/<missionId>/pr-description.md`), and it carries the `Mission:` and `PRD:` trailers. With the other choices (default message, or the commit messages list) the trailers can be dropped or mangled on `main`.

The repo setting is outside what the CLI can check. A real squash merge of a mission PR, followed by reading the resulting commit on `main`, is an operator step. Do it once per repo after enabling the setting.

GitHub also appends `Co-authored-by` lines to a squash commit. Where they land decides whether `Mission:` and `PRD:` stay readable as trailers. In a sandbox (not confirmed against GitHub), `git interpret-trailers --parse` kept `Mission:` and `PRD:` when the co-author lines sat directly under them. It dropped both when the co-author lines formed a separate paragraph or came after a `---------` separator line. Verify the first real squash merge by running `git interpret-trailers --parse` on the resulting commit on `main` and confirming `Mission:` and `PRD:` appear in the output.

### Branch safety

`ateam pool init` records the checked-out branch in `/tmp/.ateam-pool/<missionId>/branch`. Before every item commit the CLI compares the current branch with that file and refuses to commit on a mismatch. A detached HEAD at `pool init` is an error.

Recovery:

- Branch mismatch: check out the recorded branch, or write the new branch name into the file by hand if the switch was deliberate.
- Missing or empty branch file: re-run `ateam pool init`, or write the branch name into the file by hand.

### Pre-existing dirty files

`pool init` also writes `/tmp/.ateam-pool/<missionId>/baseline-dirty`: one `<git-hash>\t<path>` line for each file that was dirty before the mission started. Those paths are never committed by an item commit or by Tawnia. If the file is missing when an item commit runs, the CLI refuses to commit rather than guess.

Both files are written only if absent, so a second `pool init` does not record mission work as pre-existing.

At the end of the mission Tawnia compares each baseline path's current hash with the recorded one. She lists the ones the mission changed in her commit body and her report, under "pre-existing files changed by the mission, not committed". She also lists leftover modified paths that no item commit took and that are not in the baseline, and commits only those she names.

### When the item commit fails

A failed commit does not change the exit code of `agentStop` or `board-move`, and the item stays in `staged`. The failure shows up in three places:

- stderr, as a line starting `ITEM_COMMIT_FAILED: <itemId>: <reason>`.
- The activity feed, as an error entry.
- The JSON response, as `data.itemCommit`: `{ "committed": false, "error": "..." }`. On success it is `{ "committed": true, "sha": "..." }`, or `{ "committed": false, "noChanges": true }` when there was nothing to commit.

The agent that sees the marker sends an ALERT to Hannibal. To recover:

1. Fix the cause named in the reason. The causes the code can produce are:
   - branch mismatch, detached HEAD, or a missing or empty `branch` file (see "Branch safety");
   - a missing or unreadable `baseline-dirty` file;
   - the item or the current mission cannot be fetched from the API, or the mission id cannot be resolved;
   - an unknown item type, an invalid work-log timestamp, or a line break in the item title or mission id;
   - a git command failing while building the commit;
   - the API rejecting the `commitSha` update after the commit was made. The error reads "committed <sha> but recording commitSha failed". The commit exists on the branch; step 3 records it;
   - refreshing the real index after the commit failing, for example because `index.lock` stayed held for more than 10 seconds. The error reads "committed <sha> but refreshing the index failed". The commit exists and its SHA is recorded on the item. Once the lock is gone, run `git reset -q -- <the item's paths>` so the index matches HEAD for them.

   The branch is checked twice, before and under the commit lock. Commits are built with `commit-tree` and `update-ref`, so commit hooks do not run and cannot block them. A held `index.lock` is retried for up to 10 seconds before the index refresh fails.
2. Re-run `ateam items-commit commitItem --itemId <id>`. It only accepts items in `staged`.
3. If the commit already exists but its SHA never reached the board, the same command finds the newest commit on HEAD with `Item: <id>` as a trailer and records that SHA. If the board already has it, it reports that there is nothing to commit.

### Draft pull request

After Tawnia's commit she runs, with `ATEAM_MISSION_ID` set:

```bash
ateam missions-pr describe     # writes .qa-evidence/<missionId>/pr-description.md
ateam missions-pr openDraft    # pushes the branch and opens a draft PR
```

`openDraft` only opens a draft. It never marks the PR ready and never merges. The operator does both.

`ateam.config.json` has one switch:

```json
{ "pullRequest": { "open": false } }
```

`pullRequest.open` defaults to on when the key or the file is absent. Set it to `false` to stop `openDraft` from pushing or opening anything. `openDraft` also stops without opening a PR when the repo has no remote, `gh` is not installed, or `gh auth status` fails. In each case it prints the description file path, the exact `gh pr create --draft ...` command, and the reason, then exits 0. If a PR already exists for the branch, it reports that PR's URL.

### Pool teardown

- `ateam pool destroy` removes the pool markers but keeps `branch` and `baseline-dirty`. Use it with `pool init` to rebuild a pool mid-mission, since the kept files stop in-flight work from being recorded as pre-existing.
- `ateam pool destroy --all` removes the whole `/tmp/.ateam-pool/<missionId>/` directory, including both files. Tawnia runs it last, after the baseline comparison and the draft PR step.

## Plugin Commands

### Mission Commands
- `/ai-team:setup` - Configure project ID, permissions, teammate mode, and settings (run once per project)
- `/ai-team:plan <prd-file>` - Initialize mission from PRD, Face decomposes into work items
- `/ai-team:run [--wip N]` - Execute mission with pipeline agents (default WIP: 3)
- `/ai-team:status` - Display kanban board with current progress
- `/ai-team:resume` - Resume interrupted mission from saved state
- `/ai-team:unblock <item-id> [--guidance "hint"]` - Unblock stuck items

### Standalone Skills
- `/perspective-test <feature>` - Test a feature from user's perspective (static analysis + browser verification)

## Agent Dispatch (Dual Mode)

The plugin supports two dispatch modes, controlled by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`. The `/ai-team:run` command detects the mode and loads the appropriate orchestration playbook:

- **Legacy mode** (default): `playbooks/orchestration-legacy.md` - Uses `Task` with `run_in_background: true` and `TaskOutput` polling
- **Native teams mode** (env var = "1"): `playbooks/orchestration-native.md` - Uses `TeamCreate`, `Task` with `team_name`, and `SendMessage`

**Progressive disclosure:** Hannibal reads exactly ONE playbook at mission start. The playbook contains the complete orchestration loop, agent dispatch patterns, completion detection, and concrete examples. Claude never sees the irrelevant mode's instructions.

Model selection is defined in each agent's frontmatter (`agents/*.md`) — do NOT pass `model:` at dispatch time.

**Planning Phase (both modes):**
- Face: `subagent_type: "ai-team:face"`
- Sosa: `subagent_type: "ai-team:sosa"`

**Per-Feature Pipeline (ALL MANDATORY for each item):**
- Murdock: `subagent_type: "ai-team:murdock"` → testing stage
- B.A.: `subagent_type: "ai-team:ba"` → implementing stage
- Lynch: `subagent_type: "ai-team:lynch"` → review stage (per-feature)
- Amy: `subagent_type: "ai-team:amy"` → probing stage (EVERY feature, no exceptions)

In native teams mode each of the four pipeline roles is spawned as **N parallel instances** (`murdock-1`..`murdock-N`, `ba-1`..`ba-N`, etc.), sized by `ateam scaling compute`. The `name:` passed to `Task` is the instance name (e.g. `murdock-2`), and agents pass the same instance name to `agentStart` / `agentStop` so pool slot accounting stays consistent. When N=1 the base names (`murdock`, `ba`, `lynch`, `amy`) are used.

**Mission Completion (MANDATORY):**
- Frankie: `subagent_type: "ai-team:frankie"` → mission-tail QA walk against the running app, once all items reach `staged` and BEFORE Stockwell. A fresh, non-pre-warmed agent; a failure halts the tail — Hannibal moves each named item out of `staged` to `testing` or `implementing` via a real, rejection-cap-counted `board-move` (earliest-flagged-stage rule, WI-794), not a manual reopen. Any rework restarts the tail at Frankie, who re-walks the FULL Definition of Done.
- Stockwell: `subagent_type: "ai-team:stockwell"` → Final Mission Review (PRD+diff scoped), persisted via `missions-final-review writeFinalReview`. Runs only after Frankie's walk succeeds; an APPROVED verdict atomically promotes every `staged` item to `done` (WI-790); a Stockwell rejection restarts the tail at Frankie once the named items are back in `staged`.
- Tawnia: `subagent_type: "ai-team:tawnia"` → after post-checks pass

## Background Agent Permissions

**IMPORTANT:** Background agents (`run_in_background: true`) cannot prompt for user approval. Operations that require approval will be auto-denied.

**Native Teams Mode:** When using native teams, agents are spawned as teammates via `Task` with `team_name` parameter. The same permissions in `.claude/settings.local.json` are still required for filesystem operations.

Run `/ai-team:setup` once per project to configure required permissions in `.claude/settings.local.json`:

```json
{
  "env": {
    "ATEAM_PROJECT_ID": "my-project-name",
    "ATEAM_API_URL": "http://localhost:3000"
  },
  "permissions": {
    "allow": [
      "Bash(mkdir *)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Write(src/**)",
      "Edit(src/**)"
    ]
  }
}
```

**CRITICAL:** Both `ATEAM_PROJECT_ID` and `ATEAM_API_URL` must be in the `env` section. The `ateam` CLI reads these as environment variables.

| Permission | Used By | Purpose |
|------------|---------|---------|
| `Bash(mkdir *)` | Murdock, B.A. | Create directories for tests/implementations |
| `Bash(git add *)` | Tawnia | Stage files for final commit |
| `Bash(git commit *)` | Tawnia | Create final commit |
| `Write(src/**)` | Murdock, B.A. | Write tests and implementations |
| `Edit(src/**)` | B.A. | Edit existing files during implementation |

### Enforcement Hooks (Native Teams)

Two hooks enforce the lifecycle and routing invariants for peer-to-peer handoffs:

- **`enforce-agent-start.js`** (PreToolUse) — blocks `ateam agents-stop` and `ateam activity createActivityEntry` calls until `agents-start` has been called in the session. Prevents `NOT_CLAIMED` errors from agents (especially Lynch) who would otherwise skip claiming before logging work. Read-only `activity listActivity` is not gated — mission-scoped agents (e.g. retro) have no item to claim and must be able to read the feed.
- **`enforce-handoff.js`** (Stop) — registered per-agent on Murdock, B.A., Lynch, and Amy. After `agentStop` returns, verifies the agent sent exactly one `SendMessage` to the correct peer (matching the `claimedNext` instance from the CLI response) with the expected content type. Blocks the Stop event if the handoff is missing or misrouted. Intentionally NOT registered globally, since legacy subagent mode dispatches via the `Task` tool and would false-positive.

## Environment Variables

The `ateam` CLI reads the following environment variables (the two `ATEAM_SKIP_*_GATE` overrides are read by Hannibal's Stop hooks — `enforce-orchestrator-stop.js` / `enforce-final-review.js` via `scripts/hooks/lib/stop-gates.js` — not by the CLI):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ATEAM_PROJECT_ID` | Yes | `default` | Project identifier for multi-project isolation |
| `ATEAM_API_URL` | No* | `http://localhost:3000` | Base URL for the A(i)-Team API |
| `ATEAM_API_KEY` | No | - | Optional API key for authentication |
| `ATEAM_TIMEOUT` | No | `10000` | Request timeout in milliseconds |
| `ATEAM_RETRIES` | No | `3` | Number of retry attempts |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | No | - | Set to `1` to enable native teams dispatch |
| `ATEAM_TEAMMATE_MODE` | No | `auto` | Teammate display: `auto`, `tmux`, or `in-process` |
| `ATEAM_MISSION_ID` | Yes (native teams) | - | Mission identifier used to scope the pool directory at `/tmp/.ateam-pool/{missionId}/`. Each pipeline agent must export this before calling `ateam agents-stop` so pool claim/release can find the right directory. |
| `ATEAM_SKIP_FRANKIE_GATE` | No | - | Set to `1`/`true` to override ONLY the Frankie evidence gate (`checkFrankieEvidence`) on Hannibal's Stop hooks — missing, stale, or ❌-bearing `.qa-evidence/<missionId>/report.md`. For operators who cannot drive Frankie's walk (no Playwright headless shell, no flowspec, dev server unavailable). Does NOT release the staged-promotion gate. |
| `ATEAM_SKIP_PROMOTION_GATE` | No | - | Set to `1`/`true` to override ONLY the staged-items-not-promoted gate (`checkStagedNotPromoted`), which otherwise blocks the mission from stopping while any item sits in `staged`. For operator recovery when the board cannot clear on its own — e.g. an APPROVED final review exists but the API never promoted (a server predating WI-790's promotion transaction). Deliberately separate from `ATEAM_SKIP_FRANKIE_GATE`: skipping a walk nobody can drive is a different decision from declaring a mission finished with items the API never promoted. |

*`ATEAM_API_URL` defaults to `http://localhost:3000`. If your API runs elsewhere, you MUST set this variable.

Configure these in `.claude/settings.local.json`:

```json
{
  "env": {
    "ATEAM_PROJECT_ID": "my-project-name",
    "ATEAM_API_URL": "http://localhost:3000"
  }
}
```

## Project Configuration

The `/ai-team:setup` command **auto-detects** project settings and creates `ateam.config.json`:

### Auto-Detection Sources

1. **CLAUDE.md** - Scans for: package manager mentions, test/lint commands, dev server URLs, Docker commands
2. **package.json** - Checks `scripts` for: `test`, `test:unit`, `test:e2e`, `lint`, `dev`, `start`, and a seed-shaped script for `qa.seed`
3. **Lock files** - Detects package manager: `package-lock.json` → npm, `yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm, `bun.lock` (or legacy binary `bun.lockb`) → bun
4. **`.env.example`** - Scans for a QA/test credential env-var name (never its value) for `qa.account.credential_env`
5. **Framework config / entrypoints** - Detects drivable `surfaces` (web framework config, CLI entrypoints)

### Config File Format

See `commands/setup.md` (Step 6) for the canonical `ateam.config.json` template and full field reference — including the execution-contract fields (`surfaces`, `qa`, `testing_level`, `evidence`, `review_tier`), `ateamCliVersion`, and `pricing`. This file doesn't duplicate the template — see `adr/0006-ateam-config-schema-deferred.md` for why a second copy is exactly how these fields have drifted before (this section itself was one of the four divergent copies that ADR closed).

**Pre-mission checks** (`ateam missions-precheck missionPrecheck`):
- Run before `/ai-team:run` starts execution
- Ensures codebase is in clean state (no existing lint/test failures)
- Establishes baseline for mission work

**Post-mission checks** (`ateam missions-postcheck missionPostcheck`):
- Run after Stockwell completes and persists the Final Mission Review
- Proves all code works together (lint + unit + e2e all passing)
- Required for mission completion (enforced by Hannibal's Stop hook)

## Plugin Dependencies

Amy (Investigator) uses browser testing tools during the probing stage to verify UI features. The `/ai-team:setup` command detects which tools are available and offers to install the preferred one.

**agent-browser CLI (Preferred):**
Amy's primary browser testing tool. Installed globally via npm/bun (`npm install -g agent-browser`). Used via Bash commands (`agent-browser open`, `agent-browser snapshot`, etc.). The `/ai-team:setup` command checks for it and offers to install it if missing, adding `Bash(agent-browser:*)` and `Skill(agent-browser)` permissions automatically.

**Playwright MCP Plugin (Fallback):**
Still supported as a fallback if agent-browser is unavailable. Detected by the presence of MCP tools matching `mcp__*playwright*` (e.g., `browser_navigate`, `browser_snapshot`, `browser_click`). The `/ai-team:setup` command detects this automatically and adds the required MCP tool permissions.
