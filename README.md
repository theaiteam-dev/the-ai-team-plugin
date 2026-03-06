# The A(i)-Team

**Parallel Agent Orchestration Plugin for Claude Code**

> "I love it when a plan comes together." — Hannibal

---

## Overview

A self-orchestrating Claude Code plugin that transforms a PRD into working, tested code through pipeline-based agent execution. Enforces TDD discipline, manages dependencies automatically, and provides real-time visibility into progress via a web-based Kanban UI.

## Architecture

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
│                    │   MCP Server    │                      │
│                    │  (21 tools)     │                      │
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

All mission state is stored in the **A(i)-Team API database**, enabling:
- **Multi-project isolation** via `ATEAM_PROJECT_ID`
- **Web-based Kanban UI** for real-time visibility
- **Activity feeds** for live logging
- **Persistence** across Claude Code sessions

## The Team

| Agent | Role | Subagent Type | Specialty |
|-------|------|---------------|-----------|
| **Hannibal** | Orchestrator | *(main context)* | The man with the plan. Coordinates the team. |
| **Face** | Decomposer | opus | Breaks impossible missions into achievable objectives. |
| **Sosa** | Critic | `requirements-critic` | Challenges Face's breakdown. Finds gaps before work begins. |
| **Murdock** | QA Engineer | `qa-engineer` | Writes tests for critical paths. Move fast. |
| **B.A.** | Implementer | `clean-code-architect` | Builds solid, reliable code. No jibber-jabber. |
| **Lynch** | Reviewer | `code-review-expert` | Reviews tests + implementation together. |
| **Amy** | Investigator | `bug-hunter` | Probes every feature for bugs beyond tests. |
| **Tawnia** | Documentation | `clean-code-architect` | Updates docs and makes the final commit. |

## Installation

Add as a git submodule to any project:

```bash
# Add to your project's .claude folder
git submodule add git@github.com:yourorg/ai-team.git .claude/ai-team
```

**Project structure after install:**
```
your-project/
├── .claude/
│   └── ai-team/           # This plugin (submodule)
├── ateam.config.json      # Created by /ai-team:setup
└── src/
```

**Updating:**
```bash
git submodule update --remote .claude/ai-team
```

## Quick Start

```bash
# First time: configure project ID and permissions
/ai-team:setup

# Plan a mission from a PRD
/ai-team:plan ./docs/my-feature-prd.md

# Execute with pipeline agents
/ai-team:run

# Check progress anytime
/ai-team:status

# Resume after interruption
/ai-team:resume

# Unblock a stuck item
/ai-team:unblock 015 --guidance "Try using the existing AuthService"
```

## Kanban Dashboard

The A(i)-Team includes a web-based dashboard for real-time visibility into mission progress. Start it with Docker:

```bash
# From the ai-team plugin directory
docker compose up -d

# Visit http://localhost:3001
```

The dashboard provides two views:

### Mission Board View
- **Kanban board** with columns for each pipeline stage (briefings, ready, testing, implementing, review, probing, done)
- **Work item cards** showing title, type, assigned agent, and status
- **Live updates** via Server-Sent Events (SSE) as items move through stages
- **Activity feed** with timestamped agent actions

### Raw Agent View (NEW)
- **Real-time observability** into agent tool calls via observer hooks
- **Swim lanes** showing each agent's activity (Hannibal, Face, Sosa, Murdock, B.A., Lynch, Amy, Tawnia)
- **Tool call timeline** with PreToolUse, PostToolUse, and Stop events
- **Duration tracking** showing how long each tool call took (e.g., "Write took 1.2s")
- **Filtering controls** to view specific agents, tools, or event types
- **Live updates** via SSE as agents execute tools

### Token Usage Panel (NEW)
- **Per-agent cost breakdown** with estimated USD for each agent (Face, Murdock, B.A., Lynch, Amy, Tawnia, Hannibal)
- **Proportional bars** showing relative token consumption across agents
- **Model-aware pricing** loaded from `ateam.config.json` (Opus, Sonnet, Haiku rates)
- **Input/output/cache token counts** with K/M notation
- **Mission totals** including cache savings
- Appears in the right sidebar after mission completes; populated via SSE `mission-token-usage` event

