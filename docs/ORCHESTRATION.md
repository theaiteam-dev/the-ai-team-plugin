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
- At `rejectionCount == 2` the item is escalated to `blocked`.
- The working agent then sends a REJECTED peer message to the correct recipient (Murdock for test issues, B.A. for implementation issues) so the rework starts immediately — Hannibal is notified via FYI only.
- `--advance=false` is required on rejection: the item is moving backward, not forward, so the default forward `--advance=true` pool claim must be skipped.

## Final Review Persistence

Stockwell's Final Mission Review is stored in the database on the Mission row (`Mission.finalReview`, Markdown) rather than on the filesystem, so the full review is visible in the Kanban UI and survives session restarts.

- Write: `ateam missions-final-review writeFinalReview --missionId <id> --report <markdown>` (`POST /api/missions/{id}/final-review`)
- Read: `ateam missions-final-review getFinalReview --missionId <id>` (`GET /api/missions/{id}/final-review`)

Stockwell writes the review as its last step before post-checks run; Tawnia reads it when drafting release notes and the final commit message.

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
- Stockwell: `subagent_type: "ai-team:stockwell"` → Final Mission Review (PRD+diff scoped), persisted via `missions-final-review writeFinalReview`
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

- **`enforce-agent-start.js`** (PreToolUse) — blocks `ateam agents-stop` and `ateam activity` calls until `agents-start` has been called in the session. Prevents `NOT_CLAIMED` errors from agents (especially Lynch) who would otherwise skip claiming before logging work.
- **`enforce-handoff.js`** (Stop) — registered per-agent on Murdock, B.A., Lynch, and Amy. After `agentStop` returns, verifies the agent sent exactly one `SendMessage` to the correct peer (matching the `claimedNext` instance from the CLI response) with the expected content type. Blocks the Stop event if the handoff is missing or misrouted. Intentionally NOT registered globally, since legacy subagent mode dispatches via the `Task` tool and would false-positive.

## Environment Variables

The `ateam` CLI reads the following environment variables:

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
2. **package.json** - Checks `scripts` for: `test`, `test:unit`, `test:e2e`, `lint`, `dev`, `start`
3. **Lock files** - Detects package manager: `package-lock.json` → npm, `yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm, `bun.lockb` → bun

### Config File Format

```json
{
  "packageManager": "npm",
  "checks": {
    "lint": "npm run lint",
    "unit": "npm test",
    "e2e": "npm run test:e2e"
  },
  "precheck": ["lint", "unit"],
  "postcheck": ["lint", "unit", "e2e"],
  "devServer": {
    "url": "http://localhost:3000",
    "start": "npm run dev",
    "restart": "docker compose restart",
    "managed": false
  }
}
```

**Dev server** (`devServer`):
- `url`: Where Amy should point the browser for testing
- `start`: Command to start the server (for user reference)
- `restart`: Command to restart the server (e.g., to pick up code changes)
- `managed`: If false, user manages server; Amy checks if running but doesn't start/restart it

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
