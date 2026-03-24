# PRD: Monorepo Migration

**Version:** 1.0.0
**Status:** Proposed
**Author:** Josh / Claude
**Date:** 2026-02-08
**Repo:** `The-Ai-team` plugin + `kanban-viewer` (merged)

---

## 1. Overview

### 1.1 Background

The A(i)-Team currently spans two separate repositories:

1. **The-Ai-team** (this repo) -- The Claude Code plugin containing agents, MCP server, commands, skills, and hooks
2. **kanban-viewer** (separate repo) -- A Next.js 16 web application with Prisma/SQLite, React 19 UI, SSE real-time updates, a REST API, and Docker support

The MCP server in this repo communicates with the kanban-viewer's REST API over HTTP. The connection is configured via the `ATEAM_API_URL` environment variable (default `http://localhost:3000`) set in `.claude/settings.local.json`.

### 1.2 Problem Statement

The two repositories share 10+ domain concepts with no compile-time safety between them:

| Shared Concept | Plugin Location | Kanban-Viewer Location |
|----------------|-----------------|------------------------|
| Stage IDs (`briefings`, `ready`, `testing`, ...) | `mcp-server/src/tools/board.ts` (`VALID_TRANSITIONS`) | API route handlers, Prisma schema |
| Agent names (`Murdock`, `B.A.`, `Lynch`, ...) | `mcp-server/src/lib/agents.ts` (`VALID_AGENTS_LOWER`, `AGENT_NAME_MAP`) | UI components, API validation |
| Agent name normalization | `mcp-server/src/lib/agents.ts` (`normalizeAgentName`) | Duplicated in API middleware |
| Transition matrix | `mcp-server/src/tools/board.ts` (`VALID_TRANSITIONS`) | API route `/api/board/move` |
| Item types (`feature`, `bug`, `task`, `enhancement`) | `mcp-server/src/tools/items.ts` (Zod schema) | Prisma enum, UI filters |
| Item priorities (`critical`, `high`, `medium`, `low`) | `mcp-server/src/tools/items.ts` (Zod schema) | Prisma enum, UI sort |
| Work log entry structure | `mcp-server/src/tools/agents.ts` | Prisma model, API response types |
| Item outputs shape (`test`, `impl`, `types`) | `mcp-server/src/tools/items.ts` | API create/update handlers |
| Error codes (`ITEM_NOT_FOUND`, `INVALID_TRANSITION`, ...) | `mcp-server/src/lib/errors.ts` | API error responses |
| WIP limit configuration | `mcp-server/src/tools/missions.ts` | API board logic |

**Schema drift is already happening.** The kanban-viewer's agent list is missing `Sosa` (added to the plugin in a later commit). The transition matrix in `board.ts` includes `ready -> implementing` but the API may not. Every domain change requires coordinated edits across both repos with no compiler to catch mismatches.

**Operational friction is high.** Users must separately clone, install, configure, and run the kanban-viewer. The `/ai-team:setup` command configures `ATEAM_API_URL` but cannot help users actually start the API server. This is a common source of setup failures.

### 1.3 Solution

Merge both repositories into a single bun workspaces monorepo. Extract shared domain concepts into a `@ai-team/shared` package that both the MCP server and kanban-viewer import. A single `bun install` at the root installs everything. A single `docker compose up` starts the kanban-viewer.

### 1.4 Scope

This PRD covers:
- Repository restructuring into bun workspaces
- Moving `mcp-server/` to `packages/mcp-server/`
- Importing kanban-viewer source into `packages/kanban-viewer/`
- Extracting shared types into `packages/shared/`
- Updating plugin configuration (`.mcp.json`)
- Root-level Docker Compose for one-command startup
- Setup command updates for integrated experience
- CI/CD updates for workspace-aware builds

This PRD does NOT cover:
- New features in either the MCP server or kanban-viewer
- UI redesign or API endpoint changes
- Authentication or multi-tenant features
- Publishing packages to npm

---

## 2. Architecture

### 2.1 Current Structure (Two Repos)

```
The-Ai-team/                          kanban-viewer/
├── agents/                           ├── src/
├── commands/                         │   ├── app/          (Next.js routes)
├── skills/                           │   ├── components/   (React 19 UI)
├── scripts/                          │   └── lib/          (shared utilities)
├── .claude-plugin/                   ├── prisma/
│   └── plugin.json                   │   └── schema.prisma
├── .mcp.json                         ├── Dockerfile
├── mcp-server/                       ├── docker-compose.yml
│   ├── src/                          └── package.json
│   │   ├── tools/
│   │   │   ├── board.ts   ←── VALID_TRANSITIONS (duplicated)
│   │   │   ├── items.ts   ←── ItemType enum (duplicated)
│   │   │   └── ...
│   │   ├── lib/
│   │   │   ├── agents.ts  ←── VALID_AGENTS (duplicated)
│   │   │   └── errors.ts  ←── Error codes (duplicated)
│   │   └── ...
│   └── package.json
└── package.json
```

