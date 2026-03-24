# PRD: Repository Audit Findings & Remediation

**Version:** 1.0.0
**Status:** Proposed
**Author:** Josh / Claude (4-agent audit team)
**Date:** 2026-02-07
**Repo:** `The-Ai-team` plugin

---

## 1. Overview

### 1.1 Background

A comprehensive audit was conducted across the entire A(i)-Team repository using four parallel `code-review-expert` agents, each covering a distinct area:

| Auditor | Scope |
|---------|-------|
| **mcp-reviewer** | MCP server source code (20 tools, client, config, errors) |
| **agent-reviewer** | Agent prompts (8), commands (7), skills (2), hooks |
| **config-reviewer** | Hook scripts, lib utilities, plugin config, build artifacts |
| **docs-reviewer** | CLAUDE.md, PRDs, review docs, cross-referencing against code |

### 1.2 Purpose

This PRD documents all 18 findings from the audit, organized by severity, with clear acceptance criteria for each fix. It serves as the backlog for bringing the plugin to production quality.

### 1.3 Scope

This PRD covers remediation of:
- Broken enforcement hooks
- Code duplication in the MCP server
- Pipeline logic bugs in agent prompts
- Test failures and build issues
- Documentation drift and stale references
- Legacy code cleanup

This PRD does NOT cover:
- New features or capabilities
- Kanban UI or API server changes
- Performance optimization

---

## 2. Findings

### 2.1 Severity Definitions

| Severity | Meaning |
|----------|---------|
| **CRITICAL** | Safety rails broken, pipeline integrity compromised |
| **HIGH** | Significant code quality or correctness issues |
| **MEDIUM** | Test failures, documentation drift, inconsistencies |
| **LOW** | Cleanup, nice-to-haves, developer experience |

---

## 3. CRITICAL Findings

### Finding 1: Enforcement Hooks Are Completely Inert

**Severity:** CRITICAL
**Area:** scripts/hooks
**Files:**
- `scripts/hooks/enforce-completion-log.js` (lines 23-24, 31, 62)
- `scripts/hooks/enforce-final-review.js` (lines 16-17, 20, 25)

**Problem:**
Both enforcement hooks read from `mission/board.json` on the local filesystem:
```javascript
const missionDir = join(process.cwd(), 'mission');
const boardPath = join(missionDir, 'board.json');
```
This file does not exist in the current API-based architecture. All mission state is stored in the remote API database, accessed via MCP tools. Both hooks hit the `!existsSync(boardPath)` early return and silently allow everything through.

**Impact:**
- `enforce-completion-log.js` never blocks an agent from stopping without calling `agent_stop`
- `enforce-final-review.js` never enforces that all items are done, final review is completed, or postchecks have passed
- The entire TDD pipeline safety net is disabled

**Additionally:** `enforce-completion-log.js` error messages reference `node scripts/item-agent-stop.js` instead of the `agent_stop` MCP tool.

**Acceptance Criteria:**
- [ ] Both hooks query the API (via `ATEAM_API_URL`) instead of reading local files
- [ ] `enforce-completion-log.js` blocks agent stop if `agent_stop` MCP tool was not called
- [ ] `enforce-final-review.js` blocks mission end unless all items are `done`, final review is complete, and postchecks passed
- [ ] Error messages reference MCP tools, not legacy scripts
- [ ] Hooks have unit tests verifying block/allow behavior

---

### Finding 2: Agent Name Validation Duplicated 3x

**Severity:** CRITICAL (maintenance risk across core tool modules)
**Area:** MCP server
**Files:**
- `mcp-server/src/tools/board.ts` (lines 13-58)
- `mcp-server/src/tools/agents.ts` (lines 16-61)
- `mcp-server/src/tools/utils.ts` (lines 21-66)

**Problem:**
Identical `VALID_AGENTS_LOWER`, `AGENT_NAME_MAP`, `normalizeAgentName()`, and `AgentNameSchema` are fully duplicated across three files (~140 lines total). If an agent name is added or renamed, all three files must be updated in lockstep.

**Acceptance Criteria:**
- [ ] Agent name validation extracted to `mcp-server/src/lib/agents.ts`
- [ ] All three tool modules import from the shared module
- [ ] No duplicated agent name logic remains in tool files
- [ ] Existing tests still pass

---

### Finding 3: `zodToJsonSchema` Duplicated 3x (Each Copy Incomplete)

**Severity:** CRITICAL (each copy handles different Zod types)
**Area:** MCP server
**Files:**
- `mcp-server/src/tools/items.ts` (lines 305-385)
- `mcp-server/src/tools/missions.ts` (lines 294-366)
- `mcp-server/src/tools/utils.ts` (lines 260-341)

