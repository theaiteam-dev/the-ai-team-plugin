# API Reference

Complete documentation for all API endpoints.

## Base URL

All endpoints are relative to the application root (e.g., `http://localhost:3000`).

## Endpoints

### GET /api/board/metadata

Returns board configuration, agent status, WIP limits, and statistics.

**Response**

```json
{
  "mission": {
    "name": "Kanban Board UI",
    "started_at": "2026-01-15T18:10:00Z",
    "status": "active"
  },
  "wip_limits": {
    "testing": 2,
    "implementing": 3,
    "review": 2
  },
  "phases": {
    "briefings": ["001"],
    "ready": ["002", "003"],
    "testing": [],
    "implementing": ["004"],
    "review": [],
    "done": ["005"],
    "blocked": []
  },
  "agents": {
    "Hannibal": { "status": "idle" },
    "Face": { "status": "working", "current_item": "004" },
    "Murdock": { "status": "idle" },
    "B.A.": { "status": "blocked" },
    "Lynch": { "status": "idle" }
  },
  "stats": {
    "total_items": 34,
    "completed": 5,
    "in_progress": 2,
    "blocked": 1,
    "backlog": 26
  }
}
```

**Status Codes**

| Code | Description |
|------|-------------|
| 200 | Success |
| 500 | Server error reading board.json |

---

### GET /api/board/items

Returns all work items across all stages.

**Response**

```json
[
  {
    "id": "001",
    "title": "Define TypeScript interfaces",
    "type": "feature",
    "priority": "high",
    "stage": "done",
    "assignee": "Hannibal",
    "dependencies": [],
    "rejections": 0,
    "content": "## Description\n\nImplementation details...",
    "created_at": "2026-01-15T18:10:00Z",
    "updated_at": "2026-01-15T19:30:00Z"
  }
]
```

**Status Codes**

| Code | Description |
|------|-------------|
| 200 | Success |
| 500 | Server error reading items |

---

### GET /api/board/activity

Returns recent activity log entries (last 100 by default).

**Response**

```json
[
  {
    "timestamp": "2026-01-16T22:27:12.968Z",
    "agent": "Hannibal",
    "message": "Mission initialized: Activity Log Streaming"
  },
  {
    "timestamp": "2026-01-16T22:28:10.557Z",
    "agent": "Face",
    "message": "Created item 001: Add activity-entry-added event type"
  },
  {
    "timestamp": "2026-01-16T22:51:22.427Z",
    "agent": "Lynch",
    "message": "APPROVED 001-core-types",
    "highlightType": "approved"
  }
]
```

**LogEntry Fields**

| Field | Type | Description |
|-------|------|-------------|
| timestamp | string | ISO 8601 timestamp (with or without milliseconds) |
| agent | string | Agent name (Hannibal, Face, Murdock, B.A., Lynch) |
| message | string | Activity message |
| highlightType | string? | Optional: `approved`, `rejected`, or `alert` |

**Status Codes**

| Code | Description |
|------|-------------|
| 200 | Success |
| 500 | Server error reading activity |

---

### GET /api/board/events

Server-Sent Events endpoint for real-time updates.

**Response**

Content-Type: `text/event-stream`

```
data: {"type":"item-moved","timestamp":"2026-01-16T22:51:22Z","data":{"itemId":"001","fromStage":"review","toStage":"done"}}

data: {"type":"activity-entry-added","timestamp":"2026-01-16T22:51:22Z","data":{"logEntry":{"timestamp":"2026-01-16T22:51:22.427Z","agent":"Lynch","message":"APPROVED 001-core-types","highlightType":"approved"}}}
```

**Event Types**

| Type | Description | Data Fields |
|------|-------------|-------------|
| `item-added` | New work item created | `item` (WorkItem) |
| `item-moved` | Item moved between stages | `itemId`, `fromStage`, `toStage` |
| `item-updated` | Item content changed | `item` (WorkItem) |
| `item-deleted` | Item removed | `itemId` |
| `board-updated` | Board metadata changed | `board` (BoardMetadata) |
| `activity-entry-added` | New activity log entry | `logEntry` (LogEntry) |

