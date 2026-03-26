# Test Suite Audit Report — A(i)-Team Plugin

**178 test files reviewed across 6 domains by 6 parallel QA agents**
**Date:** 2026-03-25

---

## Overall Verdict

| Category | Count | % |
|----------|------:|--:|
| **Valid (keep)** | 78 | 44% |
| **Needs Rework** | 54 | 30% |
| **Invalid (delete)** | 46 | 26% |

**Nearly half the test suite is noise or actively misleading.** The root cause is clear: AI-generated tests that favor coverage metrics over behavioral validation. The most common anti-patterns are type-shape tests (constructing objects and asserting they equal themselves), tests that mock their own subject, and Tailwind CSS class assertions.

---

## The 5 Systemic Problems

### 1. Type-Shape Tests (~25 files)

Tests that construct an object matching a TypeScript interface and assert the properties equal what was just set. TypeScript already validates this at compile time. These tests would pass even if every function in the codebase were deleted.

**Worst offenders:** `types.test.ts` (517 lines), `types-mission-completion.test.ts` (558 lines), `agent-types.test.ts`, `animation-types.test.ts`, `mission-completion-types.test.ts`, `mission-state.test.ts`, `activity-event-types.test.ts`, `tab-notification-types.test.ts`, `work-item-modal-types.test.ts`, `hook-event-model.test.ts`, `api-types.test.ts`

### 2. Tests That Mock Their Own Subject (~8 files)

Tests that `vi.mock()` the route handler they claim to test, then call the mock and assert it returns what the mock was configured to return.

**Files:** `items/route.test.ts`, `items/[id]/route.test.ts`, `items/[id]/reject.test.ts`, `items/[id]/render.test.ts`, `board/release.test.ts`, `scripts/migrate-from-json.test.ts`, `scripts/migrate-projects.test.ts`, `scripts/e2e-regression-health-check.test.ts`

### 3. Tailwind CSS Class Assertions (~28 files)

Tests that assert specific utility classes like `bg-green-500`, `rounded-full`, `w-8`, `text-xs`. Any visual refactor, Tailwind upgrade, or design system change breaks dozens of tests without any actual bug.

**Pervasive across:** agent-badge, board-column, filter-bar, header-bar, connection-status, work-item-card, type-badge, notification-dot, and more.

### 4. Source File Regex Matching (~4 files)

Tests that `readFileSync` production source code and regex-match for strings. Not rendering, not executing — just string matching on code.

**Files:** `layout.test.tsx`, `dark-mode.test.tsx`, `card-animation-styles.test.ts`, hook static checks in `stop-guards.test.ts`

### 5. Tests of Local Reimplementations (~5 files)

Tests that define the function-under-test *inside the test file* rather than importing it from production code.

**Files:** `raw-agent-filters.test.tsx`, `e2e-regression-cleanup.test.ts`, `e2e-regression-health-check.test.ts`, `types/agent-name.test.ts`, `sse-hook-events.test.ts`

---

## Files to Delete (46 files)

### API Routes (5)

- `src/__tests__/api/items/route.test.ts` — mocks its own handler
- `src/__tests__/api/items/[id]/route.test.ts` — mocks its own handler
- `src/__tests__/api/items/[id]/reject.test.ts` — mocks its own handler
- `src/__tests__/api/items/[id]/render.test.ts` — mocks its own handler
- `src/__tests__/api/board/release.test.ts` — mocks its own handler

### Type-Shape Tests (14)

- `src/__tests__/activity-event-types.test.ts`
- `src/__tests__/agent-types.test.ts`
- `src/__tests__/animation-types.test.ts`
- `src/__tests__/mission-completion-types.test.ts`
- `src/__tests__/mission-timer-types.test.ts`
- `src/__tests__/types.test.ts`
- `src/__tests__/types-mission-completion.test.ts`
- `src/__tests__/tab-notification-types.test.ts`
- `src/__tests__/work-item-modal-types.test.ts`
- `src/__tests__/hook-event-model.test.ts`
- `src/__tests__/probing-stage-type.test.ts`
- `src/__tests__/mission-state.test.ts`
- `src/__tests__/sse-hook-events.test.ts`
- `src/__tests__/types/api-types.test.ts`

### Script Tests That Test Nothing (4)

