# Plugin Development Guide

This document contains development-specific information for working on the A(i)-Team plugin itself. It is NOT needed by agents during mission execution.

## Intent Layer

**Before modifying code in a subdirectory, read its AGENTS.md first** to understand local patterns and invariants.

- **ateam CLI**: `packages/ateam-cli/` - Go CLI generated from OpenAPI spec; agents call this via `Bash` for all API interaction
- **Agent Prompts**: `agents/AGENTS.md` - Agent behavior contracts, hooks, boundaries, and dispatch patterns
- **Kanban Viewer**: `packages/kanban-viewer/CLAUDE.md` - Next.js web UI with Prisma/SQLite (already documented)

### Global Invariants

- All mission state lives in the API database, not the filesystem. Agents use `ateam` CLI via `Bash` for state changes.
- The `@ai-team/shared` package must be built before `@ai-team/kanban-viewer` (workspace dependency).
- Tests use **vitest** (not bun's native test runner). Run `bun run test`, never bare `bun test`.
- Agent files use YAML frontmatter with hooks that enforce workflow boundaries at runtime.

## About This Repository

**This is the source repository for the A(i)-Team Claude Code plugin.**

This plugin will be published and added to user projects as a submodule (typically at `.claude/ai-team/`). The CLAUDE.md in the user's project root is what Claude Code reads at runtime - this file exists to help with plugin development.

## Package Dependencies

```
@ai-team/shared
    ↑
    └── @ai-team/kanban-viewer (UI depends on shared types)
```

The `@ai-team/shared` package provides TypeScript types and constants used by the Kanban viewer, ensuring type consistency across the system. The `ateam` CLI (`packages/ateam-cli/`) is a separate Go binary generated from the OpenAPI spec.

## File Organization

```
ai-team/
├── .claude-plugin/plugin.json  # Plugin configuration
├── package.json             # Bun workspaces root (run `bun install`)
├── bun.lockb                # Bun lock file
├── docker-compose.yml       # Docker setup for kanban-viewer
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
│   ├── ateam-cli/           # Go CLI binary - generated from OpenAPI spec
│   │   ├── main.go          # Entry point
│   │   ├── openapi.yaml     # API spec (source of truth for CLI generation)
│   │   └── ...              # Generated command implementations
│   └── kanban-viewer/       # @ai-team/kanban-viewer - Web-based Kanban UI
│       ├── package.json
│       ├── Dockerfile
│       └── src/             # React application
├── hooks/                   # Plugin-level hooks (auto-loaded by Claude Code)
│   └── hooks.json           # Plugin hooks: observer telemetry + enforcement hooks
├── playbooks/               # Dispatch-mode orchestration playbooks
│   ├── orchestration-legacy.md   # Legacy Task/TaskOutput dispatch
│   └── orchestration-native.md   # Native teams (TeamCreate/SendMessage) dispatch
├── agents/                  # Agent prompts and behavior (with frontmatter hooks)
│   ├── AGENTS.md            # Local patterns, invariants, and hook contracts
│   ├── hannibal.md          # Orchestrator (PreToolUse + PostToolUse + Stop hooks)
│   ├── face.md              # Decomposer (PreToolUse + PostToolUse + Stop observers)
│   ├── sosa.md              # Requirements Critic (PreToolUse + PostToolUse + Stop hooks)
│   ├── murdock.md           # QA Engineer (PreToolUse + PostToolUse + Stop hooks)
│   ├── ba.md                # Implementer (PreToolUse + PostToolUse + Stop hooks)
│   ├── lynch.md             # Reviewer - per-feature (PreToolUse + PostToolUse + Stop hooks)
│   ├── lynch-final.md       # Reviewer - Final Mission Review (PreToolUse + PostToolUse + Stop hooks)
│   ├── amy.md               # Investigator (PreToolUse + PostToolUse + Stop hooks)
│   ├── tawnia.md            # Documentation writer (PreToolUse + PostToolUse + Stop hooks)
│   └── __tests__/           # Agent hook contract tests
├── commands/                # Slash command definitions
│   ├── setup.md, plan.md, run.md, status.md, resume.md, unblock.md
│   └── perspective-test.md  # Standalone user perspective testing
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
│   ├── vitest.config.ts     # Test configuration for hook scripts
│   └── hooks/               # Agent lifecycle hooks
│       ├── lib/
│       │   ├── observer.js              # Shared observer utility
│       │   ├── resolve-agent.js         # Shared agent identity resolution (resolveAgent, isKnownAgent, KNOWN_AGENTS)
│       │   └── send-denied-event.js     # Fire-and-forget denied event recording
│       ├── __tests__/                   # Hook unit tests
│       │   ├── enforce-hooks.test.js
│       │   └── observe-hooks.test.ts
│       ├── # Observer hooks (telemetry)
│       ├── observe-pre-tool-use.js      # PreToolUse observer
│       ├── observe-post-tool-use.js     # PostToolUse observer
│       ├── observe-stop.js              # Stop observer
│       ├── observe-subagent.js          # Subagent lifecycle observer
│       ├── observe-teammate.js          # Teammate lifecycle observer
│       ├── track-browser-usage.js       # Browser tool usage tracker (Amy)
│       ├── # Stop hooks (completion enforcement)
│       ├── enforce-completion-log.js    # Require agent_stop before finishing
│       ├── enforce-final-review.js      # Require final review (Hannibal)
│       ├── enforce-orchestrator-boundary.js  # Plugin-level Hannibal enforcement
│       ├── enforce-orchestrator-stop.js      # Plugin-level Hannibal stop
│       ├── enforce-sosa-coverage.js     # Require item coverage (Sosa)
│       ├── enforce-browser-verification.js   # Require browser testing (Amy)
│       ├── # PreToolUse hooks (boundary enforcement)
│       ├── block-raw-echo-log.js        # Block echo >> activity.log
│       ├── block-raw-mv.js              # Block raw mv (Hannibal)
│       ├── block-hannibal-writes.js     # Block src/** writes (Hannibal)
│       ├── block-murdock-impl-writes.js # Block impl writes (Murdock)
│       ├── block-ba-test-writes.js      # Block test writes (B.A.)
│       ├── block-ba-bash-restrictions.js # Block dev server/git stash (B.A.)
│       ├── block-amy-writes.js          # Block all project writes (Amy)
│       ├── block-amy-test-writes.js     # Block test file writes (Amy)
│       ├── block-lynch-browser.js       # Block Playwright (Lynch + Lynch-Final)
│       ├── block-lynch-writes.js        # Block file writes (Lynch + Lynch-Final)
│       ├── block-sosa-writes.js         # Block all writes (Sosa)
│       ├── block-worker-board-move.js   # Block board_move (workers)
│       ├── block-worker-board-claim.js  # Block board_claim (workers)
│       └── diagnostic-hook.js           # Debug/diagnostic hook
└── docs/
    ├── hook-audit.md
    ├── test-anti-patterns.md
    ├── PLUGIN-DEV.md        # This file - plugin development guide
    ├── ORCHESTRATION.md     # Hannibal orchestration reference
    ├── kanban-ui-prd.md     # PRD for web-based kanban board
    ├── compile-time-safety-verification.md
    ├── future-thinking.md
    └── teammate-tool-integration-prd.md
```

**Monorepo Structure:**
The repository uses bun workspaces with two TypeScript packages plus a Go CLI:
- `@ai-team/shared` - Shared types and constants used by other packages
- `@ai-team/kanban-viewer` - Web UI (depends on @ai-team/shared)
- `packages/ateam-cli/` - Go CLI binary (not a bun workspace; built with `go build`)

Plugin-specific files (agents/, commands/, skills/, scripts/) remain at the repository root.

## Agent Lifecycle Hooks

The plugin uses Claude Code's hook system to enforce workflow discipline.

**IMPORTANT: Hook Data Source.** Claude Code sends hook context via **stdin as JSON**, NOT as environment variables. All hook scripts must read from stdin using `readFileSync(0, 'utf8')` and parse the JSON. The stdin JSON contains fields like `tool_name`, `tool_input`, `hook_event_name`, `session_id`, `cwd`, etc. The only env vars available are those from `settings.local.json` (e.g., `ATEAM_API_URL`, `ATEAM_PROJECT_ID`) and `CLAUDE_PROJECT_DIR`.

**IMPORTANT: Plugin-Level Hooks.** Observer hooks for telemetry (Raw Agent View) are defined in `hooks/hooks.json` at the plugin root. This file is auto-discovered by Claude Code from the `hooks/` directory at the plugin root — `plugin.json` does not reference it explicitly. These hooks fire automatically for all sessions where the plugin is enabled — no per-project configuration needed. Agent frontmatter hooks (in `agents/*.md`) provide enforcement (blocking bad behavior) scoped to individual agent lifetimes. Use `${CLAUDE_PLUGIN_ROOT}` for paths in both locations.

**IMPORTANT: Dual Registration.** All enforcement hooks are registered at BOTH the plugin level (`hooks/hooks.json`) AND in each agent's frontmatter. This is intentional for backward compatibility: frontmatter hooks scope to legacy subagent sessions, while plugin-level hooks catch native teammate sessions where frontmatter may not fire. Blocking is idempotent — being blocked by both levels is harmless.

**IMPORTANT: Agent Identity in Hooks.** All enforcement hooks use `resolveAgent()` from `scripts/hooks/lib/resolve-agent.js` to identify the current agent from hook stdin JSON. In native teams mode, `agent_type` (e.g. `"ai-team:ba"`) identifies the agent. In legacy mode, frontmatter scoping provides identity; plugin-level hooks fall back to the agent map from `lookupAgent()`. Unknown/null agents fail open (exit 0) in all enforcement hooks except `enforce-orchestrator-boundary.js`, which treats null as the main (Hannibal) session.

**IMPORTANT: Denied Event Telemetry.** All enforcement hooks call `sendDeniedEvent()` from `scripts/hooks/lib/send-denied-event.js` before blocking. This fires a fire-and-forget POST to the API with `status: "denied"`, recording which agent attempted the forbidden action. Events appear in the Raw Agent View with status "denied". No await, no throw on failure.

### Plugin-Level Hooks (`hooks/hooks.json`)

These hooks fire for all sessions where the plugin is enabled:

- **PreToolUse** (no matcher): `observe-pre-tool-use.js` — logs every tool call for Raw Agent View telemetry
- **PreToolUse** (no matcher): `enforce-orchestrator-boundary.js` — enforces allowlist for Hannibal's main session
- **PreToolUse** (no matcher): All enforcement hooks registered at plugin level (in addition to agent frontmatter); use `resolveAgent()` to identify target agent and fail-open for unknown sessions
- **PostToolUse** (no matcher): `observe-post-tool-use.js` — logs every tool result for telemetry
- **Stop** (no matcher): `observe-stop.js` — logs agent stop events for telemetry
- **Stop** (no matcher): `enforce-orchestrator-stop.js` — prevents mission ending without final review and post-checks
- **SubagentStart/Stop** (no matcher): `observe-subagent.js` — logs subagent lifecycle events
- **TeammateIdle/TaskCompleted** (no matcher): `observe-teammate.js` — logs native teams events

### Shared Working Agent Hooks (Murdock, B.A., Lynch, Lynch-Final, Amy, Tawnia)

All working agents share these hooks in their frontmatter:

- **PreToolUse(Bash)** → `block-raw-echo-log.js`: Forces `ateam activity createActivityEntry` instead of raw echo
- **PreToolUse(board_move)** → `block-worker-board-move.js`: Stage transitions are Hannibal's responsibility
- **PreToolUse(board_claim)** → `block-worker-board-claim.js`: Item claims go through `ateam agents-start agentStart`
- **PreToolUse(no matcher)** → `observe-pre-tool-use.js {agent}`: Telemetry
- **PostToolUse(no matcher)** → `observe-post-tool-use.js {agent}`: Telemetry
- **Stop** → `enforce-completion-log.js`: Requires `agent_stop` before finishing
- **Stop** → `observe-stop.js {agent}`: Telemetry

### Per-Agent Unique Hooks

**Murdock**: `block-murdock-impl-writes.js` — prevents writing implementation files
**B.A.**: `block-ba-bash-restrictions.js` + `block-ba-test-writes.js` — prevents test writes and restricted bash
**Lynch / Lynch-Final**: `block-lynch-writes.js` + `block-lynch-browser.js` — prevents file writes and browser tools
**Amy**: `block-amy-writes.js` + `track-browser-usage.js` + `enforce-browser-verification.js`
**Sosa**: `block-sosa-writes.js` + `enforce-sosa-coverage.js`
**Hannibal**: `block-hannibal-writes.js` + `block-raw-mv.js` + `enforce-final-review.js`

## Installation

When published, users can install this plugin via several methods:

### Option 1: Claude Code Plugin Command (Recommended)
```
/plugin install ai-team
```

Or from a marketplace:
```
/plugin marketplace add anthropics/claude-plugins-official
/plugin install ai-team
```

### Option 2: Git Submodule
```bash
git submodule add git@github.com:yourorg/ai-team.git .claude/ai-team
```

### Development Testing
Use the `--plugin-dir` flag to test during development:
```bash
claude --plugin-dir /path/to/ai-team
```

Once installed, the plugin's slash commands (`/ai-team:plan`, `/ai-team:run`, etc.) become available.

### First-Time Setup

After installation, run setup to configure the project:

```
/ai-team:setup
```

This will:
1. Configure your project ID (for multi-project isolation)
2. Set up required permissions for background agents
3. Create `ateam.config.json` with project settings
4. Verify API server connectivity
5. Check for optional browser tools

### Development Setup

For plugin development, the repository uses bun workspaces:

```bash
# Install dependencies for all packages
bun install

# Build shared package (must be built first)
cd packages/shared && bun run build

# Build the ateam CLI (Go binary)
cd packages/ateam-cli && go build -o ~/go/bin/ateam .

# Start Kanban UI (optional, for viewing mission progress)
docker compose up -d
```

The shared package must be built before the kanban-viewer since it depends on it. The `ateam` CLI is built separately with Go and does not depend on the bun workspace packages.
