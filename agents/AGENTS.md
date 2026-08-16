# Agent Prompts

Defines behavior contracts for 12 A(i)-Team agents. Each `.md` file is a prompt loaded at dispatch time — not code, but the instructions that shape agent behavior. Does NOT contain implementation logic (that's in the `ateam` CLI binary).

## Frontmatter Contract

All agent files use YAML frontmatter:

```yaml
---
name: agent-name              # Identifier (required)
model: sonnet                  # Model: opus | sonnet | haiku (required)
description: Role summary     # (required)
permissionMode: acceptEdits   # Working agents that write files
skills:                        # Optional - skill files to load at dispatch time
  - skill-name
hooks:                         # Runtime enforcement (see below)
  PreToolUse: [...]
  PostToolUse: [...]           # Present on all agents (observer only)
  Stop: [...]
---
```

Hannibal also has `tools:` listing available tools. Model selection (`opus`/`sonnet`/`haiku`) is declared in YAML frontmatter via the `model:` key — Claude Code reads this natively at dispatch time. Do NOT pass `model:` at dispatch time; the frontmatter is the single source of truth.

The `skills:` key is optional and lists skill files (from `skills/`) to load when the agent is dispatched. Skills provide detailed guidance without bloating the base agent prompt.

### Current Skill Wiring

| Agent | Skills |
|-------|--------|
| **Murdock** | `test-writing` |
| **B.A.** | `defensive-coding`, `security-input` |
| **Lynch** | `test-writing`, `defensive-coding`, `security-input`, `code-patterns` |
| **Amy** | `defensive-coding` |
| **Frankie** | `ateam-cli`, `agent-lifecycle`, `teams-messaging`, `a11y`, `perspective-test` |
| **Stockwell** | `test-writing`, `defensive-coding`, `security-input`, `code-patterns` |

Skills live in `skills/<name>/SKILL.md`. The available skills are:
- **`test-writing`** — banned anti-patterns, the litmus test, and quality checklist for writing tests
- **`defensive-coding`** — guard patterns, null checks, async error recovery, resource cleanup
- **`security-input`** — input validation, SQL/XSS injection prevention, URL encoding rules
- **`code-patterns`** — naming, function design, type safety, async patterns, N+1 queries, API shapes

## Agent Boundaries

| Agent | Writes | Cannot Write | Hooks |
|-------|--------|-------------|-------|
| **Hannibal** | Orchestration only | `src/**`, tests | `block-hannibal-writes`, `block-raw-mv`, `enforce-final-review` |
| **Face** | Work items via ateam CLI | Tests, implementation | observers only |
| **Sosa** | Review reports | Work items directly | None |
| **Murdock** | Tests + types | Implementation code | `block-raw-echo-log`, `enforce-handoff` |
| **B.A.** | Implementation | Tests | Same as Murdock |
| **Lynch** | Review verdicts | Any code | Same as Murdock + `block-lynch-writes`, `block-lynch-browser` |
| **Stockwell** | Final review verdicts | Any code | `block-raw-echo-log`, `block-lynch-browser`, `enforce-completion-log` |
| **Amy** | Debug scripts only | Production code, tests | Same as Murdock + `track-browser-usage`, `enforce-browser-verification` |
| **Frankie** | Evidence bundle (`.qa-evidence/`), NEW `specs/` files | Implementation, tests, existing `specs/` files | `block-raw-echo-log`, `block-frankie-writes` |
| **Tawnia** | Docs (CHANGELOG, README) | `src/**`, tests | `block-raw-echo-log`, `enforce-completion-log` |

**Hooks enforce these boundaries at runtime.** Agents physically cannot violate them.

## Hook System

Scripts in `scripts/hooks/` run at lifecycle points. Exit code 0 = allow, non-zero = block.

**All agents** carry per-agent observer hooks in their frontmatter (non-blocking, for telemetry):
- `PreToolUse` → `observe-pre-tool-use.js <agent>` — logs every tool call with agent attribution
- `PostToolUse` → `observe-post-tool-use.js <agent>` — logs tool completions with agent attribution
- `Stop` → `observe-stop.js <agent>` — logs session end with agent attribution

These fire on every tool invocation and always exit 0 (never block). The agent name is passed as a CLI argument so the API can attribute activity to the right agent.

**Working agents** (Murdock, B.A., Lynch, Amy, Frankie, Stockwell, Tawnia) all share one enforcement hook in addition to the observers:
- `PreToolUse(Bash)` → `block-raw-echo-log.js` — forces `ateam activity createActivityEntry` instead of raw echo

Their **Stop** enforcement, though, splits three ways by role — there is no single completion hook they all carry:

| Agents | Stop hook | What it requires |
|--------|-----------|------------------|
| Murdock, B.A., Lynch, Amy | `enforce-handoff.js` | Both `ateam agents-stop agentStop` **and** the peer-to-peer handoff message. A strict superset of completion logging, so these four deliberately do *not* also carry `enforce-completion-log.js` (swapped in `1f143ce`). |
| Stockwell, Tawnia | `enforce-completion-log.js` | Blocks exit until `agentStop` is logged — terminal agents that hand off to nobody. |
| Frankie | *(observer only)* | Gated instead by the evidence-bundle check inside Hannibal's `enforce-final-review.js`. |

`enforce-completion-log.js` is **item-scoped**: it scrapes a `WI-XXX` id out of the agent's last message and asks the API for that item's `work_log`. That makes it a poor fit for mission-scoped agents, whose lifecycle ids are sentinels (`FRANKIE-WALK`, `FINAL-REVIEW`, `docs`) rather than item rows — the API answers `ITEM_NOT_FOUND` for those, and the hook fails open (see `prd/drafts/mission-phase-lifecycle.md`). Frankie omits it entirely because activating it would be worse than inert: his Failure Path *requires* him to name failing `WI-XXX` ids in his final message, so the hook would latch onto an unrelated item and block him for not logging against someone else's work. His completion gate reads the filesystem (`.qa-evidence/<mission>/report.md`) instead, which needs no item row. Stockwell keeps the hook registered but is likewise absent from its `TARGET_AGENTS` list, so it is currently a no-op for him too.

**Hannibal** has unique enforcement hooks:
- `PreToolUse(Write|Edit)` → `block-hannibal-writes.js` — prevents writing to source/test files
- `PreToolUse(Bash)` → `block-raw-mv.js` — prevents raw `mv` on mission files
- `Stop` → `enforce-final-review.js` — blocks exit until final review + post-checks pass

**Lynch** has additional hooks:
- `PreToolUse(Write|Edit)` → `block-lynch-writes.js` — blocks Lynch from writing or editing any project files; `/tmp/` and `/var/` are allowed as scratch space
- `PreToolUse(mcp__plugin_playwright_playwright__.*)` → `block-lynch-browser.js` — blocks Lynch from using any Playwright browser tools; browser-based verification is Amy's job, not the reviewer's

**Amy** has additional hooks:
- `PreToolUse(mcp__plugin_playwright)` → `track-browser-usage.js` — tracks Playwright tool usage without blocking; used for telemetry to verify Amy actually performed browser verification
- `PreToolUse(Skill)` → `track-browser-usage.js` — same tracking when Amy invokes browser via a Skill
- `Stop` → `enforce-browser-verification.js` — blocks Amy from completing without evidence of browser verification for UI features (checks work log for browser activity before allowing exit)

**Frankie** has an additional hook:
- `PreToolUse(Write|Edit)` → `block-frankie-writes.js` — blocks writes to implementation, tests, or existing `specs/` files; only his evidence bundle (`.qa-evidence/`) and NEW spec files are allowed. A mission-level agent (not per-feature) — runs once, after all items reach `staged` and before Stockwell's Final Mission Review. He reports failures to Hannibal rather than moving items himself — that boundary is enforced regardless of the fact that a real path out of `staged` exists now (Hannibal executes the move via a real `board-move`, using the earliest-flagged-stage rule).

## Dual-Registration Pattern

All enforcement hooks are registered at **both** levels:

1. **Agent frontmatter** (`agents/*.md`) — scoped to legacy subagent sessions; fires when the agent is dispatched as a background `Task` with `subagent_type`
2. **`hooks/hooks.json`** (plugin level) — fires for all sessions, including native teammate sessions where frontmatter may not apply

This is intentional for backward compatibility. Blocking is idempotent — an agent blocked by both levels is fine.

**Agent identity resolution:** All enforcement hooks use `resolveAgent()` from `scripts/hooks/lib/resolve-agent.js` to extract the agent name from hook stdin JSON:
- Reads `agent_type` first (e.g. `"ai-team:ba"` → `"ba"`)
- Falls back to `teammate_name` for native teams sessions
- Strips `ai-team:` prefix and lowercases
- Returns `null` for unidentifiable sessions (fail-open for all hooks except `enforce-orchestrator-boundary.js`)

## Shared Utilities

Hook scripts share utilities in `scripts/hooks/lib/`:

**`resolve-agent.js`** — canonical agent identification:
- `resolveAgent(hookInput)` — extracts agent name from Claude Code hook stdin JSON; returns lowercase agent name (e.g. `"ba"`, `"murdock"`) or `null`
- `isKnownAgent(name)` — checks against `KNOWN_AGENTS` list; use for fail-open on unknown/system agents (Explore, Plan, etc.)
- `KNOWN_AGENTS` — `['hannibal', 'face', 'sosa', 'murdock', 'ba', 'lynch', 'stockwell', 'amy', 'tawnia', 'frankie']`

**`send-denied-event.js`** — denied event telemetry:
- `sendDeniedEvent({ agentName, toolName, reason })` — fire-and-forget POST to API with `status: "denied"`
- All enforcement hooks call this before `process.exit(2)` (and before JSON block response for `block-raw-echo-log.js`)
- Events appear in Raw Agent View with status "denied"; silently ignores network failures

**`observer.js`** — observer utilities:
- `readHookInput()` — reads and parses stdin JSON
- `buildObserverPayload()` / `sendObserverEvent()` — for telemetry POSTs
- `registerAgent()` / `unregisterAgent()` / `lookupAgent()` — agent map for SubagentStart/Stop tracking

## Dispatch Modes

Agents are dispatched differently based on `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`:

| Mode | Dispatch | Completion Signal | Orchestration |
|------|----------|-------------------|---------------|
| **Legacy** (default) | `Task(subagent_type: "ai-team:murdock", run_in_background: true)` | `ateam agents-stop agentStop`, Hannibal polls `TaskOutput` | `playbooks/orchestration-legacy.md` |
| **Native teams** (`=1`) | `TeamCreate` + `Task(team_name, name)` | `ateam agents-stop agentStop` + `SendMessage` to Hannibal | `playbooks/orchestration-native.md` |

In both modes, `ateam` CLI commands are the source of truth. Communication tools are for coordination only.

## Patterns

**Modifying an agent file:**
1. Keep hook consistency — working agents MUST have both `PreToolUse` and `Stop` hooks
2. Maintain explicit "Do NOT" sections listing forbidden operations
3. All agents must call `ateam agents-start agentStart` / `ateam agents-stop agentStop` (enforced by Stop hook)
4. Communication sections must use `SendMessage` (not the old `TeammateTool` API)

**Pipeline flow (all stages mandatory):**
```
briefings → ready → testing → implementing → review → probing → staged
                      Murdock    B.A.          Lynch    Amy
```
`staged` is the per-item pipeline's real terminal stage (WI-786/787). Then: Frankie (mission-tail QA walk, evidence bundle + graduated specs; skipped on repos whose execution contract declares no drivable surface — see `scripts/hooks/lib/qa-contract.js`) → Final Review (Stockwell, opus, PRD+diff, includes Frankie's evidence) → an APPROVED verdict atomically promotes every `staged` item to `done` (WI-790) → Post-Checks → Documentation (Tawnia, haiku) → Complete. A Stockwell rejection moves the named items out of `staged` via the earliest-flagged-stage rule and restarts the tail at Frankie once they're back in `staged`, not at Post-Checks.

## Related Context

- Hook scripts: `scripts/hooks/`
- Orchestration playbooks: `playbooks/orchestration-{legacy,native}.md`
- Dispatch commands: `commands/run.md`, `commands/resume.md`
- ateam CLI reference: `packages/ateam-cli/README.md`
