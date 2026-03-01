# Agent Prompts

Defines behavior contracts for 8 A(i)-Team agents. Each `.md` file is a prompt loaded at dispatch time — not code, but the instructions that shape agent behavior. Does NOT contain implementation logic (that's in `packages/mcp-server/`).

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

The `skills:` key is optional and lists skill files (from `skills/`) to load when the agent is dispatched. For example, Murdock includes `test-writing` and `tdd-workflow` to pull in detailed testing guidance without bloating the base agent prompt.

## Agent Boundaries

| Agent | Writes | Cannot Write | Hooks |
|-------|--------|-------------|-------|
| **Hannibal** | Orchestration only | `src/**`, tests | `block-hannibal-writes`, `block-raw-mv`, `enforce-final-review` |
| **Face** | Work items via MCP | Tests, implementation | observers only |
| **Sosa** | Review reports | Work items directly | None |
| **Murdock** | Tests + types | Implementation code | `block-raw-echo-log`, `enforce-completion-log` |
| **B.A.** | Implementation | Tests | Same as Murdock |
| **Lynch** | Review verdicts | Any code | Same as Murdock + `block-lynch-writes`, `block-lynch-browser` |
| **Lynch-Final** | Final review verdicts | Any code | Same as Lynch (per-feature) |
| **Amy** | Debug scripts only | Production code, tests | Same as Murdock + `track-browser-usage`, `enforce-browser-verification` |
| **Tawnia** | Docs (CHANGELOG, README) | `src/**`, tests | Same as Murdock |

**Hooks enforce these boundaries at runtime.** Agents physically cannot violate them.

## Hook System

Scripts in `scripts/hooks/` run at lifecycle points. Exit code 0 = allow, non-zero = block.

**All agents** carry per-agent observer hooks in their frontmatter (non-blocking, for telemetry):
- `PreToolUse` → `observe-pre-tool-use.js <agent>` — logs every tool call with agent attribution
- `PostToolUse` → `observe-post-tool-use.js <agent>` — logs tool completions with agent attribution
- `Stop` → `observe-stop.js <agent>` — logs session end with agent attribution

These fire on every tool invocation and always exit 0 (never block). The agent name is passed as a CLI argument so the API can attribute activity to the right agent.

**Working agents** (Murdock, B.A., Lynch, Amy, Tawnia) all share enforcement hooks in addition to the observers:
- `PreToolUse(Bash)` → `block-raw-echo-log.js` — forces MCP `log` tool instead of raw echo
- `Stop` → `enforce-completion-log.js` — blocks exit until `agent_stop` MCP tool is called

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
- `KNOWN_AGENTS` — `['hannibal', 'face', 'sosa', 'murdock', 'ba', 'lynch', 'lynch-final', 'amy', 'tawnia']`

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
| **Legacy** (default) | `Task(subagent_type: "ai-team:murdock", run_in_background: true)` | `agent_stop` MCP tool, Hannibal polls `TaskOutput` | `playbooks/orchestration-legacy.md` |
| **Native teams** (`=1`) | `TeamCreate` + `Task(team_name, name)` | `agent_stop` + `SendMessage` to Hannibal | `playbooks/orchestration-native.md` |

In both modes, MCP tools are the source of truth. Communication tools are for coordination only.

## Patterns

**Modifying an agent file:**
1. Keep hook consistency — working agents MUST have both `PreToolUse` and `Stop` hooks
2. Maintain explicit "Do NOT" sections listing forbidden operations
3. All agents must call `agent_start`/`agent_stop` MCP tools (enforced by Stop hook)
4. Communication sections must use `SendMessage` (not the old `TeammateTool` API)

**Pipeline flow (all stages mandatory):**
```
briefings → ready → testing → implementing → review → probing → done
                      Murdock    B.A.          Lynch    Amy
```
Then: Final Review (Lynch-Final, opus, PRD+diff) → Post-Checks → Documentation (Tawnia, haiku) → Complete.

## Related Context

- Hook scripts: `scripts/hooks/`
- Orchestration playbooks: `playbooks/orchestration-{legacy,native}.md`
- Dispatch commands: `commands/run.md`, `commands/resume.md`
- MCP tools that agents call: `packages/mcp-server/AGENTS.md`
