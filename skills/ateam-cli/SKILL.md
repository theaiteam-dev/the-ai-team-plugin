# ateam CLI Skill

The `ateam` binary is a Go CLI generated from the A(i)-Team OpenAPI spec. It provides direct access to every API endpoint without needing `curl` or raw HTTP.

## When to Use It

Use `ateam` whenever you need to interact with the A(i)-Team API:

- **Agent code**: Hannibal, Murdock, B.A., Lynch, Amy, Tawnia, Face, and Sosa ALL call `ateam` via the `Bash` tool for every API interaction (board moves, item updates, agent lifecycle, etc.)
- **Debugging**: Inspecting board state, querying items, missions, or activity logs
- **Scripts**: Automating API interactions or one-off queries

Agents call `ateam` via `Bash` — this is the primary and only API interface for agent code. There is no MCP server layer; the CLI replaced it directly.

## Basic Usage

```bash
# Always start with --help if unsure what a command does
ateam --help
ateam board --help
ateam items createItem --help

# Point at a non-default server with --base-url
ateam --base-url http://localhost:3000 board getBoard

# Get raw JSON output (useful for piping to jq)
ateam --json board getBoard
ateam --json items listItems | jq '.[] | .title'
```

## The --help Rule

**If you're unsure about any command or flag, run `--help` first.** Every command and subcommand has help text generated directly from the OpenAPI spec, including required parameters, optional flags, and descriptions.

```bash
# Top-level help: lists all resource groups
ateam --help

# Resource help: lists subcommands for that resource
ateam missions --help
ateam board-move --help

# Command help: shows all flags and parameters
ateam missions createMission --help
ateam board-move moveItem --help
ateam items updateItem --help
```

This is always faster than guessing flag names.

## Common Commands

### Board

```bash
# Full board state (all items, stages, claims, active mission)
ateam board getBoard

# Move an item to a new stage
ateam board-move moveItem --item-id WI-001 --stage implementing

# Claim an item for an agent
ateam board-claim claimItem --item-id WI-001 --agent Murdock

# Release a claim
ateam board-release releaseItem --item-id WI-001
```

### Items

```bash
# List all items
ateam items listItems

# Get a specific item
ateam items getItem --id WI-001

# Render item as markdown (useful for reading briefings)
ateam items renderItem --id WI-001
```

### Missions

```bash
# Get the active mission
ateam missions-current getCurrentMission

# List all missions
ateam missions listMissions

# Aggregate and view token usage/costs for a mission
ateam missions aggregateTokenUsage --id <missionId>
ateam missions getTokenUsage --id <missionId>
```

### Activity

```bash
# View recent activity log
ateam activity listActivity

# Add an activity entry manually
ateam activity createActivityEntry --agent Hannibal --message "Mission started" --level info
```

### Dependency Check

```bash
# See which items are ready (deps met)
ateam deps-check checkDeps
```

## Global Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--base-url` | `http://localhost:3000` | API server URL |
| `--json` | false | Output raw JSON instead of formatted text |
| `--no-color` | false | Disable color output |
| `--verbose` | false | Verbose output for debugging |
| `--config` | — | Path to a config file |

## Project ID Header

The API requires an `X-Project-ID` header for multi-tenant isolation. The CLI reads `ATEAM_PROJECT_ID` from the environment automatically — no flag needed. Set it in `.claude/settings.local.json`:

```json
{
  "env": {
    "ATEAM_PROJECT_ID": "my-project-name",
    "ATEAM_API_URL": "http://localhost:3000"
  }
}
```

Use `--base-url $ATEAM_API_URL` when the env var is set and you want to be explicit:

```bash
ateam --base-url $ATEAM_API_URL board getBoard --json
```

## Agent API Reference (Full Mapping)

Agents use `ateam` via `Bash` for all API operations. Here is the complete mapping of what each operation does:

| Operation | CLI Command |
|-----------|-------------|
| Get board state | `ateam board getBoard --json` |
| Move item to stage | `ateam board-move moveItem --itemId <id> --toStage <stage>` |
| Move item + claim | `ateam board-move moveItem --itemId <id> --toStage <stage> --agent <name>` |
| Claim item for agent | `ateam board-claim claimItem --itemId <id> --agent <name>` |
| Release item claim | `ateam board-release releaseItem --itemId <id>` |
| Create work item | `ateam items createItem --title "..." --type feature [flags]` |
| Get item details | `ateam items getItem --id <id> --json` |
| List all items | `ateam items listItems --json` |
| Update item | `ateam items updateItem --id <id> [flags]` |
| Reject item (pipeline rework) | `ateam items rejectItem --id <id>` |
| Render item as markdown | `ateam items renderItem --id <id>` |
| Signal agent start | `ateam agents-start agentStart --itemId <id> --agent <name>` |
| Signal agent completion | `ateam agents-stop agentStop --itemId <id> --agent <name> --status success --summary "..."` |
| Initialize mission | `ateam missions createMission [flags]` |
| Get active mission | `ateam missions-current getCurrentMission --json` |
| Submit precheck results | `ateam missions-precheck missionPrecheck --passed true/false [flags]` |
| Submit postcheck | `ateam missions-postcheck missionPostcheck --json` |
| Archive mission | `ateam missions-archive archiveMission --json` |
| Check dep readiness | `ateam deps-check checkDeps --json` |
| Log activity message | `ateam activity createActivityEntry --agent <name> --message "..." --level info` |
| View activity log | `ateam activity listActivity --json` |

**Note on `plugin_root`:** This was an MCP tool that returned the plugin directory path. It is no longer needed — use `${CLAUDE_PLUGIN_ROOT}` directly in Bash commands instead.

## Where the Binary Lives

- **Development (this repo):** `~/go/bin/ateam` (built manually from `packages/ateam-cli/`)
- **Installed plugin:** `${CLAUDE_PLUGIN_ROOT}/bin/ateam` (downloaded by `/ai-team:setup`)

The source lives at `packages/ateam-cli/` and is generated from `packages/kanban-viewer/openapi.yaml` using `swagger-jack`. To rebuild locally after spec changes:

```bash
cd packages/ateam-cli
go build -o ~/go/bin/ateam .
```
