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

All mission state is stored in the **A(i)-Team API database**, enabling:
- **Multi-project isolation** via `ATEAM_PROJECT_ID`
- **Web-based Kanban UI** for real-time visibility
- **Activity feeds** for live logging
- **Persistence** across Claude Code sessions

Agents interact with the API via the `ateam` CLI binary (`${CLAUDE_PLUGIN_ROOT}/bin/ateam`), called through Claude's `Bash` tool.

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

## Getting Started

### 1. Install the Plugin

**Via Claude Code plugin marketplace (recommended):**

```bash
/plugin marketplace add theaiteam-dev/the-ai-team-plugin
/plugin install ai-team@the-ai-team-plugin
```

**Via git submodule (self-hosted / development):**

```bash
git submodule add git@github.com:theaiteam-dev/the-ai-team-plugin.git .claude/ai-team
```

### 2. Start the Kanban Viewer

The kanban viewer is the API backend and web dashboard. It ships as a pre-built Docker image — no build step required.

```bash
# Start the container (pulls ghcr.io/theaiteam-dev/kanban-viewer on first run)
docker compose -f "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/docker-compose.yml" up -d

# Visit http://localhost:3000
```

Mission data is persisted at `~/.ateam/data` on your host machine and survives container restarts and upgrades.

If you're running a hosted instance (e.g., `https://kanban.theaiteam.dev`), skip this step — just point `ATEAM_API_URL` at the hosted URL in step 3.

### 3. Run Setup

```bash
/ai-team:setup
```

This configures your project:
1. Sets `ATEAM_PROJECT_ID` for multi-project isolation
2. Auto-detects package manager, lint/test commands from your project
3. Creates `ateam.config.json` with check commands
4. Verifies API connectivity
5. Configures permissions for background agents

The `ateam` CLI binary is auto-downloaded on first use — no manual install step needed.

Your settings are stored in `.claude/settings.local.json`:

```json
{
  "env": {
    "ATEAM_PROJECT_ID": "my-project-name",
    "ATEAM_API_URL": "http://localhost:3000"
  }
}
```

For hosted instances behind access control (e.g., Cloudflare Access), add your service token credentials:

```json
{
  "env": {
    "ATEAM_PROJECT_ID": "my-project-name",
    "ATEAM_API_URL": "https://kanban.theaiteam.dev",
    "ACCESS_CLIENT_ID": "<your-client-id>",
    "ACCESS_CLIENT_SECRET": "<your-client-secret>"
  }
}
```

### 4. Run a Mission

```bash
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

### Updating

```bash
# Marketplace install
/plugin update ai-team@the-ai-team-plugin

# Submodule
git submodule update --remote .claude/ai-team
```

## Kanban Dashboard

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
- **Pre-Mission Checks**: Runs `ateam missions-precheck missionPrecheck` to verify lint and tests pass (establishes baseline)

**Concurrency control:**
The system automatically calculates the optimal number of parallel agent instances based on:
- **Dependency graph parallelism** — maximum items that can be tested/implemented simultaneously without dependency violations
- **Memory budget** — WIP limits imposed by available context window

Override automatic scaling with `--concurrency N` (at planning time or on retry):
```bash
/ai-team:plan ./docs/my-prd.md --concurrency 4
# or on a retry after adjusting concurrency needs
```

The scaling decision (instance count, binding constraint, rationale) is visible in the Kanban UI scaling modal.

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
7. `final review → post-checks`: Run `ateam missions-postcheck missionPostcheck` (lint, unit, e2e)
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

### Multi-Instance Agent Pools

When `--concurrency N` is set or adaptive scaling calculates multiple instances, the system spawns a pool of agents:

```
Murdock Pool:          B.A. Pool:
- murdock-1    ─┐      - ba-1    ─┐
- murdock-2    ─┼──→   - ba-2    ├──→ Lynch
- murdock-3    ─┤      - ba-3    ├─┐
                │      - ba-4    ─┘ ▼
            (work items dispatched to available pool members)
