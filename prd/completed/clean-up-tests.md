# PRD: Test Suite Cleanup

**Version:** 1.0.0
**Status:** Proposed
**Author:** Josh / Claude (2 code-review-expert audit agents)
**Date:** 2026-02-08
**Repo:** `The-Ai-team` plugin

---

## 1. Overview

### 1.1 Background

Two `code-review-expert` agents audited all 412 tests across the repository (375 in `mcp-server/`, 37 in plugin root). The audit found that 160 tests (39%) provide no behavioral value and should be deleted. These tests fall into several categories: testing locally-defined mock schemas instead of real code, checking static file contents, verifying that deleted files stay deleted, and tautological assertions against mock return values.

### 1.2 Problem Statement

The test suite creates a false sense of coverage. Three major tool modules (`board.ts`, `items.ts`, `missions.ts`) appear well-tested with 112 tests combined, but none of those tests import the real handler code. They test locally-defined mock schemas that have already diverged from the real schemas. Meanwhile, the actual handler logic has zero test coverage.

This situation is worse than having no tests at all: it actively misleads developers into thinking the code is tested when it is not.

### 1.3 Root Cause

The A(i)-Team TDD pipeline forces every work item through a testing stage. When the work items were infrastructure/config tasks (not behavioral code), Murdock (the test-writer agent) had no guidance on what constitutes a valuable test vs. a test that exists only to satisfy the pipeline. This created perverse incentives: tests were written to pass the pipeline gate, not to protect behavior.

### 1.4 Scope

This PRD covers:
- Deletion of 8 test files that test nothing real
- Trimming of low-value tests from 6 additional files
- Writing replacement tests for the 3 tool handler modules left with zero coverage
- Pipeline process changes to prevent this from recurring

This PRD does NOT cover:
- Fixing the 23 test failures identified in PRD-002 Finding 8 (separate concern)
- Changes to the kanban-viewer API repo (WI-008 noted as user-handled)
- New feature development

---

## 2. Audit Findings

### 2.1 Summary

| Area | Total Tests | Keep | Delete | Delete % |
|------|-------------|------|--------|----------|
| MCP server (`mcp-server/src/__tests__/`) | 375 | 227 | 148 | 39% |
| Plugin root (`scripts/__tests__/`, `scripts/hooks/__tests__/`) | 37 | 25 | 12 | 32% |
| **Total** | **412** | **252** | **160** | **39%** |

### 2.2 MCP Server: Files to Delete Entirely (6 files, 129 tests)

#### `mcp-server/src/__tests__/tools/board.test.ts` (30 tests)

Tests locally-defined mock implementations and schemas. Never imports the real `board.ts` code. The test schemas diverge from real ones (e.g., test schema does not reflect current `board_move` validation logic or `board_claim` agent normalization).

#### `mcp-server/src/__tests__/tools/items.test.ts` (33 tests)

Same pattern as board.test.ts. Tests local mock schemas that differ from real schemas in multiple ways:
- Missing `'enhancement'` from the type enum
- Missing `description` and `priority` as required fields in `item_create`
- Missing `WI-XXX` prefix validation on dependency values
- Never imports real item handlers

#### `mcp-server/src/__tests__/tools/missions.test.ts` (49 tests)

Same pattern. Local mock schemas differ from real ones:
- Test's `MissionInitInputSchema` has `name` as optional; the real schema requires both `name` and `prdPath`
- Does not test actual `mission_precheck` or `mission_postcheck` handler logic
- Never imports actual handlers

#### `mcp-server/src/__tests__/config.test.ts` (10 tests)

Tests the static contents of `.mcp.json` (checks for specific strings like `command: 'node'`). This is config file linting, not behavioral testing of the `config.ts` module.

#### `mcp-server/src/__tests__/agent-prompts-pipeline.test.ts` (4 tests)

Greps markdown agent prompt files for regex patterns (e.g., checks that `murdock.md` contains the word "test"). Tests documentation wording, not code behavior.

#### `mcp-server/src/__tests__/lint-config.test.ts` (3 tests)

