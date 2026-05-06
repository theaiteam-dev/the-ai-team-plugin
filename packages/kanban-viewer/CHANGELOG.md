# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

#### Mission Telemetry Endpoints

Three new aggregation endpoints expose hook-event data per mission. All require the `X-Project-ID` header. See `docs/api.md` and `openapi.yaml` for full schemas.

- **`GET /api/missions/{missionId}/tool-histogram`** — per-agent tool-call counts grouped by `toolName` (Prisma `groupBy + _count`). Powers the retro agent's "Tool Usage" section. Go CLI: `ateam missions getToolHistogram <missionId>`.
- **`GET /api/missions/{missionId}/skill-usage`** — per-agent `Skill` invocations with `invocations` and `distinctArgs` counts. Filters `eventType: 'pre_tool_use'` so pre+post Skill events don't double-count. Go CLI: `ateam missions getSkillUsage <missionId>`.
- **`GET /api/missions/current/health-report`** — pure-data activity report for in-flight items. Returns per-item `claimedAt`/`lastActivityAt`/`lastActivitySource`/`idleSeconds`/`lastWorkLogEntry`/`recentActivity` plus an aggregate `missionIdle` boolean (600s per-item idle threshold). Active-mission scoped via `MissionItem` join + `state notIn (completed/failed/archived)`. Used by Hannibal's `/ai-team:healthcheck` slash command. Go CLI: `ateam missions-health getHealthReport`.

#### Skill Activation in Hook Events

`HookEvent.payload` now carries `skill_name` and a 12-char SHA-256 `args_hash` for every `Skill` tool call. No schema migration required — payload is already a JSON column. Powers the new skill-usage endpoint above.

#### `ScheduleWakeup` Payload Capture

`HookEvent.payload` for `ScheduleWakeup` tool calls now records `prompt` (truncated to 1000 chars), `reason`, and `delay_seconds`. Surfaced in the activity-feed `summary` so the dashboard shows what each heartbeat scheduled. Diagnostic-quality data for the heartbeat loop.

### Changed

- **`POST /api/agents/stop` rejection cap is configurable** via the `ATEAM_REJECTION_CAP` environment variable (default `4`). Non-integers (`1.5`, `NaN`), zero, and negatives all fall back to the default; previously decimals silently floored to `1` and blocked items at count=2 instead of the configured value.
- **`POST /api/agents/stop` schema synced** in `openapi.yaml`: removed dead `409 WIP_LIMIT_EXCEEDED` response (route returns `200` with `wipExceeded` + `blockedStage` instead), added `rejectionCount` and `escalated` fields to rejection-path responses, dropped stale `nextStage: nullable`, corrected the WIP-exceeded narrative.
- **Health-report active-mission scoping fixed:** `GET /api/missions/current/health-report` now uses `state notIn (completed/failed/archived)` matching the rest of the mission APIs. Previously `archivedAt: null` alone matched completed-but-not-archived missions and surfaced stale data.
- **Health-report cross-item signal-leak fixed:** when `payload.itemId` is missing from a hook event, the assigned-agent fallback is now bounded by `timestamp >= claimedAt` for both `hookEvents` and `activityLogs`. Prevents events from earlier claims on other items the same agent worked on from being attributed to the current item.

## [0.12.0] - 2026-01-30

### Added

#### Editable WIP Limits

Board columns now support inline editing of WIP (Work In Progress) limits with real-time visual feedback.

**New API Endpoint**
- `PATCH /api/stages/:id`: Update WIP limit for a stage
- Validates input (positive integers or null for unlimited)
- Returns 400/404/500 error responses appropriately

**WIP Display Format**
- Column headers now show `count/limit` format (e.g., "3/5")
- Unlimited columns display infinity symbol (e.g., "3/∞")

**Color States**
- Yellow background when at limit (count equals limit)
- Red background when over limit (count exceeds limit)
- Normal styling when under limit

**Inline Editor**
- Click WIP display to edit limit
- Input accepts positive integers or empty for unlimited
- Escape to cancel, Enter or blur to save
- Automatic focus when entering edit mode

### Testing

- Added 73 new tests for editable WIP limits
- API endpoint tests (`src/__tests__/api/stages.test.ts`): 26 tests for validation, edge cases, error handling
- BoardColumn WIP display tests (`src/__tests__/board-column-wip.test.tsx`): 36 tests for display, colors, editor
- Page handler tests (`src/__tests__/page-wip-handler.test.tsx`): 11 tests for API integration

### Technical Details