### 2.2 Target Structure (Monorepo)

```
The-Ai-team/
├── packages/
│   ├── shared/                  # @ai-team/shared
│   │   ├── src/
│   │   │   ├── stages.ts            # StageId, ALL_STAGES, TRANSITION_MATRIX
│   │   │   ├── agents.ts            # AgentName, VALID_AGENTS, normalizeAgentName
│   │   │   ├── items.ts             # ItemType, ItemPriority, WorkLogEntry, ItemOutputs
│   │   │   ├── errors.ts            # Error codes shared between API and client
│   │   │   └── index.ts             # Barrel export
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── mcp-server/              # @ai-team/mcp-server (moved from ./mcp-server/)
│   │   ├── src/
│   │   │   ├── tools/
│   │   │   │   ├── board.ts         # Imports TRANSITION_MATRIX from @ai-team/shared
│   │   │   │   └── ...
│   │   │   ├── lib/
│   │   │   │   ├── agents.ts        # Re-exports from @ai-team/shared
│   │   │   │   └── ...
│   │   │   └── ...
│   │   ├── package.json             # depends on @ai-team/shared
│   │   └── tsconfig.json
│   │
│   └── kanban-viewer/           # @ai-team/kanban-viewer (moved from separate repo)
│       ├── src/
│       │   ├── app/                  # Next.js routes
│       │   ├── components/           # React 19 UI
│       │   └── lib/                  # Imports from @ai-team/shared
│       ├── prisma/
│       │   └── schema.prisma
│       ├── Dockerfile
│       ├── docker-compose.yml        # Standalone docker-compose for the viewer
│       └── package.json              # depends on @ai-team/shared
│
├── agents/                      # UNCHANGED - plugin root
├── commands/                    # UNCHANGED
├── skills/                      # UNCHANGED
├── scripts/                     # UNCHANGED
├── .claude-plugin/              # UNCHANGED
│   └── plugin.json
├── .mcp.json                    # UPDATED path: packages/mcp-server/src/index.ts (bun runs TS natively)
├── package.json                 # Workspace root (bun workspaces)
├── bun.lockb                    # Lock file (replaces package-lock.json)
├── docker-compose.yml           # Root-level for easy startup
└── CLAUDE.md                    # UPDATED with monorepo structure
```

### 2.3 Dependency Graph

```
@ai-team/shared
    ^           ^
    |           |
    |           |
@ai-team/       @ai-team/
mcp-server       kanban-viewer
```

Both `mcp-server` and `kanban-viewer` depend on `shared`. Neither depends on the other. The `shared` package has zero external dependencies (pure TypeScript types, constants, and validation functions).

### 2.4 Plugin Root Constraint

Claude Code discovers plugins by looking for `.claude-plugin/plugin.json` at the plugin root. The following directories MUST remain at the repository root (not inside `packages/`):

- `agents/` -- Agent prompt files
- `commands/` -- Slash command definitions
- `skills/` -- Skill definitions
- `scripts/` -- Hook enforcement scripts
- `.claude-plugin/` -- Plugin metadata
- `.mcp.json` -- MCP server configuration
- `CLAUDE.md` -- Plugin instructions

Moving any of these into `packages/` would break plugin discovery. The monorepo layout is designed around this constraint.

---

## 3. Shared Package Design

### 3.1 `packages/shared/src/stages.ts`

Extracted from `mcp-server/src/tools/board.ts`:

```typescript
export const ALL_STAGES = [
  'briefings',
  'ready',
  'testing',
  'implementing',
  'review',
  'probing',
  'done',
  'blocked',
] as const;

export type StageId = (typeof ALL_STAGES)[number];

export const TRANSITION_MATRIX: Record<StageId, readonly StageId[]> = {
  briefings: ['ready', 'blocked'],
  ready: ['testing', 'implementing', 'probing', 'blocked', 'briefings'],
  testing: ['review', 'blocked'],
  implementing: ['review', 'blocked'],
  probing: ['ready', 'done', 'blocked'],
  review: ['done', 'testing', 'implementing', 'probing', 'blocked'],
  done: [],
  blocked: ['ready'],
};

export function isValidTransition(from: StageId, to: StageId): boolean {
  return TRANSITION_MATRIX[from].includes(to);
}

export function getValidNextStages(from: StageId): readonly StageId[] {
  return TRANSITION_MATRIX[from];
}
```

