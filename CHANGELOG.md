# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Pipeline parallelism with multi-instance agents:** Runnable pool architecture enabling multiple concurrent instances of the same agent (e.g., `murdock-1`, `murdock-2`, `ba-1`, `ba-2`). Native teams orchestration dispatches work items to available pool members, allowing true parallel feature development within memory and dependency constraints. See `playbooks/orchestration-native.md` for pool-based handoff protocol (#037-047).
- **Atomic pool-based peer-to-peer handoffs:** `ateam agents-stop agentStop` now manages a `/tmp/.ateam-pool/<missionId>/` directory of `.idle`/`.busy` marker files. On successful completion, the CLI atomically releases the finishing agent's slot (via defer, even on API error) and claims an idle successor instance (`claimedNext` in the response). When no successor is idle it surfaces a `poolAlert` so the agent can escalate to Hannibal for manual dispatch. Includes lane-based pre-warming and guards for missing pool directories after `/tmp` clears.
- **`ateam scaling compute` CLI command:** New `ateam scaling compute [--concurrency N] [--memory N] --json` command wraps `POST /api/scaling/compute`, returning the computed instance count, binding constraint, and memory/DAG rationale. Used by `/ai-team:run` to size the runnable pool before dispatch.
- **Adaptive scaling system:** Automatic instance count calculation balancing two constraints: (1) dependency graph parallelism (maximum items per stage from DAG), (2) memory budget ceiling (WIP limits from available context window). Chooses `min(depGraphMax, memoryCeiling)` and persists the rationale (which constraint is binding) to the database. Includes new `packages/shared/src/{dep-graph-analysis, memory-budget, adaptive-scaling}.ts` modules with comprehensive test coverage (#038, #039, #041).
- **`--concurrency N` CLI flag:** Users can override adaptive scaling with a fixed instance count for manual tuning or testing. Passed to `/ai-team:run` or `ateam missions createMission --concurrency 4`. Invalid if < 1. (#043, #044).
- **Scaling rationale modal in Kanban UI:** New modal component showing the scaling decision for the current mission: instance count, binding constraint (memory/dep-graph/override), and the factors that led to the decision. Accessible from HeaderBar. (#046).
- **Mission scaling API endpoints:** New Prisma field `scalingRationale` (JSON) on Mission table stores the full ScalingRationale. REST endpoints expose it: `GET /api/missions/{missionId}` (includes scaling), `GET /api/missions/current` (includes scaling), `POST /api/missions` accepts `concurrencyOverride` parameter. (#042).
- **Final review persistence:** Stockwell's Final Mission Review is now durably stored on the mission instead of living only in chat. New `Mission.finalReview` field plus `GET`/`POST /api/missions/{missionId}/final-review` endpoints and Go CLI commands (`ateam missions-final-review getFinalReview` / `writeFinalReview --report "..."`). Tawnia reads the stored report when drafting the release commit.
- **`agentStop --outcome rejected --return-to <stage>` flag:** Rejection is now expressed through the agent lifecycle rather than a separate item command. Lynch/Stockwell pass `--outcome rejected --return-to testing|implementing` to send an item backward; the API validates the target stage, increments `rejection_count`, and records the summary in `work_log` within a single transaction.
- **Pipeline-parallelism enforcement hooks:** New `scripts/hooks/enforce-handoff.js` and `scripts/hooks/enforce-agent-start.js` guard the pool-based workflow — agents cannot complete work without a matching `agentStart` claim, and peer handoffs must target the correct next role. Registered in `hooks/hooks.json` for both legacy and native teams modes.
- **Concurrent-execution guards in B.A. and Murdock prompts:** Agent instructions now explicitly describe pool-aware behavior (no shared scratch files, idempotent test/impl writes, safe re-entry after rejection).
- **Agent quality skill ecosystem:** Consolidated defensive coding, security input validation, and code pattern references into three reusable skills: `skills/defensive-coding/SKILL.md`, `skills/security-input/SKILL.md` (migrated from agents/references), and `skills/code-patterns/SKILL.md` (consolidated from 3 prior references). Agents now reference these by skill name instead of inline examples.
- **Enhanced agent prompts with quality skills:** Updated 6 agent instructions (B.A., Lynch, Murdock, Amy, Stockwell, Face/Tawnia) to include quality skill references, expanded defensive-coding checklists, adversarial review steps, and integration test requirements.
- **Per-item test scoping:** B.A. and Lynch now run only the work item's own test file (`outputs.test`) instead of the full suite. Sibling items in TDD-red state (Murdock wrote tests, B.A. hasn't implemented yet) caused false failures when running the full suite. Stockwell is now the first full-suite checkpoint at mission end, catching cross-item integration issues.
- **Shell-composition child stubbing ban (Ban #12):** New test-writing anti-pattern banning stubs of immediate children of shell/layout components (App, page, layout). Stubbing all children creates a mock sandwich that tests JSX composition, not application behavior.
- **Mission retrospective system:** Complete retro reporting for missions with Prisma schema migration, API endpoints (`POST/GET /api/missions/{id}/retro`), Go CLI commands (`ateam missions-retro writeRetro/getRetro`), React UI component (`RetroReport.tsx`), and slash command (`/retro`).
- **Agents/references deprecation:** Removed 5 agent reference files (`agents/references/{api-and-data, code-quality, security, testing, type-safety}.md`) — functionality migrated to reusable skills.

### Changed

- **Agents/AGENTS.md:** Updated to reflect skill-based quality pattern distribution (no more inline references).
- **Agent prompts restructured:** Consolidated checklists in B.A. (expanded defensive-coding section), added 4-skill review matrix in Lynch, integration test requirements in Murdock, logic edge-case sweeps in Amy, and unified skillset in Stockwell.
- **Per-stage WIP limits clarified and enforced:** WIP limits are applied per column (per stage), never summed across stages. An idle agent is always dispatched work if its stage has capacity, regardless of how many items are in other stages. `POST /api/agents/stop` now wraps the advance + WIP check in a single Prisma transaction to eliminate the race where two concurrent completions could both slip past a capacity check. On violation, the route returns `{ wipExceeded: true, blockedStage }` and the CLI surfaces a `WIP_LIMIT_EXCEEDED` warning so the agent can escalate to Hannibal.
- **AC reconciliation checklists added to reviewer prompts:** Lynch and Stockwell now explicitly re-check every acceptance criterion against the final diff before approving, reducing silent AC drift.

### Removed

- **`ateam items rejectItem` command removed (BREAKING):** The standalone reject-item CLI command, its MCP tool, and the `POST /api/items/{id}/reject` route have been deleted. Callers must now use `ateam agents-stop agentStop --outcome rejected --return-to <stage>` (or the equivalent `/api/agents/stop` payload). The new path is transactional with the rest of the agent lifecycle, which closes the rejection/claim race the old endpoint had.
- **36 invalid test files deleted** (13,945 lines): type-shape tests, self-mocking route tests, source regex matchers, local reimplementation tests, no-op assertion tests, and pure Tailwind class assertion tests. See TEST-REPORT.md for the full list.
- **3 additional files deleted during rework:** `agent-constants.test.ts`, `card-animation-styles.test.ts`, `prisma/projectId-required.test.ts` (duplicates or entirely invalid after cleanup).

### Fixed

- **Critical: agentStop defer pool release bug:** `defer poolSelfRelease(agentName)` captured the pre-`--body` value of `agentName` (often empty string), orphaning pool slots and permanently reducing available concurrency. Fixed with closure-based defer after body resolution.
- **Idempotent concurrent agent stop:** `agentClaim.delete` threw Prisma P2025 when two concurrent stop requests raced. Changed to `agentClaim.deleteMany` which returns `{ count: 0 }` safely.
- **createItem validation:** `ateam items createItem` now requires `--description` and at least one `outputs.*` flag. Previously, items could be created without these fields, causing downstream agent failures.
- **Sosa removed from claimable-agent enum:** Sosa is a requirements critic dispatched as a subagent, not a pipeline worker that claims board items. Removed from `board-claim claimItem` validation.
- **Output collision in Face breakdown:** Fixed false-positive output collision errors when Face created work items with shared output paths during dependency-aware decomposition.
- **`--body-file` flag for large CLI payloads:** Fixed `ateam agents-stop agentStop --body-file` path that wasn't populating `agentName` before pool release, causing orphaned slots.
- **finalReview column migration:** Added missing Prisma migration for `Mission.finalReview` TEXT column. 29 tests across 7 files were failing with `SQLITE_ERROR: no such column: main.Mission.finalReview`.
- **Rejection path in teams-messaging skill:** Updated from `--advance=false` (which only releases the claim) to `--outcome rejected --return-to <stage>` (which records the rejection). Removed contradictory "no ACK required" / "wait 20s for ACK" text.
- **Scaling route error response:** Replaced hand-rolled error payload in `POST /api/scaling/compute` with standard `ApiError` pattern using `projectValidation.error`.
- **Stripped Tailwind CSS class assertions** from 21 UI component test files. Removed `toHaveClass` checks on utility classes (`bg-green-500`, `rounded-full`, `w-8`, etc.) while preserving all behavioral assertions.
- **Replaced Prisma query-shape assertions** in 5 API route test files with HTTP response-level assertions. Tests now verify status codes and response bodies instead of internal ORM call shapes.
- **Fixed conditional assertions in MCP server tests** (`tools/items.test.ts`, `tools/missions.test.ts`). Replaced `if ('message' in result)` guards with unconditional assertions that will actually fail when error handling breaks.
- **Fixed stale stage names** in `integration/api.test.ts` — replaced `backlog`/`in_progress` with canonical `briefings`/`implementing`.
- **Removed tautological test sections** from `stage-consistency.test.ts`, `project-isolation.test.ts`, `lib/db.test.ts`, `shared-imports.test.ts`, `filter-state-types.test.ts`, `sse-token-usage.test.ts`, `hook-event-tokens.test.ts`, `dashboard-api.test.ts`, `theme-types.test.ts`.
- **Fixed `resume-recovery.test.js`** to import `TRANSITION_MATRIX` from `@ai-team/shared` instead of hardcoding a stale copy.
- **Replaced hand-rolled YAML parser** in `observer-hooks-config.test.ts` with simpler string-based extraction that doesn't depend on exact indentation levels.
- **Fixed `events-circuit-breaker.test.ts`** — removed `expect(true).toBe(true)` no-op and fragile `console.error` substring assertions.

### Changed

- Test suite reduced from 178 to 139 files. All remaining tests import and execute real production code.

## [1.1.1] — 2026-03-24

### Fixed

- **CLI ignoring `ATEAM_API_URL`:** The `ateam` CLI `--base-url` flag was hardcoded to `http://localhost:3000` and never read the `ATEAM_API_URL` environment variable. The CLI now uses `ATEAM_API_URL` when set, falling back to `localhost:3000` only when neither the env var nor the flag is provided.

## [1.1.0] — 2026-03-23

### Changed

- **Org migration:** Moved repository from `queso/the-ai-team-plugin` to `theaiteam-dev/the-ai-team-plugin`. All references updated (marketplace, GHCR images, setup command, README).
- **Access token support:** The `ateam` CLI now reads `ACCESS_CLIENT_ID` and `ACCESS_CLIENT_SECRET` from the environment and sends them as `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers. Enables hosted instances behind Cloudflare Access or similar access gateways.
- **README overhaul:** Replaced separate Installation/Quick Start/Kanban Dashboard sections with a unified Getting Started guide covering plugin install, Docker image startup, setup, and hosted instance configuration.

## [1.0.2] — 2026-03-22

### Added — Kanban-Viewer Docker Image (GHCR)

The kanban-viewer now ships as a pre-built multi-platform Docker image published to GHCR on every release. Users no longer need to clone the repo or build locally — `/ai-team:setup` pulls and starts the container automatically.

#### New Files
- `.claude-plugin/docker-compose.yml` — one-file compose config pointing at `ghcr.io/theaiteam-dev/kanban-viewer:latest`; data persisted at `~/.ateam/data`
- `packages/kanban-viewer/docker-entrypoint.sh` — initializes the SQLite database on first boot when a fresh volume is mounted (copies baked-in seed DB), then starts the server

#### Changed
- `packages/kanban-viewer/Dockerfile` — seeds database to `prisma/data.init/` at build time (not `prisma/data/`); runner stage ships the seed DB separately so volume mounts don't hide it; uses `docker-entrypoint.sh` as CMD
- `.github/workflows/release.yml` — added `packages: write` permission and `docker` job that builds and pushes `linux/amd64` + `linux/arm64` images to GHCR tagged as `:vX.Y.Z` and `:latest` on every `v*` tag; uses GHA layer cache for fast rebuilds
- `commands/setup.md` — Step 9 updated to use `docker compose -f "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/docker-compose.yml" up -d` (works for marketplace installs, no repo clone required)
- `README.md` — marketplace install promoted as primary method; kanban dashboard section updated with correct compose command and data persistence notes

### Changed

- **Versioning:** `ateam` CLI binary now embeds version via ldflags (`-X ateam/cmd.Version`), exposing `ateam --version`. Release workflow injects the git tag. `plugin.json` gains a `minCliVersion` field; `/ai-team:run` aborts with a clear message if the installed CLI is below the minimum, and `/ai-team:setup` auto-updates the binary when it is. Lock-step versioning: plugin version == CLI minimum version.
- **Plugin distribution:** Added `.claude-plugin/marketplace.json` — users can now install via `/plugin marketplace add theaiteam-dev/the-ai-team-plugin` + `/plugin install ai-team@the-ai-team-plugin` instead of git submodule.
- **Setup command:** Removed automatic permission injection. `setup` no longer writes `permissions.allow` entries to `settings.local.json` — permissions are the user's decision. The Permissions section in the setup docs is now informational guidance only.
- **B.A. retry guidance:** Added `ba-{id}-r{n}` naming convention for re-dispatched agents after rejection. Hannibal now injects a `## Prior Rejection` section at the top of B.A.'s prompt on retries so Lynch's rejection reason is prominent rather than buried in the work log. Fixed misleading comment implying B.A. saw the diagnosis automatically.
- **MCP server:** `MissionPostcheckInput` now uses `z.input` instead of `z.infer` so callers can legally omit defaulted fields (`blockers`, `output`).

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
