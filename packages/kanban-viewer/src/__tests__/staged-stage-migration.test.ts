/**
 * Tests for WI-786: Add the staged stage row via data migration and seed.
 *
 * The Stage table must contain a 'staged' row (order 6, wipLimit null) on both
 * freshly seeded databases (prisma/seed.ts) and existing databases (a hand-authored
 * data-only migration), with 'done' and 'blocked' shifted to order 7 and 8.
 *
 * Test approach: real temp SQLite databases via `prisma db push` + real subprocess
 * execution of the actual seed.ts script, and direct execution of the actual
 * migration.sql file — no mocking, no reimplementation. Mirrors the pattern used in
 * backfill-migrations.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';

import { checkWipLimit } from '@/lib/validation';
import type { StageId } from '@/types/board';

// ── Constants ────────────────────────────────────────────────────────────────

// This test file lives at src/__tests__/ — the kanban-viewer package root is two
// levels up. prisma.config.ts resolves the schema relative to its own directory,
// so only cwd (for `npx`/relative script paths) and DATABASE_URL need to be correct.
const KANBAN_VIEWER_ROOT = resolve(__dirname, '../..');
const MIGRATIONS_ROOT = resolve(__dirname, '../../prisma/migrations');
const MIGRATION_DIR_PATTERN = /^\d{14}_add_staged_stage$/;

const SUBPROCESS_TIMEOUT_MS = 30_000;

// Pre-migration Stage rows, exactly matching the seed.ts STAGES array as it exists
// today (before WI-786's change) — this is the "existing database" fixture that the
// migration.sql must transform. probing=4/review=5 inversion is a pre-existing quirk
// explicitly out of scope for this item and is preserved here unchanged.
const PRE_MIGRATION_STAGES = [
  { id: 'briefings', name: 'Briefings', order: 0, wipLimit: null as number | null },
  { id: 'ready', name: 'Ready', order: 1, wipLimit: 10 as number | null },
  { id: 'testing', name: 'Testing', order: 2, wipLimit: 3 as number | null },
  { id: 'implementing', name: 'Implementing', order: 3, wipLimit: 3 as number | null },
  { id: 'probing', name: 'Probing', order: 4, wipLimit: 3 as number | null },
  { id: 'review', name: 'Review', order: 5, wipLimit: 3 as number | null },
  { id: 'done', name: 'Done', order: 6, wipLimit: null as number | null },
  { id: 'blocked', name: 'Blocked', order: 7, wipLimit: null as number | null },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

interface StageRow {
  id: string;
  name: string;
  order: number;
  wipLimit: number | null;
}

interface ItemRow {
  id: string;
  stageId: string;
  title: string;
  updatedAt: string;
}

function dbUrlFor(dbPath: string): string {
  return `file:${dbPath}`;
}

/** Applies the real, current Prisma schema to a fresh SQLite file via `prisma db push`. */
function pushSchema(dbPath: string): void {
  try {
    execSync('npx prisma db push --config ./prisma/prisma.config.ts --accept-data-loss', {
      cwd: KANBAN_VIEWER_ROOT,
      env: { ...process.env, DATABASE_URL: dbUrlFor(dbPath) },
      stdio: 'pipe',
    });
  } catch (error) {
    const e = error as { stdout?: Buffer; stderr?: Buffer; message: string };
    throw new Error(
      `prisma db push failed: ${e.message}\nstdout: ${e.stdout?.toString() ?? ''}\nstderr: ${e.stderr?.toString() ?? ''}`
    );
  }
}

/** Runs the real prisma/seed.ts script (as invoked in production: `npx tsx prisma/seed.ts`). */
function runSeed(dbPath: string): void {
  try {
    execSync('npx tsx prisma/seed.ts', {
      cwd: KANBAN_VIEWER_ROOT,
      env: { ...process.env, DATABASE_URL: dbUrlFor(dbPath) },
      stdio: 'pipe',
    });
  } catch (error) {
    const e = error as { stdout?: Buffer; stderr?: Buffer; message: string };
    throw new Error(
      `seed.ts failed: ${e.message}\nstdout: ${e.stdout?.toString() ?? ''}\nstderr: ${e.stderr?.toString() ?? ''}`
    );
  }
}

async function getStages(client: Client): Promise<StageRow[]> {
  const result = await client.execute(
    'SELECT id, name, "order" AS "order", wipLimit FROM "Stage" ORDER BY "order"'
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    order: Number(row.order),
    wipLimit: row.wipLimit === null ? null : Number(row.wipLimit),
  }));
}

async function getItemRows(client: Client, ids: string[]): Promise<ItemRow[]> {
  const placeholders = ids.map(() => '?').join(', ');
  const result = await client.execute({
    sql: `SELECT id, stageId, title, updatedAt FROM "Item" WHERE id IN (${placeholders}) ORDER BY id`,
    args: ids,
  });
  return result.rows.map((row) => ({
    id: row.id as string,
    stageId: row.stageId as string,
    title: row.title as string,
    updatedAt: String(row.updatedAt),
  }));
}

// ── Suite 1: seed.ts on a freshly seeded database ───────────────────────────
//
// Covers AC "seed.ts STAGES array contains staged/order 6/wipLimit null, done
// shifted to 7, blocked to 8", AC "running the seed twice leaves exactly one
// staged row", and AC "staged has wipLimit null so the WIP-limit check treats it
// as unlimited". Exercises the real seed.ts script end-to-end via subprocess —
// no reimplementation of the STAGES array, no mocking.

