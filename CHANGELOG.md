# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — PRD-009: Recoverable Precheck Failure State

New `precheck_failure` mission state distinguishes transient precheck failures from terminal execution failures. When lint or test checks fail during precheck, the mission now enters `precheck_failure` (recoverable) instead of `failed` (terminal). Operator can fix lint/test issues and retry without re-running the expensive planning phase.

#### API Architecture Fix
Corrected fundamental architectural flaw where `POST /api/missions/precheck` was executing shell commands inside the kanban-viewer Docker container (target project never mounted). API now accepts agent-reported `{ passed, blockers, output }` from Hannibal, who runs checks locally via Bash against the target project.

#### New Files
- `packages/kanban-viewer/src/components/PrecheckFailureBanner.tsx` — amber inline banner showing precheck failure details with expandable raw output and retry CTA
- `packages/kanban-viewer/src/components/MissionHistoryPanel.tsx` — mission archive/history drawer triggered from HeaderBar, master-detail layout showing past missions with metadata
- `packages/kanban-viewer/src/app/api/missions/[missionId]/route.ts` — new single-mission lookup endpoint
- `packages/kanban-viewer/src/__tests__/precheck-failure-banner.test.tsx` — 4 tests
- `packages/kanban-viewer/src/__tests__/mission-history-panel.test.tsx` — 5 tests
- `packages/kanban-viewer/src/__tests__/missions-409-precheck-failure.test.ts` — 5 tests
- `packages/kanban-viewer/src/__tests__/api/missions/history.test.ts` — 3 tests
- `packages/kanban-viewer/prisma/migrations/20260306000000_add_precheck_failure/` — add precheckBlockers, precheckOutput columns; add precheck_failure to MissionState enum

#### Changed
- `packages/kanban-viewer/src/types/mission.ts` — add `precheck_failure` to MissionState enum; add precheckBlockers, precheckOutput optional fields
- `packages/kanban-viewer/prisma/schema.prisma` — add precheckBlockers (JSON TEXT), precheckOutput (JSON TEXT) to Mission model; add precheck_failure to MissionState enum
- `packages/kanban-viewer/src/app/api/missions/precheck/route.ts` — remove command execution code; accept `{ passed, blockers, output }` from request body; transition to precheck_failure on failure instead of failed
- `packages/kanban-viewer/src/app/api/missions/route.ts` — add 409 guard when POST without force and mission in precheck_failure state; add ?state= filter to GET endpoint
- `packages/kanban-viewer/src/app/page.tsx` — add PrecheckFailureBanner above DashboardNav when mission in precheck_failure state; add MissionHistoryPanel drawer
- `packages/kanban-viewer/src/components/header-bar.tsx` — add History button triggering mission history drawer
- `packages/mcp-server/src/tools/missions.ts` — change `mission_precheck` input schema from `{checks[]}` to `{passed, blockers, output}`; add new `mission_list` MCP tool
- `playbooks/orchestration-legacy.md` + `playbooks/orchestration-native.md` — add Precheck Flow section documenting Hannibal's responsibility to read ateam.config.json, run checks via Bash, report results
- `commands/run.md` — document precheck_failure as recoverable; operator can fix and retry

#### Test Coverage
- 17 new tests across 7 test files
- Precheck failure banner rendering and retry logic (4 tests)
- Mission history panel and drawer functionality (5 tests)
- API 409 guard for precheck_failure (5 tests)
- Mission history endpoint (3 tests)

#### Bug Fix
- Fixed pre-existing bug where mission-active marker was never set: API response now includes `allPassed` at top level so MCP tool's existing marker check works correctly

### Added — PRD-008: Token Usage Tracking

End-to-end token usage tracking from agent transcripts to dashboard display.
Hooks parse JSONL transcripts to extract token counts on agent stop events. HookEvent
API stores token fields (inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
model). Token cost calculator computes estimated USD from configurable per-model pricing.
Aggregation endpoint groups token usage by agent+model for a mission with deduplication logic.
SSE integration emits mission-token-usage events to the dashboard on mission completion.
TokenUsagePanel React component displays per-agent cost breakdown with proportional bars.
Token summary formatter produces one-line commit summaries for CHANGELOG entries.

