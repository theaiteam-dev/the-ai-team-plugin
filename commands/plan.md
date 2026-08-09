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
│ 3. Verify board state               │
│    Face already ran deps-check in   │
│    its pass-1 wrap-up — don't       │
│    re-run it, just confirm the      │
│    board matches Face's report      │
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
│ 5. Face (SAME agent) - SECOND PASS  │
│    • SendMessage to the still-live  │
│      pass-1 agent (no fresh spawn)  │
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
Agent(
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

**Seed exploration, don't skip it.** If the PRD names concrete code touchpoints
(specific files, modules, schemas, prior "Resolved Decisions" sections), include
that list at the top of Face's prompt so it can jump straight to those locations
instead of a cold serial exploration. This cuts the cold-start time significantly
on PRDs that already know their touchpoints. Keep exploration itself mandatory,
though — it's what catches things the PRD doesn't mention (dead code paths,
divergent/duplicate implementations, missing platform primitives). Seeding
accelerates convergence; it does not replace verification.

### 4. Verify board state

Face's pass-1 prompt already ends its wrap-up by running
`ateam deps-check checkDeps` and reporting the result (valid graph, ready
items, blocked items — see `face.md`). Don't re-run the same check from the
orchestrator; it's the identical API call against the same board state.
Instead, confirm the board matches what Face reported:

```bash
ateam board getBoard --json
```

Check that item count, waves, and the ready/blocked split line up with
Face's summary. If Face's own deps-check reported failures (circular
dependencies, missing references, orphaned items), report errors and stop —
do not proceed to Sosa.

### 5. Invoke Sosa (skip with --skip-refinement)

```
Agent(
  subagent_type: "ai-team:sosa",
  prompt: "You are Sosa from the A(i)-Team. [full sosa.md prompt]

  Review all work items in briefings stage.

  Use AskUserQuestion to clarify any ambiguities with the human.

  Output a refinement report with:
  - Critical issues (must fix)
  - Warnings (should fix)
  - Human answers received
  - Specific update instructions for Face
  - ADR Candidates (MANDATORY section — per your definition §13, always
    include it; if nothing qualifies write exactly 'ADR Candidates: none.')

  Here is the original PRD for context:

  {prd_content}"
)
```

Sosa will:
- Read all items using `ateam items listItems --json` with stage filter
- Identify issues and ambiguities
- Use `AskUserQuestion` to get human clarification
- Produce a detailed refinement report

**Preliminary vs. final reports.** Sosa may send a preliminary report (human
questions still pending) before a sharper final report lands. Do not dispatch
Face pass 2 off the preliminary and then hand-reconcile deltas yourself — ad
hoc reconciliation by the orchestrator is where instructions get lost. Default
protocol:
- Wait for Sosa's final report, then dispatch Face pass 2 once, off that
  report.
- Overlap is only safe if Sosa explicitly marks the preliminary
  "safe to dispatch — final will only add precision." If Sosa hasn't said
  that, wait for final.

### 6. Invoke Face - Second Pass (skip with --skip-refinement)

**Default: reuse the pass-1 agent.** Keep the pass-1 Face agent (spawned in
step 3) alive rather than tearing it down. Resume it here via `SendMessage`
instead of spawning a fresh subagent. The pass-1 agent already knows every
item, AC, and dependency it wrote — pass 2 completes faster, needs no
re-exploration, and can self-flag issues rooted in pass-1 context (e.g., an
AC-count ceiling it designed against). The strict "MCP tools only, no
exploration" guardrails below exist only to compensate for a *fresh* agent's
amnesia — they become unnecessary once the same agent handles both passes.

```text
SendMessage(
  to: <face_pass1_agent_id>,   # the still-live agent from step 3
  message: "**THIS IS THE SECOND PASS.** Apply Sosa's refinements below.

  You already know every item, AC, and dependency you created in pass 1 —
  no need to re-explore the codebase or re-read items via the CLI unless
  something looks stale.

  Here is Sosa's refinement report:

  {sosa_report}

  For each item needing changes:
  1. Use ateam items updateItem to modify the item
  2. Apply the specific recommendations

  After all updates:
  1. Run ateam deps-check checkDeps --json to get the readyItems list
  2. Move items with NO dependencies to ready stage using ateam board-move moveItem
  3. Leave items WITH dependencies in briefings stage
  4. Record ADRs: if Sosa's report has a non-empty 'ADR Candidates' section,
     write each as adr/NNNN-*.md in the target repo per your ADR Recording
     procedure (Glob for the next number, Write the file). State the ADR
     outcome explicitly — files written, or exactly 'ADR Candidates: none.'

  Report what was updated and moved, including the ADR outcome."
)
```

**Fallback: fresh agent.** If the pass-1 agent is no longer available (e.g.,
its session ended), spawn a new Face subagent instead and keep the
anti-exploration guardrails, since a fresh agent genuinely has no context:

```
Agent(
  subagent_type: "ai-team:face",
  prompt: "You are Face from the A(i)-Team. [full face.md prompt]

  **THIS IS THE SECOND PASS.** Apply Sosa's refinements.

  **IMPORTANT: USE MCP TOOLS ONLY — one exception, ADR recording.**
  - DO NOT use Grep or Search tools, and DO NOT explore any codebase or
    directories to refine items — all information you need for that is in
    Sosa's report below
  - The ONLY permitted file access is ADR recording: if Sosa's report has a
    non-empty 'ADR Candidates' section, you MAY Glob('adr/*.md') to find the
    next number and Write the adr/NNNN-*.md files (per your ADR Recording
    procedure). This is the single carve-out to the no-Glob/no-Write rule.

  Here is Sosa's refinement report:

  {sosa_report}

  For each item needing changes:
  1. Use ateam items updateItem to modify the item
  2. Apply the specific recommendations

  After all updates:
  1. Run ateam deps-check checkDeps --json to get the readyItems list
  2. Move items with NO dependencies to ready stage using ateam board-move moveItem
  3. Leave items WITH dependencies in briefings stage
  4. Record ADRs: if Sosa's report has a non-empty 'ADR Candidates' section,
     write each as adr/NNNN-*.md per your ADR Recording procedure (the Glob/
     Write carve-out above). State the ADR outcome explicitly — files
     written, or exactly 'ADR Candidates: none.'

  Report what was updated and moved, including the ADR outcome."
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
| Face | Second | clean-code-architect | opus | Refine and move to ready — same live agent as pass 1 via `SendMessage` (default); fresh spawn only if the pass-1 agent is unavailable |
