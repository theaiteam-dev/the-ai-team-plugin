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
                                                        │  (Lynch-Final)  │
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

Use the `deps_check` MCP tool to see which items are ready. Within a wave, items flow independently through stages.

**True Individual Item Tracking:** Items advance immediately when their agent completes - no waiting for batch completion. In legacy mode, Hannibal polls TaskOutput for each background agent individually. In native teams mode, agents send completion messages via SendMessage. In both modes, agents signal completion via the `agent_stop` MCP tool.

When ALL features reach `done`, Lynch performs a **Final Mission Review** of the entire codebase, checking for cross-cutting issues (consistency, race conditions, security, code quality).

### Data Storage

All mission state is stored in the **A(i)-Team API database**, not on the local filesystem. This enables:

- **Multi-project isolation**: Each project has a unique `ATEAM_PROJECT_ID`
- **Web-based Kanban UI**: Real-time visibility into mission progress
- **Activity feeds**: Live logging of agent actions
- **Persistence**: Mission state survives Claude Code session restarts

The MCP server acts as a bridge between Claude Code and the API, sending the project ID in every request via the `X-Project-ID` HTTP header.

### Work Item Format

Work items are stored in the database with the following structure:

```yaml
id: "WI-001"  # Generated by API with WI- prefix
title: "Feature name"
type: "feature"        # feature | task | bug | enhancement
status: "pending"
stage: "briefings"     # briefings | ready | testing | implementing | review | probing | done | blocked
outputs:
  test: "src/__tests__/feature.test.ts"    # REQUIRED
  impl: "src/services/feature.ts"          # REQUIRED
  types: "src/types/feature.ts"            # Optional
dependencies: []
parallel_group: "group-name"
rejection_count: 0
assigned_agent: "Murdock"                   # Set by agent_start, cleared by agent_stop
work_log:                                   # Populated by agent_stop
  - agent: "Murdock"
    timestamp: "2024-01-15T10:30:00Z"
    status: "success"
    summary: "Created 5 test cases"
```

The `outputs` field is critical - without it, Murdock and B.A. don't know where to create files.

## Critical Requirements

### Working Directory
**All agents work on the TARGET PROJECT, not the ai-team plugin directory.**

- The target project is the user's working directory where `/ai-team:*` commands are run
- NEVER explore, search, or modify files in the ai-team plugin directory (`.claude/ai-team/` or similar)
- When Face or other agents explore codebases, they explore the TARGET PROJECT's `src/`, `tests/`, etc.
- The MCP tools handle all communication with the A(i)-Team system - no need to explore plugin internals

### Agent Boundaries
- **Hannibal**: Orchestrates ONLY. NEVER uses Write/Edit on `src/**` or test files. Delegates ALL coding to subagents. If pipeline is stuck, reports status and waits for human intervention - never codes a workaround.
- **Face**: Creates and updates work items via MCP tools. Does NOT write tests or implementation. On second pass, uses MCP tools ONLY (no Glob/Grep).
- **Sosa**: Reviews and critiques work items. Does NOT modify items directly - provides recommendations for Face.
- **Murdock**: Writes ONLY tests and types. Does NOT write implementation code.
- **B.A.**: Writes ONLY implementation. Tests already exist from Murdock.
- **Lynch / Lynch-Final**: Reviews only. Does NOT write code.
- **Amy**: Investigates only. Does NOT write production code or tests. Reports findings with proof.
- **Tawnia**: Writes documentation only (CHANGELOG, README, docs/). Does NOT modify source code or tests. Makes the final commit.

### Stage Transitions

Use the `board_move` MCP tool for all stage transitions. The tool:
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
6. **Lynch-Final** performs **Final Mission Review** (PRD+diff scoped holistic review)
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

**MCP Work Items** (`item_create`, `board_move`, etc.):
- Persistent in API database
- Visible in Kanban UI
- Survive session restarts
- Track: feature implementation progress (per-item)

**Native Claude Tasks** (`TaskCreate`, `TaskUpdate`, `TaskList`):
- Session-level, ephemeral
- Visible in CLI progress spinner
- Lost on session restart
- Track: Hannibal's orchestration milestones (waves, phases)

Use MCP tools for mission items. Use native tasks for orchestration checkpoints. Do NOT mirror one system to the other - they track different concerns.

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
- Lynch-Final: `subagent_type: "ai-team:lynch-final"` → Final Mission Review (PRD+diff scoped)
- Tawnia: `subagent_type: "ai-team:tawnia"` → after post-checks pass

## MCP Tools

Agents use MCP tools for all board and item operations. The MCP server exposes 21 tools across 5 modules:

| Module | Tools | Description |
|--------|-------|-------------|
| **Board** | `board_read`, `board_move`, `board_claim`, `board_release` | Board state and item movement |
| **Items** | `item_create`, `item_update`, `item_get`, `item_list`, `item_reject`, `item_render` | Work item CRUD operations |
| **Agents** | `agent_start`, `agent_stop` | Agent lifecycle hooks |
| **Missions** | `mission_init`, `mission_current`, `mission_precheck`, `mission_postcheck`, `mission_archive` | Mission lifecycle management |
| **Utils** | `plugin_root`, `deps_check`, `activity_log`, `log` | Plugin path resolution, dependency validation, and logging |

### Agent Lifecycle Tools

Working agents (Murdock, B.A., Lynch, Lynch-Final, Amy, Tawnia) use lifecycle tools:

**Start Tool** (`agent_start`):
```
Parameters:
  - itemId: "007"
  - agent: "murdock"
```
- Claims the item in the database
- Records `assigned_agent` on the work item
- The kanban UI shows which agent is working on each card

**Stop Tool** (`agent_stop`):
```
Parameters:
  - itemId: "007"
  - agent: "murdock"
  - status: "success"
  - summary: "Created 5 test cases"
  - files_created: ["src/__tests__/feature.test.ts"]
```
- Marks completion in the database
- Clears `assigned_agent` from the item
- Appends work summary to `work_log` array

All tools automatically include the `X-Project-ID` header from the `ATEAM_PROJECT_ID` environment variable.

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

**Useful API endpoints** (all require `X-Project-ID` header):
- `GET /api/projects` — list all projects
- `GET /api/missions` — list missions for a project
- `GET /api/missions/current` — get active mission
- `GET /api/items` — get work items (board state)
- `POST /api/missions/{id}/token-usage` — aggregate and return token costs
- `POST /api/hooks/events` — store hook events (called by observer hooks, not manually)

Token pricing is loaded from `ateam.config.json` at runtime (see `packages/kanban-viewer/src/lib/token-cost.ts`).
