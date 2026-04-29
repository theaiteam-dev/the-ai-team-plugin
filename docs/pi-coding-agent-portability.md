# Pi Coding Agent Portability Research

Research into porting the A(i)-Team plugin to Pi Coding Agent for local model support.

**Date:** 2026-04-27 (updated 2026-04-28)
**Status:** Research / exploration

## Why Pi

Pi is the strongest candidate for running A(i)-Team with local models. It supports 75+ providers (Anthropic, OpenAI, Google, Ollama, etc.), has an agent file format nearly identical to Claude Code's, and its extension system is more capable than Claude Code's hooks. The core is intentionally minimal (4 built-in tools: read, write, edit, bash) with everything else added through extensions and packages.

## Agent File Format Comparison

Pi agent definitions are markdown files with YAML frontmatter — same pattern as ours.

| Field | Claude Code (ours) | Pi | Notes |
|-------|-------------------|-----|-------|
| `name` | Yes | Yes (filename) | Filename becomes agent type name in Pi |
| `model` | `opus` / `sonnet` / `haiku` | Any provider/model string | Pi advantage: `anthropic/claude-opus-4-6`, `ollama/llama3`, etc. |
| `description` | Yes | Yes | Same |
| `tools` | Yes | Yes | Pi: `read, grep, find, bash` etc. |
| `permissionMode` | Yes | No equivalent | Pi uses extension-level permission gates instead |
| `skills` | Yes — loads skill files at dispatch | **Not per-agent** | Gap: skills are global to session. See "Open PR" below. |
| `hooks` | Yes — PreToolUse/PostToolUse/Stop | No frontmatter hooks | Handled via TypeScript extensions instead. See "Hook Bridge" below. |
| `thinking` | No | Yes (low/medium/high) | Pi-specific |
| `max_turns` | No | Yes | Pi-specific |

The system prompt body is the markdown content below the frontmatter — identical pattern.

### Frontmatter Compatibility

Pi ignores unknown frontmatter keys (logs warnings but loads the file). This means **our agent files work on both harnesses as-is** — Pi reads `name`, `model`, `description`, `tools` and the body; silently skips `hooks:`, `permissionMode:`, `skills:`.

