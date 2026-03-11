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

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code                              │
│  ┌─────────────┐                                            │
│  │   Hannibal  │──── Task(team_name) ────────┐             │
│  │ (team lead) │                              │             │
│  └──────┬──────┘                              ▼             │
│         │                         ┌────────────────────────┐│
│         │    ┌── SendMessage ────▶│ Murdock   (tester)    ││
│         │    │                    │ B.A.      (coder)     ││
│         │◀───┤                    │ Lynch     (reviewer)  ││
│         │    │                    │ Amy       (researcher)││
│         │    └── SendMessage ────▶│ Tawnia    (documenter)││
│         │                         └──────────┬─────────────┘│
│         │                                    │              │
│         └────────────────┬───────────────────┘              │
│                          │                                  │
│                 ┌────────▼────────┐                         │
│                 │   ateam CLI     │                         │
│                 │  (Bash calls)   │                         │
│                 └────────┬────────┘                         │
└──────────────────────────┤──────────────────────────────────┘
                           │
                           ▼
                 ┌─────────────────┐
                 │  A(i)-Team API  │
                 └─────────────────┘
```

Native handles orchestration, ateam CLI handles persistence.

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

**Mission Completion (MANDATORY):**
- Lynch-Final: `subagent_type: "ai-team:lynch-final"` → Final Mission Review (PRD+diff scoped)
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
- Run after Lynch completes Final Mission Review
- Proves all code works together (lint + unit + e2e all passing)
- Required for mission completion (enforced by Hannibal's Stop hook)

## Plugin Dependencies

Amy (Investigator) uses browser testing tools during the probing stage to verify UI features. The `/ai-team:setup` command detects which tools are available and offers to install the preferred one.

**agent-browser CLI (Preferred):**
Amy's primary browser testing tool. Installed globally via npm/bun (`npm install -g agent-browser`). Used via Bash commands (`agent-browser open`, `agent-browser snapshot`, etc.). The `/ai-team:setup` command checks for it and offers to install it if missing, adding `Bash(agent-browser:*)` and `Skill(agent-browser)` permissions automatically.

**Playwright MCP Plugin (Fallback):**
Still supported as a fallback if agent-browser is unavailable. Detected by the presence of MCP tools matching `mcp__*playwright*` (e.g., `browser_navigate`, `browser_snapshot`, `browser_click`). The `/ai-team:setup` command detects this automatically and adds the required MCP tool permissions.