### 3.2 `packages/shared/src/agents.ts`

Extracted from `mcp-server/src/lib/agents.ts`:

```typescript
export const VALID_AGENTS = [
  'murdock',
  'ba',
  'lynch',
  'amy',
  'hannibal',
  'face',
  'sosa',
  'tawnia',
] as const;

export type AgentId = (typeof VALID_AGENTS)[number];

export const AGENT_DISPLAY_NAMES: Record<AgentId, string> = {
  murdock: 'Murdock',
  ba: 'B.A.',
  lynch: 'Lynch',
  amy: 'Amy',
  hannibal: 'Hannibal',
  face: 'Face',
  sosa: 'Sosa',
  tawnia: 'Tawnia',
};

export function normalizeAgentName(raw: string): string {
  return raw.toLowerCase().replace(/\./g, '');
}

export function isValidAgent(name: string): name is AgentId {
  return VALID_AGENTS.includes(normalizeAgentName(name) as AgentId);
}
```

### 3.3 `packages/shared/src/items.ts`

Extracted from `mcp-server/src/tools/items.ts` and kanban-viewer Prisma schema:

```typescript
export const ITEM_TYPES = ['feature', 'bug', 'task', 'enhancement'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type ItemPriority = (typeof ITEM_PRIORITIES)[number];

export interface ItemOutputs {
  test?: string;
  impl?: string;
  types?: string;
}

export interface WorkLogEntry {
  agent: string;
  timestamp: string;
  status: 'success' | 'failed';
  summary: string;
  files_created?: string[];
  files_modified?: string[];
}
```

### 3.4 `packages/shared/src/errors.ts`

Extracted from `mcp-server/src/lib/errors.ts` and kanban-viewer API:

```typescript
export const ERROR_CODES = {
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  WIP_LIMIT_EXCEEDED: 'WIP_LIMIT_EXCEEDED',
  AGENT_BUSY: 'AGENT_BUSY',
  DEPS_NOT_MET: 'DEPS_NOT_MET',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSION_NOT_FOUND: 'MISSION_NOT_FOUND',
  MISSION_ALREADY_ACTIVE: 'MISSION_ALREADY_ACTIVE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
```

### 3.5 Package Configuration

