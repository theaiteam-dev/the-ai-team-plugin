# PRD: A(i)-Team MCP Server

**Version:** 1.0.0
**Status:** Implemented
**Author:** Josh / Claude
**Date:** 2026-01-21
**Implementation Date:** 2026-01-22
**Repo:** Bundled in `ateam-plugin` at `mcp-server/`

---

## 1. Overview

### 1.1 Problem Statement

Claude Code needs to invoke A(i)-Team board operations through native MCP tools rather than shelling out to Node.js scripts. The Kanban Viewer now exposes a REST API for all operations, but Claude Code speaks MCP protocol over stdio.

### 1.2 Solution

Build a lightweight MCP server that:
- Exposes 15 tools matching the Kanban Viewer API endpoints
- Communicates with Claude Code via stdio transport
- Proxies tool calls to the Kanban Viewer REST API
- Returns structured responses that Claude can reason about

### 1.3 Scope

This PRD covers:
- MCP server implementation
- Tool definitions and schemas
- Claude Code plugin configuration
- Error handling and retry logic

This PRD does NOT cover:
- Kanban Viewer API implementation
- Dashboard UI
- Database schema

---

## 2. Architecture

### 2.1 System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Code                                                     │
│                                                                  │
│  ┌────────────────┐     stdio      ┌─────────────────────────┐  │
│  │   MCP Client   │◄──────────────►│   ateam-mcp-server      │  │
│  │   (built-in)   │                │                         │  │
│  └────────────────┘                │  ┌───────────────────┐  │  │
│                                    │  │  Tool Handlers    │  │  │
│                                    │  │  - board_read     │  │  │
│                                    │  │  - board_move     │  │  │
│                                    │  │  - item_create    │  │  │
│                                    │  │  - agent_start    │  │  │
│                                    │  │  - ...            │  │  │
│                                    │  └─────────┬─────────┘  │  │
│                                    │            │            │  │
│                                    └────────────┼────────────┘  │
│                                                 │               │
└─────────────────────────────────────────────────┼───────────────┘
                                                  │ HTTP
                                                  ▼
                                    ┌─────────────────────────┐
                                    │    Kanban Viewer API    │
                                    │    localhost:3000       │
                                    └─────────────────────────┘
```

### 2.2 Data Flow

```
1. Claude invokes tool (e.g., board_move)
2. Claude Code sends JSON-RPC via stdio
3. MCP Server receives request
4. Tool handler maps to Kanban Viewer API call
5. HTTP POST to /api/board/move
6. API returns response
7. Tool handler formats result
8. MCP Server sends JSON-RPC response via stdio
9. Claude receives structured result
```

### 2.3 Repository Structure

**Option A: Standalone Package**

```
ateam-mcp-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point, stdio transport setup
│   ├── server.ts             # McpServer instance
│   ├── config.ts             # Environment config
│   │
│   ├── tools/                # Tool definitions
│   │   ├── index.ts          # Register all tools
│   │   ├── board.ts          # board_read, board_move, board_claim, board_release
│   │   ├── items.ts          # item_create, item_update, item_reject, item_render, item_get, item_list
│   │   ├── agents.ts         # agent_start, agent_stop
│   │   ├── missions.ts       # mission_init, mission_precheck, mission_postcheck, mission_archive, mission_current
│   │   └── utils.ts          # deps_check, activity_log, log
│   │
│   ├── client/               # Kanban Viewer API client
│   │   ├── index.ts          # HTTP client with retry logic
│   │   └── types.ts          # Re-export API types
│   │
│   └── lib/
│       └── errors.ts         # MCP error formatting
│
├── tests/
│   ├── tools/                # Tool unit tests (mocked API)
│   └── integration/          # Full flow tests
│
└── build/
    └── index.js              # Compiled entry point