```

Each pool member can work on a different feature simultaneously. Dispatch logic hands off work items to the next available instance in the pool, enabling true parallel development constrained only by dependency ordering and memory budget.

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
2. **Completion signaling** - Agents run `ateam agents-stop agentStop` when done
3. **Per-item tracking** - `ateam board-move moveItem` stores assignments in database

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

**Pre-Mission Checks** (`ateam missions-precheck missionPrecheck`):
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

**Post-Mission Checks** (`ateam missions-postcheck missionPostcheck`):
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

## ateam CLI

The plugin uses the `ateam` Go CLI binary to interact with the A(i)-Team API. All agents call `ateam` via the `Bash` tool — no MCP server required.

### Setup

The CLI binary auto-downloads on first use via the `bin/ateam` wrapper script. It also auto-updates when the plugin's `minCliVersion` requires a newer release. To build locally during development:

```bash
cd packages/ateam-cli
go build -o ~/go/bin/ateam .
```

Configure environment via `.claude/settings.local.json`:
```json
{
  "env": {
    "ATEAM_PROJECT_ID": "my-project-name",
    "ATEAM_API_URL": "http://localhost:3000"
  }
}
```

### CLI → API Mapping

| CLI Command | Purpose |
|-------------|---------|
| `ateam board getBoard --json` | Get board state |
| `ateam board-move moveItem --itemId <id> --toStage <stage>` | Move item between stages |
| `ateam board-claim claimItem --itemId <id> --agent <name>` | Claim item for agent |
| `ateam board-release releaseItem --itemId <id>` | Release item claim |
| `ateam items createItem --title "..." --type feature` | Create work item |
| `ateam items getItem --id <id> --json` | Get item details |
| `ateam items listItems --json` | List all items |
| `ateam items updateItem --id <id>` | Update item |
| `ateam items rejectItem --id <id>` | Reject item (returns to pipeline) |
| `ateam items renderItem --id <id>` | Render item as markdown |
| `ateam agents-start agentStart --itemId <id> --agent <name>` | Signal agent start |
| `ateam agents-stop agentStop --itemId <id> --agent <name> --status success --summary "..."` | Signal agent completion |
| `ateam missions createMission` | Initialize mission |
| `ateam missions-current getCurrentMission --json` | Get active mission |
| `ateam missions-precheck missionPrecheck` | Submit precheck results |
| `ateam missions-postcheck missionPostcheck --json` | Run postcheck |
| `ateam missions-archive archiveMission --json` | Archive mission |
| `ateam deps-check checkDeps --json` | Check dependency readiness |
| `ateam activity createActivityEntry --agent <name> --message "..." --level info` | Log activity |
| `ateam activity listActivity --json` | View activity log |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ATEAM_PROJECT_ID` | `default` | Project identifier for multi-project isolation |
| `ATEAM_API_URL` | `http://localhost:3000` | A(i)-Team API server URL |
| `ATEAM_API_KEY` | - | Optional API key for authentication |
| `ACCESS_CLIENT_ID` | - | Service token ID for access-controlled instances |
| `ACCESS_CLIENT_SECRET` | - | Service token secret for access-controlled instances |

## Plugin Structure

```
ai-team/                     # Installed via marketplace or git submodule
├── .claude-plugin/
│   ├── plugin.json          # Plugin configuration (version, minCliVersion)
│   ├── marketplace.json     # Marketplace distribution metadata
│   └── docker-compose.yml   # Start kanban-viewer with pre-built GHCR image
├── package.json             # Bun workspaces root
├── bun.lock                 # Bun lock file
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
│   ├── ateam-cli/           # Go CLI binary - agents call this via Bash
│   │   ├── main.go          # Entry point
│   │   └── ...              # Generated command implementations
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
- Amy cannot create test files (findings belong in `ateam agents-stop agentStop` work_log, not as file artifacts)
- All working agents (Murdock, B.A., Lynch, Amy, Tawnia) must use `ateam activity createActivityEntry` for activity logging (raw `echo` is blocked)

**Completion enforcement hooks** ensure proper handoff:
- All working agents must run `ateam agents-stop agentStop` before exiting — the Stop hook blocks premature exit
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

## Development

### Commit Conventions

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/). This is enforced by [commitlint](https://commitlint.js.org/) on every PR to `main`.

```
feat: add token cost breakdown to dashboard
fix: postcheck no longer runs commands in wrong context
docs: update pipeline flow diagram
refactor: extract agent dispatch into shared utility
test: add Stockwell normalization assertions
ci: add commitlint workflow for PRs
chore: update Go dependencies
```

**Breaking changes** use a footer:
```
feat: replace MCP server with ateam CLI binary

BREAKING CHANGE: MCP server package removed. All agent communication
now goes through the ateam CLI binary via Bash tool calls.
```

### Release Process

Releases are **fully automated** — merging a PR to `main` is all it takes.

```
Branch → PR to main → commitlint validates → merge → semantic-release
                                                         │
                                              Analyzes commits since last tag
                                                         │
                                              feat: → minor   (v1.1.0)
                                              fix:  → patch   (v1.0.2)
                                              BREAKING CHANGE → major (v2.0.0)
                                              docs:/chore:/ci: → no release
                                                         │
                                              Creates GitHub Release + git tag
                                                         │
                                         ┌───────────────┼───────────────┐
                                         │               │               │
                                    Go CLI build    Docker image    Release notes
                                   (4 platforms)   (GHCR publish)  (auto-generated)
```

**What gets built on release:**
- `ateam` CLI binaries for darwin/arm64, darwin/amd64, linux/arm64, linux/amd64
- `kanban-viewer` Docker image pushed to GHCR (`:vX.Y.Z` and `:latest`)
- GitHub Release with auto-generated notes from conventional commits

**Manual tag fallback** — if you need to cut a release outside the normal flow:
```bash
git tag v1.2.3
git push origin v1.2.3
```

**Changelogs** are maintained manually in `CHANGELOG.md` — semantic-release does not auto-generate them.

**Configuration files:**
- `.releaserc.json` — semantic-release plugins (commit-analyzer, release-notes-generator, github)
- `.commitlintrc.yml` — commit message validation rules
- `.github/workflows/release.yml` — the full release pipeline
- `.github/workflows/commitlint.yml` — PR commit validation

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
**Symptom:** `ateam` CLI commands return connection errors.

**Cause:** The kanban-viewer container is not running.

**Fix:** Start the container and ensure `ATEAM_API_URL` is configured correctly in `.claude/settings.local.json`:
```bash
docker compose -f "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/docker-compose.yml" up -d
```

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