Mission "Editable WIP Limits" completed:
- 3 work items delivered (WI-020, WI-021, WI-024)
- Zero rejections
- All items passed TDD-first testing workflow

---

## [0.11.0] - 2026-01-30

### Added

#### Multi-Item Agent Claims

Agents can now claim multiple work items simultaneously. The only limit is the WIP limit per stage column.

**Schema Changes**
- `AgentClaim` model now uses auto-increment `id` as primary key
- `itemId` remains unique (each item can only have one agent)
- `agentName` indexed for efficient querying
- Removed one-item-per-agent constraint

**WIP Limit Enforcement**
- `/api/agents/start` now checks WIP limit before allowing work to begin
- Returns `WIP_LIMIT_EXCEEDED` error when stage is at capacity
- Allows work when stage has no WIP limit (null)

#### Work Item Card Enhancements

**Work Log Indicator**
- Cards now show work log count: "📄 3 work summaries"
- Singular/plural text ("1 work summary" vs "3 work summaries")
- Uses FileText icon for visual indicator

**Work History Modal Colors**
- Agent names display in their respective colors in work history
- Colored bullet points match each agent's theme color
- Colors: Hannibal (green), Face (cyan), Murdock (amber), B.A. (red), Amy (pink), Lynch (blue), Tawnia (teal)

#### Docker Compose Support

Added `docker-compose.yml` for simplified container management:
- Bind mount for local database persistence (`./prisma/data:/app/prisma/data`)
- Container auto-restart policy
- Commands: `docker compose up -d`, `docker compose down`, `docker compose up -d --build`

### Changed

#### Activity Log Mission Scoping

Activity logs are now properly scoped to the current active mission:
- Only shows logs for the active mission (not archived/completed/failed)
- Returns empty list when no active mission exists
- Prevents stale logs from previous missions appearing after archive

### Fixed

#### Agent Claim Race Conditions

- Updated `AgentClaim` delete operations to use `itemId` (unique) instead of `agentName`
- Fixed `/api/agents/stop` and `/api/board/release` routes

### Testing

- Added WIP limit enforcement tests in `agents/start.test.ts`
- Tests verify: below limit allowed, at capacity rejected, null limit allowed, multiple agents up to limit

---

## [0.10.0] - 2026-01-28

### Added

#### Multi-Project Support (PRD 014-015)

Complete multi-project isolation with SQLite schema updates and project API.

**Database Schema Updates**
- New `Project` model with id, name, createdAt, updatedAt
- Foreign key relationships: `Item`, `Mission`, `ActivityLog` now belong to projects
- Database indexes on projectId for query performance
- `Item` output fields: `outputTest`, `outputImpl`, `outputTypes` for tracking generated files

**API Endpoints**
- `GET /api/projects`: List all projects
- `POST /api/projects`: Create new project
- Project identification via `X-Project-ID` header (auto-created on first use)

**Project Isolation**
- All API requests require X-Project-ID header
- Work items, missions, activity logs scoped to project
- Database maintains referential integrity with project constraints

#### Item Output File Tracking

Items now track output files generated during implementation:

**New Item Fields**
- `outputTest`: Path to test file (e.g., `src/__tests__/feature.test.ts`)
- `outputImpl`: Path to implementation file (e.g., `src/lib/feature.ts`)
- `outputTypes`: Path to types file (e.g., `src/types/feature.ts`)

**API Support**
- `outputs` field in `CreateItemRequest` and `UpdateItemRequest`
- Output collision detection in dependency validation
- WorkLog entries include outputs for tracking what was created

#### Improved Error Handling

**Error Factory Functions** (`src/lib/errors.ts`)
- Standardized error creation with factory functions
- Each error includes code, message, and contextual details
- Error codes: ITEM_NOT_FOUND, INVALID_TRANSITION, WIP_LIMIT_EXCEEDED, DEPENDENCY_CYCLE, OUTPUT_COLLISION, CLAIM_CONFLICT, VALIDATION_ERROR, UNAUTHORIZED, SERVER_ERROR, DATABASE_ERROR, INVALID_STAGE

**Error Classes**
- `ApiError` class with serialization support
- `ApiErrorResponse` interface for consistent error format
- `OutputCollisionDetail` interface for output conflict reporting

#### Migration Script Updates

- `scripts/migrate-from-json.ts`: Updated to support project-scoped migration
- Preserves all work items, dependencies, and stages during SQLite migration

### Changed

#### Breaking Change: ReleaseItemResponse

