# PRD: Native Teams Hook Enforcement

**Version:** 1.0.0
**Status:** Draft
**Author:** Josh / Claude
**Date:** 2026-02-24
**Package:** Plugin hooks + `scripts/hooks/`

---

## 1. Overview

### 1.1 Background

The A(i)-Team enforces agent boundaries through two hook systems:

1. **Plugin-level hooks** (`hooks/hooks.json`) — fire for every session where the plugin is enabled. Currently used for observer/telemetry hooks that record tool calls to the API. These hooks cannot be blocked by agents and always fire.

2. **Agent frontmatter hooks** (e.g., `agents/amy.md` YAML frontmatter) — fire only within the agent's subagent context. Currently used for all enforcement hooks (`block-amy-writes.js`, `block-worker-board-claim.js`, etc.) that prevent agents from violating their role boundaries.

The A(i)-Team supports two dispatch modes: **legacy mode** (background `Task` + `TaskOutput` polling) and **native teams mode** (`TeamCreate` + `SendMessage`). In legacy mode, each agent runs as a subagent within the main Claude context, and its frontmatter hooks fire correctly. In native teams mode, agents run as teammates in a different execution context where **only plugin-level hooks fire**.

### 1.2 Problem Statement

All agent boundary enforcement is ineffective in native teams mode. Enforcement hooks are defined exclusively in agent frontmatter, but **frontmatter hooks do not fire when agents run as teammates** via `Task` with `team_name`.

**Evidence (proven by audit of kindredshelf project, PRD-0008 mission):**

- **1:1 pre/post event ratio** across all worker agents (Amy 42:42, B.A. 93:85, Lynch 43:36, Murdock 34:33). If both plugin-level and frontmatter observer hooks fired, the ratio would be ~2:1. The 1:1 ratio proves only plugin-level hooks fire for teammates.
- **Zero duplicate events** at matching timestamps — each tool call produces exactly one hook event, not two.
- **`hookInput.agent_type`** is set to the teammate's clean name (e.g., `"murdock"`, not `"ai-team:murdock"`) in the stdin JSON, confirming the plugin-level observer uses this field (not a CLI argument from frontmatter) to attribute events.
- The one plugin-level enforcement hook (`enforce-orchestrator-boundary.js`) explicitly skips teammates: `if (hookInput.agent_type) { process.exit(0); }`.

This audit revealed:

1. **Zero boundary violations were blocked.** Across 13,800+ hook events, exactly 0 were denied. Observer hooks recorded every tool call, but enforcement hooks never fired to block prohibited actions.

2. **Agents violated role boundaries undetected.** Specific violations observed in a single mission run:
   - **Lynch** (reviewer) edited `lib/env.ts` — reviewers must not write code
   - **Amy** (investigator) edited `__tests__/middleware.test.ts` — investigators must not write project files
   - **Hannibal** (orchestrator) edited `.env.example` — orchestrators must not edit project files
   - **B.A., Lynch, and Amy** each used `board_claim` directly (8 total calls) — workers must use `agent_start`

3. **The TDD pipeline's integrity guarantee is undermined.** The entire value proposition of the A(i)-Team depends on agents staying in their lanes: Murdock writes tests, B.A. implements, Lynch reviews without modifying. Without enforcement, any agent can do anything, and the pipeline provides no stronger guarantees than a single agent working alone.

### 1.3 Business Context

The A(i)-Team is moving toward native teams mode as the primary dispatch mechanism. It provides better UX (real-time teammate visibility in Claude Code), simpler orchestration (message-passing vs. polling), and is the direction Anthropic is investing in. Legacy mode will eventually be deprecated.

If enforcement only works in legacy mode, users adopting native teams mode lose all safety guarantees without knowing it. This is worse than having no enforcement at all — users believe boundaries are enforced when they aren't, leading to silent quality degradation of mission outputs.

