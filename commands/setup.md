# /ai-team:setup

Configure Claude Code permissions and project settings for A(i)-Team.

## Usage

```
/ai-team:setup
```

## What This Command Does

1. **Auto-detects** project settings from CLAUDE.md and package.json
2. **Configures** the project ID environment variable for multi-project isolation
3. **Configures** native Agent Teams if desired (optional)
4. **Creates** `ateam.config.json` with project-specific settings
5. **Downloads** the `ateam` CLI binary from GitHub releases (if not already present)
6. **Injects** A(i)-Team instructions into CLAUDE.md (so Claude uses the workflow)
7. **Detects** Docker and offers to start kanban-viewer if not running
8. **Verifies** API server connectivity
9. **Configures** observer hook event reporting (telemetry)
10. **Checks** for Playwright plugin (optional, for browser testing)

## Behavior

### Step 1: Configure Project ID and API URL

The A(i)-Team uses a project ID to isolate data between projects and an API URL to communicate with the backend server.

**Check for existing configuration:**
```
Look for ATEAM_PROJECT_ID and ATEAM_API_URL in:
1. .claude/settings.local.json (env section)
2. Environment variables
```

**If project ID not configured, ask the user:**
```
AskUserQuestion({
  questions: [{
    question: "What project ID should identify this project? (Used to isolate data in the API)",
    header: "Project ID",
    options: [
      { label: "Use folder name (Recommended)", description: "Auto-generate from current directory name" },
      { label: "Use git remote", description: "Extract from git remote URL" },
      { label: "Custom", description: "Enter a custom project identifier" }
    ],
    multiSelect: false
  }]
})
```

**If API URL not configured, ask the user:**
```
AskUserQuestion({
  questions: [{
    question: "Where is the A(i)-Team API server running?",
    header: "API URL",
    options: [
      { label: "http://localhost:3000 (Recommended)", description: "Default local development server" },
      { label: "Use detected devServer URL", description: "If devServer was detected, offer it as an option" },
      { label: "Custom URL", description: "Enter a custom API server URL" }
    ],
    multiSelect: false
  }]
})
```

**Write to `.claude/settings.local.json`:**
```json
{
  "env": {
    "ATEAM_PROJECT_ID": "my-project-name",
    "ATEAM_API_URL": "http://localhost:3000"
  }
}
```

**IMPORTANT:** Both `ATEAM_PROJECT_ID` and `ATEAM_API_URL` must be set in `.claude/settings.local.json`. The `ateam` CLI reads these from environment variables, NOT from `ateam.config.json`.

### Step 2: Auto-Detect Project Settings

**IMPORTANT:** Before asking questions, inspect the project's existing documentation to auto-detect settings.

1. **Read CLAUDE.md** (if exists)
   - Look for package manager mentions: `npm`, `yarn`, `pnpm`, `bun`
   - Look for test commands: `npm test`, `vitest`, `jest`, `pnpm test`, etc.
   - Look for lint commands: `npm run lint`, `eslint`, `biome`, etc.
   - Look for dev server URLs: `localhost:3000`, `localhost:5173`, etc.
   - Look for docker commands: `docker compose up`, etc.