- `src/__tests__/scripts/migrate-from-json.test.ts`
- `src/__tests__/scripts/migrate-projects.test.ts`
- `src/__tests__/scripts/e2e-regression-health-check.test.ts`
- `src/__tests__/scripts/e2e-regression-cleanup.test.ts`

### Prisma/Types Tests (2)

- `src/__tests__/prisma/seed.test.ts` — tests local constants
- `src/__tests__/types/agent-name.test.ts` — tests local helper function

### UI Tests (7)

- `src/__tests__/layout.test.tsx` — regex on source code
- `src/__tests__/dark-mode.test.tsx` — regex on source + jsdom empty strings
- `src/__tests__/responsive-board-side-panel-width.test.tsx` — pure Tailwind assertions
- `src/__tests__/type-badge.test.tsx` — pure Tailwind assertions
- `src/__tests__/notification-dot.test.tsx` — pure Tailwind assertions
- `src/__tests__/rejection-badge.test.tsx` — pure Tailwind assertions
- `src/__tests__/raw-agent-filters.test.tsx` — tests local function, not production code

### MCP Server (2)

- `packages/mcp-server/src/__tests__/tools/index-probe.test.ts` — `expect(true).toBe(true)`
- `packages/mcp-server/src/__tests__/shared-imports.test.ts` — tests `@ai-team/shared`, not MCP server

### Plugin Infrastructure (2)

- `commands/__tests__/setup-observer-config.test.js` — regex on markdown prose
- `src/__tests__/types/item-type.test.ts` — tests local constants

---

## Needs Rework (54 files)

### API Routes — Brittle Prisma Query Assertions (5)

These test real handlers but assert on exact Prisma call shapes rather than HTTP response behavior:

- `src/__tests__/api/activity/route.test.ts` — asserts `{ take: 100 }`, `{ orderBy: { timestamp: 'desc' } }`
- `src/__tests__/api/board/route.test.ts` — near-duplicate tests for same successful request
- `src/__tests__/api/board/events-memory.test.ts` — asserts `findMany` call count (implementation detail)
- `src/__tests__/api/board/events-circuit-breaker.test.ts` — contains `expect(true).toBe(true)` no-op
- `src/__tests__/api/missions/route.test.ts` — asserts Prisma call shapes

### UI Components — Tailwind Class Assertions (28)

These contain valuable behavioral tests mixed with CSS class assertions. The CSS tests should be stripped:

- `src/__tests__/agent-badge.test.tsx`
- `src/__tests__/agent-badge-colors.test.tsx`
- `src/__tests__/agent-status-bar-label.test.tsx`
- `src/__tests__/agent-status-bar.test.tsx`
- `src/__tests__/board-column.test.tsx`
- `src/__tests__/board-column-wip.test.tsx`
- `src/__tests__/board-column-animations.test.tsx`
- `src/__tests__/connection-status-indicator.test.tsx`
- `src/__tests__/dependency-indicator.test.tsx`
- `src/__tests__/filter-bar.test.tsx`
- `src/__tests__/filter-bar-search.test.tsx`
- `src/__tests__/filter-bar-active-indicators.test.tsx`
- `src/__tests__/header-bar.test.tsx`
- `src/__tests__/header-bar-completion-visual.test.tsx`
- `src/__tests__/header-bar-project-selector.test.tsx`
- `src/__tests__/item-detail-modal.test.tsx`
- `src/__tests__/work-item-card.test.tsx`
- `src/__tests__/work-item-card-animations.test.tsx`
- `src/__tests__/raw-agent-view.test.tsx`
- `src/__tests__/mission-completion-integration.test.tsx`
- `src/__tests__/page-connection-status.test.tsx`

### Utility/Logic — Mixed Valid and Invalid (8)

- `src/__tests__/shared-imports.test.ts` — 60% export-existence checks, 40% valid transition logic
- `src/__tests__/filter-state-types.test.ts` — first 170 lines type-shape, rest is valid `useFilterState` tests
- `src/__tests__/agent-constants.test.ts` — asserts exact Tailwind class strings
- `src/__tests__/theme-types.test.ts` — asserts exact hex color values
- `src/__tests__/card-animation-styles.test.ts` — reads CSS file and asserts substrings
- `src/__tests__/sse-token-usage.test.ts` — mixed type-shape and valid behavioral tests
- `src/__tests__/hook-event-tokens.test.ts` — 2 valid integration tests + 1 type-shape test
- `src/__tests__/dashboard-api.test.ts` — heavily mocked, tests mock setup more than service