The `ReleaseItemResponse.agent` field is now `AgentName | null`:

```typescript
// Before
export interface ReleaseItemResponse {
  agent: AgentName;  // Always present
}

// After
export interface ReleaseItemResponse {
  agent: AgentName | null;  // null when no claim existed
}
```

This change makes the endpoint idempotent: releasing a non-existent claim returns `released: false, agent: null` instead of an error.

#### Database Indexes

Added performance indexes on frequently queried columns:
- `Item.stageId`: Stage filtering queries
- `Item.projectId`: Project isolation queries
- `Item.archivedAt`: Soft delete filtering
- `Item.assignedAgent`: Agent status queries
- `Mission.projectId`: Project mission queries
- `Mission.archivedAt`: Mission archival queries
- `ActivityLog.projectId`: Project activity queries

#### Type Organization

Consolidated project types with existing API response types in `src/types/api.ts`.

### Fixed

#### Race Condition in Item Claim

- Fixed concurrent claim requests via unique constraint on `AgentClaim`
- Added `CLAIM_CONFLICT` error code for race condition detection
- `createClaimConflictError()` factory for consistent error handling

#### Stage Transition Validation

- Improved validation matrix for all stage transitions
- Dependency cycle detection in transition operations
- Force override flag for WIP limit bypass with explicit override

### Testing

- Added comprehensive tests for multi-project support
- Project isolation integration tests
- Output file collision detection tests
- Error factory function unit tests
- Database index validation tests
- 100+ new tests across project and error handling

### Technical Details

**Prisma Migrations**
- Project model with cascading relationships
- Foreign key constraints on all project-scoped tables
- Database constraints ensure referential integrity

**Environment Support**
- SQLite database auto-creates project tables on first use
- No manual migration required for existing deployments
- Backward-compatible with single-project deployments

---

## [0.9.0] - 2026-01-21

### Added

#### Prisma ORM with SQLite Database (PRD 013)

Full API and storage layer with Prisma ORM, enabling programmatic kanban board management.

**Database Schema (8 models)**
- `Stage`: Board columns with WIP limits
- `Item`: Work items with type, priority, and timestamps
- `ItemDependency`: Self-referential many-to-many for dependencies
- `WorkLog`: Agent work history with actions and summaries
- `AgentClaim`: One-to-one agent-to-item claims
- `Mission`: Mission tracking with state and timestamps
- `MissionItem`: Many-to-many mission-to-item mapping
- `ActivityLog`: System activity entries with levels

**TypeScript Types** (`src/types/`)
- API request/response types in `api.ts`
- Board state types in `board.ts`
- Item types with relations in `item.ts`
- Agent types in `agent.ts`
- Mission types in `mission.ts`

**Validation Utilities** (`src/lib/`)
- `isValidTransition`: Stage transition matrix validation
- `checkWipLimit`: WIP limit enforcement with force override
- `validateDependencies`: Cycle detection and dependency validation
- `errors.ts`: Standardized API error classes

**18 REST API Endpoints**

Board Operations:
- `GET /api/board`: Full board state with stages, items, stats
- `POST /api/board/move`: Move item between stages with transition validation
- `POST /api/board/claim`: Claim item for agent
- `POST /api/board/release`: Release agent claim

Item Operations:
- `GET /api/items`: List all items with filters
- `POST /api/items`: Create new item
- `GET /api/items/[id]`: Get item with relations
- `PATCH /api/items/[id]`: Update item fields
- `DELETE /api/items/[id]`: Soft delete item
- `POST /api/items/[id]/reject`: Reject item with reason
- `GET /api/items/[id]/render`: Render item as markdown

Agent Operations:
- `POST /api/agents/start`: Start work (claim + move + log)
- `POST /api/agents/stop`: Stop work with outcome

Mission Operations:
- `GET /api/missions`: List all missions
- `POST /api/missions`: Create new mission
- `GET /api/missions/current`: Get active mission
- `POST /api/missions/precheck`: Validate mission readiness
- `POST /api/missions/postcheck`: Validate mission completion
- `POST /api/missions/archive`: Archive mission and items

Utility Operations:
- `GET /api/deps/check`: Validate dependency graph
- `GET /api/activity`: Get activity log entries
- `POST /api/activity`: Log activity entry

**Migration Script** (`scripts/migrate-from-json.ts`)
- Migrates existing `board.json` data to SQLite
- Preserves work items, stages, and dependencies

**SSE Endpoint Refactor**
- Polls database instead of watching filesystem
- Detects item changes, moves, additions, deletions
- Streams activity log updates in real-time