Tests config file presence: `package.json` has a lint script, `biome.json` exists, `ateam.config.json` has a lint key. Setup validation, not unit tests.

### 2.3 MCP Server: Tests to Trim from Kept Files (19 tests from 5 files)

#### `mcp-server/src/__tests__/tools/agents.test.ts` (remove 3 of N)

| Test Name | Reason |
|-----------|--------|
| "should export tool definitions" | Meta-test on static exports |
| "should include proper descriptions" | Meta-test on static exports |
| "should include input schema" | Meta-test on static exports |

#### `mcp-server/src/__tests__/tools/utils.test.ts` (remove 8 of N)

| Test Name | Reason |
|-----------|--------|
| "multi-word messages" | Tautological mock test (asserts mock returns what mock was told to return) |
| 3 tool registration meta-tests | Static export checks, not behavioral tests |
| 4 "Response Structure Consistency" tests | Verify that mock return values have expected properties |

#### `mcp-server/src/__tests__/errors.test.ts` (remove 11 of N)

| Tests | Reason |
|-------|--------|
| 6 redundant HTTP status code mapping tests (403, 429, 502, 503, 504, 409) | The mapping is a simple lookup table, already tested by 5 other status codes |
| 5 edge case tests (Infinity/float status, undefined/object message, NaN, McpErrorResponse structure) | Already covered by existing type guards and other tests in the file |

#### `mcp-server/src/__tests__/server.test.ts` (remove 4 of N)

| Test Name | Reason |
|-----------|--------|
| "version 1.0.0" | Tests a string constant |
| "connect method" | Mock tautology (asserts mock.connect exists because mock defined it) |
| Source code grep test | Greps source file for patterns instead of testing behavior |
| Duplicate export test | Already tested elsewhere |

#### `mcp-server/src/__tests__/tools/index.test.ts` (remove 14 of N)

| Tests | Reason |
|-------|--------|
| Duplicate registration tests | Already covered in other test files |
| Duplicate export tests | Same checks exist in module-specific test files |
| "handler is a function" tests | Checks `typeof handler === 'function'` without calling it |

#### `mcp-server/src/__tests__/tools/index-probe.test.ts` (remove 8 of N)

| Tests | Reason |
|-------|--------|
| 7 duplicates | Same assertions exist in other test files |
| 1 literal no-op | `expect(true).toBe(true)` |

### 2.4 Plugin Root: Files to Delete Entirely (2 files, 6 tests)

#### `scripts/__tests__/no-legacy-imports.test.js` (3 tests)

Verifies that deleted files stay deleted and that existing files exist. Git provides this guarantee. These tests will never catch a real regression.

#### `scripts/__tests__/readme-exists.test.js` (3 tests)

Greps `README.md` for keywords like "install", "quick start", "node". Documentation linting, not behavioral testing.

### 2.5 Plugin Root: Tests to Trim (6 tests from 1 file)

#### `scripts/hooks/__tests__/enforce-hooks.test.js` (remove 6 of N)

All 6 are "no legacy reference" guard tests that check source code and error messages do not mention `item-agent-stop.js` or `mission-postcheck.js`. These were migration-era tests. The legacy scripts no longer exist. These tests protect against a migration that is already complete and will never be undone.

### 2.6 Coverage Gap After Deletion

Deleting `board.test.ts`, `items.test.ts`, and `missions.test.ts` leaves those three tool handler modules with **zero test coverage**. These are among the most important modules in the MCP server (board operations, item CRUD, mission lifecycle). New tests must be written that:

1. Import the real handler functions from `board.ts`, `items.ts`, and `missions.ts`
2. Mock only the HTTP client (not the schemas or handlers)
3. Follow the pattern already established in `agents.test.ts` and `utils.test.ts`, which do import real code

---

## 3. Work Items

### 3.1 Wave 1: Delete Dead Tests (no dependencies)

These items can be executed in parallel. They have no dependencies on each other or on any code changes.

---

#### WI-001: Delete 6 fake MCP server test files

**Type:** task
**Priority:** high