### Mission History & Archive (NEW)
- **History drawer** triggered by `History` button in HeaderBar (right side)
- **Master-detail layout** shows list of past missions with metadata on the left, details on the right
- **Sortable by date** — missions listed in reverse chronological order (newest first)
- **State badges** show mission state (completed, failed, archived, precheck_failure)
- **Mission details** include name, PRD path, state, started/completed/archived timestamps, duration
- **Accessible anytime** — drawer does not navigate away from the board, can be dismissed to continue work

### Precheck Failure Banner (NEW)
- **Amber inline banner** shown when mission is in `precheck_failure` state (not terminal `failed`)
- **Blocker list** shows which checks failed (e.g., "Lint failed with 3 error(s)")
- **Expandable raw output** shows full stdout/stderr from check commands
- **Retry affordance** — operator can fix issues and click "Retry Precheck" to re-run checks without re-planning
- **Distinct from terminal failures** — visually and state-wise different from red `failed` state

Switch between views using the navigation tabs at the top of the dashboard.

## Pipeline Flow

### Planning Phase (`/ai-team:plan`)

Two-pass refinement ensures quality before work begins:

```
PRD → Face (1st pass) → Sosa (review) → Face (2nd pass) → ready stage
           ↓                  ↓               ↓
      briefings          questions         refinement
        stage            (human)
```

1. **Face (First Pass)**: Decomposes PRD into work items in `briefings` stage
2. **Sosa (Review)**: Challenges the breakdown, asks human questions via `AskUserQuestion`
3. **Face (Second Pass)**: Applies Sosa's recommendations, moves Wave 0 items to `ready` stage

Use `--skip-refinement` to bypass Sosa for simple PRDs.

### Execution Phase (`/ai-team:run`)

**Before starting execution:**
- **Pre-Mission Checks**: Runs `mission_precheck` MCP tool to verify lint and tests pass (establishes baseline)

Each feature flows through stages sequentially:

```
briefings → ready → testing → implementing → review → probing → done
                       ↑           ↑            ↑         ↑       │
                    Murdock      B.A.        Lynch      Amy       │
                                          (per-feature)           │
                                                                  ▼
                                                        ┌─────────────────┐
                                                        │  Final Review   │
                                                        │  (Lynch - all   │
                                                        │   code at once) │
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

**Stage transitions:**
1. `ready → testing`: Murdock writes tests (and types if needed)
2. `testing → implementing`: B.A. implements to pass tests
3. `implementing → review`: Lynch reviews ALL outputs together
4. `review → probing`: Amy probes for bugs beyond tests (APPROVED)
5. `probing → done`: Feature complete (VERIFIED), or back to ready (FLAG)
6. `all done → final review`: Lynch reviews entire codebase holistically
7. `final review → post-checks`: Run `mission_postcheck` MCP tool (lint, unit, e2e)
8. `post-checks → documentation`: Tawnia updates CHANGELOG, README, docs/
9. `documentation → complete`: Tawnia creates final commit with all co-authors

## Pipeline Parallelism

Different features can be at different stages simultaneously:

```
Feature 001: [implementing] ─→ [review]       ─→ done
Feature 002:    [testing]   ─→ [implementing] ─→ ...
Feature 003:                   [testing]      ─→ ...
```

WIP limit controls how many features are in-flight (not in briefings, ready, or done stages).

### True Individual Item Tracking

Items flow independently through the pipeline. When an agent completes work on one item, that item advances **immediately** without waiting for other agents:

```
Time T0: Dispatch Murdock for 001, 002, 003
Time T1: 001 completes → immediately move to implementing, dispatch B.A.
         (002 and 003 still in testing)
Time T2: 002 completes → immediately move to implementing, dispatch B.A.
         (001 now in implementing, 003 still in testing)
```

This is achieved through:
1. **TaskOutput polling** - Hannibal polls each background agent individually
2. **Completion signaling** - Agents call `agent_stop` MCP tool when done
3. **Per-item tracking** - `board_move` MCP tool stores assignments in database

## Feature Item Format

Each work item bundles everything for one feature:

```yaml
id: "WI-001"  # Generated by API with WI- prefix
title: "Order sync service"
type: "feature"
stage: "briefings"
outputs:
  types: "src/types/order-sync.ts"           # Optional
  test: "src/__tests__/order-sync.test.ts"
  impl: "src/services/order-sync.ts"