#### New Files
- `scripts/hooks/lib/parse-transcript.js` — JSONL transcript parser for token extraction
- `packages/kanban-viewer/src/lib/token-cost.ts` — cost calculator with per-model pricing
- `packages/kanban-viewer/src/lib/token-summary.ts` — one-line token summary formatter
- `packages/kanban-viewer/src/app/api/missions/[missionId]/token-usage/route.ts` — aggregation endpoint
- `packages/kanban-viewer/src/components/token-usage-panel.tsx` — React component for cost display
- `packages/kanban-viewer/src/__tests__/hook-event-tokens.test.ts` — 5 tests
- `packages/kanban-viewer/src/__tests__/token-cost.test.ts` — 6 tests
- `packages/kanban-viewer/src/__tests__/token-aggregation.test.ts` — 8 tests
- `packages/kanban-viewer/src/__tests__/sse-token-usage.test.ts` — 6 tests
- `packages/kanban-viewer/src/__tests__/token-usage-panel.test.tsx` — 6 tests
- `packages/kanban-viewer/src/__tests__/token-summary.test.ts` — 5 tests
- `scripts/hooks/__tests__/parse-transcript.test.ts` — 5 tests
- `packages/kanban-viewer/src/__tests__/setup-jest-dom.ts` — Jest DOM setup helper

#### Changed
- `packages/kanban-viewer/prisma/schema.prisma` — added HookEvent token fields (inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, model) and MissionTokenUsage aggregation model
- `ateam.config.json` — new pricing section with per-model token costs ($/1M tokens)
- `scripts/hooks/observe-subagent.js` — parse transcript and extract tokens on subagent stop
- `scripts/hooks/observe-stop.js` — parse transcript and extract tokens on stop event
- `scripts/hooks/lib/observer.js` — token field injection into HookEvent
- `packages/kanban-viewer/src/app/api/hooks/events/route.ts` — store token fields in HookEvent
- `packages/kanban-viewer/src/app/api/board/events/route.ts` — emit mission-token-usage SSE event
- `packages/kanban-viewer/src/hooks/use-board-events.ts` — callback support for SSE events
- `packages/kanban-viewer/src/types/index.ts` — TokenUsageData, MissionTokenUsage type exports
- `packages/kanban-viewer/src/types/hook-event.ts` — HookEvent token fields
- `packages/kanban-viewer/vitest.config.ts` — setUp configuration
- `agents/tawnia.md` — updated Tawnia prompt with token summary formatter details

#### Test Coverage
- 39 new tests across 7 test files
- Hook transcript parsing (5 tests)
- Token cost calculation (6 tests)
- Mission aggregation with deduplication (8 tests)
- SSE integration (6 tests)
- React component rendering (6 tests)
- Token summary formatting (5 tests)
- Transcript parsing utilities (3 tests)

### Added — PRD-007: Native Teams Hook Enforcement

Plugin-level enforcement hooks so agent boundaries work in native teams mode
(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Previously, enforcement hooks only
fired for legacy subagent sessions (via frontmatter). Now all enforcement hooks
are dual-registered in `hooks/hooks.json` with `resolveAgent()` guards.

#### New Files
- `scripts/hooks/lib/resolve-agent.js` — shared agent identity utility (`resolveAgent`, `isKnownAgent`, `KNOWN_AGENTS`)
- `scripts/hooks/lib/send-denied-event.js` — fire-and-forget denied event recording via A(i)-Team API
- `scripts/hooks/block-lynch-writes.js` — new Lynch write enforcement hook (coverage gap fix)
- `scripts/hooks/__tests__/resolve-agent.test.ts` — 15 tests
- `scripts/hooks/__tests__/send-denied-event.test.ts` — 9 tests
- `scripts/hooks/__tests__/pretooluse-guards.test.ts` — ~115 tests
- `scripts/hooks/__tests__/stop-guards.test.ts` — 31 tests
- `scripts/hooks/__tests__/block-lynch-writes.test.ts` — 20 tests
- `scripts/hooks/__tests__/orchestrator-boundary.test.ts` — 28 tests

#### Changed
- `hooks/hooks.json` — 13 new PreToolUse + Stop enforcement entries registered at plugin level
- All 13 PreToolUse enforcement hooks — added `resolveAgent()` guard + `sendDeniedEvent()` telemetry
- All 5 Stop enforcement hooks — added `resolveAgent()` guard
- `scripts/hooks/enforce-orchestrator-boundary.js` — expanded from blocklist to allowlist approach with `resolveAgent()`
- `CLAUDE.md` — new sections on dual registration pattern, agent identity resolution, and denied event telemetry; fixed stale `hooks/` directory comment
- `agents/AGENTS.md` — new sections on dual registration pattern and shared utilities