**Description:**
Delete the following 6 test files that test mock schemas instead of real code:

1. `mcp-server/src/__tests__/tools/board.test.ts` (30 tests)
2. `mcp-server/src/__tests__/tools/items.test.ts` (33 tests)
3. `mcp-server/src/__tests__/tools/missions.test.ts` (49 tests)
4. `mcp-server/src/__tests__/config.test.ts` (10 tests)
5. `mcp-server/src/__tests__/agent-prompts-pipeline.test.ts` (4 tests)
6. `mcp-server/src/__tests__/lint-config.test.ts` (3 tests)

**Acceptance Criteria:**
- [ ] All 6 files deleted
- [ ] `npm test` in `mcp-server/` still passes (remaining tests unaffected)
- [ ] No imports or references to these files remain in other test files

---

#### WI-002: Delete 2 root-level useless test files

**Type:** task
**Priority:** high

**Description:**
Delete the following 2 test files from the plugin root test directories:

1. `scripts/__tests__/no-legacy-imports.test.js` (3 tests)
2. `scripts/__tests__/readme-exists.test.js` (3 tests)

**Acceptance Criteria:**
- [ ] Both files deleted
- [ ] Any test runner config that references these files is updated (if applicable)
- [ ] Remaining root-level tests still pass

---

#### WI-003: Trim 19 low-value tests from 5 MCP server test files

**Type:** task
**Priority:** medium

**Description:**
Remove specific low-value tests from files that otherwise contain good tests. The files to modify and tests to remove are detailed in Section 2.3 of this PRD.

**Files to modify:**
- `mcp-server/src/__tests__/tools/agents.test.ts` — remove 3 meta-tests on static exports
- `mcp-server/src/__tests__/tools/utils.test.ts` — remove 8 tautological/meta-tests
- `mcp-server/src/__tests__/errors.test.ts` — remove 11 redundant/duplicate tests
- `mcp-server/src/__tests__/server.test.ts` — remove 4 mock-tautology/grep tests
- `mcp-server/src/__tests__/tools/index.test.ts` — remove 14 duplicate/type-check-only tests
- `mcp-server/src/__tests__/tools/index-probe.test.ts` — remove 8 duplicate/no-op tests

**Acceptance Criteria:**
- [ ] 19 specified tests removed (not the entire files -- only the listed tests)
- [ ] Remaining tests in each file still pass
- [ ] No test that validates actual behavior is removed

---

#### WI-004: Trim 6 legacy migration guard tests from enforce-hooks.test.js

**Type:** task
**Priority:** medium

**Description:**
Remove the 6 "no legacy reference" tests from `scripts/hooks/__tests__/enforce-hooks.test.js`. These tests check that source code does not mention `item-agent-stop.js` or `mission-postcheck.js`, which were removed during a past migration. The migration is complete and irreversible.

**Acceptance Criteria:**
- [ ] 6 legacy guard tests removed
- [ ] Remaining tests in the file still pass
- [ ] File is not deleted entirely (it contains other valuable hook tests)

---

### 3.2 Wave 2: Write Real Tests (depends on Wave 1)

These items depend on WI-001 (the fake test files must be deleted first to avoid conflicts). They can be executed in parallel with each other.

---

#### WI-005: Write real board.ts handler tests

**Type:** feature
**Priority:** high
**Dependencies:** WI-001

**Description:**
Write tests for `mcp-server/src/tools/board.ts` that import the real handler functions and mock only the HTTP client. Cover the 4 board tools: `board_read`, `board_move`, `board_claim`, `board_release`.

**Test file:** `mcp-server/src/__tests__/tools/board.test.ts` (recreated with real tests)

**Pattern to follow:** See `mcp-server/src/__tests__/tools/agents.test.ts` for the established pattern of importing real handlers and mocking the HTTP client.

**Acceptance Criteria:**
- [ ] Tests import real handlers from `board.ts`
- [ ] HTTP client is mocked (not the schemas or handler logic)
- [ ] Happy path tested for each of the 4 board tools
- [ ] Error paths tested (invalid stage transition, WIP limit exceeded, claim conflict)
- [ ] All tests pass

