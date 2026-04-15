---
missionId: ~
---

# SQLite Migration System

**Author:** Josh / Claude  **Date:** 2026-03-29  **Status:** Draft

## 1. Context & Background

The kanban-viewer uses SQLite via Prisma with a "bake and copy" initialization strategy: `prisma db push` creates a seed DB at build time, and the Docker entrypoint copies it on first boot. There is no mechanism to apply schema changes to an existing database.

This caused data loss during the agent-quality-skills mission: adding a `retroReport` column required replacing the live DB with a fresh init copy, wiping all mission tracking data (work items, work logs, rejection history, token usage).

The same problem will occur on every OVH Cloud deployment that introduces a schema change.

## 2. Problem Statement

Schema changes to the kanban-viewer database require destroying and re-creating the DB because there is no migration system. This causes complete data loss of mission history, work logs, and telemetry — the exact data the retro system is designed to analyze.

## 3. Requirements

### Functional

1. A migration runner that applies pending SQL migrations to an existing SQLite database on container startup
2. Migration files stored in a numbered/timestamped directory (e.g., `prisma/migrations/001_add_retro_report.sql`)
3. A `_migrations` table in the DB tracking which migrations have been applied
4. Docker entrypoint runs migrations after init-copy (new DBs) and on existing DBs (upgrades)
5. Migrations are idempotent — re-running a migration that's already applied is a no-op
6. Schema changes generate both a Prisma schema update AND a corresponding migration SQL file

### Non-Functional

- Zero data loss on schema upgrades
- Container startup adds < 1s for migration check
- Works with SQLite (no server-based migration tools)

## 4. Scope

### In Scope
- Migration runner (Node.js script run from entrypoint)
- Migration file format and directory structure
- Updated Docker entrypoint
- Retroactive migration for `retroReport` column
- Documentation for creating new migrations

### Out of Scope
- Prisma Migrate (requires datasource URL in schema, adds complexity)
- Rollback support (SQLite ALTER TABLE is limited anyway)
- CI/CD pipeline changes