### Integration/Infrastructure (7)

- `src/__tests__/integration/project-isolation.test.ts` — mocks entire DB (defeats "integration" purpose)
- `src/__tests__/integration/api.test.ts` — uses stale stage names (`backlog`, `in_progress`)
- `src/__tests__/integration/stage-consistency.test.ts` — half valid, half tautological
- `src/__tests__/prisma/project-schema.test.ts` — regex-based schema parsing is fragile
- `src/__tests__/prisma/projectId-required.test.ts` — duplicate of project-schema + fragile regex
- `src/__tests__/prisma/indexes.test.ts` — fragile regex but tests real schema file
- `src/__tests__/lib/db.test.ts` — top half valid (singleton), bottom half tests string literals

### MCP Server (4)

- `src/__tests__/tools/items.test.ts` — conditional `if ('message' in result)` assertions silently pass
- `src/__tests__/tools/missions.test.ts` — same conditional assertion weakness
- `src/__tests__/tools/agents.test.ts` — same issue, but has valuable outcome mapping test
- `src/__tests__/tools/utils.test.ts` — duplicated agent validation tests

### Plugin Infrastructure (2)

- `commands/__tests__/resume-recovery.test.js` — hardcoded transition matrix instead of importing from source
- `agents/__tests__/observer-hooks-config.test.ts` — hand-rolled YAML parser is maintenance liability

---

## Best Tests (Gold Standard Examples)

These represent what good looks like. Future tests should follow these patterns.

### API Route Tests

| File | Why It's Good |
|------|---------------|
| `api/agents/stop.test.ts` | Imports real handler, tests business logic (stage-aware transitions, claim validation), clear fixtures |
| `api/board/claim.test.ts` | Imports real handler, covers business rules (done/briefings rejection, 409 on double-claim) |
| `api/board/claim-race-condition.test.ts` | Tests a specific real bug, verifies `$transaction` atomicity, simulates concurrency |
| `api/board/events.test.ts` | Tests real SSE behavior: streaming, change detection, heartbeats, cleanup |
| `api/board/events-activity-log.test.ts` | Tests race condition fix with comments explaining the bug being prevented |
| `api/items/dependency-validation.test.ts` | Imports real handler, tests N+1 query fix |
| `api/projects/route.test.ts` | ID normalization, format validation, case-insensitive duplicate detection |
| `api/stages.test.ts` | Comprehensive validation: negative numbers, floats, strings, booleans, boundary testing |
| `api/missions/postcheck.test.ts` | Tests real parsing logic (lint errors, test counts), state transitions, edge cases |

### Utility/Logic Tests

| File | Why It's Good |
|------|---------------|
| `lib/api-validation.test.ts` | Tests real validators with happy/negative/edge paths, error quality assertions |
| `lib/validation.test.ts` | Exhaustive transition matrix coverage, WIP limits, cycle detection |
| `lib/api-transform.test.ts` | Tests real transform function with realistic data |
| `lib/project-validation.test.ts` | Regex tests, find-or-create logic, case normalization |
| `dependency-utils.test.ts` | Pure function tests with graph cycle detection |
| `activity-log.test.ts` | Tests `parseLogEntry`/`parseLogFile` with malformed entries, edge cases |
| `filter-utils.test.ts` | Tests AND-logic filter combination across multiple dimensions |
| `duration-pairing.test.ts` | Real algorithm testing with immutability checks |
| `token-cost.test.ts` | Known model pricing, fallback pricing, custom config |

### UI Component Tests

| File | Why It's Good |
|------|---------------|
| `progress-bar-item-move.test.tsx` | Regression test for real bug, uses `aria-valuenow` not CSS |
| `progress-stats-sse-integration.test.tsx` | Stats from actual work items, covers add/move/delete/rapid updates |
| `page-activity-initial-load.test.tsx` | Tests real bug fix (logs disappearing on refresh) |
| `page-wip-handler.test.tsx` | Full integration: API calls, error handling, state rollback on failure |
| `header-bar-reopen.test.tsx` | Timer resume, interval cleanup, rapid toggling |
| `filter-keyboard-shortcuts.test.tsx` | "/" focus, Cmd+K, Escape, input-focus guard |
| `filter-empty-state.test.tsx` | Integration: apply filters, verify empty state, clear restores items |
| `board-archive.test.tsx` | Integration for archive flow, no re-render loops |
| `token-usage-panel.test.tsx` | Business logic: formatting, sorting, proportional bars |
| `work-item-modal.test.tsx` | Open/close, escape, metadata, acceptance criteria checkboxes |

