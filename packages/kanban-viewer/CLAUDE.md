# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm test             # Run all Vitest tests
npm test -- <pattern> # Run specific tests (e.g., npm test -- board-service)
npx playwright test  # Run E2E tests

# Docker Compose (preferred)
docker compose up -d              # Start container
docker compose up -d --build      # Rebuild and start
docker compose down               # Stop container

# Docker (manual)
docker build -t kanban-viewer .   # Build image
docker run -d --name kanban-viewer -p 3000:3000 -v "$(pwd)/prisma/data:/app/prisma/data" kanban-viewer
```

**Important:** When making code changes, you must rebuild the Docker container for changes to take effect:
```bash
docker compose up -d --build
```

## Architecture

### Data Flow

The application displays a kanban board backed by SQLite and streams real-time updates via SSE:

```
SQLite Database  →  Prisma ORM  →  API Routes  →  React Page
(prisma/data/)       (queries)      (Next.js)      (state)
                                        ↓
                               SSE /api/board/events
                                        ↓
                                useBoardEvents hook
                                        ↓
                                Real-time UI updates
```

**Project Scoping:** All API requests require the `X-Project-ID` header. Projects are auto-created on first use.

### Mission Directory Structure

The `mission/` folder is used for seeding and archiving. Live data is stored in SQLite.

```
mission/
├── activity.log         # Agent activity (can be imported via seed scripts)
├── briefings/           # Seed work items (markdown with YAML frontmatter)
├── ready/               # Items ready for work
├── done/                # Completed items
└── archive/             # Archived missions
```

**Stages:** briefings → ready → testing → implementing → review → probing → done (or blocked)

### Key Layers

**Prisma ORM** (`prisma/schema.prisma`): Database schema defining Projects, Items, Missions, AgentClaims, and ActivityLogs. SQLite database stored in `prisma/data/ateam.db`.

**Database Models** (10 tables)
- `Project`: Multi-project isolation (id, name, timestamps)
- `Stage`: Board columns with WIP limits
- `Item`: Work items with outputs (outputTest, outputImpl, outputTypes)
- `ItemDependency`: Self-referential many-to-many dependencies
- `AgentClaim`: One-to-one agent-to-item claims
- `WorkLog`: Agent work history with outcomes
- `Mission`: Mission tracking with state and timestamps; also stores `finalReview` (markdown of Stockwell's final mission review report) and `scalingRationale` (JSON blob describing agent instance counts and the binding constraint for scaling decisions)
- `MissionItem`: Many-to-many mission-to-item mapping
- `ActivityLog`: System activity with levels (info/warn/error)

**API Routes** (`src/app/api/`): RESTful endpoints for board operations. Key endpoints:
- `GET /api/board` - Full board state (items, stages, claims, mission)
- `POST /api/board/claim` - Agent claims an item
- `POST /api/board/move` - Move item between stages
- `POST /api/items` - Create work items
- `POST /api/missions` - Create a mission (use `force: true` to archive failed/completed missions and their items)
- `POST/GET /api/missions/{missionId}/final-review` - Store and retrieve Stockwell's final mission review report (markdown, scoped to the requesting project)
- `GET /api/activity` - Activity log entries (returns project-level logs when no active mission)

**SSE Endpoint** (`src/app/api/board/events/route.ts`): Polls database for changes, emits events: `item-added`, `item-moved`, `item-updated`, `item-deleted`, `board-updated`, `activity-entry-added`.

**useBoardEvents Hook** (`src/hooks/use-board-events.ts`): React hook connecting to SSE endpoint with automatic reconnection and exponential backoff.

### Core Types

```typescript
type Stage = 'briefings' | 'ready' | 'probing' | 'testing' | 'implementing' | 'review' | 'done' | 'blocked';
type AgentName = 'Hannibal' | 'Face' | 'Murdock' | 'B.A.' | 'Lynch' | 'Amy' | 'Tawnia' | 'Stockwell';
type BoardEventType = 'item-added' | 'item-moved' | 'item-updated' | 'item-deleted' | 'board-updated' | 'activity-entry-added';

