---
model: sonnet
---
# /ai-team:plan

Initialize a mission from a PRD file with two-pass refinement.

## Usage

```
/ai-team:plan <prd-file> [--skip-refinement]
```

## Arguments

- `prd-file` (required): Path to the PRD markdown file
- `--skip-refinement` (optional): Skip Sosa's review for simple PRDs

## Flow

```
/ai-team:plan ./prd.md
         │
         ▼
┌─────────────────────────────────────┐
│ 1. ateam missions createMission     │
│    Initialize fresh mission in DB   │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 2. Face (opus) - FIRST PASS         │
│    • Decompose PRD into items       │
│    • Create items via ateam CLI     │
│    • Items start in 'briefings'     │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 3. ateam deps-check checkDeps       │
│    Validate dependency graph        │
└─────────────────────────────────────┘
         │
         ▼ (skip if --skip-refinement)
┌─────────────────────────────────────┐
│ 4. Sosa (opus, requirements-critic) │
│    • Review all items in briefings  │
│    • Identify issues & ambiguities  │
│    • Ask human questions            │
│    • Output refinement report       │
└─────────────────────────────────────┘
         │
         ▼ (skip if --skip-refinement)
┌─────────────────────────────────────┐
│ 5. Face (opus) - SECOND PASS        │
│    • Apply Sosa's recommendations   │
│    • Update items via ateam CLI     │
│    • Move Wave 0 → ready stage      │
│    • Dependent items stay briefings │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 6. Report Summary                   │
│    Display results to user          │
└─────────────────────────────────────┘
```

## Behavior

### 1. Validate PRD file exists

```
if not exists(prd-file):
    error "PRD file not found: {prd-file}"
    exit
```

### 1.5. Pre-Flight: Environment Check

Verify the A(i)-Team environment is configured before attempting any API calls.

```bash
# Check CLI works
${CLAUDE_PLUGIN_ROOT}/bin/ateam --version
```

```text
if the command fails:
    Output to user:
    "⚠ ateam CLI failed to initialize. Run /ai-team:setup first."
    STOP.
```

```bash
# Check ATEAM_PROJECT_ID is set
echo $ATEAM_PROJECT_ID
```

```text
if empty or "default":
    Output to user:
    "⚠ ATEAM_PROJECT_ID is not configured. The API requires a project ID
    to isolate your mission data.

    Run /ai-team:setup to configure your project, then restart Claude Code."
    STOP.
```

```bash
# Check API is reachable
${CLAUDE_PLUGIN_ROOT}/bin/ateam board getBoard --json 2>&1 | head -5
```

```text
if connection refused or timeout:
    Output to user:
    "⚠ Cannot reach the A(i)-Team API at ${ATEAM_API_URL:-http://localhost:3000}.

    Make sure the kanban-viewer is running, or run /ai-team:setup to configure."
    STOP.
```

If all checks pass, continue silently.

### 2. Initialize mission

Run `ateam missions createMission` with ALL required parameters:

```bash
ateam missions createMission --name "Project Name" --prdPath "prd/drafts/my-feature.md" --force --json
```

- `--name`: Project name extracted from PRD (first H1 header or filename)
- `--prdPath`: Path to the PRD file (the same file passed as argument to `/ai-team:plan`)
- `--force`: Archive existing mission if any
- `--json`: Get structured response

**All three flags (`--name`, `--prdPath`, `--force`) must be included on the first call.** Do not omit `--prdPath`.

This command:
- Archives existing mission data (if any) in the database
- Creates fresh mission record for this project
- Initializes empty board state
- Logs mission start to activity feed

### 3. Invoke Face - First Pass

```
Task(
  subagent_type: "ai-team:face",
  prompt: "You are Face from the A(i)-Team. [full face.md prompt]

  **THIS IS THE FIRST PASS.** Create work items in briefings stage only.
  Do NOT move items to ready - that happens in the second pass.

  Here is the PRD to decompose:

  {prd_content}

  Create work items using the ateam CLI (ateam items createItem).
  When done, run ateam deps-check checkDeps and report summary."
)
```