**Problem:**
The `zodToJsonSchema()`, `isOptional()`, and `getPropertySchema()` functions are near-identical across three files (~240 lines total). Critically, each copy handles DIFFERENT Zod types: `utils.ts` handles `ZodEffects`, `missions.ts` handles `ZodBoolean`, `items.ts` handles `ZodEnum`. Each is independently incomplete.

**Acceptance Criteria:**
- [ ] Unified `zodToJsonSchema` extracted to `mcp-server/src/lib/schema-utils.ts`
- [ ] Handles ALL Zod types currently covered across the three copies (ZodEffects, ZodBoolean, ZodEnum, ZodOptional, ZodDefault, ZodString, ZodNumber, ZodArray, ZodObject)
- [ ] All three tool modules import from the shared module
- [ ] Unit tests for each Zod type conversion

---

## 4. HIGH Findings

### Finding 4: `formatErrorMessage` and `ToolResponse` Duplicated

**Severity:** HIGH
**Area:** MCP server
**Files:**
- `formatErrorMessage` + `ApiErrorLike`: `agents.ts` (lines 140-166), `utils.ts` (lines 140-164)
- `ToolResponse` interface: `board.ts` (142-145), `items.ts` (148-151), `missions.ts` (164-167), `utils.ts` (131-135)

**Problem:**
`formatErrorMessage` duplicated in 2 files despite `lib/errors.ts` already providing `formatApiError` and `formatNetworkError`. `ToolResponse` interface duplicated in all 4 tool modules.

**Acceptance Criteria:**
- [ ] `ToolResponse` extracted to shared types file (e.g., `mcp-server/src/lib/types.ts`)
- [ ] Tool modules use `lib/errors.ts` utilities instead of local `formatErrorMessage`
- [ ] No duplicated error formatting or response types in tool files

---

### Finding 5: Hannibal's Approval Flow Skips Amy's Probing Stage

**Severity:** HIGH
**Area:** Agent prompts
**Files:**
- `agents/hannibal.md` (lines 697-716, "Handling Approvals" section)
- `agents/hannibal.md` (lines 353-392, "Concrete Example" timeline)

**Problem:**
The "Handling Approvals" section says: "When Lynch approves: `board_move(itemId: '001', to: 'done')`" - this skips the mandatory `probing` stage (Amy). The concrete example timeline also shows items going directly from review to done.

**Impact:** If an LLM reads these sections standalone, it could skip Amy's probing entirely, breaking the mandatory pipeline.

**Acceptance Criteria:**
- [ ] "Handling Approvals" shows: Lynch APPROVED -> move to `probing` -> dispatch Amy -> Amy VERIFIED -> move to `done`
- [ ] Concrete example timeline includes the probing stage transition
- [ ] No section in hannibal.md shows review -> done directly

---

### Finding 6: Lynch Can Spawn Amy, Duplicating Mandatory Pipeline Stage

**Severity:** HIGH
**Area:** Agent prompts
**File:** `agents/lynch.md` (lines 144-183, "Deep Investigation (Optional)" section)

**Problem:**
Lynch's prompt has a section allowing Lynch to spawn Amy during per-feature review. But Amy's probing stage is mandatory and orchestrated by Hannibal after Lynch approves. This creates duplicate Amy runs.

**Acceptance Criteria:**
- [ ] "Deep Investigation" section removed from per-feature review context
- [ ] OR clearly scoped to Final Mission Review only (where Amy is NOT dispatched by pipeline)
- [ ] No path exists for Lynch to spawn Amy during per-feature review

---

### Finding 7: Resume Command Has 3 Contradictory Recovery Strategies

**Severity:** HIGH
**Area:** Commands
**File:** `commands/resume.md` (lines 29-42 vs 131-147 vs native teams section)