The hook audit that revealed this was the first mission run with telemetry enabled in native teams mode. Every previous native teams run had the same vulnerability — it was simply undetectable without the observer infrastructure from PRD-005.

### 1.4 Scope

**In Scope:**
- Registering enforcement hooks in plugin-level `hooks/hooks.json` so they fire for native teammates
- Adding agent-name guards to each enforcement hook (read `hookInput.agent_type` from stdin to determine which agent is running — this field is already populated by Claude Code for both subagent and teammate sessions)
- Recording denied events in the API (so the Raw Agent View shows blocked violations)
- Closing identified coverage gaps (Lynch Write/Edit, Hannibal non-`src/` writes)
- Tests proving enforcement works in both dispatch modes

**Out of Scope:**
- Building a session-to-agent mapping system (not needed — `hookInput.agent_type` already provides the agent name in the stdin JSON)
- Changing enforcement hook logic beyond adding the agent-name guard (the path-checking logic in `block-*.js` scripts is correct)
- Modifying Claude Code's hook system itself (we work within the existing hook contract)
- Deprecating agent frontmatter hooks (they should continue working for legacy mode compatibility)
- Adding new boundary rules beyond closing identified gaps
- Runtime enforcement configuration (e.g., toggling rules per mission)

---

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Block boundary violations in native teams | Violations blocked / violations attempted | 100% (currently 0%) |
| Record denied events in API | Denied events visible in Raw Agent View | Yes (currently absent) |
| Close enforcement coverage gaps | Agents with complete hook coverage | 8/8 (currently 6/8 — Lynch and Hannibal have gaps) |
| Maintain legacy mode enforcement | Existing frontmatter hooks still fire in legacy mode | No regressions |
| No false positives | Legitimate tool calls incorrectly blocked | 0 |

**Negative metric (must NOT degrade):**
- Agent execution speed shall not be measurably affected. Enforcement hooks shall complete within 100ms. A slow or failed enforcement check shall not block the agent indefinitely.

---

## 3. User Stories

**As a mission operator** running a native teams mission, **I want** agent boundaries enforced the same as in legacy mode **so that** I can trust the TDD pipeline produces quality results regardless of dispatch mode.

**As a mission operator** viewing the Raw Agent View, **I want** to see denied events when agents attempt boundary violations **so that** I can verify enforcement is active and understand what was blocked.

**As a plugin developer** adding new enforcement rules, **I want** a single registration point for hooks **so that** I don't need to add rules in two places (frontmatter + hooks.json) and risk them drifting.

---

## 4. Requirements

### 4.1 Agent Identification

Claude Code already provides agent identity in the hook stdin JSON. No new mapping infrastructure is needed.

1. Enforcement hooks shall read `hookInput.agent_type` from stdin to determine the active agent. In native teams mode, this contains the teammate's clean name (e.g., `"murdock"`). In legacy subagent mode, this contains the `subagent_type` (e.g., `"ai-team:murdock"`). For the main session (Hannibal), this field is absent.
2. Enforcement hooks shall also check `hookInput.teammate_name` as a fallback identifier for native teammates.
3. Enforcement hooks shall normalize agent names by stripping the `ai-team:` prefix if present (matching the pattern in `observe-subagent.js` line 26).
4. If neither `agent_type` nor `teammate_name` is set and the session is not the main session, the hook shall fail-open (exit 0).

### 4.2 Plugin-Level Enforcement Registration

5. All enforcement hooks currently in agent frontmatter shall also be registered in `hooks/hooks.json`.
6. Each enforcement hook shall check the resolved agent name before applying rules — a Write block for Amy shall not block B.A.'s legitimate writes. The existing `enforce-orchestrator-boundary.js` demonstrates this pattern.
7. Enforcement hooks shall use appropriate matchers to minimize unnecessary invocations (e.g., `Write|Edit` matcher for write-blocking hooks, not a catch-all).
8. The `hooks/hooks.json` registration shall not remove hooks from agent frontmatter — both registration points shall coexist for backward compatibility with legacy mode.