**Dashboard Service** (`src/services/prisma-board-service.ts`)
- `PrismaBoardService` using Prisma directly
- Replaces filesystem-based `BoardService` for API consumers

### Changed

#### SSE Hook
- Updated to work with new database-backed events endpoint
- Maintains backward compatibility with existing event types

#### Types Organization
- Split monolithic `types/index.ts` into domain-specific files
- Re-exports from index for backward compatibility

### Testing

- Added 751 new tests (2508 total passing)
- API endpoint tests: 432 tests across 18 endpoints
- Prisma seed tests: 16 tests
- Migration script tests: 18 tests
- Validation utility tests: 96 tests
- Type definition tests: 79 tests
- Integration tests: 110 tests
- E2E tests: 27 passing

### Technical Details

Mission "PRD 013: Kanban Viewer API + Storage Layer" completed:
- 25 work items delivered
- Zero rejections
- All items passed TDD-first testing workflow
- A(i)-Team agents: Face (decomposition), Murdock (testing), B.A. (implementation), Lynch (review)

---

## [0.8.0] - 2026-01-20

### Added

#### Mission Completion Flow (PRD 012)

Full mission completion workflow with phases, status tracking, and dedicated agent support.

**New Mission Phases**
- `final_review`: Lynch performs holistic review of all completed items
- `post_checks`: Automated verification (lint, typecheck, test, build)
- `documentation`: Tawnia updates docs and creates final commit
- `complete`: Mission finished with summary

**New SSE Events**
- `final-review-started`: Emitted when Lynch begins final review
- `final-review-complete`: Emitted with verdict (passed/failed)
- `post-checks-started`: Emitted when automated checks begin
- `post-check-update`: Emitted for each check result (lint, typecheck, test, build)
- `post-checks-complete`: Emitted with all check results
- `documentation-started`: Emitted when Tawnia begins docs
- `documentation-complete`: Emitted with commit hash and summary

**New Types**
- `MissionPhase`: Union type for mission phases
- `CheckResultStatus`: 'pending' | 'running' | 'passed' | 'failed'
- `CheckResult`: Status and completion timestamp for each check
- `FinalReviewStatus`: Agent, verdict, rejections count
- `PostChecksStatus`: Results for lint, typecheck, test, build
- `DocumentationStatus`: Agent, files modified, commit hash, summary