2. **Read package.json** (if exists)
   - Check `scripts` for: `test`, `test:unit`, `test:e2e`, `lint`, `dev`, `start`
   - Detect package manager from lock files: `package-lock.json` → npm, `yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm, `bun.lockb` → bun

3. **Build detected config** from findings

### Step 3: Configure Native Teams (Optional)

Claude Code supports native Agent Teams via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, which provides direct agent-to-agent communication, interactive control via Shift+Up/Down arrows, and split pane visualization in the terminal.

**Ask the user if they want to enable native teams:**
```
AskUserQuestion({
  questions: [{
    question: "Enable native Agent Teams? This provides direct agent-to-agent communication, interactive control via Shift+Up/Down arrows, and split pane visualization in the terminal.",
    header: "Native Agent Teams",
    options: [
      { label: "Yes (Recommended)", description: "Enable native teams for enhanced agent orchestration" },
      { label: "No", description: "Use standard background task dispatch" }
    ],
    multiSelect: false
  }]
})
```

**If yes, write the feature flag to `.claude/settings.local.json`:**

Add `"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"` to the `env` section:
```json
{
  "env": {
    "ATEAM_PROJECT_ID": "my-project-name",
    "ATEAM_API_URL": "http://localhost:3000",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

**Then ask for teammate mode preference:**
```
AskUserQuestion({
  questions: [{
    question: "Which teammate mode should agents use?",
    header: "Teammate Mode",
    options: [
      { label: "auto (Recommended)", description: "Uses tmux for split panes if available, falls back to in-process" },
      { label: "tmux", description: "Always use tmux for split pane visualization (requires tmux installed)" },
      { label: "in-process", description: "Run teammates in-process without split panes" }
    ],
    multiSelect: false
  }]
})
```

**Write the mode to `.claude/settings.local.json`:**

Add `"ATEAM_TEAMMATE_MODE": "<choice>"` to the `env` section:
```json
{
  "env": {
    "ATEAM_PROJECT_ID": "my-project-name",
    "ATEAM_API_URL": "http://localhost:3000",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "ATEAM_TEAMMATE_MODE": "auto"
  }
}
```

**If tmux mode selected, verify tmux is installed:**
```
Run: which tmux
```

If tmux is not found:
```
⚠ tmux is not installed but "tmux" mode was selected.
Split pane visualization requires tmux. Either:
  1. Install tmux: brew install tmux (macOS) or apt install tmux (Linux)
  2. Switch to "auto" mode (will fall back to in-process if tmux is unavailable)
  3. Switch to "in-process" mode (no split panes)
```

### Step 4: Confirm Detected Settings

If settings were auto-detected from CLAUDE.md/package.json, **confirm them** instead of asking from scratch:

**Example confirmation flow:**
```
I detected the following settings from your project:

  Project ID:      my-awesome-app (from folder name)
  Package manager: pnpm (detected from pnpm-lock.yaml)
  Lint command:    pnpm run lint (from package.json scripts.lint)
  Unit tests:      pnpm test:unit (from package.json scripts.test:unit)
  E2E tests:       pnpm exec playwright test (from CLAUDE.md)
  Dev server:      http://localhost:3000 (from CLAUDE.md)

Does this look correct?
```

Then use `AskUserQuestion` with detected values as the recommended option.

### Step 5: Fill Gaps with Questions

Only ask questions for settings that **could not be detected**. Use `AskUserQuestion` for missing settings:

**Pre-Mission Checks** (always ask - preference)
```
AskUserQuestion({
  questions: [{
    question: "Which checks should run BEFORE starting a mission? (establishes baseline)",
    header: "Pre-checks",
    options: [
      { label: "Lint + Unit tests", description: "Recommended: ensure clean starting point" },
      { label: "Unit tests only", description: "Just verify tests pass" },
      { label: "Lint only", description: "Just verify code style" },
      { label: "None", description: "Skip pre-mission checks" }
    ],
    multiSelect: false
  }]
})
```

**Post-Mission Checks** (always ask - preference)
```
AskUserQuestion({
  questions: [{
    question: "Which checks should run AFTER mission completes? (proves everything works)",
    header: "Post-checks",
    options: [
      { label: "Lint + Unit + E2E", description: "Recommended: full verification" },
      { label: "Lint + Unit tests", description: "Standard verification" },
      { label: "Unit tests only", description: "Minimal verification" },
      { label: "None", description: "Skip post-mission checks" }
    ],
    multiSelect: false
  }]
})
```

### Step 6: Write Config File

Based on answers, create `ateam.config.json` in project root:

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

- `devServer.url`: Where Amy should point Playwright for browser testing
- `devServer.start`: Command to start the server (for user reference)
- `devServer.restart`: Command to restart the server (e.g., to pick up code changes)
- `devServer.managed`: If false, user manages server; Amy checks if running but doesn't start/restart it

### Step 7: Download `ateam` CLI Binary

The `ateam` CLI provides local tooling for mission management. Download it from GitHub releases if not already present.

**Read the desired version from `ateam.config.json`:**
```
Read ateam.config.json and extract the "ateamCliVersion" field.
Default to "latest" if not set.
```

**Run the following bash script to detect platform and download:**
```bash
#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
BIN_DIR="${PLUGIN_ROOT}/bin"
BINARY="${BIN_DIR}/ateam-bin"

# TODO: Update this if the repo is hosted elsewhere
GITHUB_REPO="theaiteam-dev/the-ai-team-plugin"

# Read minimum required version from plugin.json (set by plugin authors on each release)
MIN_CLI_VERSION=""
PLUGIN_JSON="${PLUGIN_ROOT}/.claude-plugin/plugin.json"
if [ -f "$PLUGIN_JSON" ]; then
  DETECTED=$(grep -o '"minCliVersion"[[:space:]]*:[[:space:]]*"[^"]*"' "$PLUGIN_JSON" | sed 's/.*"minCliVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/')
  if [ -n "$DETECTED" ]; then
    MIN_CLI_VERSION="$DETECTED"
  fi
fi

# Read desired version from ateam.config.json (user pin, default: "latest")
DESIRED_VERSION="latest"
if [ -f ateam.config.json ]; then
  DETECTED=$(grep -o '"ateamCliVersion"[[:space:]]*:[[:space:]]*"[^"]*"' ateam.config.json | sed 's/.*"ateamCliVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/')
  if [ -n "$DETECTED" ]; then
    DESIRED_VERSION="$DETECTED"
  fi
fi

# Semver comparison helper: returns 0 if $1 >= $2, 1 otherwise
semver_gte() {
  [ "$(printf '%s\n%s' "$1" "$2" | sort -V | head -1)" = "$2" ]
}

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin) PLATFORM="darwin" ;;
  linux)  PLATFORM="linux" ;;
  *)
    echo "ERROR: Unsupported operating system: $OS"
    echo "The ateam CLI supports darwin (macOS) and linux only."
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH_SUFFIX="amd64" ;;
  arm64|aarch64) ARCH_SUFFIX="arm64" ;;
  *)
    echo "ERROR: Unsupported architecture: $ARCH"
    echo "The ateam CLI supports amd64 and arm64 only."
    exit 1
    ;;
esac

ASSET_NAME="ateam-${PLATFORM}-${ARCH_SUFFIX}"

# Check if binary already exists and satisfies version requirements
if [ -f "$BINARY" ] && [ -x "$BINARY" ]; then
  CURRENT_VERSION=$("$BINARY" --version 2>/dev/null | awk '{print $NF}' || echo "unknown")

  # Check minimum version requirement from plugin.json
  MEETS_MIN=true
  if [ -n "$MIN_CLI_VERSION" ] && [ "$CURRENT_VERSION" != "unknown" ]; then
    if ! semver_gte "$CURRENT_VERSION" "$MIN_CLI_VERSION"; then
      MEETS_MIN=false
      echo "⚠ ateam CLI ${CURRENT_VERSION} is below minimum required version ${MIN_CLI_VERSION}"
      echo "  Updating..."
    fi
  fi

  # If pinned version matches and minimum is met, skip download
  if [ "$MEETS_MIN" = "true" ] && [ "$DESIRED_VERSION" != "latest" ] && [ "$CURRENT_VERSION" = "$DESIRED_VERSION" ]; then
    echo "✓ ateam CLI already installed (${CURRENT_VERSION})"
    exit 0
  fi

  # If latest requested and minimum is met, skip download
  if [ "$MEETS_MIN" = "true" ] && [ "$DESIRED_VERSION" = "latest" ]; then
    echo "✓ ateam CLI already installed (${CURRENT_VERSION})"
    exit 0
  fi

  if [ "$MEETS_MIN" = "true" ]; then
    echo "Existing ateam CLI version: ${CURRENT_VERSION}"
    echo "Desired version: ${DESIRED_VERSION} — updating..."
  fi
fi

# Resolve download URL
if [ "$DESIRED_VERSION" = "latest" ]; then
  DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/latest/download/${ASSET_NAME}"
else
  DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/${DESIRED_VERSION}/${ASSET_NAME}"
fi

# Create bin directory
mkdir -p "$BIN_DIR"

# Download the binary
echo "Downloading ateam CLI (${ASSET_NAME})..."
echo "  URL: ${DOWNLOAD_URL}"

HTTP_STATUS=$(curl -fSL -w "%{http_code}" -o "$BINARY" "$DOWNLOAD_URL" 2>/dev/null || true)

if [ ! -f "$BINARY" ] || [ "$(wc -c < "$BINARY" | tr -d ' ')" -lt 1000 ]; then
  echo ""
  echo "ERROR: Failed to download ateam CLI binary."
  echo "  URL: ${DOWNLOAD_URL}"
  echo "  HTTP status: ${HTTP_STATUS:-unknown}"
  echo ""
  echo "Possible causes:"
  echo "  - No release published yet for this version"
  echo "  - Network connectivity issue"
  echo "  - Repository is private (may need GITHUB_TOKEN)"
  echo ""
  echo "You can download it manually from:"
  echo "  https://github.com/${GITHUB_REPO}/releases"
  rm -f "$BINARY"
  exit 1
fi

# Make executable
chmod +x "$BINARY"

# Verify it runs
if "$BINARY" --help >/dev/null 2>&1; then
  INSTALLED_VERSION=$("$BINARY" --version 2>/dev/null || echo "unknown")
  echo "✓ ateam CLI installed successfully (${INSTALLED_VERSION})"
  echo "  Location: ${BINARY}"
else
  echo ""
  echo "WARNING: Binary downloaded but failed to execute."
  echo "  This may indicate a platform mismatch or corrupt download."
  echo "  Location: ${BINARY}"
  echo "  Expected: ${ASSET_NAME}"
  echo ""
  echo "Try downloading manually from:"
  echo "  https://github.com/${GITHUB_REPO}/releases"
  exit 1
fi
```

**Success output:**
```
Downloading ateam CLI (ateam-darwin-arm64)...
✓ ateam CLI installed successfully (v1.2.3)
  Location: /path/to/plugin/bin/ateam
```

**If already installed and up to date:**
```
✓ ateam CLI already installed (v1.2.3)
```

**If download fails:**
```
ERROR: Failed to download ateam CLI binary.
  URL: https://github.com/theaiteam-dev/the-ai-team-plugin/releases/latest/download/ateam-darwin-arm64

Possible causes:
  - No release published yet for this version
  - Network connectivity issue
  - Repository is private (may need GITHUB_TOKEN)

You can download it manually from:
  https://github.com/theaiteam-dev/the-ai-team-plugin/releases
```

**Note:** The binary is downloaded to `${CLAUDE_PLUGIN_ROOT}/bin/ateam` which is gitignored. Each machine downloads its own platform-specific binary.

### Step 8: Inject A(i)-Team Instructions into CLAUDE.md

**Purpose:** Ensure Claude knows to use the A(i)-Team system for PRD work in this project.

1. **Check if CLAUDE.md exists** in project root

2. **If CLAUDE.md exists:**
   - Check if it already contains `## A(i)-Team` section
   - If not present, append the section at the end

3. **If CLAUDE.md does not exist:**
   - Create it with the A(i)-Team section

**Section to inject:**

```markdown

## A(i)-Team Integration

This project uses the A(i)-Team plugin for PRD-driven development.

### When to Use A(i)-Team

Use the A(i)-Team workflow when:
- Implementing features from a PRD document
- Working on multi-file changes that benefit from TDD
- Building features that need structured test → implement → review flow

### Commands

- `/ai-team:plan <prd-file>` - Decompose a PRD into tracked work items
- `/ai-team:run` - Execute the mission with parallel agents
- `/ai-team:status` - Check current progress
- `/ai-team:resume` - Resume an interrupted mission

### Workflow

1. Place your PRD in the `prd/` directory
2. Run `/ai-team:plan prd/your-feature.md`
3. Run `/ai-team:run` to execute

The A(i)-Team will:
- Break down the PRD into testable units
- Write tests first (TDD)
- Implement to pass tests
- Review each feature
- Probe for bugs
- Update documentation and commit

**Do NOT** work on PRD features directly without using `/ai-team:plan` first.
```

**Check for existing section:**
```
if CLAUDE.md contains "## A(i)-Team":
    skip injection (already configured)
else:
    append section to CLAUDE.md
```

**Example output:**
```
Updating CLAUDE.md...
  ✓ Added A(i)-Team integration instructions
```

Or if already present:
```
Checking CLAUDE.md...
  ✓ A(i)-Team section already present
```

### Step 9: Docker Detection and Kanban-Viewer Startup

The A(i)-Team kanban-viewer is a web-based Kanban board and API backend. It ships as a pre-built Docker image on GHCR — no local build required.

**Check Docker availability and kanban-viewer status:**

1. **Check if Docker is installed:**
   ```
   Run: which docker || docker --version
   ```

2. **Check if Docker is running:**
   ```
   Run: docker info 2>/dev/null
   ```

3. **Check if kanban-viewer is already running:**
   ```
   Run: curl -s http://localhost:3000/api/missions/current 2>/dev/null
   Or: docker ps | grep kanban-viewer
   ```

**If kanban-viewer already running:**
```
✓ Kanban-viewer already running at http://localhost:3000
```

**If Docker available and kanban-viewer NOT running:**

Ask the user if they want to start it:
```
AskUserQuestion({
  questions: [{
    question: "The A(i)-Team kanban-viewer provides a web UI and API backend. Would you like to start it now?",
    header: "Kanban UI",
    options: [
      { label: "Start with Docker (Recommended)", description: "Pulls ghcr.io/theaiteam-dev/kanban-viewer and starts the container" },
      { label: "Skip for now", description: "You can start it later — see setup docs" }
    ],
    multiSelect: false
  }]
})
```

**If user chooses "Start with Docker":**
1. Run:
   ```bash
   docker compose -f "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/docker-compose.yml" up -d
   ```
2. Wait 5 seconds for startup (first run pulls the image, takes longer)
3. Verify API responds: `curl -s http://localhost:3000/api/missions/current`
4. Show confirmation:
```
✓ Kanban-viewer started at http://localhost:3000
  Data persisted at ~/.ateam/data
```

**If Docker NOT available:**

Show installation instructions:
```
The kanban-viewer provides a web-based Kanban board for mission tracking.

To use it, install Docker first:
  macOS:  https://docs.docker.com/desktop/install/mac-install/
  Linux:  https://docs.docker.com/engine/install/

Once Docker is running:
  docker compose -f "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/docker-compose.yml" up -d

The kanban board will be available at http://localhost:3000
Mission data is persisted at ~/.ateam/data
```

### Step 10: Verify API Connectivity

Test connection to the A(i)-Team API server:

```
Using ateam CLI to verify API connectivity...

✓ Connected to A(i)-Team API at http://localhost:3000
✓ Project ID: my-awesome-app
```

If connection fails:
```
⚠ Could not connect to A(i)-Team API at http://localhost:3000

Make sure the kanban-viewer is running:
  docker compose up -d    (from repo root)

Or start it manually:
  cd packages/kanban-viewer && bun run dev

Or configure a different URL:
  Set ATEAM_API_URL in .claude/settings.local.json
```

### Step 11: Configure Observer Hook Event Reporting

Check API availability before enabling hook event reporting. The observer hooks provide real-time telemetry for mission monitoring.

**If API is reachable, ask the user:**
```
Would you like to enable hook event reporting?

This sends tool-call and agent lifecycle events to the API for
observability (token usage, agent activity, mission telemetry).

- Enable hook event reporting  (Recommended if using Kanban UI)
- Disable hook event reporting (Events are not sent to the API)
```

**If enabled**, configure hooks in `.claude/settings.local.json`:
```json
{
  "hooks": {
    "PostToolUse": [{ "command": "node scripts/hooks/post-tool-use.js" }],
    "SubagentStop": [{ "command": "node scripts/hooks/subagent-stop.js" }]
  }
}
```

**If disabled or API unreachable**, skip hooks configuration:
```
⚠ Hook event reporting disabled — observer hooks will not be configured.
  You can enable this later by re-running /ai-team:setup.
```

### Step 12: Check Browser Testing Tools

Check for agent-browser CLI (preferred) and Playwright plugin (fallback). See Plugin Dependencies section below.

## Permissions

Setup does **not** modify your permissions — that's your call. Background agents will prompt for approval when they need to write files or run git commands unless you pre-approve them.

If you want agents to run without interruption, add permissions to `.claude/settings.local.json` yourself:

| Permission | Purpose |
|------------|---------|
| `Bash(mkdir *)` | Create directories for tests and implementations |
| `Bash(git add *)` | Tawnia stages files for final commit |
| `Bash(git commit *)` | Tawnia creates final commit |
| `Write(src/**)` | Murdock writes tests, B.A. writes implementations |
| `Edit(src/**)` | B.A. edits existing files during implementation |

Adjust the glob patterns to match your project layout (e.g. `Write(lib/**)`, `Write(packages/*/src/**)`).

**CRITICAL:** `ATEAM_PROJECT_ID` and `ATEAM_API_URL` MUST be in the `env` section of `.claude/settings.local.json`. The `ateam` CLI reads these as environment variables — it does NOT read from `ateam.config.json`.

## Environment Variables

The `ateam` CLI reads the following environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ATEAM_PROJECT_ID` | Yes | `default` | Project identifier for multi-project isolation |
| `ATEAM_API_URL` | No | `http://localhost:3000` | Base URL for the A(i)-Team API |
| `ATEAM_API_KEY` | No | - | Optional API key for authentication |
| `ATEAM_TIMEOUT` | No | `10000` | Request timeout in milliseconds |
| `ATEAM_RETRIES` | No | `3` | Number of retry attempts |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | No | - | Set to `1` to enable native teams dispatch |
| `ATEAM_TEAMMATE_MODE` | No | `auto` | Teammate mode: `auto`, `tmux`, or `in-process` |

## Example Output

```
A(i)-Team Setup

Configuring project...
  Project ID: my-awesome-app (from folder name)
  API URL: http://localhost:3000

Configuring native teams...
  ✓ Agent Teams enabled
  ✓ Teammate mode: auto

Settings updated: .claude/settings.local.json
  env.ATEAM_PROJECT_ID = "my-awesome-app"
  env.ATEAM_API_URL = "http://localhost:3000"
  env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"
  env.ATEAM_TEAMMATE_MODE = "auto"

Downloading ateam CLI...
  ✓ ateam CLI installed (v1.2.3) at .claude/ai-team/bin/ateam

Updating CLAUDE.md...
  ✓ Added A(i)-Team integration instructions

Verifying API connectivity...
  ✓ Connected to A(i)-Team API at http://localhost:3000
  ✓ Project ID registered

Checking plugin dependencies...
  ✓ Playwright plugin detected

Board operations handled via ateam CLI → API server.
CLAUDE.md updated with A(i)-Team workflow instructions.

⚠️  RESTART REQUIRED
Environment variables are loaded when Claude Code starts.
To pick up the new settings, please:
  1. Exit this session (/exit or Ctrl+C)
  2. Restart Claude Code in this directory

After restart, run /ai-team:plan to begin.
```

## Customization

If your project uses a different structure or API server, edit `.claude/settings.local.json`:

```json
{
  "env": {
    "ATEAM_PROJECT_ID": "custom-project-id",
    "ATEAM_API_URL": "https://api.example.com"
  }
}
```

**Note:** If you're using a non-default API URL (e.g., a local hostname like `http://kanban-viewer.orb.local:3000`), you MUST set `ATEAM_API_URL` in the `env` section. The default of `http://localhost:3000` only works if that's where your API actually runs.

## Plugin Dependencies

The A(i)-Team recommends the **Playwright plugin** for Amy's browser-based bug hunting.

### Check for Playwright Plugin

After configuring permissions, check if Playwright is available:

```
Do you have the Playwright plugin installed? Amy (Investigator) uses it for browser-based testing.
```

If the user doesn't have it:

```
Amy can use the Playwright plugin for browser-based bug hunting.

To install it:
1. Go to the Claude Code plugins repository
2. Install the official Playwright plugin
3. Run: /ai-team:setup again to verify

Without Playwright, Amy can still:
- Run curl commands for API testing
- Execute Node.js test scripts
- Analyze code and logs

But she won't be able to:
- Open browsers for UI testing
- Take screenshots
- Test interactive flows
```

### Verify Plugin Installation

To check if Playwright tools are available, look for MCP tools matching `mcp__*playwright*`:
- `mcp__plugin_playwright_playwright__browser_navigate`
- `mcp__plugin_playwright_playwright__browser_snapshot`
- `mcp__plugin_playwright_playwright__browser_click`

If these tools exist, Playwright is properly installed as a fallback browser tool for Amy.

## Notes

- **Restart required after first setup** - Environment variables are loaded when Claude Code starts, so you must restart Claude Code after initial setup for `ATEAM_PROJECT_ID` and `ATEAM_API_URL` to take effect
- Uses `settings.local.json` for env vars (gitignored) — permissions are not touched
- Run this once per project before using `/ai-team:plan`
- Safe to run multiple times - won't duplicate CLAUDE.md sections or teammate config
- Playwright plugin is recommended but not strictly required
- Project ID enables running multiple A(i)-Team projects simultaneously
- CLAUDE.md injection ensures Claude uses `/ai-team:plan` for PRD work instead of ad-hoc development
- Native Agent Teams is optional - the plugin works with standard background task dispatch if not enabled