### 4.3 Denied Event Recording

9. When an enforcement hook blocks a tool call, it shall POST a hook event to the API with `status: "denied"`.
10. The denied event shall include: `agentName`, `toolName`, `eventType`, and a human-readable `summary` explaining why the action was blocked.
11. Denied events shall appear in the Raw Agent View alongside normal tool call events.

### 4.4 Coverage Gap Fixes

12. Lynch shall have a `PreToolUse(Write|Edit)` enforcement hook that blocks all file writes. Lynch is a reviewer and shall not modify any files.
13. Hannibal's write-blocking hook shall block writes to all project files, not only `src/**`. The orchestrator delegates all file modifications to subagents — no path should be writable by Hannibal.

### 4.5 Non-Functional Requirements

14. Enforcement hooks shall complete within 100ms per invocation.
15. If `agent_type` and `teammate_name` are both absent from stdin (unrecognized session), the enforcement hook shall allow the action (fail-open) — not block legitimate work.
16. Denied event POSTing to the API shall be fire-and-forget. A failed POST shall not block the agent or delay the denial response to Claude Code.

---

## 5. Edge Cases & Error States

- **Missing `agent_type` in stdin:** If Claude Code changes its hook contract and stops providing `agent_type` for teammates, enforcement hooks lose agent identity. The hook shall fail-open (exit 0) when it cannot determine the agent. This preserves the current behavior (no enforcement) rather than blocking everything.
- **Explore/Plan subagents:** Agents like Explore and Plan appear in telemetry with `agent_type` set (e.g., `"Explore"`, `"Plan"`). Enforcement hooks shall skip agent names that don't match any known A(i)-Team agent (no block, no warning).
- **Legacy mode `ai-team:` prefix:** In legacy subagent mode, `agent_type` is `"ai-team:murdock"`. In native teams mode, it's `"murdock"`. Enforcement hooks shall handle both formats by stripping the `ai-team:` prefix before matching.
- **Hook script crashes:** If an enforcement hook exits with a non-zero code due to a bug (not an intentional block), Claude Code interprets it as a block. Enforcement scripts shall wrap logic in try/catch and exit 0 (allow) on unexpected errors, reserving non-zero exit only for intentional denials.
- **Duplicate enforcement in legacy mode:** When frontmatter hooks are retained alongside plugin-level hooks, both may fire for legacy subagent sessions. Blocking is idempotent (two blocks = same result as one), so this is harmless. However, denied events should be deduplicated or at least clearly labeled by source to avoid confusion in the Raw Agent View.
- **Hannibal editing non-source project files:** The current `enforce-orchestrator-boundary.js` blocks `src/`, test files, and common source directories but misses project root files (`.env.example`, `Dockerfile`, `docker-compose.yml`, etc.). The expanded check must define an allowlist of paths Hannibal CAN write (e.g., `mission/`, `briefings/`, config files the orchestrator manages) rather than a blocklist of source directories.

---

## 6. Dependencies

- **Claude Code hook contract:** We depend on Claude Code (a) processing `hooks/hooks.json` entries for all sessions including teammates, (b) providing `agent_type` and/or `teammate_name` in the stdin JSON for teammate sessions, and (c) respecting non-zero exit codes (exit 2) as blocks. All three behaviors are confirmed working by the PRD-0008 audit (observers fire, agent identity is present, `enforce-orchestrator-boundary.js` blocks Hannibal writes to `src/`).
- **Raw Agent View UI (PRD-005):** The UI already displays hook events. Denied events need to appear with visual differentiation (red badge, "DENIED" label) — this may already be implemented based on the seed data spec (WI-078 included 3 denied events in seed data).
- **Existing enforcement scripts:** The `block-*.js` scripts contain correct enforcement logic. Only the registration (frontmatter → plugin-level) and agent-name guard need to change.

---