describe('WI-786: prisma/seed.ts seeds the staged stage (fresh database)', () => {
  let tmpDir: string;
  let dbPath: string;
  let client: Client;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wi786-seed-'));
    dbPath = join(tmpDir, 'test.db');
    pushSchema(dbPath);
    runSeed(dbPath);
    runSeed(dbPath); // second run — proves seed-time idempotency (AC4)
    client = createClient({ url: dbUrlFor(dbPath) });
  }, SUBPROCESS_TIMEOUT_MS);

  afterAll(async () => {
    client.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('seeds a staged row with order 6 and unlimited WIP, shifting done to 7 and blocked to 8', async () => {
    const stages = await getStages(client);

    expect(stages.find((s) => s.id === 'staged')).toEqual({
      id: 'staged',
      name: 'Staged',
      order: 6,
      wipLimit: null,
    });
    expect(stages.find((s) => s.id === 'done')?.order).toBe(7);
    expect(stages.find((s) => s.id === 'blocked')?.order).toBe(8);
  });

  it('running the seed twice leaves exactly one staged row', async () => {
    const stages = await getStages(client);
    expect(stages.filter((s) => s.id === 'staged')).toHaveLength(1);
  });

  it('the seeded staged row has wipLimit null, which checkWipLimit treats as unlimited capacity', async () => {
    const stages = await getStages(client);
    const staged = stages.find((s) => s.id === 'staged');

    // Assert existence unconditionally first — a `?? null` fallback here would mask
    // a missing row instead of failing the test for the right reason.
    expect(staged).toBeDefined();
    expect(staged?.wipLimit).toBeNull();

    // 'staged' is not yet part of the StageId union (a follow-up item adds it to
    // packages/shared); checkWipLimit's stageId param is unused by its logic, so this
    // cast is scoped to proving the wipLimit contract, not claiming full type coverage.
    const result = checkWipLimit('staged' as StageId, 999, staged!.wipLimit);
    expect(result).toEqual({ allowed: true, available: null });
  });
});

// ── Suite 2: the hand-authored migration.sql on an existing database ───────
//
// Covers AC "migration inserts staged row and updates order values of done/blocked
// to 7 and 8", AC "migration SQL is idempotent", and AC "after the migration runs
// against a database that already has items in done, those items are unmodified".
// Executes the real migration.sql file directly against a real SQLite database —
// no reimplementation of the migration logic, no regex-matching of the SQL source.

describe('WI-786: staged stage data migration SQL (existing database)', () => {
  let migrationSql: string;

  beforeAll(() => {
    const entries = readdirSync(MIGRATIONS_ROOT, { withFileTypes: true });
    const match = entries.find((e) => e.isDirectory() && MIGRATION_DIR_PATTERN.test(e.name));

    if (!match) {
      throw new Error(
        `Expected a prisma/migrations/<YYYYMMDDHHmmss>_add_staged_stage directory ` +
          `containing migration.sql under ${MIGRATIONS_ROOT} — none found.`
      );
    }

    migrationSql = readFileSync(join(MIGRATIONS_ROOT, match.name, 'migration.sql'), 'utf8');
  });

  let tmpDir: string;
  let dbPath: string;
  let client: Client;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wi786-migration-'));
    dbPath = join(tmpDir, 'test.db');
    pushSchema(dbPath);
    client = createClient({ url: dbUrlFor(dbPath) });

    await client.execute({
      sql: `INSERT INTO "Project" (id, name, createdAt, updatedAt) VALUES (?, ?, datetime('now'), datetime('now'))`,
      args: ['proj-test', 'Test Project'],
    });

    for (const stage of PRE_MIGRATION_STAGES) {
      await client.execute({
        sql: `INSERT INTO "Stage" (id, name, "order", wipLimit) VALUES (?, ?, ?, ?)`,
        args: [stage.id, stage.name, stage.order, stage.wipLimit],
      });
    }

    // Existing items already sitting in 'done' — the migration must leave these alone.
    for (const id of ['WI-100', 'WI-101']) {
      await client.execute({
        sql: `INSERT INTO "Item" (id, title, description, type, priority, stageId, projectId, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [id, `Title ${id}`, `Description for ${id}`, 'feature', 'medium', 'done', 'proj-test'],
      });
    }
  }, SUBPROCESS_TIMEOUT_MS);

  afterEach(async () => {
    client.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('inserts the staged row and shifts done/blocked orders to 7 and 8 on first apply', async () => {
    await client.executeMultiple(migrationSql);

    const stages = await getStages(client);
    expect(stages.find((s) => s.id === 'staged')).toEqual({
      id: 'staged',
      name: 'Staged',
      order: 6,
      wipLimit: null,
    });
    expect(stages.find((s) => s.id === 'done')?.order).toBe(7);
    expect(stages.find((s) => s.id === 'blocked')?.order).toBe(8);
  });

  it('is idempotent: applying the migration twice leaves exactly one staged row and does not error', async () => {
    await client.executeMultiple(migrationSql);

    let secondApplyError: unknown = null;
    try {
      await client.executeMultiple(migrationSql);
    } catch (error) {
      secondApplyError = error;
    }
    expect(secondApplyError).toBeNull();

    const stages = await getStages(client);
    expect(stages.filter((s) => s.id === 'staged')).toHaveLength(1);
    expect(stages.find((s) => s.id === 'done')?.order).toBe(7);
    expect(stages.find((s) => s.id === 'blocked')?.order).toBe(8);
  });

  it('does not modify Item rows that were already in the done stage', async () => {
    const before = await getItemRows(client, ['WI-100', 'WI-101']);
    expect(before).toHaveLength(2); // sanity: fixture actually landed before asserting no-op

    await client.executeMultiple(migrationSql);

    const after = await getItemRows(client, ['WI-100', 'WI-101']);
    expect(after).toEqual(before);
    expect(after.every((row) => row.stageId === 'done')).toBe(true);
  });
});