---

#### WI-006: Write real items.ts handler tests

**Type:** feature
**Priority:** high
**Dependencies:** WI-001

**Description:**
Write tests for `mcp-server/src/tools/items.ts` that import the real handler functions and mock only the HTTP client. Cover the 6 item tools: `item_create`, `item_update`, `item_get`, `item_list`, `item_reject`, `item_render`.

**Test file:** `mcp-server/src/__tests__/tools/items.test.ts` (recreated with real tests)

**Pattern to follow:** Same as WI-005. Import real handlers, mock HTTP client.

**Acceptance Criteria:**
- [ ] Tests import real handlers from `items.ts`
- [ ] HTTP client is mocked
- [ ] Happy path tested for each of the 6 item tools
- [ ] Schema validation tested (required fields, enum values, `WI-XXX` dependency format)
- [ ] Error paths tested (item not found, validation failure)
- [ ] All tests pass

---

#### WI-007: Write real missions.ts handler tests

**Type:** feature
**Priority:** high
**Dependencies:** WI-001

**Description:**
Write tests for `mcp-server/src/tools/missions.ts` that import the real handler functions and mock only the HTTP client. Cover the 5 mission tools: `mission_init`, `mission_current`, `mission_precheck`, `mission_postcheck`, `mission_archive`.

**Test file:** `mcp-server/src/__tests__/tools/missions.test.ts` (recreated with real tests)

**Pattern to follow:** Same as WI-005. Import real handlers, mock HTTP client.

**Acceptance Criteria:**
- [ ] Tests import real handlers from `missions.ts`
- [ ] HTTP client is mocked
- [ ] Happy path tested for each of the 5 mission tools
- [ ] Schema validation tested (required `name` and `prdPath` for `mission_init`)
- [ ] Error paths tested (no active mission, check failures)
- [ ] All tests pass

---

### 3.3 Wave 3: Pipeline Process Changes (independent of test work)

These items address the root cause: the pipeline that created the bad tests in the first place. They modify agent prompts and pipeline logic, not test files.

---

#### WI-008: Add `ready -> implementing` transition to board_move VALID_TRANSITIONS

**Type:** enhancement
**Priority:** medium
**Repo:** kanban-viewer (separate repository)

**Description:**
The `board_move` tool's `VALID_TRANSITIONS` map needs a `ready -> implementing` transition to support items that skip the testing stage (e.g., documentation, config-only work items). This change is in the kanban-viewer API repo, not the plugin repo.

**NOTE:** This item is in a separate repository and will be handled by the user directly. It is listed here for completeness and as a dependency for WI-009 and WI-011.

**Acceptance Criteria:**
- [ ] `VALID_TRANSITIONS` in the kanban-viewer API includes `ready -> implementing`
- [ ] The transition is only allowed for items explicitly marked as `NO_TEST_NEEDED`
- [ ] Existing `ready -> testing` transition is unaffected

---

#### WI-009: Update Face agent to mark non-behavioral items as NO_TEST_NEEDED

**Type:** enhancement
**Priority:** medium
**Dependencies:** WI-008

**Description:**
Update `agents/face.md` to instruct Face to identify work items where testing adds no value and mark them with a `NO_TEST_NEEDED` flag (or equivalent metadata). Categories that should be flagged:

- Documentation-only items (CHANGELOG, README, docs/)
- Config file changes (`.json`, `.yaml` config)
- Type-only items (TypeScript type definitions with no runtime behavior)
- Static asset changes

Face should still default to requiring tests for all `feature` and `bug` type items.

**Acceptance Criteria:**
- [ ] `agents/face.md` includes guidance on identifying non-testable items
- [ ] Work item schema supports a `no_test` or `skip_testing` flag
- [ ] Face marks appropriate items during decomposition
- [ ] Feature and bug items are never marked as no-test

---

#### WI-010: Update Murdock agent with "What NOT to test" guidance

**Type:** enhancement
**Priority:** medium