## 7. Risks & Open Questions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| False positives block legitimate agent work | Medium | High — mission stalls | Extensive test coverage; fail-open on errors; `ATEAM_ENFORCEMENT=off` env var bypass |
| Duplicate enforcement in legacy mode (frontmatter + plugin) | Low | Low — double-block is harmless | Both hooks fire but blocking is idempotent |
| `agent_type` field changes in future Claude Code version | Low | High — enforcement breaks | Fail-open on missing identity; test against Claude Code updates |
| Hannibal allowlist too restrictive | Medium | Medium — blocks legitimate orchestrator work | Start with known-safe paths, iterate based on mission runs |

### Open Questions

- [ ] Should enforcement hooks in `hooks/hooks.json` replace or supplement frontmatter hooks? Supplementing is safer for backward compatibility but means maintaining two registrations. Replacing is cleaner but requires verifying frontmatter hooks aren't needed for legacy mode.
- [ ] For the Hannibal write-block expansion: allowlist (Hannibal CAN write to X) or blocklist (Hannibal CANNOT write to Y)? Allowlist is safer but may be too restrictive for edge cases.
- [ ] Should we add an "enforcement active" indicator to the kanban UI so operators can confirm hooks are working before starting a mission?

---

## 8. Implementation Phases

**Phase 1: Shared Agent Guard + Core Enforcement**
- Create a shared `resolveAgent(hookInput)` utility that extracts the agent name from `hookInput.agent_type` or `hookInput.teammate_name`, normalizes the `ai-team:` prefix, and returns `null` for unidentifiable sessions
- Add agent-name guards to existing enforcement scripts (each script reads the agent name and exits 0 if it doesn't apply to that agent)
- Register the 5 most critical enforcement hooks in `hooks/hooks.json`:
  - `block-amy-writes.js` (Amy Write/Edit — matcher: `Write|Edit`)
  - `block-worker-board-claim.js` (all workers board_claim — matcher: `mcp__plugin_ai-team_ateam__board_claim`)
  - `block-worker-board-move.js` (all workers board_move — matcher: `mcp__plugin_ai-team_ateam__board_move`)
  - `block-hannibal-writes.js` (Hannibal Write/Edit — already plugin-level via `enforce-orchestrator-boundary.js`, but expand coverage)
  - `block-raw-echo-log.js` (all workers raw echo — matcher: `Bash`)
- Wire denied event POSTing to API (fire-and-forget POST with `status: "denied"`)

**Phase 2: Complete Coverage + Gap Fixes**
- Register remaining enforcement hooks in `hooks/hooks.json`:
  - `block-murdock-impl-writes.js` (Murdock Write/Edit on impl files)
  - `block-ba-test-writes.js` (B.A. Write/Edit on test files)
  - `block-ba-bash-restrictions.js` (B.A. Bash restrictions)
  - `block-lynch-browser.js` (Lynch Playwright)
  - `block-sosa-writes.js` (Sosa Write/Edit)
- New: `block-lynch-writes.js` (Lynch Write/Edit — coverage gap fix)
- Expand `enforce-orchestrator-boundary.js` to cover all project files (allowlist approach: Hannibal can only write to `mission/`, `briefings/`, `ateam.config.json`, and similar orchestration files)
- Stop enforcement hooks: `enforce-completion-log.js`, `enforce-browser-verification.js`, `enforce-sosa-coverage.js`

**Phase 3: Testing + Validation**
- Unit tests for `resolveAgent()` covering: native teammate (`agent_type: "murdock"`), legacy subagent (`agent_type: "ai-team:murdock"`), main session (no `agent_type`), Explore/Plan agents, missing stdin
- Integration tests that invoke enforcement hooks with simulated stdin JSON and verify correct exit codes
- Run a test mission in native teams mode and confirm denied events appear in Raw Agent View
- Update documentation (CLAUDE.md, agents/AGENTS.md) to reflect new hook architecture