dependencies: []
parallel_group: "orders"
status: "pending"
rejection_count: 0
objective: "One sentence describing the deliverable."
acceptance:
  - "Criterion 1"
  - "Criterion 2"
context: "Business logic, patterns, edge cases to consider."
```

## Key Features

### TDD Pipeline

Each feature flows: **Murdock → B.A. → Lynch → Amy**
1. Murdock writes tests first (defines acceptance criteria)
2. B.A. implements to pass those tests
3. Lynch reviews tests + implementation together
4. Amy probes for bugs that slip past tests

### Final Mission Review

When ALL features are complete, Lynch performs a holistic review of the entire codebase:
- **Readability & consistency** across all files
- **Race conditions & async issues** in concurrent code
- **Security vulnerabilities** (injection, auth gaps, input validation)
- **Code quality** (DRY violations, coupling, performance)
- **Integration issues** between modules

If issues are found, specific items return to the pipeline for fixes.

### Mission Lifecycle Checks

**Pre-Mission Checks** (`mission_precheck` MCP tool):
- Run before `/ai-team:run` starts execution
- Configured via `ateam.config.json` (typically lint + unit tests)
- Ensures codebase is in clean state before mission begins
- Establishes baseline - if tests are already failing, mission can't determine what it broke
- If checks fail, mission enters `precheck_failure` state (recoverable)

**Precheck Failure Recovery:**
- When precheck fails (lint or test errors), mission does NOT reach terminal `failed` state
- Operator fixes the lint/test issues in the target project
- Operator retries precheck via `/ai-team:run` without re-planning
- All planning work (Face decomposition, Sosa review, work items) remains intact
- Dashboard shows recoverable `precheck_failure` with blocker details and retry affordance

**Post-Mission Checks** (`mission_postcheck` MCP tool):
- Run after Lynch's Final Mission Review approves
- Configured via `ateam.config.json` (typically lint + unit + e2e)
- Proves all code works together
- Required for mission completion (enforced by Hannibal's Stop hook)

### Testing Philosophy

**Move fast, test what matters:**
- ✅ Happy paths
- ✅ Negative paths (error cases)
- ✅ Key edge cases
- ❌ Don't chase 100% coverage

### Token Usage Tracking

After each mission, the dashboard shows a per-agent cost breakdown:

- **Observer hooks** (`observe-subagent.js`, `observe-stop.js`) parse JSONL transcripts on agent completion and forward token counts to the API
- **Aggregation endpoint** (`POST /api/missions/{id}/token-usage`) groups usage by agent+model with deduplication
- **Configurable pricing** via `ateam.config.json` — set per-model rates ($/1M tokens) for Opus, Sonnet, and Haiku
- **Token summary** in CHANGELOG entries — Tawnia includes a one-line summary (e.g., `Tokens: 1.2M input, 45K output`)

### Work Item Sizing

**Smallest independently-completable units:**
- One logical unit of functionality per item
- No arbitrary time limits
- If you can split it further, split it

### Resumable

- Pick up where you left off after interruptions
- Items in active stages return to previous stage
- Completed work is never redone

## Commands

### `/ai-team:setup`

Configure project ID, permissions, and settings. **Run this once per project.**

This command:
1. **Configures project ID** - Sets `ATEAM_PROJECT_ID` for multi-project isolation
2. **Auto-detects settings** from `CLAUDE.md`, `package.json`, and lock files
3. **Confirms detected settings** before writing
4. **Configures permissions** for background agents:
   - `Bash(mkdir *)` - create directories
   - `Write(src/**)` - tests and implementations
   - `Edit(src/**)` - edit existing files
   - `Bash(git add *)` - staging files for commit
   - `Bash(git commit *)` - creating final commit
5. **Creates `ateam.config.json`** with project settings
6. **Verifies API connectivity**
7. **Checks for browser testing tools** (agent-browser preferred, Playwright fallback)

### `/ai-team:plan <prd-file> [--skip-refinement]`

Initialize a mission from a PRD file with two-pass refinement:
1. Face decomposes PRD into work items
2. Sosa reviews and asks clarifying questions
3. Face refines based on feedback and moves Wave 0 to `ready` stage

Use `--skip-refinement` to bypass Sosa's review for simple PRDs.

### `/ai-team:run [--wip N] [--max-wip M]`

Execute the mission. Default WIP: 3, max: 5.

### `/ai-team:status`

Display the mission board with current progress.

### `/ai-team:resume`

Resume an interrupted mission.

### `/ai-team:unblock <item-id> [--guidance "hint"]`

Unblock a stuck work item with optional guidance.

### Standalone Skills

#### `/perspective-test <feature>`

Test a feature from a real user's perspective. Combines static code analysis with browser-based verification to catch integration bugs that unit tests miss.

```bash
/perspective-test "the login form"
/perspective-test "project name display in header"
/perspective-test src/components/UserProfile.tsx
```

## MCP Server

The plugin includes an MCP (Model Context Protocol) server that exposes board operations as tools that Claude Code can invoke directly.

### Setup

1. **Build the MCP server:**
   ```bash
   bun install              # from repo root
   cd packages/shared && bun run build   # shared must build first
   cd packages/mcp-server && bun run build
   ```

2. **Configure environment** (via `.claude/settings.local.json`):
   ```json
   {
     "env": {
       "ATEAM_PROJECT_ID": "my-project-name",
       "ATEAM_API_URL": "http://localhost:3000"
     }
   }
   ```

### Available Tools

The MCP server provides 22 tools across 5 modules:

| Module | Tools | Description |
|--------|-------|-------------|
| **Board** | `board_read`, `board_move`, `board_claim`, `board_release` | Board state and item movement |
| **Items** | `item_create`, `item_update`, `item_get`, `item_list`, `item_reject`, `item_render` | Work item CRUD operations |
| **Agents** | `agent_start`, `agent_stop` | Agent lifecycle hooks |
| **Missions** | `mission_init`, `mission_current`, `mission_precheck`, `mission_postcheck`, `mission_list`, `mission_archive` | Mission lifecycle management |
| **Utils** | `plugin_root`, `deps_check`, `activity_log`, `log` | Plugin path resolution, dependency validation, and logging |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ATEAM_PROJECT_ID` | `default` | Project identifier for multi-project isolation |
| `ATEAM_API_URL` | `http://localhost:3000` | A(i)-Team API server URL |
| `ATEAM_API_KEY` | - | Optional API key for authentication |
| `ATEAM_TIMEOUT` | `10000` | Request timeout in ms |
| `ATEAM_RETRIES` | `3` | Max retry attempts |

## Plugin Structure

```
ai-team/                     # Add as .claude/ai-team submodule
├── .claude-plugin/
│   └── plugin.json          # Plugin configuration
├── .mcp.json                # MCP server configuration for Claude Code
├── package.json             # Bun workspaces root
├── bun.lock                 # Bun lock file
├── docker-compose.yml       # Docker setup for kanban-viewer
├── vitest.config.js         # Test runner configuration
├── packages/                # Monorepo packages
│   ├── shared/              # @ai-team/shared - Shared types and constants
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts     # Re-exports all types
│   │       ├── stages.ts    # Stage definitions and validation
│   │       ├── agents.ts    # Agent type definitions
│   │       ├── items.ts     # Work item types
│   │       ├── errors.ts    # Error types
│   │       └── __tests__/   # Type tests
│   ├── mcp-server/          # @ai-team/mcp-server - MCP server implementation
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts     # Entry point (stdio transport)
│   │   │   ├── server.ts    # McpServer instance
│   │   │   ├── config.ts    # Environment configuration (projectId, apiUrl)
│   │   │   ├── client/      # HTTP client with retry logic
│   │   │   ├── lib/         # Error handling utilities
│   │   │   └── tools/       # Tool implementations
│   │   │       ├── board.ts     # Board operations (4 tools)
│   │   │       ├── items.ts     # Item operations (6 tools)
│   │   │       ├── agents.ts    # Agent lifecycle (2 tools)
│   │   │       ├── missions.ts  # Mission lifecycle (5 tools)
│   │   │       ├── utils.ts     # Utilities (4 tools)
│   │   │       └── index.ts     # Tool registration
│   │   └── dist/            # Compiled JavaScript
│   └── kanban-viewer/       # @ai-team/kanban-viewer - Web-based Kanban UI
│       ├── package.json
│       ├── Dockerfile
│       └── src/             # Next.js application
├── playbooks/               # Dispatch-mode orchestration playbooks
│   ├── orchestration-legacy.md   # Legacy Task/TaskOutput dispatch
│   └── orchestration-native.md   # Native teams dispatch
├── agents/                  # Agent prompts with lifecycle hooks
│   ├── AGENTS.md            # Agent behavior contracts and boundaries
│   ├── hannibal.md          # Orchestrator (PreToolUse + Stop hooks)
│   ├── face.md              # Decomposer (observers only)
│   ├── sosa.md              # Requirements Critic (PreToolUse + Stop hooks)
│   ├── murdock.md           # QA Engineer (PreToolUse + PostToolUse + Stop hooks)
│   ├── ba.md                # Implementer (PreToolUse + PostToolUse + Stop hooks)
│   ├── lynch.md             # Reviewer (PreToolUse + PostToolUse + Stop hooks)
│   ├── amy.md               # Investigator (PreToolUse + PostToolUse + Stop hooks)
│   └── tawnia.md            # Documentation writer (PreToolUse + PostToolUse + Stop hooks)
├── commands/
│   ├── setup.md             # Configure project ID + permissions
│   ├── plan.md              # Initialize mission
│   ├── run.md               # Execute mission
│   ├── status.md            # Check progress
│   ├── resume.md            # Resume interrupted
│   ├── unblock.md           # Unblock failed items
│   └── perspective-test.md  # Standalone user perspective testing
├── hooks/                   # Plugin-level hooks (auto-loaded by Claude Code)
│   └── hooks.json           # Observer hooks for Raw Agent View telemetry
├── skills/
│   ├── test-writing/
│   │   ├── SKILL.md                          # Test quality rules (5 banned categories)
│   │   └── references/
│   │       └── testing-anti-patterns.md      # Detailed anti-pattern catalog
│   ├── tdd-workflow/
│   │   └── SKILL.md                          # TDD cycle and test granularity
│   └── perspective-test/
│       └── SKILL.md                          # User perspective testing methodology
├── scripts/                 # Hook enforcement scripts (for internal use)
│   ├── vitest.config.ts     # Test config for hook tests
│   └── hooks/               # Agent lifecycle hooks
│       ├── lib/
│       │   └── observer.js              # Shared observer utilities
│       ├── __tests__/                   # Hook enforcement tests
│       │   ├── enforce-hooks.test.js
│       │   └── observe-hooks.test.ts
│       ├── # Observer hooks (telemetry)
│       ├── observe-pre-tool-use.js      # PreToolUse observer
│       ├── observe-post-tool-use.js     # PostToolUse observer
│       ├── observe-stop.js              # Stop observer
│       ├── observe-subagent.js          # SubagentStart/Stop observer
│       ├── observe-teammate.js          # TeammateIdle/TaskCompleted observer
│       ├── # Stop hooks (completion enforcement)
│       ├── enforce-completion-log.js    # Require agent_stop before exit
│       ├── enforce-final-review.js      # Require final review (Hannibal)
│       ├── enforce-browser-verification.js  # Require browser testing (Amy)
│       ├── enforce-orchestrator-boundary.js # Plugin-level Hannibal enforcement
│       ├── enforce-orchestrator-stop.js     # Plugin-level Hannibal stop
│       ├── enforce-sosa-coverage.js     # Require item coverage (Sosa)
│       ├── # PreToolUse hooks (boundary enforcement)
│       ├── block-raw-echo-log.js        # Block echo >> activity.log
│       ├── block-raw-mv.js              # Block raw mv (Hannibal)
│       ├── block-hannibal-writes.js     # Block src/** writes (Hannibal)
│       ├── block-murdock-impl-writes.js # Block impl writes (Murdock)
│       ├── block-ba-test-writes.js      # Block test writes (B.A.)
│       ├── block-ba-bash-restrictions.js # Block dev server/git stash (B.A.)
│       ├── block-amy-writes.js          # Block all project writes (Amy)
│       ├── block-amy-test-writes.js     # Block test file writes (Amy)
│       ├── block-lynch-browser.js       # Block Playwright (Lynch)
│       ├── block-sosa-writes.js         # Block all writes (Sosa)
│       ├── block-worker-board-move.js   # Block board_move (workers)
│       ├── block-worker-board-claim.js  # Block board_claim (workers)
│       ├── track-browser-usage.js       # Track browser tool usage (Amy)
│       └── diagnostic-hook.js           # Diagnostic hook for debugging
├── docs/                    # Documentation
│   ├── hook-audit.md
│   ├── test-anti-patterns.md
│   ├── kanban-ui-prd.md
│   ├── compile-time-safety-verification.md
│   ├── future-thinking.md
│   └── teammate-tool-integration-prd.md
└── README.md
```

## Agent Lifecycle Hooks

The plugin uses Claude Code's hook system to enforce workflow discipline. All agents have comprehensive enforcement hooks defined in their frontmatter — see `agents/AGENTS.md` for the full listing.

**Boundary enforcement hooks** prevent agents from taking actions outside their role:
- Hannibal cannot write to source or test files, cannot use raw `mv` for stage transitions, and cannot exit until final review and post-checks pass
- Amy cannot create test files (findings belong in `agent_stop` work_log, not as file artifacts)
- All working agents (Murdock, B.A., Lynch, Amy, Tawnia) must use the `log` MCP tool for activity logging (raw `echo` is blocked)

**Completion enforcement hooks** ensure proper handoff:
- All working agents must call `agent_stop` before exiting — the Stop hook blocks premature exit
- Hannibal's Stop hook validates that all items are in `done`, Lynch's Final Review is complete, and post-checks have passed

**Observer hooks** for telemetry (Raw Agent View) fire automatically for all sessions via `hooks/hooks.json` — no per-project configuration needed.

Hook scripts live in `scripts/hooks/`. Exit code 0 = allow, non-zero = block.

## Project Configuration

`ateam.config.json` (created by `/ai-team:setup`):

```json
{
  "packageManager": "pnpm",
  "checks": {
    "lint": "pnpm run lint",
    "unit": "pnpm test:unit",
    "e2e": "pnpm exec playwright test"
  },
  "precheck": ["lint", "unit"],
  "postcheck": ["lint", "unit", "e2e"],
  "devServer": {
    "url": "http://localhost:3000",
    "start": "docker compose up",
    "restart": "docker compose restart",
    "managed": false
  }
}
```

## Troubleshooting

### Background agents getting permission denied
**Symptom:** Murdock/B.A. errors: "Permission to use Write has been auto-denied (prompts unavailable)"

**Cause:** Background agents can't prompt for approval interactively.

**Fix:** Run `/ai-team:setup` to configure required permissions, or manually add to `.claude/settings.local.json`:
```json
{
  "env": {
    "ATEAM_PROJECT_ID": "my-project-name"
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

### Cannot connect to API server
**Symptom:** MCP tools return connection errors.

**Cause:** A(i)-Team API server is not running.

**Fix:** Start the API server and ensure `ATEAM_API_URL` is configured correctly in `.claude/settings.local.json`.

### Agents not creating files
**Symptom:** Murdock/B.A. complete but no test/impl files appear.

**Cause:** Work items missing `outputs:` field.

**Fix:** Ensure every work item has:
```yaml
outputs:
  test: "src/__tests__/feature.test.ts"
  impl: "src/services/feature.ts"
```

### Murdock writing implementation code
**Symptom:** Murdock creates both tests AND implementation instead of just tests.

**Cause:** Murdock's boundaries weren't clear enough.

**Fix:** Murdock should only create files at `outputs.test` and `outputs.types`. Implementation (`outputs.impl`) is B.A.'s job.

---

*In 1972, a crack commando unit was sent to prison by a military court for a crime they didn't commit. These men promptly escaped from a maximum security stockade to the Los Angeles underground. Today, still wanted by the government, they survive as soldiers of fortune. If you have a problem, if no one else can help, and if you can find them, maybe you can hire... The A(i)-Team.*