`packages/shared/package.json`:
```json
{
  "name": "@ai-team/shared",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

The shared package has zero runtime dependencies. It exports only types, constants, and pure validation functions.

---

## 4. Work Items

### 4.1 Wave 0: Preparation (no code changes to existing modules)

These items restructure the repository without changing any module behavior. After Wave 0, the plugin must still load and all existing tests must pass.

---

#### WI-001: Set up bun workspaces in root package.json

**Type:** task
**Priority:** high

**Description:**
Convert the root `package.json` to a workspace root. The current root `package.json` is named `@ai-team/scripts` with vitest as a dev dependency. Update it to define bun workspaces pointing to `packages/*`.

**Current root `package.json`:**
```json
{
  "name": "@ai-team/scripts",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

**Target root `package.json`:**
```json
{
  "name": "@ai-team/root",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "bun run build --workspace",
    "test": "bun run test --workspace --if-present",
    "test:root": "vitest run"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "typescript": "^5.3.0"
  }
}
```

**Acceptance Criteria:**
- [ ] Root `package.json` declares `workspaces: ["packages/*"]`
- [ ] Root `package.json` has `"private": true` (workspace roots must be private)
- [ ] Root-level vitest config (`vitest.config.js`) still works for `scripts/` tests
- [ ] `bun install` at root completes without errors

---

#### WI-002: Move mcp-server to packages/mcp-server

**Type:** task
**Priority:** high
**Dependencies:** WI-001

**Description:**
Move the `mcp-server/` directory to `packages/mcp-server/`. Update all internal import paths if any use relative paths that reference the old location. The MCP server's `package.json` already uses the name `@ai-team/mcp-server`, which works with workspaces.

**Acceptance Criteria:**
- [ ] `mcp-server/` directory moved to `packages/mcp-server/`
- [ ] `packages/mcp-server/package.json` exists and is valid
- [ ] `bun run build` in `packages/mcp-server/` succeeds
- [ ] `bun run test` in `packages/mcp-server/` passes all existing tests
- [ ] No dangling references to `mcp-server/` at the old location

---

#### WI-003: Update .mcp.json path reference

**Type:** task
**Priority:** high
**Dependencies:** WI-002

**Description:**
Update `.mcp.json` to point to the new MCP server location. The current path uses `${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js` and must change to `${CLAUDE_PLUGIN_ROOT}/packages/mcp-server/src/index.ts`. Since bun natively executes TypeScript files, we can point directly to the source without requiring a build step.

**Current `.mcp.json`:**
```json
{
  "mcpServers": {
    "ateam": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js"]
    }
  }
}
```

**Target `.mcp.json` (using bun):**
```json
{
  "mcpServers": {
    "ateam": {
      "command": "bun",
      "args": ["${CLAUDE_PLUGIN_ROOT}/packages/mcp-server/src/index.ts"]
    }
  }
}
```

**Acceptance Criteria:**
- [ ] `.mcp.json` path points to `packages/mcp-server/src/index.ts`
- [ ] `.mcp.json` uses `"command": "bun"` instead of `"node"`
- [ ] Plugin loads correctly in Claude Code with the updated path
- [ ] All 20 MCP tools are available after the path change
- [ ] `bun` is available in the system PATH (verified during setup)

---

#### WI-004: Verify plugin loads after restructure

**Type:** task
**Priority:** high
**Dependencies:** WI-002, WI-003

**Description:**
End-to-end verification that the plugin still works after restructuring. This is a manual verification step, not an automated test.

**Verification steps:**
1. Start Claude Code with `--plugin-dir` pointing to the repo root
2. Verify all MCP tools are registered (use `mission_current` to test connectivity)
3. Verify slash commands work (`/ai-team:status`)
4. Verify agent prompts are discovered (agents/ directory)
5. Run `bun test` at workspace root to confirm all tests pass

**Acceptance Criteria:**
- [ ] Plugin loads without errors
- [ ] All 20 MCP tools respond to invocations
- [ ] `/ai-team:status` command executes
- [ ] `bun test` passes across all workspaces

---

### 4.2 Wave 1: Bring in kanban-viewer

These items add the kanban-viewer to the monorepo. After Wave 1, both packages coexist and the kanban-viewer builds and runs from its new location.

---

#### WI-005: Move kanban-viewer source into packages/kanban-viewer

**Type:** task
**Priority:** high
**Dependencies:** WI-001

**Description:**
Bring the kanban-viewer repository into `packages/kanban-viewer/`. Use `git subtree add` to preserve commit history, or copy the source and note the original repo in a README if history preservation is impractical.

**Key files to include:**
- `src/` -- Next.js application source
- `prisma/` -- Prisma schema and migrations
- `public/` -- Static assets
- `Dockerfile` and `docker-compose.yml` -- Container setup
- `package.json`, `tsconfig.json`, `next.config.ts`
- `.env.example` -- Environment variable template

**Acceptance Criteria:**
- [ ] `packages/kanban-viewer/` contains the full kanban-viewer source
- [ ] `packages/kanban-viewer/package.json` exists and is recognized by bun workspaces
- [ ] Git history is preserved (via subtree) or the original repo is referenced
- [ ] No files from kanban-viewer pollute the repository root
- [ ] Next.js + bun compatibility verified (see wave 1 notes below)

---

#### WI-006: Add root-level docker-compose.yml

**Type:** task
**Priority:** medium
**Dependencies:** WI-005

**Description:**
Create a root-level `docker-compose.yml` that starts the kanban-viewer with a single command. This file should reference the Dockerfile inside `packages/kanban-viewer/` and mount the SQLite database to a persistent volume.

The kanban-viewer's own `docker-compose.yml` inside `packages/kanban-viewer/` remains for standalone use. The root-level file is a convenience wrapper.

```yaml
# docker-compose.yml (root)
services:
  kanban-viewer:
    build:
      context: ./packages/kanban-viewer
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    volumes:
      - ateam-data:/app/data
    environment:
      - DATABASE_URL=file:/app/data/ateam.db

volumes:
  ateam-data:
```

**Acceptance Criteria:**
- [ ] `docker compose up` from repo root builds and starts the kanban-viewer
- [ ] The API responds at `http://localhost:3000`
- [ ] SQLite data persists across container restarts (volume mount)
- [ ] `packages/kanban-viewer/docker-compose.yml` still works standalone

---

#### WI-007: Verify kanban-viewer builds and runs from new location

**Type:** task
**Priority:** high
**Dependencies:** WI-005, WI-006

**Description:**
Verify the kanban-viewer works correctly from its new location within the monorepo. Test both local development and Docker workflows.

**Verification steps:**
1. `cd packages/kanban-viewer && bun run dev` starts the dev server
2. `docker compose up` from repo root starts the container
3. API endpoints respond correctly (`/api/board`, `/api/items`, etc.)
4. SSE endpoint delivers real-time updates
5. `bun run build` in `packages/kanban-viewer/` produces a production build
6. Prisma migrations run successfully

**Acceptance Criteria:**
- [ ] Local dev server starts and serves the UI
- [ ] Docker container builds and runs
- [ ] All API endpoints respond with correct data
- [ ] Existing kanban-viewer tests pass from the new location
- [ ] **Important:** Flag any Next.js + bun compatibility issues for resolution (bun's Node.js compat layer may have gaps)

---

### 4.3 Wave 2: Extract shared package

These items create the `@ai-team/shared` package and migrate both consumers to use it. This is the core of the monorepo value proposition. After Wave 2, changing a shared type is a single-file edit that both packages see at compile time.

---

#### WI-008: Create packages/shared with extracted types

**Type:** feature
**Priority:** high
**Dependencies:** WI-002, WI-005

**Description:**
Create the `packages/shared/` package with types, constants, and validation functions extracted from both the MCP server and kanban-viewer. See Section 3 of this PRD for the detailed module design.

**Modules to create:**
- `stages.ts` -- `StageId`, `ALL_STAGES`, `TRANSITION_MATRIX`, `isValidTransition`, `getValidNextStages`
- `agents.ts` -- `AgentId`, `VALID_AGENTS`, `AGENT_DISPLAY_NAMES`, `normalizeAgentName`, `isValidAgent`
- `items.ts` -- `ItemType`, `ItemPriority`, `ItemOutputs`, `WorkLogEntry`, `ITEM_TYPES`, `ITEM_PRIORITIES`
- `errors.ts` -- `ErrorCode`, `ERROR_CODES`
- `index.ts` -- Barrel export of all modules

**Acceptance Criteria:**
- [ ] `packages/shared/package.json` is valid with name `@ai-team/shared`
- [ ] All types compile without errors (`bun run build`)
- [ ] Zero runtime dependencies (types, constants, and pure functions only)
- [ ] All exported types match the current definitions in both MCP server and kanban-viewer
- [ ] `tsconfig.json` targets ES modules with declaration output

---

#### WI-009: Update mcp-server to import from @ai-team/shared

**Type:** feature
**Priority:** high
**Dependencies:** WI-008

**Description:**
Replace locally-defined types and constants in the MCP server with imports from `@ai-team/shared`.

**Files to update:**

| File | Change |
|------|--------|
| `packages/mcp-server/src/lib/agents.ts` | Replace `VALID_AGENTS_LOWER`, `AGENT_NAME_MAP`, `normalizeAgentName` with re-exports from `@ai-team/shared` |
| `packages/mcp-server/src/tools/board.ts` | Replace `VALID_TRANSITIONS` with import of `TRANSITION_MATRIX` from `@ai-team/shared` |
| `packages/mcp-server/src/tools/items.ts` | Replace inline type/priority enums with `ITEM_TYPES`, `ITEM_PRIORITIES` from `@ai-team/shared` |
| `packages/mcp-server/src/lib/errors.ts` | Replace inline error codes with `ERROR_CODES` from `@ai-team/shared` |
| `packages/mcp-server/package.json` | Add `"@ai-team/shared": "*"` to dependencies |

**Acceptance Criteria:**
- [ ] MCP server imports all shared concepts from `@ai-team/shared`
- [ ] No duplicate definitions of shared types remain in the MCP server
- [ ] `bun run build` in `packages/mcp-server/` succeeds
- [ ] All existing MCP server tests pass (behavior unchanged)
- [ ] Zod schemas in tool files use the shared constants (e.g., `z.enum(ITEM_TYPES)`)

---

#### WI-010: Update kanban-viewer to import from @ai-team/shared

**Type:** feature
**Priority:** high
**Dependencies:** WI-008

**Description:**
Replace locally-defined types and constants in the kanban-viewer with imports from `@ai-team/shared`.

**Areas to update:**
- API route handlers that validate stage transitions
- API route handlers that validate agent names
- UI components that render agent avatars or stage columns
- Prisma seed scripts that reference agent names or stages
- Any utility functions that duplicate `normalizeAgentName` logic

**Acceptance Criteria:**
- [ ] Kanban-viewer imports all shared concepts from `@ai-team/shared`
- [ ] No duplicate definitions of shared types remain in the kanban-viewer
- [ ] `bun run build` in `packages/kanban-viewer/` succeeds
- [ ] All existing kanban-viewer tests pass (behavior unchanged)
- [ ] The Sosa agent appears in the kanban-viewer (drift fixed)

---

#### WI-011: Delete duplicate type definitions

**Type:** task
**Priority:** medium
**Dependencies:** WI-009, WI-010

**Description:**
After both packages import from `@ai-team/shared`, sweep for any remaining duplicate definitions of shared concepts. This is a safety-net cleanup pass.

**Search for duplicates of:**
- Agent name arrays or enums (besides the shared package)
- Stage name arrays or enums (besides the shared package)
- Transition matrix definitions (besides the shared package)
- Item type/priority enums (besides the shared package)
- Error code constants (besides the shared package)

**Acceptance Criteria:**
- [ ] No file outside `packages/shared/src/` defines `VALID_AGENTS`, `ALL_STAGES`, `TRANSITION_MATRIX`, `ITEM_TYPES`, `ITEM_PRIORITIES`, or `ERROR_CODES`
- [ ] `bun run build` succeeds for all three packages
- [ ] `bun test` passes across the entire workspace

---

#### WI-012: Verify shared type compile-time safety

**Type:** task
**Priority:** high
**Dependencies:** WI-009, WI-010, WI-011

**Description:**
Prove the compile-time safety goal: a single-file edit to a shared type propagates to both packages as a build error.

**Verification steps:**
1. Add a new stage (e.g., `'qa-hold'`) to `ALL_STAGES` in `packages/shared/src/stages.ts`
2. Run `bun run build` at workspace root -- both packages should report type errors where stage exhaustiveness checks fail
3. Revert the change
4. Rename an agent in `VALID_AGENTS` -- both packages should fail to build
5. Revert the change

This is a manual verification step, not an automated test.

**Acceptance Criteria:**
- [ ] Adding a stage to `ALL_STAGES` causes build errors in both mcp-server and kanban-viewer
- [ ] Removing an agent from `VALID_AGENTS` causes build errors in both packages
- [ ] After reverting, all packages build cleanly

---

### 4.4 Wave 3: Setup automation

These items improve the developer experience by integrating the kanban-viewer into the `/ai-team:setup` flow. After Wave 3, a new user can get the full A(i)-Team running with minimal manual steps.

---

#### WI-013: Update /ai-team:setup to detect and start kanban-viewer

**Type:** enhancement
**Priority:** medium
**Dependencies:** WI-006

**Description:**
Update the `/ai-team:setup` command (`commands/setup.md`) to detect whether Docker is available and offer to build/start the kanban-viewer container.

**New setup step (after API URL configuration):**

1. Check if Docker is installed (`which docker`)
2. Check if `docker-compose.yml` exists at the plugin root
3. If both are true, offer to start the kanban-viewer:
   ```
   Docker detected. Start the kanban-viewer dashboard?
   This provides a web UI for tracking mission progress.
     - Yes (Recommended): docker compose up -d
     - No: I'll start it manually
   ```
4. If started, auto-configure `ATEAM_API_URL` to `http://localhost:3000`
5. Add a health check: wait for `/api/board` to respond (up to 30 seconds)

**Acceptance Criteria:**
- [ ] Setup detects Docker availability
- [ ] Setup offers to start the kanban-viewer container
- [ ] `ATEAM_API_URL` is auto-configured when Docker is used
- [ ] Health check verifies API is responding before proceeding
- [ ] Setup still works without Docker (manual API URL configuration)

---

#### WI-014: Update CLAUDE.md with monorepo structure

**Type:** task
**Priority:** medium
**Dependencies:** WI-009, WI-010

**Description:**
Update the `CLAUDE.md` file to reflect the new monorepo structure. Key sections to update:

- **File Organization**: Update the directory tree to show `packages/` layout
- **Architecture**: Update system diagram to show shared package
- **Environment Variables**: Note that `ATEAM_API_URL` can point to the local Docker container
- **Installation**: Add `docker compose up` to the quick-start flow
- **MCP Tools**: Update any references to `mcp-server/` paths

**Acceptance Criteria:**
- [ ] File Organization section shows `packages/shared/`, `packages/mcp-server/`, `packages/kanban-viewer/`
- [ ] `.mcp.json` path reference is updated in docs
- [ ] Docker startup instructions are included
- [ ] No references to the old `mcp-server/` path (at repo root) remain

---

### 4.5 Wave 4: CI/CD

These items ensure the monorepo is properly tested in CI. They can be worked in parallel with Wave 3.

---

#### WI-015: Update GitHub Actions for workspaces

**Type:** task
**Priority:** medium
**Dependencies:** WI-001, WI-002, WI-005

**Description:**
Update `.github/` CI workflows to handle the bun workspaces monorepo. The build should use the `oven-sh/setup-bun@v2` action and:

1. Install all workspace dependencies with `bun install` at root
2. Build `packages/shared/` first (other packages depend on it)
3. Build `packages/mcp-server/` and `packages/kanban-viewer/` in parallel
4. Run tests for all packages with vitest (not bun test)

**Example workflow:**
```yaml
- name: Setup bun
  uses: oven-sh/setup-bun@v2
  with:
    bun-version: latest

- name: Install dependencies
  run: bun install

- name: Build packages
  run: bun run build --workspace

- name: Run tests
  run: bun run test --workspace --if-present
```

**Acceptance Criteria:**
- [ ] CI uses `oven-sh/setup-bun@v2` action instead of `actions/setup-node`
- [ ] CI runs `bun install` at workspace root
- [ ] `@ai-team/shared` builds before dependent packages
- [ ] All package tests run in CI (vitest still used as test runner)
- [ ] CI passes on the main branch after migration

---

#### WI-016: Add conditional build detection

**Type:** enhancement
**Priority:** low
**Dependencies:** WI-015

**Description:**
Optimize CI by detecting which packages changed and only running relevant builds/tests. Use file path filters in GitHub Actions:

```yaml
on:
  push:
    paths:
      - 'packages/shared/**'     # Changes here trigger all builds
      - 'packages/mcp-server/**' # Only rebuild mcp-server + shared
      - 'packages/kanban-viewer/**' # Only rebuild kanban-viewer + shared
```

Changes to `packages/shared/` should trigger builds for both dependent packages. Changes to a leaf package should only trigger that package's build.

**Note:** All CI jobs use `bun` (via `oven-sh/setup-bun@v2`) instead of `npm`.

**Acceptance Criteria:**
- [ ] Changes to `packages/shared/` trigger builds for all packages
- [ ] Changes to only `packages/mcp-server/` skip kanban-viewer build
- [ ] Changes to only `packages/kanban-viewer/` skip mcp-server build
- [ ] Changes to plugin root files (agents/, commands/) skip package builds

---

## 5. Migration Path for Existing Users

### 5.1 Submodule Users

Users who have the plugin installed as a git submodule at `.claude/ai-team/` need to update after this migration.

**Steps:**
1. Ensure `bun` is installed: `curl -fsSL https://bun.sh/install | bash`
2. `cd .claude/ai-team && git pull origin main` -- Pull the restructured repo
3. `bun install` -- Install workspace dependencies (replaces per-package installs)
4. No changes to `.claude/settings.local.json` (env vars unchanged)
5. The `.mcp.json` update is automatic (pulled with git)

**Breaking changes:**
- The `.mcp.json` path changes from `mcp-server/dist/index.js` to `packages/mcp-server/src/index.ts`
- The `.mcp.json` command changes from `node` to `bun`
- These changes are handled automatically -- users do not need to update their config manually

**No rebuild required:** Since bun executes TypeScript natively, the MCP server no longer needs a build step. `bun install` is sufficient.

### 5.2 Plugin-dir Users

Users testing with `--plugin-dir` need to:
1. Ensure `bun` is installed: `curl -fsSL https://bun.sh/install | bash`
2. Pull the updated repo
3. Run `bun install` at the repo root

**Note:** No build step is required. Since bun executes TypeScript natively, the MCP server runs directly from `packages/mcp-server/src/index.ts`.

### 5.3 Migration Automation

Consider adding a `postinstall` script in the root `package.json` that builds the shared package automatically (though the MCP server no longer requires a build):

```json
{
  "scripts": {
    "postinstall": "bun run build -w packages/shared"
  }
}
```

This ensures the shared package is built after `bun install`, making its types available to dependent packages.

---

## 6. Implementation Notes

### 6.1 Wave Dependencies

```
Wave 0                          Wave 1
WI-001 (workspaces)             WI-005 (kanban-viewer import)
  |                               |        |
  v                               v        v
WI-002 (move mcp-server) ─────> WI-008   WI-006 (root docker-compose)
  |                              (shared)   |
  v                               |  |      v
WI-003 (.mcp.json)               |  |    WI-007 (verify kanban-viewer)
  |                               |  |
  v                               v  v
WI-004 (verify plugin) ─────── WI-009  WI-010  ──> WI-013 (setup updates)
                               (mcp)   (kanban)
                                 |       |
                                 v       v
                                WI-011 (delete dupes)
                                   |
                                   v
                                WI-012 (verify safety)  WI-014 (CLAUDE.md)

Wave 4 (independent of Waves 2-3)
WI-015 (CI workspaces) ──> WI-016 (conditional builds)
```

Wave 0 and Wave 1 have minimal overlap: WI-001 is a prerequisite for both, but WI-002 (move mcp-server) and WI-005 (import kanban-viewer) can proceed in parallel after WI-001 completes.

Wave 2 depends on both Wave 0 and Wave 1 completing, since the shared package needs both consumers in place.

Wave 3 and Wave 4 can proceed in parallel. Both depend on earlier waves but not on each other.

### 6.2 Git History Preservation

The preferred method for bringing kanban-viewer into the monorepo is `git subtree add`:

```bash
git subtree add --prefix=packages/kanban-viewer \
  git@github.com:yourorg/kanban-viewer.git main \
  --squash
```

This preserves the kanban-viewer's commit history as a single squashed commit. The `--squash` flag keeps the main repo's history clean while recording the origin.

If subtree proves problematic (e.g., due to submodule conflicts), a plain copy with a README noting the source repo and last commit hash is acceptable.

### 6.3 TypeScript Project References and Bun Native TS Support

For optimal build performance, consider using TypeScript project references between packages:

```json
// packages/mcp-server/tsconfig.json
{
  "references": [
    { "path": "../shared" }
  ]
}
```

This enables incremental builds: changes to `shared` only rebuild what depends on it. This is an optimization and not strictly required for correctness.

**Bun Benefit:** Since bun natively executes TypeScript files without compilation, the MCP server doesn't need a build step. TypeScript errors are caught at runtime or via `bun run tsc --noEmit` for type-checking.

### 6.4 TypeScript Dependency Notes

- Keep `typescript` as a devDependency for type-checking via `bun run tsc --noEmit`
- Drop `tsx` devDependency -- bun runs `.ts` files natively without intermediaries
- Keep `vitest` as the test runner (do NOT replace with `bun test`)
- Kanban-viewer's Next.js build still requires `typescript` for production type-checking

### 6.5 Kanban-Viewer Standalone Docker

The kanban-viewer's `packages/kanban-viewer/docker-compose.yml` must continue to work independently. Users who only want the dashboard (without the Claude Code plugin) should be able to:

```bash
cd packages/kanban-viewer
docker compose up
```

The root-level `docker-compose.yml` is a convenience for developers working on the full stack.

### 6.6 Risk: Bun Workspace Hoisting

Bun workspaces hoist shared dependencies to the root `node_modules/`. This can cause issues if:
- The MCP server and kanban-viewer depend on different major versions of the same package
- A package uses `require.resolve` with assumptions about `node_modules` layout

Mitigate by auditing dependency versions across packages before the migration. Bun's dependency resolution is generally more predictable than npm's, but conflicts should still be tested.

### 6.7 Risk: Next.js + Bun Compatibility

**This is a known area of potential friction.** Verify during WI-007 that:
- Next.js build process works with bun (no breaking API changes)
- Bun's Node.js compatibility layer supports all Next.js dependencies
- `next.config.ts` can import from `@ai-team/shared` without issues
- The Dockerfile's build context includes `packages/shared/`

If Next.js doesn't run smoothly with bun, consider:
- Keeping `packages/kanban-viewer` on `npm` while other packages use `bun` (dual package managers)
- Using `bun` only for local development, `npm` in Docker (CI workaround)
- Waiting for bun's Next.js support to mature before full migration

These compatibility issues will surface during WI-007 and should be resolved before moving forward.

---

## 7. Success Criteria

The monorepo migration is complete when:

1. **Single repo, single clone** -- Developers clone one repository and get the complete A(i)-Team system
2. **Single install** -- `bun install` at root installs all workspace dependencies for all packages
3. **One-command dashboard** -- `docker compose up` from the repo root starts the kanban-viewer
4. **Compile-time safety** -- Changing a shared type (e.g., adding a stage, renaming an agent) is a single-file edit in `packages/shared/` that produces build errors in both dependent packages until they are updated
5. **Zero drift** -- The kanban-viewer's agent list, stage list, and transition matrix are guaranteed to match the MCP server's (proven by shared imports, not manual coordination)
6. **All tests pass** -- `bun test` at workspace root runs all package tests successfully (vitest remains the test runner)
7. **Plugin loads correctly** -- Claude Code discovers the plugin, `.mcp.json` points to `packages/mcp-server/src/index.ts`, and all 20 MCP tools are available
8. **No build step for MCP server** -- Since bun runs `.ts` files natively, the MCP server executes directly from source with no compilation required
9. **Existing users can update** -- Submodule and plugin-dir users can migrate with documented steps (requires bun installation)
10. **Next.js + bun verified** -- Kanban-viewer builds and runs with bun (compatibility confirmed or workarounds documented)