interface LogEntry {
  timestamp: string;  // ISO format, with or without milliseconds
  agent: string;
  message: string;
  highlightType?: 'approved' | 'rejected' | 'alert';
}

// Filter types
type TypeFilter = 'All Types' | 'implementation' | 'test' | 'interface' | 'integration' | 'feature' | 'bug' | 'enhancement';
type AgentFilter = 'All Agents' | 'Unassigned' | AgentName;
type StatusFilter = 'All Status' | 'Active' | 'Blocked' | 'Has Rejections' | 'Has Dependencies' | 'Completed';

interface FilterState {
  typeFilter: TypeFilter;
  agentFilter: AgentFilter;
  statusFilter: StatusFilter;
  searchQuery: string;
}
```

### Multi-Project Support

Projects isolate work items, missions, and activity logs. The UI includes a project selector dropdown.

**API Usage:** Include `X-Project-ID: your-project-id` header in all requests. Projects are created automatically on first use.

**URL Format:** `http://localhost:3000/?projectId=your-project-id`

<details>
<summary>Project ID Rules</summary>

- Alphanumeric characters, hyphens, and underscores only
- Max 100 characters
- Normalized to lowercase
- Cannot be empty or contain special characters

</details>

### Work Item Format

Work items are stored in SQLite. Seed files use markdown with YAML frontmatter:

```yaml
---
id: "001"
title: "Feature name"
type: feature          # feature | bug | enhancement | task
priority: high         # critical | high | medium | low
dependencies: ["000"]  # IDs of blocking items
outputs:               # Optional: related file paths
  test: "src/__tests__/feature.test.ts"
  impl: "src/path/to/impl.ts"
---

## Objective
Description and acceptance criteria...
```

Items are created via `POST /api/items` or migration scripts in `scripts/`.

### Error Handling

**Error Factory Functions** (`src/lib/errors.ts`)

Standardized error creation with factory functions that include context:

```typescript
// Error codes for programmatic handling
ErrorCodes.ITEM_NOT_FOUND
ErrorCodes.INVALID_TRANSITION
ErrorCodes.WIP_LIMIT_EXCEEDED
ErrorCodes.DEPENDENCY_CYCLE
ErrorCodes.OUTPUT_COLLISION
ErrorCodes.CLAIM_CONFLICT
ErrorCodes.VALIDATION_ERROR
ErrorCodes.UNAUTHORIZED
ErrorCodes.SERVER_ERROR
ErrorCodes.DATABASE_ERROR
ErrorCodes.INVALID_STAGE

// Factory functions return ApiError with code, message, and details
createItemNotFoundError(itemId)
createInvalidTransitionError(from, to)
createWipLimitExceededError(stageId, limit, current)
createDependencyCycleError(cycle)
createOutputCollisionError(collisions)
createClaimConflictError(itemId)
createValidationError(message, details)
createUnauthorizedError(message?)
createServerError(message?)
createDatabaseError(message, error?)
createInvalidStageError(currentStage, requiredStage, message?)
```

All errors serialize to `ApiErrorResponse` format with `success: false`.

## Testing

Tests use Vitest with jsdom environment. Test files are in `src/__tests__/`. The `@/` alias resolves to `src/`.

When mocking the `useBoardEvents` hook in tests, capture callbacks to simulate SSE events:

```typescript
let capturedCallbacks: UseBoardEventsOptions | null = null;
vi.mock('@/hooks/use-board-events', () => ({
  useBoardEvents: vi.fn((options) => {
    capturedCallbacks = options;
    return { isConnected: true, connectionError: null };
  }),
}));

// Trigger event in test:
act(() => {
  capturedCallbacks?.onItemAdded?.(newItem);
});

// Trigger activity entry event:
act(() => {
  capturedCallbacks?.onActivityEntry?.({
    timestamp: '2026-01-16T10:00:00.123Z',
    agent: 'B.A.',
    message: 'Implementing feature',
  });
});
```
