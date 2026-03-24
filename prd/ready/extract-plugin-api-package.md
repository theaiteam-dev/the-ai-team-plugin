# PRD: Extract `@theaiteam/plugin-api` Package

**Version:** 1.0.0
**Status:** Proposed
**Date:** 2026-03-21

---

## 1. Overview

### 1.1 Background

The kanban-viewer package contains a full REST API surface (activity, agents, board, items, missions, projects, stages) implemented as Next.js route handlers backed by Prisma + libSQL. This API is currently tightly coupled to the kanban-viewer application — the route handlers, business logic, database queries, and Prisma schema all live inside `packages/kanban-viewer/`.

The goal is to extract this API layer into a standalone, publishable npm package: `@theaiteam/plugin-api`. The kanban-viewer becomes a thin consumer of that package, and any future application can import and expose the same API surface with zero duplication.

### 1.2 Problem Statement

- The API logic is not reusable outside the kanban-viewer without copy-pasting
- The kanban-viewer owns the Prisma schema, making it impossible for another app to share the data model cleanly
- Route handlers are defined directly in Next.js app router structure, coupling the API to a specific framework layout
- There is no clean boundary between "what is the API" and "what is the kanban-viewer UI"

---

## 2. Architecture Decisions

### 2.1 Package Name and License

- Package name: `@theaiteam/plugin-api`
- License: MIT
- Published to npm under the `@theaiteam` org
- Lives in `packages/plugin-api/` within this monorepo
- Built with `tsup`, same as `packages/shared/`

### 2.2 Route Handler Exports (Framework-Agnostic Adapter Pattern)

The package exports a single `toNextJsHandler()` function that returns Next.js-compatible route handlers. Consuming apps mount them at any path they choose.

```ts
// @theaiteam/plugin-api
export function toNextJsHandler(config: PluginApiConfig): NextJsHandlers

// Consuming app: packages/kanban-viewer/src/app/api/ateam/[...route]/route.ts
import { toNextJsHandler } from '@theaiteam/plugin-api'
export const { GET, POST, PUT, DELETE } = toNextJsHandler({ db: prisma })
```

This pattern mirrors `@context-kit/auth`'s `toNextJsHandler()` for consistency.

The internal routing (which handler runs for which path) is managed inside the package using URL pattern matching — not the filesystem. This keeps the package framework-portable if a non-Next.js adapter is needed later.

### 2.3 Prisma Client Injection

The package does **not** instantiate its own Prisma client. The consuming application creates the client and passes it in via config:

```ts
toNextJsHandler({ db: prisma })
```

**Rationale:**
- Avoids duplicate Prisma client instances (connection exhaustion)
- The consuming app controls the database adapter (libSQL, pg, or otherwise)
- The consuming app controls logging, connection pooling, and lifecycle
- Consistent with how context-kit apps already manage Prisma

The package ships a Prisma schema that consuming apps extend or adopt. Migrations remain the consumer's responsibility.

### 2.4 Prisma Schema Ownership

Two options considered:

**Option A:** Package ships its own `schema.prisma`, consumers copy/adopt it.
**Option B:** Package ships schema as a reference; each consumer owns their own schema.

**Decision: Option B.** Each consuming app owns its schema. The package documents the required models and fields. This avoids conflicts when consumers have additional models and keeps the package from managing migrations.

The package exports TypeScript types derived from Prisma but does not re-export `@prisma/client` types directly — it uses its own domain types (already partially in `packages/shared/`).

### 2.5 No Auth, No Org Scoping

The package has zero knowledge of authentication or multi-tenancy. Every route handler receives a `projectId` (extracted from the `X-Project-ID` header) and scopes all database operations to that project. Nothing else.

Auth, API key validation, org resolution, and session handling are entirely the consuming application's responsibility — implemented as middleware before the request reaches the package's route handlers.

**kanban-viewer:** No middleware. Request hits the handler directly.
**Any consuming app that needs auth:** Middleware validates credentials, resolves `projectId`, then passes to the handler.

The package does not know or care what wraps it.

### 2.6 SSE (Server-Sent Events)

The current kanban-viewer exposes SSE endpoints for real-time board updates. These move into the package as first-class exported handlers, not special-cased. The consuming app mounts them at the appropriate path.

### 2.7 What Stays in kanban-viewer

- All UI components, pages, and layouts
- The Prisma client singleton (`lib/db.ts`)
- The `db-path.ts` utility (libSQL-specific path resolution)
- The `prisma/` directory (schema, migrations, seed)
- Docker configuration
- The `toNextJsHandler()` call site — a single route file

### 2.8 What Moves to plugin-api

- All route handler logic from `src/app/api/`
- All `src/lib/` utilities that are API-related (not UI-related):
  - `activity-log.ts`, `agent-status-utils.ts`, `api-transform.ts`, `api-validation.ts`
  - `dependency-utils.ts`, `filter-utils.ts`, `item-transform.ts`
  - `json-utils.ts`, `parser.ts`, `project-utils.ts`, `stage-utils.ts`
  - `stats.ts`, `token-cost.ts`, `token-summary.ts`, `validation.ts`
  - `errors.ts`, `utils.ts`
- `packages/shared/` types that are API-relevant (re-exported from plugin-api)
- The internal router

---

## 3. Package Interface

```ts
// Main export
export function toNextJsHandler(config: PluginApiConfig): {
  GET: NextRequest => Promise<NextResponse>
  POST: NextRequest => Promise<NextResponse>
  PUT: NextRequest => Promise<NextResponse>
  DELETE: NextRequest => Promise<NextResponse>
}

export interface PluginApiConfig {
  db: PrismaClient
}

// Domain types (re-exported from shared or defined here)
export type { WorkItem, Mission, Stage, Agent, ActivityEntry } from './types'
```

---

## 4. Migration Plan

1. Create `packages/plugin-api/` with `package.json`, `tsup.config.ts`, `tsconfig.json`
2. Move API business logic files from `kanban-viewer/src/lib/` → `plugin-api/src/lib/`
3. Move route handler logic from `kanban-viewer/src/app/api/` → `plugin-api/src/routes/`
4. Implement internal router in `plugin-api/src/handler.ts`
5. Export `toNextJsHandler` from package root
6. Update kanban-viewer: replace all route files with single catch-all route importing from `@theaiteam/plugin-api`
7. Update kanban-viewer `package.json` to depend on `@theaiteam/plugin-api`
8. Verify kanban-viewer behavior is unchanged (existing tests pass)
9. Publish `@theaiteam/plugin-api` to npm

---

## 5. Out of Scope

- Auth or API key handling (consuming app concern, if needed)
- Multi-tenancy or org scoping (consuming app concern, if needed)
- Any changes to the `ateam` CLI
- Any changes to the Claude Code plugin agents or commands
- A non-Next.js adapter (future work if needed)
