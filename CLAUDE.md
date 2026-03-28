# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**For plugin development:** See `docs/PLUGIN-DEV.md` (file organization, hooks, installation, build setup).
**For orchestration reference:** See `docs/ORCHESTRATION.md` (architecture, env vars, permissions, config).

## Overview

The A(i)-Team is a Claude Code plugin for parallel agent orchestration. It transforms PRDs into working, tested code through a TDD pipeline with specialized agents:

- **Hannibal** (Orchestrator): Runs in main Claude context, coordinates the team
- **Face** (Decomposer): Breaks PRDs into feature items (uses opus model)
- **Sosa** (Critic): Reviews decomposition, asks clarifying questions (requirements-critic subagent, opus)
- **Murdock** (QA): Writes tests first (qa-engineer subagent)
- **B.A.** (Implementer): Implements code to pass tests (clean-code-architect subagent)
- **Lynch** (Reviewer): Reviews tests + implementation together (code-review-expert subagent)
- **Amy** (Investigator): Probes every feature for bugs beyond tests (bug-hunter subagent)
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
briefings → ready → testing → implementing → review → probing → done
                       ↑           ↑            ↑         ↑       │
                    Murdock      B.A.        Lynch      Amy       │
                                          (per-feature)           │
                                                                  ▼
                                                        ┌─────────────────┐
                                                        │  Final Review   │
                                                        │  (Stockwell)  │
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

**Note on transition enforcement:** The transition matrix enforces the linear pipeline: `testing` advances to `implementing` (not directly to `review`); `implementing` advances to `review`; `review` can send an item back to `testing` or `implementing` for rework, or forward to `probing`; `probing` advances to `done` or can send back to `ready`. See `packages/shared/src/stages.ts` for the full `TRANSITION_MATRIX`.

Each feature flows through stages sequentially. Different features can be at different stages simultaneously (pipeline parallelism). WIP limits control how many features are in-flight.

**Two-Level Orchestration:**
1. **Dependency waves** - Items wait in `briefings` until deps reach `done` (correct waiting)
2. **Pipeline flow** - Items advance IMMEDIATELY on completion, no stage batching (critical)

Use `ateam deps-check checkDeps --json` to see which items are ready. Within a wave, items flow independently through stages.

**True Individual Item Tracking:** Items advance immediately when their agent completes - no waiting for batch completion. In legacy mode, Hannibal polls TaskOutput for each background agent individually. In native teams mode, agents send completion messages via SendMessage. In both modes, agents signal completion via `ateam agents-stop agentStop`.

When ALL features reach `done`, Lynch performs a **Final Mission Review** of the entire codebase, checking for cross-cutting issues (consistency, race conditions, security, code quality).

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
stage: "briefings"     # briefings | ready | testing | implementing | review | probing | done | blocked
objective: "Users can create orders with line items and see real-time totals"  # One behavioral sentence
acceptance:                                  # Measurable criteria (JSON array in DB)
  - "POST /api/orders with valid items returns 201 with order ID"
  - "Order total reflects sum of item prices × quantities"
  - "POST /api/orders with empty items array returns 400"
context: "Integrates with existing ProductService (src/services/product.ts). Called from checkout page via useCreateOrder hook."
outputs:
  test: "src/__tests__/feature.test.ts"    # REQUIRED
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

The `outputs` field is critical - without it, Murdock and B.A. don't know where to create files.

**Structured fields** guide downstream agents:
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
- **Hannibal**: Orchestrates ONLY. NEVER uses Write/Edit on `src/**` or test files. Delegates ALL coding to subagents. If pipeline is stuck, reports status and waits for human intervention - never codes a workaround.
- **Face**: Creates and updates work items via `ateam` CLI. Does NOT write tests or implementation. On second pass, uses `ateam` CLI ONLY (no Glob/Grep).
- **Sosa**: Reviews and critiques work items. Does NOT modify items directly - provides recommendations for Face.
- **Murdock**: Writes ONLY tests and types. Does NOT write implementation code.
- **B.A.**: Writes ONLY implementation. Tests already exist from Murdock.
- **Lynch / Stockwell**: Reviews only. Does NOT write code.
- **Amy**: Investigates only. Does NOT write production code or tests. Reports findings with proof.
- **Tawnia**: Writes documentation only (CHANGELOG, README, docs/). Does NOT modify source code or tests. Makes the final commit.

### Stage Transitions

Use `ateam board-move moveItem` for all stage transitions. The command:
- Validates the transition is allowed
- Enforces WIP limits
- Logs the transition to the activity feed
- Returns success/error status

## Key Conventions

### TDD Workflow (MANDATORY STAGES - NO EXCEPTIONS)

Every feature MUST flow through ALL stages. Skipping stages is NOT permitted.

**Per-Feature Pipeline (each item, in order):**
1. **Murdock** writes tests first (defines acceptance criteria)
2. **B.A.** implements to pass those tests
3. **Lynch** reviews tests + implementation together
4. **Amy** probes for bugs beyond tests (Raptor Protocol) ← MANDATORY, NOT OPTIONAL
5. If rejected at any stage (max 2 times), item goes to `blocked`

**Mission Completion (after ALL items reach done):**
6. **Stockwell** performs **Final Mission Review** (PRD+diff scoped holistic review)
7. **Post-checks** run (lint, unit, e2e)
8. **Tawnia** updates documentation and creates final commit ← MANDATORY, NOT OPTIONAL

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
- Stockwell: `subagent_type: "ai-team:stockwell"` → Final Mission Review (PRD+diff scoped)
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
| Create item | `ateam items createItem --title "..." --type feature --objective "..." --acceptance "criterion 1" --acceptance "criterion 2" --context "..." ...` |
| Get item | `ateam items getItem --id <id>` |
| List items | `ateam items listItems --json` |
| Update item | `ateam items updateItem --id <id> [flags]` |
| Reject item | `ateam items rejectItem --id <id>` |
| Render item | `ateam items renderItem --id <id>` |
| Agent start | `ateam agents-start agentStart --itemId <id> --agent <name>` |
| Agent stop | `ateam agents-stop agentStop --itemId <id> --agent <name> --status success --summary "..."` |
| Create mission | `ateam missions createMission [flags]` |
| Current mission | `ateam missions-current getCurrentMission --json` |
| Pre-check | `ateam missions-precheck missionPrecheck --json` |
| Post-check | `ateam missions-postcheck missionPostcheck --json` |
| Archive mission | `ateam missions-archive archiveMission --json` |
| Check deps | `ateam deps-check checkDeps --json` |
| Log activity | `ateam activity createActivityEntry --agent <name> --message "..." --level info` |
| List activity | `ateam activity listActivity --json` |

### Agent Lifecycle Commands

Working agents (Murdock, B.A., Lynch, Stockwell, Amy, Tawnia) use lifecycle commands:

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
  --agent "murdock" \
  --status success \
  --summary "Created 5 test cases" \
  --filesCreated "src/__tests__/feature.test.ts"
```
- Marks completion in the database
- Clears `assigned_agent` from the item
- Appends work summary to `work_log` array

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
- `POST /api/hooks/events` — store hook events (called by observer hooks, not manually)

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