### MCP Server Tests

| File | Why It's Good |
|------|---------------|
| `client.test.ts` | Retry logic with fake timers, URL normalization, error classification, delay race conditions |
| `errors.test.ts` | HTTP status to MCP error mapping, circular reference handling, `withErrorBoundary` |
| `lib/schema-utils.test.ts` | Pure function with comprehensive Zod type coverage |
| `lib/agents.test.ts` | Agent name normalization pipeline (`'ba'` -> `'B.A.'`) |
| `tools/board.test.ts` | Dependency injection pattern, real error message construction |
| `server.test.ts` (config section) | Environment variable parsing with edge cases |
| `http-client-config.test.ts` | Static analysis test that caught a real bug (WI-119) |

### Plugin Infrastructure Tests

| File | Why It's Good |
|------|---------------|
| `hooks/block-lynch-writes.test.ts` | Runs actual hook as subprocess with real JSON stdin — gold standard |
| `hooks/orchestrator-boundary.test.ts` | Same subprocess pattern, marker file guard, allowlist logic |
| `hooks/parse-transcript.test.ts` | Pure function with real temp files, edge cases |
| `hooks/resolve-agent.test.ts` | Thorough prefix stripping, fallback precedence, null handling |
| `hooks/enforce-hooks.test.js` | Comprehensive integration tests for 5 enforcement hooks |
| `hooks/stop-guards.test.ts` | Agent targeting with `__TEST_MOCK_RESPONSE__` env var injection |
| `shared/shared.test.ts` (transition section) | Validates `review` cannot skip `probing` to reach `done` |

### E2E Tests

| File | Why It's Good |
|------|---------------|
| `e2e/workflow-regression.spec.ts` | True E2E: project creation through completion with real HTTP |
| `e2e/board-load.spec.ts` | Uses `data-testid`, verifies 8 columns render |

---

## Top 10 Recommendations

1. **Delete the 46 invalid files** — they provide false confidence and maintenance burden

2. **Strip `toHaveClass` Tailwind assertions** from the 28 flagged UI test files — keep only behavioral assertions

3. **Add a testing guideline to CLAUDE.md**: "If a test imports only types (not functions) and makes no function calls to production code, it is invalid"

4. **Fix conditional assertions in MCP server tests** — the `if ('message' in result)` pattern silently passes on wrong response shapes

5. **Replace hardcoded tool counts** in `mcp-server/tools/index.test.ts` with structural assertions (unique names, non-empty descriptions)

6. **Fix the no-op assertion** in `events-circuit-breaker.test.ts` line 639: `expect(true).toBe(true)`

7. **Consolidate fragmented component tests** — agent-badge (2 files), filter-bar (3 files), header-bar (5 files), board-column (3 files) should each be merged

8. **Prefer the subprocess execution pattern** for hook tests (as in `block-lynch-writes.test.ts`)

9. **Prefer the dependency injection pattern** for MCP tool tests (as in `board.test.ts`)

10. **Never define the function-under-test inside the test file** — always import from production code

---

## Testing Guidelines for Future Development

### A test is INVALID if it:
- Imports only types (not functions) and makes no function calls to production code
- Mocks the module it claims to test (`vi.mock('@/app/api/items/route')` then calls the mock)
- Defines the function-under-test inline rather than importing from production code
- Only asserts that object properties equal the values just assigned to them
- Uses `expect(true).toBe(true)` or equivalent no-op assertions
- Reads source files with `fs.readFileSync` and regex-matches for strings

### A test is BRITTLE if it:
- Asserts specific Tailwind utility classes (`bg-green-500`, `w-8`, `rounded-full`)
- Asserts exact Prisma query shapes instead of HTTP response behavior
- Hardcodes counts that change when features are added (e.g., `toHaveLength(22)`)
- Uses regex to parse non-test files (schema.prisma, CSS, markdown)
- Tests `console.error` message substrings that break on any rewording

### A test is GOOD if it:
- Imports and calls real production code (route handlers, utility functions, hooks)
- Tests behavior, not implementation details
- Would fail if the code under test were broken
- Would NOT fail if the code were refactored without changing behavior
- Has clear arrange-act-assert structure with descriptive names
- Covers a real bug, edge case, or business rule