**Description:**
Update `agents/murdock.md` to include explicit guidance on what does NOT warrant testing. Murdock currently has no framework for deciding when a test adds value vs. when it is theater.

**Add guidance covering:**
- Do not test static file contents (config files, markdown files)
- Do not test that exports exist or have certain types (meta-tests)
- Do not test mock return values against themselves (tautological tests)
- Do not test that deleted files stay deleted (git handles this)
- Do not redefine schemas locally -- always import from source
- If the only way to write a test is to copy-paste the implementation into the test, the test has no value

**Acceptance Criteria:**
- [ ] `agents/murdock.md` includes a "What NOT to test" or "Anti-patterns" section
- [ ] Each anti-pattern includes a concrete example of what to avoid
- [ ] Murdock's existing testing guidance is not weakened (behavioral tests are still required)

---

#### WI-011: Update Hannibal agent to fast-track NO_TEST_NEEDED items

**Type:** enhancement
**Priority:** medium
**Dependencies:** WI-008, WI-009

**Description:**
Update `agents/hannibal.md` to recognize the `NO_TEST_NEEDED` flag on work items and skip the testing stage for those items, moving them directly from `ready` to `implementing`.

**Acceptance Criteria:**
- [ ] `agents/hannibal.md` includes logic to check for `NO_TEST_NEEDED` flag
- [ ] Flagged items skip `testing` stage and go `ready -> implementing`
- [ ] Flagged items still go through `review` and `probing` stages (only testing is skipped)
- [ ] Non-flagged items follow the normal pipeline (no behavior change)

---

## 4. Implementation Notes

### 4.1 Wave Dependencies

```
Wave 1 (WI-001 through WI-004)     Wave 3 (WI-008 through WI-011)
  All independent, run in parallel    WI-008 (kanban-viewer, user-handled)
  No code changes, only deletions       |
         |                              v
         v                            WI-009 (depends on WI-008)
Wave 2 (WI-005, WI-006, WI-007)      WI-010 (independent)
  Depend on WI-001                    WI-011 (depends on WI-008, WI-009)
  Can run in parallel with each other
```

Wave 2 and Wave 3 are independent of each other and can proceed in parallel.

### 4.2 Test Count Impact

| Phase | Tests | Running Total |
|-------|-------|---------------|
| Starting count | 412 | 412 |
| After Wave 1 deletions | -160 | 252 |
| After Wave 2 new tests (est. 40-60) | +50 (est.) | ~302 |

The net test count will decrease, but the remaining tests will all validate real behavior.

### 4.3 Risk: Wave 2 Test File Name Collisions

WI-005, WI-006, and WI-007 recreate test files at the same paths as the files deleted in WI-001 (`board.test.ts`, `items.test.ts`, `missions.test.ts`). WI-001 must complete before Wave 2 begins. If running through the A(i)-Team pipeline, these should be separate waves with explicit dependencies.

### 4.4 WI-008 Is External

WI-008 requires a change to the kanban-viewer API repository, which is a separate codebase. The user will handle this item directly. WI-009 and WI-011 depend on the schema/transition change from WI-008 but can be written as prompt changes that reference the expected behavior.

### 4.5 Relation to PRD-002

PRD-002 Finding 8 documents 23 test failures across 5 files. This PRD does not address those failures, but there is overlap:
- Some of the failing tests are in files being deleted (e.g., `config.test.ts` has 2 failures but is being deleted entirely in WI-001)
- After Wave 1 deletions, the remaining failure count from PRD-002 will be lower
- Wave 2 new tests should be written to pass from the start, not to fix old failures

---

## 5. Success Criteria

The test cleanup mission is complete when:

1. All 160 identified low-value tests are removed
2. Real tests exist for `board.ts`, `items.ts`, and `missions.ts` handler modules
3. All remaining tests pass (`npm test` in both `mcp-server/` and project root)
4. Agent prompts are updated to prevent recurrence (Face, Murdock, Hannibal)
5. No test in the repository tests mock schemas, static file contents, or deleted file absence