**Problem:**
Three contradictory approaches in the same document:
1. Step 3: Move items backward (testing -> ready, implementing -> testing, review -> implementing)
2. Recovery Rules: `review` items "Stay in review stage" (contradicts #1)
3. Native teams: Respawn agents at current stage (don't move items)

**Acceptance Criteria:**
- [ ] Single consistent recovery strategy documented
- [ ] Legacy and native teams sections use the same logic
- [ ] All stage recovery rules are listed (including `probing`)

---

## 5. MEDIUM Findings

### Finding 8: 23 Test Failures Across 5 Files

**Severity:** MEDIUM
**Area:** MCP server tests
**Files:**
- `client.test.ts`: 5 failures (unhandled promise rejections in retry tests)
- `tools/index.test.ts`: 9 failures (tests expect `setRequestHandler` but impl uses `server.tool()`)
- `server.test.ts`: 3 failures (mock's `tool` is not a function)
- `config.test.ts`: 2 failures (expect env vars not in `.mcp.json`)
- `tools/utils.test.ts`: 4 failures (wrong API path `/api/utils/deps-check` vs `/api/deps/check`)

**Problem:**
Tests were written against a different API than what's implemented. 332 of 355 tests pass, but 23 failures indicate test/implementation drift.

**Acceptance Criteria:**
- [ ] All 355 tests pass
- [ ] `client.test.ts` retry tests handle promise rejections correctly
- [ ] `tools/index.test.ts` updated to match `server.tool()` API
- [ ] API paths in test expectations match implementation

---

### Finding 9: `agents.ts` Has Zero Retries for Agent Lifecycle Calls

**Severity:** MEDIUM
**Area:** MCP server
**File:** `mcp-server/src/tools/agents.ts` (line ~175, `retries: 0`)

**Problem:**
Agent start/stop API calls have no retry protection. A network blip during `agent_stop` could lose work completion records permanently - the agent's work is done but never recorded.

**Acceptance Criteria:**
- [ ] `agents.ts` uses `config.retries` (default 3) instead of hardcoded 0
- [ ] Or at minimum, `agent_stop` has retries (even if `agent_start` stays at 0)

---

### Finding 10: Inconsistent HTTP Client Instantiation

**Severity:** MEDIUM
**Area:** MCP server
**Files:** `items.ts:19-24`, `missions.ts:18-23`, `utils.ts:170-175` (module-level, hardcoded), `board.ts:159-167` (per-call, uses config), `agents.ts:171-178` (per-call, hardcoded)

**Problem:**
Three modules hardcode `timeout: 30000` and `retries: 3` as module-level singletons, ignoring `config.timeout` (default 10000) and `config.retries`. Two modules create clients per-call. No consistent pattern.

**Acceptance Criteria:**
- [ ] All modules use `config.timeout` and `config.retries`
- [ ] Consistent client creation pattern across all tool modules (prefer module-level singleton using config values)

---

### Finding 11: `plugin.json` Path Wrong in CLAUDE.md

**Severity:** MEDIUM
**Area:** Documentation
**File:** `CLAUDE.md` (line 358)

**Problem:**
File tree shows `plugin.json` at root, but it was moved to `.claude-plugin/plugin.json` (confirmed by git status: `R plugin.json -> .claude-plugin/plugin.json`).

**Acceptance Criteria:**
- [ ] CLAUDE.md file tree updated to show `.claude-plugin/plugin.json`
- [ ] Any other references to root-level `plugin.json` updated

---

### Finding 12: Hannibal's Hook Mismatch in CLAUDE.md

**Severity:** MEDIUM
**Area:** Documentation
**Files:** `CLAUDE.md` (lines 509-515), `agents/hannibal.md` (lines 12-14)

**Problem:**
CLAUDE.md documents Hannibal's Bash hook as `block-raw-echo-log.js`, but the actual frontmatter uses `block-raw-mv.js`. Additionally, `block-raw-mv.js` is not listed in CLAUDE.md's file tree (line 393-398 lists only 4 hook scripts; there are 5).

**Acceptance Criteria:**
- [ ] CLAUDE.md hook section matches actual hannibal.md frontmatter
- [ ] All 5 hook scripts listed in CLAUDE.md file tree
- [ ] Each hook's purpose documented accurately

---

### Finding 13: Kanban UI PRD Is Significantly Stale

**Severity:** MEDIUM
**Area:** Documentation
**File:** `docs/kanban-ui-prd.md`

**Problem:**
The PRD describes a filesystem-based architecture (`board.json`, `activity.log`, `mission/` directory, `fs.watch`) that no longer exists. Current architecture uses API database + MCP tools. Also references only 5 agents (missing Sosa, Amy, Tawnia) and 7 stages (missing `probing`).

**Acceptance Criteria:**
- [ ] PRD either updated to reflect API-based architecture, or clearly marked as superseded with a pointer to the current system
- [ ] Agent roster and stage list corrected if PRD is kept active

---

### Finding 14: Subagent Type Confusion Across Docs

**Severity:** MEDIUM
**Area:** Documentation / Agent prompts
**Files:** `CLAUDE.md` (lines 18-22 vs 307-314), `commands/plan.md` (lines 244-246), `agents/sosa.md`, `agents/amy.md`, `agents/tawnia.md`

**Problem:**
Three different stories about subagent types:
1. CLAUDE.md Overview: Murdock=`qa-engineer`, B.A.=`clean-code-architect`, Lynch=`code-review-expert`, Amy=`bug-hunter`
2. CLAUDE.md Dispatch section: ALL use `subagent_type: "general-purpose"`
3. Agent files: Each claims their own type (e.g., `sosa.md` says `requirements-critic`)

The dispatch section (#2) is what Hannibal actually uses. The overview labels (#1) describe the agent's *role*, not dispatch type. The agent file labels (#3) are informational only.

**Acceptance Criteria:**
- [ ] CLAUDE.md Overview clarifies that role labels are descriptive, not dispatch types
- [ ] Agent file "Subagent Type" headers either removed or annotated as "role description"
- [ ] `commands/plan.md` Agent Invocations table corrected to show `general-purpose`
- [ ] One authoritative source of truth for dispatch types (CLAUDE.md Dispatch section)

---

## 6. LOW Findings

### Finding 15: ~1,600 Lines of Legacy Dead Code

**Severity:** LOW
**Area:** Project structure
**Files:** All of `lib/board.js`, `lib/lock.js`, `lib/validate.js` (~600 lines), and 18 scripts in `scripts/` (~1,000 lines)

**Problem:**
The `lib/` utilities are only imported by `scripts/*.js` files. The scripts are the legacy CLI interface replaced by MCP server + API. None of the active code paths (MCP server, hooks) import from `lib/`. Additionally, `lib/validate.js` AGENTS constant is missing `tawnia` and `sosa`, and `lib/board.js` AGENT_DISPLAY_NAMES is missing Tawnia - further evidence of staleness.

The root `package.json` dependencies (`gray-matter`, `proper-lockfile`) are only used by this legacy code.

**Acceptance Criteria:**
- [ ] Legacy `lib/` and `scripts/` either removed or moved to `legacy/` with a note
- [ ] Root `package.json` dependencies cleaned up if legacy code removed
- [ ] OR: If keeping for reference, add a README in `scripts/` marking them as deprecated

---

### Finding 16: No README.md at Project Root

**Severity:** LOW
**Area:** Documentation

**Problem:**
No project-level README.md exists. For a plugin intended for publication, a README with quick-start instructions, prerequisites, and basic usage is expected.

**Acceptance Criteria:**
- [ ] Root README.md created with: project description, prerequisites, installation, quick-start, link to CLAUDE.md for details

---

### Finding 17: No Linter Configured

**Severity:** LOW
**Area:** Build / DX
**Files:** `mcp-server/package.json` (line 13), `ateam.config.json` (line 4)

**Problem:**
`npm run lint` in mcp-server echoes `'No linter configured'`. The `ateam.config.json` lint check points to this no-op, meaning `mission_postcheck` lint step always passes trivially.

**Acceptance Criteria:**
- [ ] ESLint (or Biome) configured for `mcp-server/` with TypeScript rules
- [ ] `npm run lint` produces real output
- [ ] `ateam.config.json` lint command runs a real linter

---

### Finding 18: Untracked `The-Ai-team/` Directory in Root

**Severity:** LOW
**Area:** Project hygiene

**Problem:**
Git status shows `?? The-Ai-team` - a nested copy or submodule of the project inside itself. Also, `REVIEW_TEAMMATE_TOOL_INTEGRATION.md` is untracked.

**Acceptance Criteria:**
- [ ] `The-Ai-team/` directory investigated and removed or added to `.gitignore`
- [ ] `REVIEW_TEAMMATE_TOOL_INTEGRATION.md` either committed or removed

---

## 7. Implementation Notes

### Suggested Work Order

**Wave 1 - Safety (Findings 1, 5, 6, 7):**
Fix broken hooks and pipeline logic bugs. These affect correctness of every mission run.

**Wave 2 - Code Quality (Findings 2, 3, 4, 9, 10):**
Extract duplicated code and fix client inconsistencies. Reduces maintenance burden and prevents silent bugs.

**Wave 3 - Tests (Finding 8):**
Fix 23 failing tests. Do this after Wave 2 since refactoring may change test targets.

**Wave 4 - Documentation (Findings 11, 12, 13, 14):**
Update CLAUDE.md, mark stale PRDs, resolve subagent type confusion.

**Wave 5 - Cleanup (Findings 15, 16, 17, 18):**
Remove legacy code, add README, configure linter, clean up untracked files.

### Dependencies

- Finding 8 (test fixes) should follow Findings 2-4 (code extraction) since refactoring will change imports
- Finding 17 (linter) should precede or accompany Finding 8 (tests) for CI hygiene
- Findings 11-14 (doc updates) are independent and can be done anytime

### Estimated Scope

| Wave | Findings | Estimated Items |
|------|----------|----------------|
| 1 - Safety | 1, 5, 6, 7 | 4 work items |
| 2 - Code Quality | 2, 3, 4, 9, 10 | 3-4 work items (2/3/4 can be one refactor) |
| 3 - Tests | 8 | 1-2 work items |
| 4 - Documentation | 11, 12, 13, 14 | 1-2 work items (batch doc fixes) |
| 5 - Cleanup | 15, 16, 17, 18 | 2-3 work items |
| **Total** | **18 findings** | **~12-15 work items** |
