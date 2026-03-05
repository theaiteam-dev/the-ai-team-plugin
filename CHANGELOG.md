# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