**Activity Log Streaming**

The endpoint watches `activity.log` for changes and streams new entries in real-time:
- Uses file position tracking to emit only new lines
- Each new line becomes a separate `activity-entry-added` event
- Handles rapid appends without data loss

**Connection Behavior**

- Connection stays open until client disconnects
- Server sends heartbeat every 30 seconds
- Client should reconnect on disconnect (hook handles this automatically)

---

### GET /api/board/stage/[stage]

Returns all work items in a specific stage.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| stage | string | Stage name (briefings, ready, testing, implementing, review, done, blocked) |

**Response**

```json
[
  {
    "id": "001",
    "title": "Define TypeScript interfaces",
    "type": "feature",
    "stage": "done",
    ...
  }
]
```

**Status Codes**

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Invalid stage name |
| 500 | Server error reading items |

**Example**

```bash
curl http://localhost:3000/api/board/stage/done
```

---

### GET /api/board/item/[id]

Returns a single work item by ID.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| id | string | Work item ID (e.g., "001") |

**Response**

```json
{
  "id": "001",
  "title": "Define TypeScript interfaces",
  "type": "feature",
  "priority": "high",
  "stage": "done",
  "assignee": "Hannibal",
  "dependencies": [],
  "rejections": 0,
  "content": "## Description\n\nFull markdown content...",
  "created_at": "2026-01-15T18:10:00Z",
  "updated_at": "2026-01-15T19:30:00Z"
}
```

**Status Codes**

| Code | Description |
|------|-------------|
| 200 | Success |
| 404 | Item not found |
| 500 | Server error reading item |

**Example**

```bash
curl http://localhost:3000/api/board/item/001
```

---

## Mission Telemetry

These endpoints aggregate hook event data for a mission. All require the `X-Project-ID` header. See `openapi.yaml` for the canonical response schemas.

### GET /api/missions/{missionId}/tool-histogram

Per-agent tool-call counts for a mission, grouped by `toolName` (Prisma `groupBy + _count`).

**Response**

```json
{
  "success": true,
  "data": {
    "missionId": "M-20260506-002",
    "agents": [
      {
        "agentName": "lynch",
        "tools": [
          { "name": "Bash", "count": 72 },
          { "name": "SendMessage", "count": 44 },
          { "name": "Skill", "count": 36 }
        ]
      }
    ]
  }
}
```

**CLI:** `ateam missions getToolHistogram <missionId> [--json]`

---

### GET /api/missions/{missionId}/skill-usage

Per-agent skill activations with counts and `distinctArgs`. Filters `eventType: 'pre_tool_use'` so the same `Skill` invocation isn't double-counted across pre+post hook events.

**Response**

```json
{
  "success": true,
  "data": {
    "missionId": "M-20260506-002",
    "agents": [
      {
        "agentName": "amy",
        "skills": [
          {
            "skillName": "ai-team:perspective-test",
            "invocations": 4,
            "distinctArgs": 1
          }
        ]
      }
    ]
  }
}
```

`distinctArgs` is the count of distinct 12-char SHA-256 hashes of `args` for the skill — useful for spotting agents that re-invoke a skill with different arguments versus repeatedly invoking it identically.

**CLI:** `ateam missions getSkillUsage <missionId> [--json]`

---

### GET /api/missions/current/health-report

Pure-data health-report for in-flight items in the active mission. Used by Hannibal's `/ai-team:healthcheck` slash command and available for ad-hoc inspection.

Returns activity timestamps & counts per in-flight item (`testing | implementing | review | probing`) plus an aggregate `missionIdle` boolean derived from a 600-second per-item idle threshold (true when every in-flight item has `idleSeconds > 600`, also true when there are no in-flight items). Scoped to the active mission via the `MissionItem` join and a `state notIn (completed/failed/archived)` predicate so it never returns stale data from old missions.