```

**Option B: Bundled with Plugin**

```
ateam-plugin/
├── CLAUDE.md
├── skills/
├── subagents/
├── docs/
│
├── mcp-server/               # MCP server as subdirectory
│   ├── package.json
│   ├── src/
│   │   └── (same as Option A)
│   └── build/
│
├── .mcp.json                 # Project-scope MCP config
└── scripts/                  # DEPRECATED
```

**Recommendation:** Option B (bundled) for easier distribution with the plugin.

---

## 3. MCP Tool Definitions

### 3.1 Tool Schema Format

Each tool is registered with:
- **name**: Snake_case identifier
- **description**: What the tool does (shown to Claude)
- **inputSchema**: Zod schema for parameters
- **handler**: Async function that calls API and returns result

### 3.2 Board Tools

#### `board_read`

```typescript
// tools/board.ts

server.tool(
  'board_read',
  'Read the current board state including all stages, items, and agent claims',
  {
    includeCompleted: z.boolean().optional().default(false)
      .describe('Include items in done stage'),
  },
  async ({ includeCompleted }) => {
    const response = await apiClient.get('/api/board', { 
      params: { includeCompleted } 
    });
    return { content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }] };
  }
);
```

---

#### `board_move`

```typescript
server.tool(
  'board_move',
  'Move a work item between stages. Validates stage transitions and WIP limits.',
  {
    itemId: z.string().describe('Work item ID (e.g., WI-001)'),
    toStage: z.enum(['backlog', 'ready', 'in_progress', 'review', 'done', 'blocked'])
      .describe('Target stage'),
    force: z.boolean().optional().default(false)
      .describe('Override WIP limits if true'),
  },
  async ({ itemId, toStage, force }) => {
    const response = await apiClient.post('/api/board/move', { itemId, toStage, force });
    return formatResponse(response.data);
  }
);
```

---

#### `board_claim`

```typescript
server.tool(
  'board_claim',
  'Assign an agent to a work item. Agent must not have an existing claim.',
  {
    itemId: z.string().describe('Work item ID'),
    agent: z.enum(['Hannibal', 'Face', 'Murdock', 'BA', 'Lynch', 'Amy', 'Tawnia'])
      .describe('Agent name'),
  },
  async ({ itemId, agent }) => {
    const response = await apiClient.post('/api/board/claim', { itemId, agent });
    return formatResponse(response.data);
  }
);
```

---

#### `board_release`

```typescript
server.tool(
  'board_release',
  'Release an agent claim from a work item',
  {
    itemId: z.string().describe('Work item ID'),
  },
  async ({ itemId }) => {
    const response = await apiClient.post('/api/board/release', { itemId });
    return formatResponse(response.data);
  }
);
```

---

### 3.3 Item Tools

#### `item_create`

```typescript
server.tool(
  'item_create',
  'Create a new work item. Item is created in backlog stage.',
  {
    title: z.string().max(200).describe('Item title'),
    description: z.string().describe('Full description (markdown supported)'),
    type: z.enum(['feature', 'bug', 'chore', 'spike']).describe('Item type'),
    priority: z.enum(['critical', 'high', 'medium', 'low']).describe('Priority level'),
    dependencies: z.array(z.string()).optional()
      .describe('IDs of items this depends on'),
  },
  async (params) => {
    const response = await apiClient.post('/api/items', params);
    return formatResponse(response.data);
  }
);
```

---

#### `item_update`

```typescript
server.tool(
  'item_update',
  'Update a work item properties',
  {
    itemId: z.string().describe('Work item ID'),
    title: z.string().max(200).optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    type: z.enum(['feature', 'bug', 'chore', 'spike']).optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    dependencies: z.array(z.string()).optional()
      .describe('Replace dependencies with this list'),
  },
  async ({ itemId, ...updates }) => {
    const response = await apiClient.patch(`/api/items/${itemId}`, updates);
    return formatResponse(response.data);
  }
);
```

---

#### `item_get`

```typescript
server.tool(
  'item_get',
  'Get a single work item with all its details',
  {
    itemId: z.string().describe('Work item ID'),
  },
  async ({ itemId }) => {
    const response = await apiClient.get(`/api/items/${itemId}`);
    return formatResponse(response.data);
  }
);
```

---

#### `item_list`

```typescript
server.tool(
  'item_list',
  'List work items with optional filters',
  {
    stage: z.enum(['backlog', 'ready', 'in_progress', 'review', 'done', 'blocked']).optional(),
    type: z.enum(['feature', 'bug', 'chore', 'spike']).optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    agent: z.enum(['Hannibal', 'Face', 'Murdock', 'BA', 'Lynch', 'Amy', 'Tawnia']).optional(),
  },
  async (filters) => {
    const response = await apiClient.get('/api/items', { params: filters });
    return formatResponse(response.data);
  }
);
```

---

#### `item_reject`

```typescript
server.tool(
  'item_reject',
  'Record a rejection on a work item. Item escalates to blocked after 2 rejections.',
  {
    itemId: z.string().describe('Work item ID'),
    reason: z.string().describe('Rejection reason'),
    agent: z.enum(['Hannibal', 'Face', 'Murdock', 'BA', 'Lynch', 'Amy', 'Tawnia'])
      .describe('Rejecting agent'),
  },
  async ({ itemId, reason, agent }) => {
    const response = await apiClient.post(`/api/items/${itemId}/reject`, { reason, agent });
    return formatResponse(response.data);
  }
);
```

---

#### `item_render`

```typescript
server.tool(
  'item_render',
  'Render a work item as formatted markdown',
  {
    itemId: z.string().describe('Work item ID'),
    includeWorkLog: z.boolean().optional().default(true)
      .describe('Include work log history'),
  },
  async ({ itemId, includeWorkLog }) => {
    const response = await apiClient.get(`/api/items/${itemId}/render`, {
      params: { includeWorkLog }
    });
    return { content: [{ type: 'text', text: response.data.data.markdown }] };
  }
);
```

---

### 3.4 Agent Tools

#### `agent_start`

```typescript
server.tool(
  'agent_start',
  'Start working on an item. Claims the item, moves to in_progress, and logs start.',
  {
    itemId: z.string().describe('Work item ID'),
    agent: z.enum(['Hannibal', 'Face', 'Murdock', 'BA', 'Lynch', 'Amy', 'Tawnia'])
      .describe('Agent starting work'),
  },
  async ({ itemId, agent }) => {
    const response = await apiClient.post('/api/agents/start', { itemId, agent });
    return formatResponse(response.data);
  }
);
```

---

#### `agent_stop`

```typescript
server.tool(
  'agent_stop',
  'Stop working on an item. Releases claim, logs summary, moves to review or blocked.',
  {
    itemId: z.string().describe('Work item ID'),
    agent: z.enum(['Hannibal', 'Face', 'Murdock', 'BA', 'Lynch', 'Amy', 'Tawnia'])
      .describe('Agent completing work'),
    summary: z.string().describe('Work summary for the log'),
    outcome: z.enum(['completed', 'blocked']).optional().default('completed')
      .describe('Work outcome'),
  },
  async ({ itemId, agent, summary, outcome }) => {
    const response = await apiClient.post('/api/agents/stop', { itemId, agent, summary, outcome });
    return formatResponse(response.data);
  }
);
```

---

### 3.5 Mission Tools

#### `mission_init`

```typescript
server.tool(
  'mission_init',
  'Initialize a new mission. Archives any existing mission first.',
  {
    name: z.string().describe('Mission name'),
    prdPath: z.string().describe('Path to PRD file'),
  },
  async ({ name, prdPath }) => {
    const response = await apiClient.post('/api/missions', { name, prdPath });
    return formatResponse(response.data);
  }
);
```

---

#### `mission_current`

```typescript
server.tool(
  'mission_current',
  'Get the current active mission',
  {},
  async () => {
    const response = await apiClient.get('/api/missions/current');
    return formatResponse(response.data);
  }
);
```

---

#### `mission_precheck`

```typescript
server.tool(
  'mission_precheck',
  'Run pre-mission checks (lint, unit tests) before starting work',
  {},
  async () => {
    const response = await apiClient.post('/api/missions/precheck');
    return formatResponse(response.data);
  }
);
```

---

#### `mission_postcheck`

```typescript
server.tool(
  'mission_postcheck',
  'Run post-mission checks (lint, unit, e2e tests) after completion',
  {},
  async () => {
    const response = await apiClient.post('/api/missions/postcheck');
    return formatResponse(response.data);
  }
);
```

---

#### `mission_archive`

```typescript
server.tool(
  'mission_archive',
  'Archive the current mission and its items',
  {},
  async () => {
    const response = await apiClient.post('/api/missions/archive');
    return formatResponse(response.data);
  }
);
```

---

### 3.6 Utility Tools

#### `deps_check`

```typescript
server.tool(
  'deps_check',
  'Validate dependency graph. Detects cycles and shows which items are ready to work on.',
  {},
  async () => {
    const response = await apiClient.get('/api/deps/check');
    return formatResponse(response.data);
  }
);
```

---

#### `activity_log`

```typescript
server.tool(
  'activity_log',
  'Log a progress message to the Live Feed',
  {
    message: z.string().describe('Log message'),
    agent: z.enum(['Hannibal', 'Face', 'Murdock', 'BA', 'Lynch', 'Amy', 'Tawnia']).optional()
      .describe('Agent name if applicable'),
    level: z.enum(['info', 'warn', 'error']).optional().default('info')
      .describe('Log level'),
  },
  async ({ message, agent, level }) => {
    const response = await apiClient.post('/api/activity', { message, agent, level });
    return formatResponse(response.data);
  }
);
```

---

#### `log`

```typescript
server.tool(
  'log',
  'Simple logging utility (shorthand for activity_log with info level)',
  {
    agent: z.enum(['Hannibal', 'Face', 'Murdock', 'BA', 'Lynch', 'Amy', 'Tawnia'])
      .describe('Agent name'),
    message: z.string().describe('Log message'),
  },
  async ({ agent, message }) => {
    const response = await apiClient.post('/api/activity', { message, agent, level: 'info' });
    return formatResponse(response.data);
  }
);
```

---

## 4. Implementation Details

### 4.1 Entry Point

```typescript
// src/index.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/index.js';
import { config } from './config.js';

