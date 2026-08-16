# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**For plugin development:** See `docs/PLUGIN-DEV.md` (file organization, hooks, installation, build setup).
**For orchestration reference:** See `docs/ORCHESTRATION.md` (architecture, env vars, permissions, config).
**For migration authoring and recovery:** See `docs/PLUGIN-DEV.md` — [How to Add a Prisma Migration](docs/PLUGIN-DEV.md#how-to-add-a-prisma-migration) and [Migration Failure Recovery](docs/PLUGIN-DEV.md#migration-failure-recovery).

## Overview

The A(i)-Team is a Claude Code plugin for parallel agent orchestration. It transforms PRDs into working, tested code through a TDD pipeline with specialized agents:

- **Hannibal** (Orchestrator): Runs in main Claude context, coordinates the team
- **Face** (Decomposer): Breaks PRDs into feature items (uses opus model)
- **Sosa** (Critic): Reviews decomposition, asks clarifying questions (requirements-critic subagent, opus)
- **Murdock** (QA): Writes tests first (qa-engineer subagent)
- **B.A.** (Implementer): Implements code to pass tests (clean-code-architect subagent)
- **Lynch** (Reviewer): Reviews tests + implementation together (code-review-expert subagent)
- **Amy** (Investigator): Probes every feature for bugs beyond tests (bug-hunter subagent)
- **Frankie** (QA/Demo Man): Walks the mission's Definition of Done against the running app once all items reach `staged`, producing an evidence bundle — verifies and evidences, never writes implementation, tests, or existing specs
- **Stockwell** (Reviewer): Final Mission Review — holistic PRD+diff review of the entire codebase, run after Frankie's walk succeeds
- **Tawnia** (Documentation): Updates docs and makes final commit (clean-code-architect subagent)

### Pipeline Flow

**Planning Phase (`/ai-team:plan`):**
```
PRD → Face (1st pass) → Sosa (review) → Face (2nd pass) → ready stage
           ↓                  ↓               ↓
      briefings          questions         refinement
        stage            (human)
```

**Execution Phase (`/ai-team:run`):**
```
briefings → ready → testing → implementing → review → probing → staged
                       ↑           ↑            ↑         ↑       │
                    Murdock      B.A.        Lynch      Amy       │
                                          (per-feature)           │
                                                                  ▼
                                                        ┌─────────────────┐
                                                        │  Frankie Walk   │
                                                        │ (mission tail)  │
                                                        └────────┬────────┘
                                                                 │
                                                                 ▼
                                                        ┌─────────────────┐
                                                        │  Final Review   │
                                                        │  (Stockwell)  │
                                                        └────────┬────────┘
                                                                 │ FINAL APPROVED
                                                                 ▼
                                                        ┌─────────────────┐
                                                        │ Promote staged  │
                                                        │  items → done   │
                                                        │   (API, WI-790) │
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
                                                        └─────────────────┘
```

**Note on transition enforcement:** The transition matrix enforces the linear pipeline: `testing` advances to `implementing` (not directly to `review`); `implementing` advances to `review`; `review` can send an item back to `testing` or `implementing` for rework, or forward to `probing`; `probing` advances to `staged` — the per-item pipeline's real terminal stage (WI-786/787). **Lynch and Amy use the earliest-flagged-stage principle** (`packages/shared/src/stages.ts` + `scripts/hooks/enforce-handoff.js`): if the rejection names a test gap (alone or with an impl bug), `--return-to testing` so Murdock audits coverage before B.A. reworks; if it names only an impl bug, `--return-to implementing` so B.A. fixes directly. A Frankie or Stockwell failure at the mission tail uses the SAME earliest-flagged-stage rule, executed by Hannibal as a real `ateam board-move moveItem --toStage <testing|implementing>` (WI-794 made this a first-class, rejection-cap-counted transition) — no agent holds a claim on the item by tail time, so `agentStop --outcome rejected` is unavailable (see `adr/0005-done-is-terminal-no-in-mission-rework.md`), which is why Hannibal executes the move directly instead. Once the named items are back in `staged`, the mission tail restarts at Frankie. `done` is reached only when an APPROVED final review atomically promotes every staged item (WI-790) — post-checks and Tawnia run only after that. The matrix also allows a `probing → ready` transition for manual operator recovery (Hannibal can re-decompose a problematic item) but no pipeline agent uses it as a rejection target. See `packages/shared/src/stages.ts` for the full `TRANSITION_MATRIX`.

Each feature flows through stages sequentially. Different features can be at different stages simultaneously (**pipeline parallelism** — the assembly-line model). Within each stage, up to N items can be processed concurrently by N agent instances (**stage concurrency**), where N is guided by `ateam scaling compute`. WIP limits are **per stage** (per column) — each stage independently caps how many items can be in it. An idle agent should always be dispatched work if its stage has capacity, regardless of how many items are in other stages.

**Two-Level Orchestration:**
1. **Dependency waves** - Items wait in `briefings` until deps reach `staged` (or later) — the per-item pipeline's real terminal stage (correct waiting)
2. **Pipeline flow** - Items advance IMMEDIATELY on completion, no stage batching (critical)

Use `ateam deps-check checkDeps --json` to see which items are ready. Within a wave, items flow independently through stages.

**True Individual Item Tracking:** Items advance immediately when their agent completes - no waiting for batch completion. In legacy mode, Hannibal polls TaskOutput for each background agent individually. In native teams mode, pipeline agents (Murdock → B.A. → Lynch → Amy) hand off directly to each other via START messages — Hannibal receives only FYI (handoff succeeded) or ALERT (handoff failed/timed out) messages and intervenes only on ALERT. In both modes, agents signal completion via `ateam agents-stop agentStop`.

When ALL features reach `staged` — the per-item pipeline's real terminal stage (WI-786/787) — Frankie walks the mission's full Definition of Done against the running app first (a fresh, non-pre-warmed agent, mission tail — see `agents/frankie.md`). A failure halts the tail: Hannibal moves each named item out of `staged` to `testing` or `implementing` (earliest-flagged-stage rule) via a real `ateam board-move moveItem`, a rejection-cap-counted transition (WI-794) — not a manual reopen. Once Frankie's walk is clean, Stockwell performs a **Final Mission Review** of the entire codebase, checking for cross-cutting issues (consistency, race conditions, security, code quality) — his review includes Frankie's evidence bundle and graduated specs. A Stockwell rejection restarts the tail at Frankie the same way, once the named items are back in `staged`. An APPROVED final review atomically promotes every staged item to `done` (WI-790) — post-checks and Tawnia's documentation phase run only after that.

### Data Storage

All mission state is stored in the **A(i)-Team API database**, not on the local filesystem. This enables:

- **Multi-project isolation**: Each project has a unique `ATEAM_PROJECT_ID`
- **Web-based Kanban UI**: Real-time visibility into mission progress
- **Activity feeds**: Live logging of agent actions
- **Persistence**: Mission state survives Claude Code session restarts

The `ateam` CLI binary communicates with the API, reading `ATEAM_PROJECT_ID` from the environment automatically and sending it with every request.

### Work Item Format

Work items are stored in the database with the following structure:

```yaml
id: "WI-001"  # Generated by API with WI- prefix
title: "Feature name"
type: "feature"        # feature | task | bug | enhancement
status: "pending"
stage: "briefings"     # briefings | ready | testing | implementing | review | probing | staged | done | blocked
objective: "Users can create orders with line items and see real-time totals"  # One behavioral sentence
acceptance:                                  # Measurable criteria (JSON array in DB)
  - "POST /api/orders with valid items returns 201 with order ID"
  - "Order total reflects sum of item prices × quantities"
  - "POST /api/orders with empty items array returns 400"
context: "Integrates with existing ProductService (src/services/product.ts). Called from checkout page via useCreateOrder hook."
outputs:
  test: "src/__tests__/feature.test.ts"    # REQUIRED — empty "" only on NO_TEST_NEEDED task items (see work-breakdown skill)
  impl: "src/services/feature.ts"          # REQUIRED
  types: "src/types/feature.ts"            # Optional
dependencies: []
parallel_group: "group-name"
rejection_count: 0
assigned_agent: "Murdock"                   # Set by agentStart, cleared by agentStop
work_log:                                   # Populated by agentStop
  - agent: "Murdock"
    timestamp: "2024-01-15T10:30:00Z"
    status: "success"
    summary: "Created 5 test cases"
```

The `outputs` field is critical - without it, Murdock and B.A. don't know where to create files. On the `ateam items createItem` command line, the outputs are set with **dotted** flags — `--outputs.test`, `--outputs.impl`, `--outputs.types` (NOT `--outputTest` or `--output-test`; the CLI rejects those with `Error: unknown flag`). `--outputs.types` is optional. **Create items one at a time** (one sequential `Bash` call each), never several `createItem` calls batched into a single parallel tool block — if the first call errors, the harness cancels the rest of the batch and burns item IDs.

**All four text fields are required** when creating work items via `ateam items createItem`:
- **`description`**: Human-readable executive summary — synthesizes objective + context into 1-3 sentences a PM could skim on the kanban board. Not a dump of structured data; a prose narrative of the work item.
- **`objective`**: One behavioral sentence — Murdock tests it, B.A. implements it, Tawnia documents it
- **`acceptance`**: Measurable criteria — Murdock maps each to a test, Lynch checks coverage, Stockwell verifies
- **`context`**: Integration points — B.A. knows where to wire code, Amy knows where to probe for boundary bugs

## Critical Requirements

### Working Directory
**All agents work on the TARGET PROJECT, not the ai-team plugin directory.**

- The target project is the user's working directory where `/ai-team:*` commands are run
- NEVER explore, search, or modify files in the ai-team plugin directory (`.claude/ai-team/` or similar)
- When Face or other agents explore codebases, they explore the TARGET PROJECT's `src/`, `tests/`, etc.
- The `ateam` CLI binary handles all communication with the A(i)-Team system - no need to explore plugin internals

### Agent Boundaries
- **Hannibal**: Orchestrates ONLY. NEVER uses Write/Edit on `src/**` or test files. Delegates ALL coding to subagents. If pipeline is stuck, reports status and waits for human intervention - never codes a workaround. In native teams mode, Hannibal dispatches only the first agent per item (Murdock); subsequent handoffs are peer-to-peer. Hannibal intervenes only on ALERT messages.
- **Face**: Creates and updates work items via `ateam` CLI. Does NOT write tests or implementation. On second pass, uses `ateam` CLI ONLY (no Glob/Grep).
- **Sosa**: Reviews and critiques work items. Does NOT modify items directly - provides recommendations for Face.
- **Murdock**: Writes ONLY tests and types. Does NOT write implementation code. In native teams mode, sends a START message directly to B.A. after `agentStop --advance`, then sends FYI/ALERT to Hannibal.
- **B.A.**: Writes ONLY implementation. Tests already exist from Murdock. In native teams mode, ACKs Murdock's START, then sends a START to Lynch after `agentStop --advance`.
- **Lynch / Stockwell**: Reviews only. Does NOT write code. In native teams mode, Lynch sends START to Amy (approved) or peer rejection to Murdock/B.A. (rejected), then FYI/ALERT to Hannibal.
- **Amy**: Investigates only. Does NOT write production code or tests. Reports findings with proof. In native teams mode, sends FYI/ALERT to Hannibal only (no downstream peer handoff).
- **Frankie**: Verifies and evidences only. Does NOT write implementation, tests, or existing `specs/` files — walks the mission's DoD against the running app, writes his evidence bundle and new flow files, and reports failures to Hannibal. Never moves items himself: he reports the failing items, and Hannibal moves each one out of `staged` via a real `board-move` using the earliest-flagged-stage rule (WI-794).
- **Tawnia**: Writes documentation only (CHANGELOG, README, docs/). Does NOT modify source code or tests. Makes the final commit.

### Stage Transitions

**Legacy mode / Hannibal:** Use `ateam board-move moveItem` for all stage transitions. The command validates the transition, enforces WIP limits, logs the activity, and returns success/error.

**Native teams mode (pipeline workers):** Call `ateam agents-stop agentStop --advance` (default `true`) — this advances the item to the next stage atomically. If the target stage is at WIP capacity, the API returns `WIP_LIMIT_EXCEEDED` (409); use `--advance=false` to release the claim without advancing, then send an ALERT to Hannibal to handle re-dispatch when capacity opens.

**Rejections (Lynch):** Rejection is expressed through `agentStop` with `--outcome rejected --return-to <stage>`. This replaces the old `ateam items rejectItem` command (which has been removed). The API moves the item back to the target stage (`testing` or `implementing`), increments `rejection_count`, and records the rejection summary in `work_log`. Items that hit the rejection cap transition to `blocked` instead of moving back to `--return-to`. The cap defaults to **4** and is overridable per API server via the `ATEAM_REJECTION_CAP` environment variable; non-integer or non-positive values fall back to the default.

**Stockwell does NOT issue `--return-to` rejections.** His Final Mission Review runs after every item reaches `staged` — the per-item pipeline's real terminal stage (WI-786/787); `done` isn't reached until an APPROVED verdict promotes staged items. A Stockwell rejection is report-only: he names the items and issues, and Hannibal moves each one out of `staged` to `testing` or `implementing` via `ateam board-move moveItem` (earliest-flagged-stage rule, WI-794 — a real, rejection-cap-counted transition, not a manual reopen). The tail restarts at Frankie once the named items are back in `staged`.

## Key Conventions

### TDD Workflow (MANDATORY STAGES - NO EXCEPTIONS)

Every feature MUST flow through ALL stages. Skipping stages is NOT permitted.

**Sole carve-out — NO_TEST_NEEDED task items:** non-code `type: "task"` items flagged per the `work-breakdown` skill (empty `outputs.test` + `NO_TEST_NEEDED` on its own line in the description — docs, static config, deletions) skip ONLY the `testing` stage: they enter the pipeline at `implementing` (`ready → implementing`, a legal transition in the matrix) and Lynch, Amy, and everything downstream still run. Anything with runtime impact never qualifies — when in doubt, it gets tests.

**Per-Feature Pipeline (each item, in order):**
1. **Murdock** writes tests first (defines acceptance criteria)
2. **B.A.** implements to pass those tests
3. **Lynch** reviews tests + implementation together
4. **Amy** probes for bugs beyond tests (Raptor Protocol) ← MANDATORY, NOT OPTIONAL
5. If an item exceeds the rejection cap, it goes to `blocked` instead of returning to its `--return-to` stage (cap defaults to **4**, overridable per API server via `ATEAM_REJECTION_CAP` — see **Rejections** under Stage Transitions above)

**Mission Completion (after ALL items reach staged — the per-item pipeline's real terminal stage, WI-786/787):**
6. **Frankie** walks the mission's full Definition of Done against the running app and produces an evidence bundle ← MANDATORY, RUNS BEFORE Stockwell (skipped only on repos whose execution contract declares no drivable surface — see `scripts/hooks/lib/qa-contract.js`). A failure halts here: Hannibal moves each named item out of `staged` to `testing` or `implementing` via a real `board-move` (earliest-flagged-stage rule, WI-794) — a rejection-cap-counted transition, not a manual bounce.
7. **Stockwell** performs **Final Mission Review** (PRD+diff scoped holistic review, including Frankie's evidence)
7a. An APPROVED verdict atomically promotes every staged item to `done` (WI-790) — the API does this as part of persisting the review, not Hannibal.
8. **Post-checks** run (lint, unit, e2e) — only after promotion, so every item is already in `done`
9. **Tawnia** updates documentation and creates final commit ← MANDATORY, NOT OPTIONAL

A Stockwell rejection restarts the tail at Frankie (not post-checks) once the named items are back in `staged`, so the evidence bundle always reflects the final code.

**A mission is NOT complete until Tawnia commits.** No shortcuts.

### Testing Philosophy

**Test granularity depends on work item type:**

| Type | Test Count | Focus |
|------|------------|-------|
| `feature` | 3-5 tests | Happy path, error path, edge cases |
| `task` | 1-3 smoke tests | "Does it compile? Does it run? Does it integrate?" |
| `bug` | 2-3 tests | Reproduce bug, verify fix, regression guard |
| `enhancement` | 2-4 tests | New/changed behavior only |

**Scaffolding work (`type: "task"`)** needs minimal testing:
- Types-only items: 1-2 tests proving the types compile and can be used
- Config files: 1-2 tests proving config loads and works
- Don't test every field/property individually - test the outcome

**Feature work (`type: "feature"`)** needs behavioral testing:
- Cover happy paths, negative paths, and key edge cases
- Don't chase 100% coverage
- 3-5 tests per feature is often enough
- Test behavior, not implementation

### Work Item Sizing
Smallest independently-completable units:
- One logical unit of functionality per item
- If you can split it further without artificial boundaries, split it
- No arbitrary time limits

### Task Tracking: Two Systems

The A(i)-Team uses two distinct task tracking systems for different purposes:

**ateam CLI Work Items** (`ateam items createItem`, `ateam board-move moveItem`, etc.):
- Persistent in API database
- Visible in Kanban UI
- Survive session restarts
- Track: feature implementation progress (per-item)

**Native Claude Tasks** (`TaskCreate`, `TaskUpdate`, `TaskList`):
- Session-level, ephemeral
- Visible in CLI progress spinner
- Lost on session restart
- Track: Hannibal's orchestration milestones (waves, phases)

Use `ateam` CLI for mission items. Use native tasks for orchestration checkpoints. Do NOT mirror one system to the other - they track different concerns.

### Agent Dispatch

The plugin supports two dispatch modes, controlled by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`. The `/ai-team:run` command detects the mode and loads the appropriate orchestration playbook. Hannibal reads exactly ONE playbook at mission start.

Model selection is defined in each agent's frontmatter (`agents/*.md`) — do NOT pass `model:` at dispatch time.

**Planning Phase (both modes):**
- Face: `subagent_type: "ai-team:face"` (opus via frontmatter)
- Sosa: `subagent_type: "ai-team:sosa"` (opus via frontmatter)

**Per-Feature Pipeline (ALL MANDATORY for each item):**
- Murdock: `subagent_type: "ai-team:murdock"` → testing stage
- B.A.: `subagent_type: "ai-team:ba"` → implementing stage
- Lynch: `subagent_type: "ai-team:lynch"` → review stage (per-feature)
- Amy: `subagent_type: "ai-team:amy"` → probing stage (EVERY feature, no exceptions)

**Mission Completion (MANDATORY):**
- Frankie: `subagent_type: "ai-team:frankie"` → mission-tail QA walk, once all items reach `staged` and BEFORE Stockwell. A fresh, non-pre-warmed agent.
- Stockwell: `subagent_type: "ai-team:stockwell"` → Final Mission Review (PRD+diff scoped), runs only after Frankie's walk succeeds
- Tawnia: `subagent_type: "ai-team:tawnia"` → after post-checks pass

## ateam CLI

Agents interact with the A(i)-Team API by running the `ateam` binary via the `Bash` tool. The entry point is `${CLAUDE_PLUGIN_ROOT}/bin/ateam` — a wrapper script that auto-downloads and updates the Go binary on first use (or when `minCliVersion` bumps). For development, use `~/go/bin/ateam` built from source. It reads `ATEAM_PROJECT_ID` from the environment automatically.

Usage: `ateam <resource> <command> [flags]`

### CLI Reference

| Operation | Command |
|-----------|---------|
| Read board | `ateam board getBoard --json` |
| Move item | `ateam board-move moveItem --itemId <id> --toStage <stage>` |
| Claim item | `ateam board-claim claimItem --itemId <id> --agent <name>` |
| Release item | `ateam board-release releaseItem --itemId <id>` |
| Create item | `ateam items createItem --title "..." --type feature --description "..." --objective "..." --acceptance "criterion 1" --acceptance "criterion 2" --context "..." ...` |
| Get item | `ateam items getItem --id <id>` |
| List items | `ateam items listItems --json` |
| Update item | `ateam items updateItem --id <id> [flags]` |
| Render item | `ateam items renderItem --id <id>` |
| Agent start | `ateam agents-start agentStart --itemId <id> --agent <name>` |
| Agent stop | `ateam agents-stop agentStop --itemId <id> --agent <name> --outcome completed --summary "..."` |
| Agent stop (no advance) | `ateam agents-stop agentStop --itemId <id> --agent <name> --outcome completed --summary "..." --advance=false` |
| Reject item (via agent) | `ateam agents-stop agentStop --itemId <id> --agent <name> --outcome rejected --return-to <stage> --summary "..."` |
| Create mission | `ateam missions createMission [flags]` |
| Current mission | `ateam missions-current getCurrentMission --json` |
| Pre-check | `ateam missions-precheck missionPrecheck --json` |
| Post-check | `ateam missions-postcheck missionPostcheck --json` |
| Archive mission | `ateam missions-archive archiveMission --json` |
| Get final review | `ateam missions-final-review getFinalReview --missionId <id> --json` |
| Write final review | `ateam missions-final-review writeFinalReview --missionId <id> --report "..." --json` |
| Tool histogram | `ateam missions getToolHistogram <missionId> --json` |
| Skill usage | `ateam missions getSkillUsage <missionId> --json` |
| Health report | `ateam missions-health getHealthReport [--json]` |
| Compute scaling | `ateam scaling compute [--concurrency N] [--memory N] [--persist] --json` |
| Check deps | `ateam deps-check checkDeps --json` |
| Log activity | `ateam activity createActivityEntry --agent <name> --message "..." --level info` |
| List activity | `ateam activity listActivity --json` |
| Pool init | `ateam pool init` |
| Pool destroy | `ateam pool destroy` |
| Pool status | `ateam pool status [--json]` |
| Pool claim | `ateam pool claim <instance>` |
| Pool release | `ateam pool release --agent <instance>` |
| Pool mark-idle | `ateam pool mark-idle <instance>` |

### Agent Lifecycle Commands

Working agents (Murdock, B.A., Lynch, Amy, Frankie, Stockwell, Tawnia) use lifecycle commands:

**Start** (`ateam agents-start agentStart`):
```bash
ateam agents-start agentStart --itemId "WI-007" --agent "murdock"
```
- Claims the item in the database
- Records `assigned_agent` on the work item
- The kanban UI shows which agent is working on each card

**Stop** (`ateam agents-stop agentStop`):
```bash
ateam agents-stop agentStop \
  --itemId "WI-007" \
  --agent "Murdock" \
  --outcome completed \
  --summary "Created 5 test cases"
```
- Marks completion in the database
- Clears `assigned_agent` from the item
- Appends work summary to `work_log` array
- In native teams mode, advances item to the next stage (default `--advance=true`). Use `--advance=false` to release the claim without advancing (e.g., when WIP_LIMIT_EXCEEDED).
- **Rejection flow:** Pass `--outcome rejected --return-to <stage>` to send an item backward through the pipeline (e.g., Lynch returning to `testing` or `implementing`). The API validates the target stage, increments `rejection_count`, and records the rejection summary. This replaces the removed `ateam items rejectItem` command.

### Observability: Hook Events & Token Usage

Observer hooks (`scripts/hooks/lib/observer.js`) fire on every tool call and agent lifecycle event, POSTing structured data to the API. This gives us real-time telemetry for every mission — do NOT parse Claude Code session transcripts (`.jsonl` files) when this data is available.

**Hook events** are stored in the database per-project. They capture agent name, tool name, event type, timestamps, token counts, and model. Events are posted automatically by the observer hooks — no manual instrumentation needed.

**Token usage per mission** is the primary way to check costs:
```bash
# Aggregate token usage (POST triggers aggregation, GET returns cached results)
POST /api/missions/{missionId}/token-usage  (Header: X-Project-ID)
GET  /api/missions/{missionId}/token-usage  (Header: X-Project-ID)
```

Returns per-agent breakdown with model, token counts, and estimated cost:
```json
{
  "agents": [
    { "agentName": "face", "model": "claude-opus-4-6", "estimatedCostUsd": 18.78, ... },
    { "agentName": "hannibal", "model": "claude-sonnet-4-6", "estimatedCostUsd": 0.58, ... }
  ],
  "totals": { "estimatedCostUsd": 36.87, ... }
}
```

**Useful API endpoints** (all require `X-Project-ID` header, sent automatically by `ateam`):
- `GET /api/projects` — list all projects
- `GET /api/missions` — list missions for a project
- `GET /api/missions/current` — get active mission
- `GET /api/items` — get work items (board state)
- `POST /api/missions/{id}/token-usage` — aggregate and return token costs
- `GET /api/missions/{id}/tool-histogram` — per-agent tool-call counts grouped by tool name
- `GET /api/missions/{id}/skill-usage` — per-agent skill invocations with counts and `distinctArgs`
- `POST /api/hooks/events` — store hook events (called by observer hooks, not manually)

**Skill activations** are captured on the `HookEvent` `payload` column: when `toolName === 'Skill'`, observer hooks record `skill_name` and a 12-char SHA-256 `args_hash` so repeated invocations with the same args are identifiable without storing the args themselves.

Token pricing is loaded from `ateam.config.json` at runtime (see `packages/kanban-viewer/src/lib/token-cost.ts`).

## Commits & Releases

### Commit Messages

All commits MUST follow [Conventional Commits](https://www.conventionalcommits.org/). This is enforced by commitlint on PRs (`.github/workflows/commitlint.yml`).

| Prefix | Purpose | Release Effect |
|--------|---------|----------------|
| `feat:` | New feature | Minor bump (v1.**1**.0) |
| `fix:` | Bug fix | Patch bump (v1.0.**1**) |
| `docs:` | Documentation only | No release |
| `style:` | Formatting, no logic change | No release |
| `refactor:` | Code change, no new feature/fix | No release |
| `perf:` | Performance improvement | Patch bump |
| `test:` | Adding/updating tests | No release |
| `build:` | Build system or dependencies | No release |
| `ci:` | CI configuration | No release |
| `chore:` | Maintenance | No release |
| `revert:` | Revert a previous commit | Patch bump |

For breaking changes, add `BREAKING CHANGE:` in the commit footer → major bump (v**2**.0.0).

### Release Process

Releases are fully automated via semantic-release (`.github/workflows/release.yml`):

```
Branch → PR to main → commitlint validates → merge → semantic-release
                                                         ↓
                                              Analyzes commits since last tag
                                                         ↓
                                              feat: → minor, fix: → patch
                                                         ↓
                                              Creates GitHub Release + v* tag
                                                         ↓
                                         ┌───────────────┼───────────────┐
                                         ↓               ↓               ↓
                                    Go CLI build    Docker image    Release notes
                                   (4 platforms)   (GHCR publish)  (auto-generated)
```

- **No manual tagging needed** — semantic-release handles versioning from commit messages
- **Manual tag fallback** — `git tag v1.2.3 && git push --tags` still triggers the full pipeline
- **Changelogs are manual** — semantic-release does NOT update `CHANGELOG.md`; update it by hand
- **Config**: `.releaserc.json` (plugins), `.commitlintrc.yml` (commit rules)
