# Hook Attribution Gap: Investigation & Fix

**Date:** 2026-04-06
**Mission:** M-20260406-006 (React Todo Client, test-harness project)
**Status:** Fixed

## Problem

When running missions with native teams mode (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), all pre/post tool-use hook events were attributed to `hannibal` instead of the actual agent (murdock, ba, lynch, amy, etc.). This broke:

1. **Per-agent telemetry** — the Kanban UI showed Hannibal making 1,590+ tool calls while teammates showed zero
2. **Token usage aggregation** — `POST /api/missions/{id}/token-usage` groups by `agentName`, so all teammate costs were lumped under Hannibal
3. **Observability** — no way to see which agent was doing what in real-time

Only Face and Sosa had correct-ish attribution (as `ai-team:face`, `ai-team:sosa`) because they run as legacy subagents where `hookInput.agent_type` is populated. Teammate idle events (`teammate_idle`) were correctly attributed because they come from a different code path.

## Evidence from M-20260406-006

```
agentName      eventType       count   has_tokens
hannibal       pre_tool_use    815     0
hannibal       post_tool_use   775     0
hannibal       stop            139     139
ai-team:face   pre_tool_use    53      0
ai-team:face   post_tool_use   44      0
ai-team:sosa   pre_tool_use    25      0
ai-team:sosa   post_tool_use   24      0
murdock-1      teammate_idle   13      0
ba-1           teammate_idle   13      0
...
```

815 + 775 = 1,590 tool-use events all under `hannibal`. These belong to murdock, ba, lynch, amy, stockwell, and tawnia.

## Root Cause

### How agent attribution works

`buildObserverPayload()` in `scripts/hooks/lib/observer.js` resolves the agent name via a fallback chain:

```js
// BEFORE fix
const agentName = agentNameArg || hookInput.agent_type || lookupAgent(sessionId) || 'hannibal';
```

1. **`agentNameArg`** — CLI arg from `process.argv[2]`, passed in agent frontmatter hooks (e.g., `observe-pre-tool-use.js murdock`)
2. **`hookInput.agent_type`** — stdin field set by Claude Code for legacy subagents
3. **`lookupAgent(sessionId)`** — temp file registry populated by `observe-subagent.js` on `SubagentStart`
4. **`'hannibal'`** — fallback

### Why all four steps fail for teammates

**Step 1 fails:** Agent frontmatter hooks are NOT applied to teammates. When Claude Code spawns a teammate via native teams, the teammate's frontmatter `hooks:` block is ignored. Instead, the parent session's hooks (Hannibal's) fire for all teammate tool calls. Hannibal's frontmatter passes `observe-pre-tool-use.js hannibal`, so `process.argv[2]` is always `'hannibal'`.

**Step 2 fails:** `hookInput.agent_type` is only set for legacy subagents (via `SubagentStart`/`SubagentStop` events). For native teammates, Claude Code uses `hookInput.teammate_name` instead (e.g., `'murdock-1'`). The observer never read this field.

**Step 3 fails:** `registerAgent(sessionId, agentName)` is called by `observe-subagent.js` on `SubagentStart`, which maps Hannibal's session ID to the subagent name. But teammate tool calls come from a different session ID than where `SubagentStart` registered, so the lookup misses.

**Step 4 kicks in:** Everything falls through to `'hannibal'`.

### The missing link

Claude Code DOES include `teammate_name` in the hook stdin JSON for all teammate events:

```json
{
  "teammate_name": "murdock-1",
  "tool_name": "Bash",
  "hook_event_name": "PreToolUse",
  "session_id": "<teammate-session-id>"
}
```

The `resolveAgent()` utility in `scripts/hooks/lib/resolve-agent.js` already handles this correctly — it reads both `agent_type` and `teammate_name`, strips the `ai-team:` prefix, strips the `-N` instance suffix for known agents, and normalizes to lowercase. Every enforcement hook (e.g., `block-murdock-impl-writes.js`) imports and uses `resolveAgent`. The observer hooks were the only ones that didn't.

## Fix

One-line change in `buildObserverPayload()`:

```js
// AFTER fix
import { resolveAgent } from './resolve-agent.js';

const agentName = agentNameArg || resolveAgent(hookInput) || lookupAgent(sessionId) || 'hannibal';
```

`resolveAgent(hookInput)` handles:

| Input | Result |
|---|---|
| `{ teammate_name: 'murdock-1' }` | `'murdock'` |
| `{ teammate_name: 'ai-team:ba-2' }` | `'ba'` |
| `{ agent_type: 'ai-team:face' }` | `'face'` |
| `{ agent_type: 'Lynch' }` | `'lynch'` |
| `{}` | `null` (falls through to next step) |

### Files changed

- `scripts/hooks/lib/observer.js` — import `resolveAgent`, replace `hookInput.agent_type` in fallback chain
- `scripts/hooks/__tests__/observe-hooks.test.ts` — added 3 teammate attribution tests, updated 2 existing tests to use realistic `agent_type` values (with `ai-team:` prefix)

## Impact on Token Usage

Token aggregation (`POST /api/missions/{id}/token-usage`) groups HookEvents by `agentName + model`. With the attribution gap:

- All teammate tokens were summed under `hannibal`
- Per-agent cost breakdown was meaningless
- The distinction between orchestration overhead and actual work was lost

After the fix, future missions will have correct per-agent token attribution. Historical missions (including M-20260406-006) cannot be retroactively fixed because the raw HookEvent rows were written with `agentName: 'hannibal'`.

## Secondary Finding: Token Aggregation Is Manual

`MissionTokenUsage` was empty for M-20260406-006 not because of a bug, but because `POST /api/missions/{id}/token-usage` was never called. This endpoint must be triggered explicitly — it is not auto-populated. The orchestration playbook should call it as part of post-mission cleanup.

## Secondary Finding: Stockwell Final Review Errors

Stockwell hit two errors trying to persist its final review:

1. **"No writeFinalReview command available"** — the CLI command exists (`ateam missions-final-review writeFinalReview`), but Stockwell couldn't find it. Likely a CLI binary version mismatch (the binary auto-updates based on `minCliVersion` in `plugin.json`, but the command may have been added after the cached binary version).

2. **`agentStop` requires `--itemId`** — Stockwell's final review is mission-level, not item-level. Stockwell resorted to `--itemId "FINAL-REVIEW"` as a workaround, which would fail or create garbage data. A `missions-complete` command would be the proper solution for mission-level lifecycle signaling.

## Lessons

1. **Test with the actual runtime mode.** The observer hooks were tested with CLI args and `agent_type`, which covers legacy subagent mode. Native teams mode uses different stdin fields (`teammate_name`) and a different hook execution model (parent session hooks fire, not agent frontmatter hooks). Both paths need coverage.

2. **Reuse existing utilities.** `resolveAgent()` was already written and tested. The enforcement hooks used it. The observer hooks should have used it from the start.

3. **Verify your assumptions about hook execution context.** The agent frontmatter declares hooks with agent-specific CLI args, which suggests each agent runs its own hooks. In native teams mode, this isn't true — the parent session runs all hooks, and the agent identity must be extracted from stdin.