const server = new McpServer({
  name: 'ateam',
  version: '1.0.0',
});

// Register all tools
registerAllTools(server);

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);

console.error(`[ateam-mcp] Connected to ${config.apiUrl}`);
```

### 4.2 API Client

```typescript
// src/client/index.ts

import { config } from '../config.js';

interface ApiClientOptions {
  baseUrl: string;
  timeout?: number;
  retries?: number;
}

class ApiClient {
  private baseUrl: string;
  private timeout: number;
  private retries: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl;
    this.timeout = options.timeout ?? 10000;
    this.retries = options.retries ?? 3;
  }

  async get(path: string, options?: { params?: Record<string, unknown> }) {
    return this.request('GET', path, undefined, options?.params);
  }

  async post(path: string, body?: unknown) {
    return this.request('POST', path, body);
  }

  async patch(path: string, body?: unknown) {
    return this.request('PATCH', path, body);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, unknown>
  ) {
    const url = new URL(path, this.baseUrl);
    
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` }),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeout),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new ApiError(data.error?.code ?? 'UNKNOWN', data.error?.message ?? 'Unknown error');
        }

        return data;
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on client errors (4xx)
        if (error instanceof ApiError && error.code.startsWith('4')) {
          throw error;
        }
        
        // Exponential backoff
        if (attempt < this.retries - 1) {
          await sleep(Math.pow(2, attempt) * 100);
        }
      }
    }

    throw lastError;
  }
}

class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const apiClient = new ApiClient({
  baseUrl: config.apiUrl,
  timeout: config.timeout,
  retries: config.retries,
});
```

### 4.3 Configuration

```typescript
// src/config.ts

export const config = {
  apiUrl: process.env.ATEAM_API_URL ?? 'http://localhost:3000',
  apiKey: process.env.ATEAM_API_KEY,
  timeout: parseInt(process.env.ATEAM_TIMEOUT ?? '10000', 10),
  retries: parseInt(process.env.ATEAM_RETRIES ?? '3', 10),
};
```

### 4.4 Response Formatting

```typescript
// src/lib/format.ts

export function formatResponse(data: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(data, null, 2),
    }],
  };
}

export function formatError(error: Error) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        error: true,
        code: (error as any).code ?? 'UNKNOWN',
        message: error.message,
      }, null, 2),
    }],
    isError: true,
  };
}
```

---

## 5. Claude Code Configuration

### 5.1 Project Scope (`.mcp.json`)

For projects using the A(i)-Team plugin:

```json
{
  "mcpServers": {
    "ateam": {
      "command": "node",
      "args": ["./ateam-plugin/mcp-server/build/index.js"],
      "env": {
        "ATEAM_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

### 5.2 User Scope (`~/.claude.json`)

For personal/global availability:

```json
{
  "mcpServers": {
    "ateam": {
      "command": "node",
      "args": ["/path/to/ateam-mcp-server/build/index.js"],
      "env": {
        "ATEAM_API_URL": "http://localhost:3000",
        "ATEAM_API_KEY": "optional-key-if-auth-enabled"
      }
    }
  }
}
```

### 5.3 NPM Package (future)

If published to npm as `@pairhq/ateam-mcp`:

```json
{
  "mcpServers": {
    "ateam": {
      "command": "npx",
      "args": ["@pairhq/ateam-mcp"],
      "env": {
        "ATEAM_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

---

## 6. Plugin Integration

### 6.1 Updated Plugin Structure

```
ateam-plugin/
├── CLAUDE.md                    # Plugin entry point
├── .mcp.json                    # MCP server configuration
│
├── skills/
│   ├── orchestration/
│   │   └── SKILL.md             # Updated to reference MCP tools
│   └── ...
│
├── subagents/
│   ├── hannibal.md
│   ├── face.md
│   └── ...
│
├── mcp-server/                  # Bundled MCP server
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   └── build/
│
└── scripts/                     # DEPRECATED - migration period only
    └── (legacy scripts)
```

### 6.2 Skill Updates

Update orchestration skill to use MCP tools instead of scripts:

```markdown
<!-- Before -->
To move an item, run:
```bash
node scripts/board-move.js WI-001 in_progress
```

<!-- After -->
To move an item, use the `board_move` tool:
- itemId: "WI-001"
- toStage: "in_progress"
```

### 6.3 Subagent Updates

Update subagent prompts to use MCP tools:

```markdown
<!-- Before -->
When starting work, run:
```bash
node scripts/item-agent-start.js WI-001 Hannibal
```

<!-- After -->
When starting work, call the `agent_start` tool with:
- itemId: The work item ID
- agent: "Hannibal"
```

---

## 7. Error Handling

### 7.1 API Errors

Map Kanban Viewer API errors to MCP-friendly responses:

| API Error Code | MCP Response |
|----------------|--------------|
| `ITEM_NOT_FOUND` | Error with message "Item {id} not found" |
| `INVALID_TRANSITION` | Error with message "Cannot move from {from} to {to}" |
| `WIP_LIMIT_EXCEEDED` | Error with message "Stage {stage} is at capacity ({limit} items)" |
| `AGENT_BUSY` | Error with message "Agent {name} is already working on {itemId}" |
| `DEPS_NOT_MET` | Error with message "Dependencies not satisfied: {deps}" |

### 7.2 Network Errors

- Timeout: Retry up to 3 times with exponential backoff
- Connection refused: Return error suggesting to check if Kanban Viewer is running
- 5xx errors: Retry with backoff

### 7.3 Validation Errors

Zod validation errors are caught by the MCP SDK and returned as structured errors to Claude.

---

## 8. Testing

### 8.1 Unit Tests

- Tool parameter validation
- Response formatting
- Error mapping

### 8.2 Integration Tests

```typescript
// tests/integration/board.test.ts

describe('board tools', () => {
  it('board_read returns board state', async () => {
    // Mock API response
    nock('http://localhost:3000')
      .get('/api/board')
      .reply(200, { success: true, data: mockBoardState });

    const result = await invokeTool('board_read', {});
    
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      success: true,
      data: expect.objectContaining({
        stages: expect.any(Array),
        items: expect.any(Array),
      }),
    });
  });

  it('board_move validates stage transitions', async () => {
    nock('http://localhost:3000')
      .post('/api/board/move')
      .reply(400, { 
        success: false, 
        error: { code: 'INVALID_TRANSITION', message: 'Cannot move from done to backlog' }
      });

    const result = await invokeTool('board_move', {
      itemId: 'WI-001',
      toStage: 'backlog',
    });
    
    expect(result.isError).toBe(true);
  });
});
```

### 8.3 Manual Testing

Use MCP Inspector to test tools:

```bash
npx @modelcontextprotocol/inspector build/index.js
```

---

## 9. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ATEAM_API_URL` | No | `http://localhost:3000` | Kanban Viewer API URL |
| `ATEAM_API_KEY` | No | _(none)_ | API key if auth enabled |
| `ATEAM_TIMEOUT` | No | `10000` | Request timeout (ms) |
| `ATEAM_RETRIES` | No | `3` | Max retry attempts |

---

## 10. Implementation Checklist

### Phase 1: Project Setup
- [x] Initialize package with TypeScript
- [x] Add MCP SDK dependency
- [x] Create config module
- [x] Create API client with retry logic

### Phase 2: Core Tools
- [x] `board_read`
- [x] `board_move`
- [x] `board_claim`
- [x] `board_release`

### Phase 3: Item Tools
- [x] `item_create`
- [x] `item_update`
- [x] `item_get`
- [x] `item_list`
- [x] `item_reject`
- [x] `item_render`

### Phase 4: Agent Tools
- [x] `agent_start`
- [x] `agent_stop`

### Phase 5: Mission Tools
- [x] `mission_init`
- [x] `mission_current`
- [x] `mission_precheck`
- [x] `mission_postcheck`
- [x] `mission_archive`

### Phase 6: Utility Tools
- [x] `deps_check`
- [x] `activity_log`
- [x] `log`

### Phase 7: Integration
- [x] Add `.mcp.json` to plugin
- [x] Update skill docs
- [x] Update subagent prompts
- [x] Test with Claude Code

### Phase 8: Documentation
- [x] Update CLAUDE.md
- [x] Update README.md
- [x] Update CHANGELOG.md
- [x] Update command docs (plan.md, run.md, setup.md)
- [x] Update PRD status

**Note:** CLI scripts in `scripts/` directory are retained for internal use by hook enforcement, but all agent-facing operations now use MCP tools.

---

## 11. Tool Summary

| Tool | API Endpoint | Description |
|------|--------------|-------------|
| `board_read` | `GET /api/board` | Get full board state |
| `board_move` | `POST /api/board/move` | Move item between stages |
| `board_claim` | `POST /api/board/claim` | Assign agent to item |
| `board_release` | `POST /api/board/release` | Release agent claim |
| `item_create` | `POST /api/items` | Create work item |
| `item_update` | `PATCH /api/items/[id]` | Update work item |
| `item_get` | `GET /api/items/[id]` | Get single item |
| `item_list` | `GET /api/items` | List items with filters |
| `item_reject` | `POST /api/items/[id]/reject` | Record rejection |
| `item_render` | `GET /api/items/[id]/render` | Render as markdown |
| `agent_start` | `POST /api/agents/start` | Start working on item |
| `agent_stop` | `POST /api/agents/stop` | Stop working on item |
| `mission_init` | `POST /api/missions` | Initialize new mission |
| `mission_current` | `GET /api/missions/current` | Get active mission |
| `mission_precheck` | `POST /api/missions/precheck` | Run pre-checks |
| `mission_postcheck` | `POST /api/missions/postcheck` | Run post-checks |
| `mission_archive` | `POST /api/missions/archive` | Archive mission |
| `deps_check` | `GET /api/deps/check` | Validate dependencies |
| `activity_log` | `POST /api/activity` | Log to Live Feed |
| `log` | `POST /api/activity` | Simple log shorthand |

---

## 12. Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^2.0.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0",
    "nock": "^13.0.0"
  }
}
```

---

## 13. Implementation Notes

1. **Bundled vs standalone**: ✅ **Resolved** - MCP server is bundled with plugin at `mcp-server/` directory
2. **NPM publish**: 🔜 **Future** - Can publish as `@pairhq/ateam-mcp` for standalone usage later
3. **Versioning**: ✅ **Resolved** - MCP server version tracks plugin version (both at 2.0.0)
4. **Script deprecation**: ✅ **Resolved** - CLI scripts retained for hook enforcement but not directly called by agents
5. **Testing coverage**: ✅ **Complete** - 355 tests covering all 20 tools with full coverage