Relevant Pi issues:
- [#1235](https://github.com/badlogic/pi-mono/issues/1235) — Suppress warnings for Claude Code extended frontmatter fields (people already sharing files across harnesses)
- [#338](https://github.com/badlogic/pi-mono/issues/338) — Feature request to support hooks in agent frontmatter (exactly what we already have)

This eliminates the need for separate agent files or a build step. One set of `.md` files, both harnesses read them.

## Hook System Comparison

Claude Code uses shell-script hooks declared in agent frontmatter and `settings.json`. Pi uses a TypeScript extension system with 27 typed events.

### Event Mapping

| Our hook pattern | Pi equivalent |
|---|---|
| `PreToolUse` → exit non-zero to block | `tool_call` → return `{ block: true, reason }` |
| `PostToolUse` → observer telemetry | `tool_result` → fire-and-forget API POST |
| `Stop` → enforce lifecycle completion | `agent_end` event |
| Matcher pattern (e.g. `Write\|Edit`) | Filter on `event.toolName` in handler |

### Pi Advantages Over Claude Code Hooks

- **Input mutation**: Can modify tool arguments before execution (Claude Code can't)
- **Result modification**: Can alter tool output after execution
- **UI interaction**: Extensions can show confirm dialogs, select menus, notifications
- **More lifecycle events**: 27 events vs 3 hook points (turn_start/end, before_agent_start, session lifecycle, LLM request/response, etc.)
- **Hot reload**: `/reload` command picks up extension changes without restart
- **System prompt injection**: `before_agent_start` can modify/replace the system prompt at runtime

### Pi Disadvantage

- Must write TypeScript, not arbitrary shell scripts (though `pi.exec()` lets you shell out)

## Hook Bridge Strategy

Our existing hooks are Node scripts that read stdin JSON and use exit codes. We don't need to rewrite them — we write thin Pi extension wrappers.

**One generic wrapper function:**

```typescript
import { execSync } from "child_process";

function wrapHook(matcher: RegExp, hookScript: string) {
  pi.on("tool_call", async (event) => {
    if (!matcher.test(event.toolName)) return;
    try {
      execSync(`node ${hookScript}`, {
        input: JSON.stringify(event),
        encoding: "utf-8",
      });
    } catch (e) {
      return { block: true, reason: e.stderr?.toString() || "Blocked by hook" };
    }
  });
}

// Register all enforcement hooks
wrapHook(/^(write|edit)$/, `${PLUGIN_ROOT}/scripts/hooks/block-murdock-impl-writes.js`);
wrapHook(/^(write|edit)$/, `${PLUGIN_ROOT}/scripts/hooks/block-hannibal-writes.js`);
wrapHook(/^bash$/, `${PLUGIN_ROOT}/scripts/hooks/block-raw-mv.js`);
// etc.
```

**Observer hooks** (telemetry) use `tool_result` events with fire-and-forget `pi.exec()` calls to existing observer scripts.

**Stop hooks** (enforce-handoff, enforce-final-review) use `agent_end` events.

The hook scripts themselves don't change. The bridge layer translates between Pi's `{ block: true }` convention and our exit-code convention.

### Open Question: Agent Identity Resolution

Our hooks use `resolveAgent()` to extract agent name from Claude Code's hook stdin JSON (`agent_type`, `teammate_name` fields). Pi's event objects have different shapes. The bridge layer needs to inject agent identity into the stdin JSON so `resolveAgent()` works, or we add a Pi-specific resolver.

## Skills System

Pi has skills — same concept as ours. Directory with `SKILL.md`, YAML frontmatter (`name`, `description`), markdown body. Discovery from `~/.pi/agent/skills/`, `.pi/skills/`, npm packages, or git repos.

**Gap:** Skills are global to a session. No declarative `skills:` key in agent frontmatter. Our agents wire specific skills per role (Murdock gets `test-writing` + `tdd-workflow`, B.A. gets `defensive-coding` + `security-input`).

**Workarounds:**
1. SDK's `skillsOverride` callback on `DefaultResourceLoader` can filter skills per session programmatically
2. Bake skill content into agent system prompts directly (loses the clean separation)
3. Open a PR to Pi — see below

## Open PR: Per-Agent Skills

The infrastructure already exists in Pi:
- Skills exist with discovery + loading + prompt formatting
- Sub-agents are separate `pi` processes with their own sessions
- `skillsOverride` callback already filters skills programmatically

The missing piece: a `skills:` key in agent markdown frontmatter that feeds into `skillsOverride` during session creation. When loading an agent `.md`, if frontmatter has `skills: [test-writing, defensive-coding]`, filter the `ResourceLoader` to only inject those skills.

This is a small, well-scoped PR. Touches the agent file parser and session creation path. Connects two things that already exist but aren't wired together.

## Sub-Agent Dispatch

Pi sub-agents are separate `pi --mode rpc` child processes. Two modes:

- **`spawn`**: Child gets only the task string. Isolated, reproducible. Lower token cost.
- **`fork`**: Child gets forked snapshot of current session context + task string. For follow-up work needing prior context.

Maps to our dispatch patterns:
- Hannibal dispatching Murdock/B.A./Lynch = `spawn` mode (isolated workers)
- Re-dispatching B.A. after rejection with context = `fork` mode or `spawn` with explicit context in prompt

## Dual-Harness Strategy

The goal is **one plugin that works on both Claude Code and Pi** — not a fork, not a build step.

### What's Already Shared (zero changes)

- **10 agent files** — frontmatter + system prompt body. Pi ignores unknown keys, Claude Code ignores unknown keys. Same files.
- **13 skill files** — `SKILL.md` format is identical across harnesses.
- **29 hook scripts** — Node scripts with stdin JSON + exit codes. Called natively by Claude Code, called via bridge extension on Pi.
- **`scripts/hooks/lib/`** — shared utilities including `resolveAgent()`, `sendDeniedEvent()`, `observer.js`.
- **ateam CLI** — all agent interactions (agentStart, agentStop, board-move, etc.) go through bash. Works identically on both harnesses.
- **Pipeline logic** — stage rules, TDD workflow, agent boundaries, wave management, WIP limits, rejection handling.

### The Harness-Specific Surface: 3 Functions

Analysis of the playbooks and commands shows the entire harness coupling reduces to **three abstract operations**:

| Operation | Claude Code | Pi |
|-----------|-------------|-----|
| **dispatch(agent, item)** | `Task(subagent_type: "ai-team:{agent}", run_in_background: true, ...)` | `subagent({ type: "{agent}", mode: "spawn", ... })` |
| **poll(task_id)** | `TaskOutput(task_id, block: false, timeout: 500)` | Event-driven — `subagent:async-complete` event, no polling |
| **message(to, content)** | `SendMessage(to: "{to}", content: "{content}")` | `pi_messenger({ action: "send", to: "{to}", message: "{content}" })` |

Plus team lifecycle (`TeamCreate`/`TeamDelete` on Claude Code, no equivalent needed on Pi — pi-messenger handles registration automatically).

### Playbook Approach: Dispatch Adapter Header

Instead of maintaining two playbook versions, each playbook gets a **dispatch adapter header** that maps abstract operations to concrete harness calls. The orchestration logic uses the abstract names.

```
# ═══════════════════════════════════════════════════════════
# DISPATCH ADAPTER (set by harness detection at mission start)
# ═══════════════════════════════════════════════════════════
#
# Claude Code:
#   dispatch(agent, item) → Task(subagent_type: "ai-team:{agent}", run_in_background: true, ...)
#   poll(task_id)          → TaskOutput(task_id, block: false, timeout: 500)
#   message(to, content)   → SendMessage(to: "{to}", content: "{content}")
#   team_setup()           → TeamCreate(team_name: "mission-{id}", ...)
#   team_teardown()        → TeamDelete()
#
# Pi:
#   dispatch(agent, item) → subagent({ type: "{agent}", mode: "spawn", ... })
#   poll(task_id)          → (event-driven, no polling — subagent:async-complete)
#   message(to, content)   → pi_messenger({ action: "send", to: "{to}", message: "{content}" })
#   team_setup()           → (no-op — pi-messenger auto-registers)
#   team_teardown()        → (no-op — agents deregister on shutdown)
```

The rest of the playbook — phases, wave management, rejection handling, pre/post checks, final review, Tawnia dispatch — stays identical.

### Concrete Counts

Measured from the actual codebase:

| File set | Harness-coupled references | Total lines |
|----------|---------------------------|-------------|
| `orchestration-legacy.md` | 42 (`Task`, `TaskOutput`, `subagent_type`, `run_in_background`) | ~400 |
| `orchestration-native.md` | 79 (`Task`, `SendMessage`, `TeamCreate`, `TeamDelete`, `team_name`, `subagent_type`) | ~700 |
| Commands (7 files) | 9 total references | ~300 |

The playbook bodies are 90%+ pipeline logic. The dispatch calls are sprinkled through, not concentrated.

### What Needs Work

| Gap | Effort | Approach |
|-----|--------|----------|
| Per-agent skills | Small | PR to Pi upstream ([#338](https://github.com/badlogic/pi-mono/issues/338) is related) |
| `permissionMode` equivalent | Small | Extension that auto-accepts edits per agent |
| Hook bridge extension | Medium | One TypeScript file, ~100-150 lines, wraps all 29 hooks |
| Agent identity in Pi events | Small | Shim in bridge that maps Pi event shape to our `resolveAgent()` format |
| Dispatch adapter in playbooks | Medium | Abstract the 3 operations, add harness-specific header |
| Command adapters | Small | 9 references across 7 files — mechanical substitution |
| Pi packaging | Small | `package.json` with `pi` key alongside existing `.claude-plugin/` |

## Inter-Agent Messaging

Pi core has **no built-in inter-agent messaging**. Sub-agents (pi-subagents) are strictly parent-child — children can't talk to siblings. Three community extensions fill the gap:

### pi-messenger (best fit for our pattern)

File-based peer-to-peer mesh. Agents register in `~/.pi/agent/messenger/` and can send direct messages by name or broadcast to all peers. Messages wake recipients mid-task via Pi's steering queue (`pi.sendMessage()` with `deliverAs: "steer"`).

| Feature | Details |
|---------|---------|
| Direct messages | `pi_messenger({ action: "send", to: "Amy", message: "..." })` |
| Broadcasts | `pi_messenger({ action: "broadcast", message: "..." })` — FYI/ALERT pattern |
| File reservations | `reserve`/`release` actions claim files/dirs, enforced via `tool_call` blocking |
| Mid-task delivery | Messages injected as steering between turns, not queued until completion |
| Presence | Auto-detection of active/idle/away/stuck agents with dead agent cleanup |

**Maps to our native teams pattern:**
- Lynch sends START directly to Amy by name (direct message)
- Hannibal receives FYI/ALERT via broadcast or direct message
- Messages arrive mid-task via steering, not just at agent completion
- File reservations prevent conflicts (similar to Claude Code's worktree isolation)

### pi-intercom

Local IPC broker over Unix sockets. Any named session can `send` (fire-and-forget) or `ask` (blocks until reply) another session. Better for structured 1:1 planner-worker patterns than multi-agent mesh.

### pi-subagents

Parent-child only. No sibling communication. Optional pi-intercom companion adds a channel back to the parent. Not sufficient for our peer-to-peer handoff pattern.

### Recommendation

Use **pi-messenger** for inter-agent communication. It's the only option that supports the full mesh topology our native teams mode needs (peer-to-peer + broadcast + mid-task delivery). The file-based approach is simple and debuggable — you can `cat` an agent's inbox to see pending messages.

## Shared Task Board / Work Item Tracking

**Pi adds nothing to persistent work item tracking. The ateam CLI remains the sole source of truth.**

Pi core deliberately has no task tools ("No built-in to-dos. They confuse models."). Community extensions are all file-backed and local:

| Extension | Storage | Persistent? | Cross-Session? |
|-----------|---------|-------------|----------------|
| pi-tasks | `.pi/tasks/tasks.json` | Yes (file) | Yes (project scope) |
| pi-messenger Crew | `.pi/messenger/crew/` | Yes (file) | Yes |
| taskplane | `PROMPT.md` + `STATUS.md` per task | Yes (file) | Yes (within batch) |
| pi-subagents | Temp dirs, 24hr TTL | No | No |

None provide a networked, database-backed system. They solve "multiple agents in one project coordinating on files" — not durable organizational tracking across sessions and machines.

**Our ateam CLI** (API + database) handles: work item creation, stage transitions, agent claims, work logs, WIP limits, dependency waves, activity feeds, token usage tracking, and the Kanban UI. All accessed via `bash` tool calls, which work identically from Pi's bash tool. No changes needed.

Pi's native `TaskCreate`/`TaskList` equivalent (pi-tasks) could replace Claude Code's ephemeral native tasks for Hannibal's orchestration milestones, but that's optional — the ateam board is what matters.

## What We Gain

- **Local model support**: Run pipeline workers on Ollama/vLLM models, keep orchestrator on Claude
- **Mixed model teams**: Different providers per agent role (cheap local model for B.A., Claude for Lynch review)
- **No vendor lock-in**: Same agent definitions, same hooks, portable across providers
- **Richer extension API**: Input mutation, result modification, UI interaction, hot reload

## Effort Estimate

| Work item | Effort | Dependency |
|-----------|--------|------------|
| Hook bridge extension | 1 day | None |
| Dispatch adapter headers for playbooks | 1-2 days | None |
| Command adapter (9 refs, 7 files) | Half day | None |
| Pi packaging (`package.json` with `pi` key) | Half day | None |
| Single-agent smoke test (Murdock on local model) | 1 day | Hook bridge |
| Full pipeline end-to-end with pi-messenger | 2-3 days | All above |
| PR to Pi: per-agent `skills:` frontmatter | 1 day | None (can parallel) |

**Total: ~1 week focused work.** First working single-agent test in 1-2 days. The long pole is end-to-end testing with pi-messenger handling peer handoffs.

## Next Steps

1. Open PR to Pi for per-agent `skills:` frontmatter key
2. Build hook bridge extension (one file, wraps all 29 existing hooks)
3. Add dispatch adapter headers to playbooks (abstract 3 operations)
4. Add Pi packaging alongside existing `.claude-plugin/`
5. Smoke test: single Murdock dispatch on Pi with local model
6. Install pi-messenger, validate peer-to-peer messaging maps to our SendMessage/FYI/ALERT pattern
7. Full pipeline end-to-end test on Pi