**Tawnia Agent**
- Added Tawnia to `AgentName` type
- Pink color theme (#ec4899) for badges and status
- Displayed in agent status bar as 7th agent

**Mission Completion Panel**
- New `MissionCompletionPanel` component for completion flow visualization
- Shows current phase with progress indicators
- Displays check results with pass/fail status
- Shows documentation summary and commit info

**Header Phase Display**
- Mission status badge shows current phase
- Phase-specific colors and icons
- Completion timestamp display

**Activity Log Enhancement**
- New "committed" highlight type for Tawnia's commits
- Pink background styling for commit messages

#### Agent Assignment Bug Fix

Fixed bug where assigned agents weren't appearing on work item cards during moves.

**Root Cause**
- When an item moved AND its content changed (to add `assigned_agent`), the SSE endpoint skipped the content-change event because it had already processed a move event for that item in the same debounce window

**Fix**
- Modified `createItemMovedEvent` to include full item data
- Updated `ItemMovedEvent` type to include optional `item` field
- Updated `useBoardEvents` hook callback to pass item through
- Updated page component to use full item data when updating state

#### Agent Status Bar Bug Fix

Fixed bug where agent status bar always showed "IDLE" even when agents were actively working.

**Root Cause**
- Agent status was read from `board.json`'s agents section, which was never updated by orchestration scripts

**Fix**
- Created `deriveAgentStatusesFromWorkItems()` utility function
- Agents assigned to items in active stages (probing, testing, implementing, review) now show as ACTIVE
- Status updates in real-time as items move through the pipeline

### Changed

#### Agent Status Bar
- Now displays 7 agents (added Tawnia)
- Updated layout to accommodate additional agent

#### E2E Regression Script
- Added mission completion flow testing
- Tests final_review, post_checks, documentation, and complete phases
- Verifies all agents including Tawnia

### Testing

- Added 248 new tests (1757 total passing)
- Mission completion types: 9 tests
- Agent constants (Amy, Tawnia): 20 tests
- Agent status bar (7 agents): 49 tests
- Header mission phase display: 98 tests
- Mission completion panel: comprehensive component tests
- SSE event handlers: 523 tests (expanded for new events)
- Mission completion integration: end-to-end flow tests
- Agent status utils: 24 tests (deriveAgentStatusesFromWorkItems)
- Agent status SSE integration: 20 tests (updated for derived status)

### Technical Details

Mission "PRD 012: Tawnia & Mission Completion Flow" completed:
- 8 work items delivered
- Zero rejections
- All items passed TDD-first testing workflow
- A(i)-Team agents: Face (decomposition), Murdock (testing), B.A. (implementation), Lynch (review), Amy (probing), Tawnia (documentation)

---

## [0.7.0] - 2026-01-18

### Added

#### Project Name Display
- Project name extracted from parent folder of mission directory
- `getProjectName()` method in BoardService using `path.resolve/dirname/basename`
- `projectName` field in BoardMetadata type and API response
- 160px container in header left side with project name
- Hover effect changes text to green (#22c55e)
- Responsive hiding below 1024px viewport
- Text truncation for long project names

#### Filter Bar
- New FilterBar component below header (48px height, #1f2937 background)
- Three dropdown filters: Type, Agent, Status
- Dropdown styling: #374151 background, 6px border-radius, hover #4b5563
- Selected option shows green text (#22c55e) and checkmark icon
- "Filter by:" label in #6b7280

#### Search Input
- Search input on right side of FilterBar (200px width)
- Search icon inside input on left
- 300ms debounce before triggering filter
- Clear button (X) appears when input has value
- Placeholder "Search..." in #6b7280

#### Active Filter Indicators
- Green tint on active dropdowns (#22c55e20 background, #22c55e border)
- "Clear filters" button appears when any filter is non-default
- Clear filters resets all dropdowns and search to defaults

#### Filter Logic
- `useFilterState` hook for filter state management with stable callbacks
- Filter utility functions: `matchesType`, `matchesAgent`, `matchesStatus`, `matchesSearch`
- `filterWorkItems` combines all filters with AND logic
- Status filter logic: Active (testing/implementing/review), Blocked, Has Rejections, Has Dependencies, Completed

#### Empty State
- "No items match filters" message when filters hide all items
- Centered in board area with 14px #6b7280 text
- Clear filters button below message in #22c55e

#### Keyboard Shortcuts
- `/` key focuses search input
- `Cmd+K` (Mac) or `Ctrl+K` (Windows) focuses search input
- `Escape` clears search input and closes open dropdowns
- Shortcuts don't trigger when typing in other inputs

### Testing

- Added 269 new tests (1509 total passing)
- Project name extraction: 13 tests
- API metadata projectName: 8 tests
- Header project name display: 16 tests
- Filter state types and hook: 31 tests
- Filter utility functions: 46 tests
- FilterBar component: 30 tests
- Search input: 21 tests
- Active filter indicators: 20 tests
- Page filter integration: 17 tests
- Empty state: 14 tests
- Keyboard shortcuts: 24 tests

### Technical Details

Mission "PRD 011: Filter Bar & Project Name" completed:
- 11 work items delivered
- 1 rejection (item 003 wiring fix)
- All items passed TDD-first testing workflow
- A(i)-Team agents: Face (decomposition), Murdock (testing), B.A. (implementation), Lynch (review), Amy (probing)

---

## [0.6.0] - 2026-01-18

### Added

#### Mission Completion SSE Event
- New `mission-completed` event type emitted when mission status transitions to 'completed'
- Frontend handler updates UI state when mission completes
- Prevents duplicate event emissions with `missionCompletedEmitted` flag

#### Progress Bar Completion State
- Progress bar turns green when mission reaches 100% completion
- Added `isComplete` prop to Progress component
- New `--success` CSS variable with light/dark mode support

#### Work Item Card Enhancements
- Dependency tooltip shows which items a card depends on
- Tonal type badges with translucent backgrounds and matching borders
- Consistent card minimum height (140px) for visual alignment

#### Board Archive Handling
- Work items automatically clear from UI when mission is archived
- Explicit empty phases detection with `Array.isArray()` checks

### Changed

#### Type Safety Improvements
- Refactored `BoardEvent` from single interface to discriminated union
- Each event type now has properly typed data interface
- TypeScript guarantees correct properties exist for each event type

#### Live Feed Panel Layout
- Fixed flex layout compatibility: replaced `inline-block` with `flex-shrink-0`
- Improved agent name column alignment

#### Modal Improvements
- Work item modal: `overflow-y-auto` with `max-h-[90vh]` for small screens
- Rejection history table: removed `table-fixed` for responsive column widths
- Better text wrapping with `break-words` for prose content

### Fixed

#### SSE Endpoint Reliability
- Consolidated board.json reads to prevent race conditions
- Added error logging when board.json file read fails
- Proper initialization of mission status tracking at route start

#### Null Safety
- Added nullish coalescing chain for stats: `data.stats ?? prev.stats ?? defaultBoardMetadata.stats`

### Testing

- Added 88 new tests (1240 total passing)
- Board archive tests: 12 tests
- Mission completion SSE tests: 15 tests
- Progress bar completion tests: 8 tests
- Work item card tooltip tests: 14 tests
- Live feed panel layout tests: 9 tests
- BoardEvent type discrimination tests: 30 tests

### Technical Details

Mission "PRD 010: Smaller UI Tweaks" completed:
- 10 work items delivered
- Zero rejections
- All items passed TDD-first testing workflow
- Code review identified and fixed 15 issues (4 critical, 7 warnings, 4 minor)
- A(i)-Team agents: Face (decomposition), Murdock (testing), B.A. (implementation), Lynch (review), Amy (probing), Sosa (requirements critic)

---

## [0.5.0] - 2026-01-18

### Added

#### Design Alignment (PRD 009)

Comprehensive UI refinements to match updated design specifications.

**System Log Panel**
- Added `>_ SYSTEM LOG` header with monospace styling
- Agent names now display in brackets: `[Murdock]`, `[B.A.]`, etc.
- Agent names use Inter font (sans-serif), timestamps use JetBrains Mono
- Smart auto-scroll: pins to bottom, pauses when user scrolls up, resumes within 50px
- Panel styled with #1a1a1a background and 1px #374151 left border

**Agent Status Bar**
- Updated spacing to 80px gaps between agents (`gap-20`)
- AGENTS label left-aligned, agent badges right-aligned
- Consistent sizing: 32px avatars, 8px status dots

**Board Columns**
- Removed purple background from Probing column (now matches other columns)
- Column min-width reduced to 200px
- Standardized header styling across all columns

**Work Item Cards**
- Card padding increased to 16px (`p-4`)
- Added dependency icon (Link2) with count display
- Feature type badge color updated to cyan-500
- Rejection badge styled with AlertTriangle icon and amber background

**Item Detail Modal**
- Background color #1f2937 with #374151 border
- 12px border-radius, 24px padding
- Custom close button with hover state
- Section headers: 14px, white, font-weight 600

**Typography**
- Replaced Geist fonts with Inter and JetBrains Mono from Google Fonts
- Inter weights: 400, 500, 600, 700
- JetBrains Mono weights: 400, 500
- CSS variables: `--font-inter`, `--font-jetbrains-mono`

### Testing

- Added 179 new tests (1152 total passing)
- Layout/font tests: 22 tests
- Live feed panel tests: 55 tests (including auto-scroll)
- Agent status bar tests: 49 tests
- Board column tests: 41 tests
- Work item card tests: 93 tests (across 2 files)
- Item detail modal tests: 42 tests

### Technical Details

Mission "design-alignment" completed:
- 12 work items delivered
- Zero rejections
- All items passed TDD-first testing workflow
- A(i)-Team agents: Face (decomposition), Murdock (testing), B.A. (implementation), Lynch (review), Amy (probing)

---

## [0.4.0] - 2026-01-17

### Added

#### Mission Completion Timer
- Timer freezes when mission is marked complete (`status: "completed"`)
- Visual completion indicator (checkmark) in header when mission complete
- Support for mission reopening with timer resume
- Added `completed_at` optional field to `Mission` interface

#### UI Animations & Transitions
- Card entrance animations when items are added to board
- Card exit animations when items are removed
- Hover effects on work item cards (scale, shadow)
- Column layout transitions for smooth reordering
- New `src/styles/animations.css` with keyframe definitions
- Animation types: `CardAnimationState`, `AnimationConfig`

#### Connection Status Indicator
- Granular connection state tracking: `connected`, `connecting`, `disconnected`, `error`
- Visual indicator in header shows real-time SSE connection status
- Automatic reconnection with exponential backoff (up to 10 attempts)

### Changed

#### SSE Hook Improvements (`src/hooks/use-board-events.ts`)
- Added `connectionState: ConnectionStatus` to return value
- Maintains backward-compatible `isConnected` boolean
- Uses ref pattern for recursive reconnection to avoid stale closures
- Error state now separate from disconnected state

#### SSE Endpoint Updates (`src/app/api/board/events/route.ts`)
- `board-updated` events now include full board data payload
- Enables real-time agent status updates without polling
- Enables real-time progress stats updates

#### Agent Status Bar
- Now updates in real-time via SSE (no polling required)
- Added Amy agent support

### Fixed

- SSE connection status indicator showing incorrect state
- Agent status bar not updating when agents change status
- Progress stats not updating in real-time
- Lint errors in SSE hook (recursive useCallback pattern)

### Testing

- Added 221 new tests (973 total passing)
- Connection state tests: 18 tests
- SSE board-updated payload tests: 9 tests
- Page connection status tests: 12 tests
- Agent status SSE integration: 9 tests
- Progress stats SSE integration: 9 tests
- Animation types tests: 14 tests
- Card animation styles tests: 22 tests
- Board column animations tests: 8 tests
- Page animations tests: 9 tests
- Work item card animations tests: 12 tests
- Mission completion tests: 47 tests
- Header bar completion tests: 32 tests

### Technical Details

Two missions completed:
1. **UI Enhancements v0.3.0**: 9 work items for animations, timer fixes, Amy agent
2. **Fix SSE Connection Status**: 5 work items for real-time updates

---

## [0.3.0] - 2026-01-16

### Added

#### Real-Time Activity Log Streaming

The Live Feed panel now updates in real-time as agents write to `activity.log`. Previously, the panel only loaded entries on page load.

**New Event Type**
- Added `activity-entry-added` to `BoardEventType` union
- Added `logEntry` field to `BoardEvent.data` interface
- Re-exported `LogEntry` type from `src/types/index.ts`

**SSE Endpoint Updates** (`src/app/api/board/events/route.ts`)
- Watches `activity.log` for changes using `fs.watch`
- Tracks file position to emit only new entries (incremental reads)
- Parses new lines with `parseLogEntry` and emits separate events
- Handles multiple rapid appends without data loss

**Hook Updates** (`src/hooks/use-board-events.ts`)
- Added `onActivityEntry?: (entry: LogEntry) => void` callback
- Follows existing callback ref pattern for consistency

**Page Integration** (`src/app/page.tsx`)
- Wires `onActivityEntry` to append new entries to state
- Deduplicates entries by timestamp + agent + message

### Fixed

#### Activity Log Parsing
- Fixed regex in `parseLogEntry` to support timestamps with milliseconds
- The regex now accepts both `2026-01-16T10:00:00Z` and `2026-01-16T10:00:00.123Z` formats
- Added test case for millisecond timestamp parsing

### Testing

- Added 79 new tests (752 total passing)
- Activity event types: 11 tests
- SSE activity events: 6 tests
- useBoardEvents activity callback: 9 tests
- Page activity streaming: 17 tests
- End-to-end integration: 13 tests
- Activity log parsing (with milliseconds): 23 tests

### Technical Details

5 work items delivered in dependency order:
- 001: Add `activity-entry-added` event type (types layer)
- 002: SSE endpoint activity.log file watching
- 003: useBoardEvents `onActivityEntry` callback
- 004: Page integration for activity log streaming
- 005: End-to-end integration test

---

## [0.2.0] - 2026-01-15

### Changed

#### Dark Mode
- Application now renders in dark mode by default
- Added `dark` class to root HTML element in `layout.tsx`
- Updated app title to "Kanban Board Viewer"

#### Board Columns
- Removed per-column WIP labels (global header WIP is sufficient)
- Column headers now show only stage name and item count

#### Work Item Cards
- Agent indicator now only displays for active stages (testing, implementing, review)
- Status dot uses status-based colors (green=active, red=blocked) instead of agent colors
- Swapped footer layout: agent on left, blocker count on right

#### Agent Status Bar
- Status dots now use status-specific colors with animation:
  - ACTIVE: Green with pulse animation
  - WATCHING: Amber (no animation)
  - IDLE: Gray (no animation)

### Added

#### New Components
- **WorkItemModal** (`src/components/work-item-modal.tsx`): Full detail modal for work items
  - Header with ID, type tag, status, close button
  - Title bar with agent and rejection badge
  - Objective section with description
  - Acceptance criteria as parsed checklist
  - Rejection history table (when applicable)
  - Current status section
  - Closes on X, outside click, or ESC key

- **NotificationDot** (`src/components/notification-dot.tsx`): Reusable notification indicator
  - Amber pulsing dot
  - Optional count badge for multiple items
  - Used on Human Input tab

#### New Types
- `ThemeColors` interface for dark mode color palette
- `DARK_THEME_COLORS` constant with PRD-specified colors
- `WORK_ITEM_TYPE_BADGE_COLORS` for type tag styling
- `RejectionHistoryEntry` for modal rejection table
- `WorkItemModalProps` for modal component
- `TabNotificationProps` and `NotificationDotProps` for notifications
- Added `rejection_history` optional field to `WorkItem`

#### Integrations
- Click any work item card to open detail modal
- Human Input tab shows notification dot when items are blocked
- Blocked items count passed to LiveFeedPanel

### Testing
- Added 111 new tests (614 total passing)
- Theme types: 22 tests
- Dark mode CSS: 16 tests
- Work item modal: 41 tests
- Notification dot: 22 tests
- Updated board-column and work-item-card tests

### Technical Details

17 work items delivered across 6 parallel groups:
- dark-mode (3 items): Theme types, CSS tests, implementation
- column-wip (2 items): WIP removal tests, implementation
- agent-cards (2 items): Card display tests, implementation
- work-item-modal (4 items): Types, tests, implementation, integration
- agent-status (2 items): Animation tests, implementation
- tab-notification (4 items): Types, tests, implementation, integration

---

## [0.1.0] - 2026-01-15

### Added

#### Core Types & Data Layer
- TypeScript interfaces for WorkItem, BoardState, Agent, Stage, and related types
- YAML frontmatter parser with gray-matter for reading work item markdown files
- BoardService for filesystem-based data access across stage folders
- Stage utilities for validation, ordering, and display names
- Statistics calculation for board metrics (total, completed, in-progress, blocked)
- Dependency graph utilities for tracking item relationships
- Activity log parsing for timeline events

#### API Routes
- `GET /api/board/metadata` - Board configuration, agents, WIP limits, stats
- `GET /api/board/items` - All work items across all stages
- `GET /api/board/activity` - Activity log entries
- `GET /api/board/events` - Server-Sent Events stream for real-time updates
- `GET /api/board/stage/[stage]` - Items filtered by stage
- `GET /api/board/item/[id]` - Single item lookup by ID

#### UI Components
- **HeaderBar**: Mission name, status indicator, progress bar, timer
- **BoardColumn**: Stage column with item count, WIP indicator, scrollable cards
- **WorkItemCard**: Compact card with title, type badge, dependency/rejection indicators
- **TypeBadge**: Color-coded badges (feature/bug/enhancement/task)
- **DependencyIndicator**: Shows blocked/blocking relationships
- **RejectionBadge**: Displays rejection count with icon
- **AgentStatusBar**: Fixed bottom bar with all agent badges
- **AgentBadge**: Individual agent with status indicator
- **LiveFeedPanel**: Tabbed panel for activity feed and human input
- **MissionTimer**: Real-time elapsed time since mission start
- **ItemDetailModal**: Full item details in dialog overlay
- **ProgressBar**: Visual mission completion progress
- **ResponsiveBoard**: Layout wrapper for responsive design

#### Hooks
- `useBoardData`: Fetches and manages board state with polling
- `useBoardEvents`: SSE connection with auto-reconnect

#### Base UI (shadcn/ui)
- Card, Badge, Tabs, Tooltip, ScrollArea, Button, Separator, Dialog, Progress

#### Testing
- 503 unit tests with Vitest
- 22 end-to-end tests with Playwright
- Test coverage for all components, hooks, utilities, and API routes

#### Configuration
- Next.js 16.1.2 with App Router and Turbopack
- Tailwind CSS 4 with custom configuration
- ESLint 9 with Next.js config
- Playwright config for e2e testing
- Vitest config with jsdom environment

### Technical Details

- **Framework**: Next.js 16.1.2, React 19.2.3
- **Styling**: Tailwind CSS 4, tw-animate-css
- **Components**: Radix UI primitives via shadcn/ui
- **Icons**: Lucide React
- **Testing**: Vitest 4.0.17, Playwright 1.57.0, Testing Library
- **Data**: gray-matter for YAML frontmatter parsing

### Project Structure

```
34 work items completed across 6 parallel groups:
- types (1 item): Core TypeScript definitions
- data-layer (7 items): Parser, services, utilities
- api-layer (6 items): REST and SSE endpoints
- ui-components (12 items): React components
- page-assembly (4 items): Main page, hooks, layout
- integration-tests (4 items): E2E test suites
```