### 4. Validate dependencies

Run `ateam deps-check checkDeps --json`.

Check for:
- Circular dependencies
- Missing references
- Orphaned items

If validation fails, report errors and stop.

### 5. Invoke Sosa (skip with --skip-refinement)

```
Task(
  subagent_type: "ai-team:sosa",
  prompt: "You are Sosa from the A(i)-Team. [full sosa.md prompt]

  Review all work items in briefings stage.

  Use AskUserQuestion to clarify any ambiguities with the human.

  Output a refinement report with:
  - Critical issues (must fix)
  - Warnings (should fix)
  - Human answers received
  - Specific update instructions for Face

  Here is the original PRD for context:

  {prd_content}"
)
```

Sosa will:
- Read all items using `ateam items listItems --json` with stage filter
- Identify issues and ambiguities
- Use `AskUserQuestion` to get human clarification
- Produce a detailed refinement report

### 6. Invoke Face - Second Pass (skip with --skip-refinement)

```
Task(
  subagent_type: "ai-team:face",
  prompt: "You are Face from the A(i)-Team. [full face.md prompt]

  **THIS IS THE SECOND PASS.** Apply Sosa's refinements.

  **IMPORTANT: USE MCP TOOLS ONLY.**
  - DO NOT use Glob, Grep, or Search tools
  - DO NOT explore any codebase or directories
  - All information you need is in Sosa's report below

  Here is Sosa's refinement report:

  {sosa_report}

  For each item needing changes:
  1. Use ateam items updateItem to modify the item
  2. Apply the specific recommendations

  After all updates:
  1. Run ateam deps-check checkDeps --json to get the readyItems list
  2. Move items with NO dependencies to ready stage using ateam board-move moveItem
  3. Leave items WITH dependencies in briefings stage

  Report what was updated and moved."
)
```

### 7. Report summary

```
Mission planning complete.

{n} objectives identified:
- {x} in ready stage (Wave 0 - no dependencies)
- {y} in briefings stage (waiting on dependencies)

Dependency depth: {max_depth}
Parallel waves: {waves}

Refinement applied:
- {critical} critical issues resolved
- {warnings} warnings addressed
- {questions} questions answered

Ready for /ai-team:run
```

## Example

```
/ai-team:plan ./docs/shipping-feature-prd.md
```

With skip refinement:
```
/ai-team:plan ./docs/simple-fix-prd.md --skip-refinement
```

## Output

- Mission initialized in the API database
- Work items created with proper stages
- Board state ready for execution
- Activity log started
- Previous mission archived (if any)
- Summary of decomposition and refinement

## Errors

- **PRD not found**: File path invalid
- **Circular dependency detected**: Decomposition has cycles
- **Invalid work item**: Missing required fields
- **Refinement blocked**: Critical issues Sosa can't resolve
- **API unavailable**: Cannot connect to A(i)-Team server

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam missions createMission --name <name> --prdPath <path> --force` | Archive existing mission, create fresh state |
| `ateam items createItem` | Create work items (Face first pass) |
| `ateam items updateItem --id <id>` | Update work items (Face second pass) |
| `ateam items listItems --json` | List items by stage (Sosa review) |
| `ateam board-move moveItem --itemId <id> --toStage <stage>` | Move items between stages (Face second pass) |
| `ateam deps-check checkDeps --json` | Validate dependency graph |

## Agent Invocations

| Agent | Pass | Subagent Type | Model | Purpose |
|-------|------|---------------|-------|---------|
| Face | First | clean-code-architect | opus | Decompose PRD into items |
| Sosa | - | requirements-critic | opus | Review and challenge items |
| Face | Second | clean-code-architect | opus | Refine and move to ready |