**Response (active mission, items in flight)**

```json
{
  "success": true,
  "data": {
    "missionId": "M-20260506-002",
    "generatedAt": "2026-05-06T19:13:03.000Z",
    "missionIdle": false,
    "inFlightItems": [
      {
        "itemId": "WI-318",
        "title": "TodoItem component: render, toggle, inline edit, delete",
        "stage": "implementing",
        "assignedAgent": "ba-1",
        "claimedAt": "2026-05-06T18:30:00.000Z",
        "lastActivityAt": "2026-05-06T18:35:27.000Z",
        "lastActivitySource": "hook_event",
        "idleSeconds": 305,
        "lastWorkLogEntry": {
          "agent": "amy-1",
          "summary": "FLAG - CRITICAL: handleConfirmDelete has no in-flight guard",
          "timestamp": "2026-05-06T18:35:27.000Z"
        },
        "recentActivity": [
          {
            "agent": "ba-1",
            "tool": "Edit",
            "eventType": "pre_tool_use",
            "timestamp": "2026-05-06T18:33:14.000Z"
          }
        ]
      }
    ]
  }
}
```

The freshest activity timestamp per item is the max of: hook events (with `payload.itemId` matching when present, falling back to `agentName === assignedAgent && timestamp >= claimedAt` when missing), activity logs (same constraint), work logs scoped by `itemId`, and the agent claim itself. Items with no signals at all emit `lastActivityAt: null` and `idleSeconds: null` rather than a phantom "agent_claim @ generatedAt" fallback.

**Status Codes**

| Code | Description |
|------|-------------|
| 200 | Success (active mission found, items returned) |
| 400 | `VALIDATION_ERROR` — missing or malformed `X-Project-ID` |
| 404 | `NO_ACTIVE_MISSION` — no mission in this project is in a non-terminal state |
| 500 | `DATABASE_ERROR` — Prisma error during aggregation |

**CLI:** `ateam missions-health getHealthReport [--json]`

---

## Data Types

### WorkItem

```typescript
interface WorkItem {
  id: string;
  title: string;
  type: 'feature' | 'bug' | 'enhancement' | 'task';
  priority: 'low' | 'medium' | 'high' | 'critical';
  stage: Stage;
  assignee?: string;
  dependencies: string[];
  rejections: number;
  content: string;
  created_at: string;
  updated_at: string;
}
```

### Stage

```typescript
type Stage =
  | 'briefings'
  | 'ready'
  | 'testing'
  | 'implementing'
  | 'review'
  | 'done'
  | 'blocked';
```

### Agent

```typescript
interface Agent {
  status: 'idle' | 'working' | 'blocked';
  current_item?: string;
}
```

### MissionStatus

```typescript
type MissionStatus = 'planning' | 'active' | 'paused' | 'completed';
```

---

## Error Responses

All error responses follow this format:

```json
{
  "error": "Error message describing what went wrong"
}
```

---

## Usage Examples

### Fetch all data for initial load

```javascript
const [metadata, items] = await Promise.all([
  fetch('/api/board/metadata').then(r => r.json()),
  fetch('/api/board/items').then(r => r.json())
]);
```

### Subscribe to real-time updates

```javascript
const eventSource = new EventSource('/api/board/events');

eventSource.addEventListener('update', (event) => {
  const data = JSON.parse(event.data);
  console.log('File changed:', data.path);
  // Refetch data...
});

eventSource.addEventListener('heartbeat', (event) => {
  console.log('Connection alive');
});
```

### Fetch items by stage

```javascript
const doneItems = await fetch('/api/board/stage/done').then(r => r.json());
```

### Fetch single item

```javascript
const item = await fetch('/api/board/item/001').then(r => r.json());
```
