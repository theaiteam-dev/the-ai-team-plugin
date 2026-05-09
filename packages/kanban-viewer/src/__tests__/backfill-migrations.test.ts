/**
 * Tests for prisma/scripts/backfill-migrations.ts (WI-321)
 *
 * The backfill script populates _prisma_migrations for databases
 * originally created via 'prisma db push', so subsequent
 * 'prisma migrate deploy' runs treat those migrations as already applied.
 *
 * Test approach: real temp SQLite databases + real migration directories.
 * No mocking of libsql or fs — we test observable behavior end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';

import { backfillMigrations } from '../../prisma/scripts/backfill-migrations';

// ── Constants ────────────────────────────────────────────────────────────────

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Prisma 7 _prisma_migrations DDL used to pre-populate test databases.
 * Mirrors the schema the backfill script must create when the table is absent.
 */
const CREATE_PRISMA_MIGRATIONS_TABLE = `
  CREATE TABLE "_prisma_migrations" (
    "id"                  TEXT     NOT NULL PRIMARY KEY,
    "checksum"            TEXT     NOT NULL,
    "finished_at"         DATETIME,
    "migration_name"      TEXT     NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      DATETIME,
    "started_at"          DATETIME NOT NULL,
    "applied_steps_count" INTEGER  NOT NULL DEFAULT 0
  )
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function openDb(dbPath: string): Promise<Client> {
  return createClient({ url: `file:${dbPath}` });
}

/**
 * Returns all rows from _prisma_migrations ordered by migration_name.
 * Returns [] when the table does not yet exist.
 */
async function getMigrationRows(
  client: Client
): Promise<Record<string, unknown>[]> {
  try {
    const result = await client.execute(
      'SELECT id, checksum, migration_name, applied_steps_count, ' +
        'started_at, finished_at, rolled_back_at, logs ' +
        'FROM "_prisma_migrations" ORDER BY migration_name'
    );
    return result.rows.map((row) => ({ ...row }));
  } catch {
    return [];
  }
}

/** Pre-insert a row so a DB looks partially or fully populated. */
async function insertMigrationRow(
  client: Client,
  migrationName: string,
  checksum: string
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO "_prisma_migrations"
            (id, checksum, migration_name, applied_steps_count, started_at, finished_at, logs, rolled_back_at)
          VALUES (?, ?, ?, 1, ?, ?, NULL, NULL)`,
    args: [id, checksum, migrationName, now, now],
  });
  return id;
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('backfillMigrations', () => {
  let tmpDir: string;
  let dbPath: string;
  let migrationsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'backfill-test-'));
    dbPath = join(tmpDir, 'test.db');
    migrationsDir = join(tmpDir, 'migrations');
    await mkdir(migrationsDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Creates a <migrationsDir>/<name>/migration.sql file and returns metadata. */
  async function createMigration(
    name: string,
    sql: string
  ): Promise<{ name: string; sql: string; checksum: string }> {
    const migDir = join(migrationsDir, name);
    await mkdir(migDir);
    await writeFile(join(migDir, 'migration.sql'), sql, 'utf8');
    return { name, sql, checksum: sha256hex(sql) };
  }

  // ── AC1: Fresh DB ───────────────────────────────────────────────────────────

  describe('AC1 – fresh DB with no _prisma_migrations table', () => {
    it('creates the table and inserts one row per migration directory', async () => {
      const mA = await createMigration(
        '20250101000000_create_widget',
        'CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT);'
      );
      const mB = await createMigration(
        '20250202000000_add_color',
        'ALTER TABLE "Widget" ADD COLUMN "color" TEXT;'
      );

      // DB has the full schema (both migrations applied via db push)
      const setup = await openDb(dbPath);
      await setup.execute(
        'CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT, "color" TEXT);'
      );
      setup.close();

      await backfillMigrations({ databaseUrl: dbPath, migrationsDir });

      const verify = await openDb(dbPath);
      const rows = await getMigrationRows(verify);
      verify.close();

      expect(rows).toHaveLength(2);
      const names = rows.map((r) => r.migration_name as string);
      expect(names).toContain(mA.name);
      expect(names).toContain(mB.name);
    });
  });

  // ── AC2: Fully populated DB ─────────────────────────────────────────────────

  describe('AC2 – fully populated DB', () => {
    it('exits without inserting duplicates when all migrations are already recorded', async () => {
      const mA = await createMigration(
        '20250101000000_create_foo',
        'CREATE TABLE "Foo" ("id" TEXT NOT NULL PRIMARY KEY);'
      );
      const mB = await createMigration(
        '20250202000000_add_bar',
        'ALTER TABLE "Foo" ADD COLUMN "bar" TEXT;'
      );

      const setup = await openDb(dbPath);
      await setup.execute(
        'CREATE TABLE "Foo" ("id" TEXT NOT NULL PRIMARY KEY, "bar" TEXT);'
      );
      await setup.execute(CREATE_PRISMA_MIGRATIONS_TABLE);
      await insertMigrationRow(setup, mA.name, mA.checksum);
      await insertMigrationRow(setup, mB.name, mB.checksum);
      setup.close();

      await backfillMigrations({ databaseUrl: dbPath, migrationsDir });

      const verify = await openDb(dbPath);
      const rows = await getMigrationRows(verify);
      verify.close();

      expect(rows).toHaveLength(2); // still exactly 2 – no duplicates added
    });

    it('logs a no-op message when all migrations are already recorded (AC2 stdout)', async () => {
      const mA = await createMigration(
        '20250101000000_create_foo',
        'CREATE TABLE "Foo" ("id" TEXT NOT NULL PRIMARY KEY);'
      );
      const setup = await openDb(dbPath);
      await setup.execute(
        'CREATE TABLE "Foo" ("id" TEXT NOT NULL PRIMARY KEY);'
      );
      await setup.execute(CREATE_PRISMA_MIGRATIONS_TABLE);
      await insertMigrationRow(setup, mA.name, mA.checksum);
      setup.close();

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await backfillMigrations({ databaseUrl: dbPath, migrationsDir });
      const captured = logSpy.mock.calls.map((args) => args.join(' '));
      logSpy.mockRestore();

      const noOpLine = captured.find((line) =>
        /already populated|skipping|bootstrap/i.test(line)
      );
      expect(noOpLine).toBeDefined();
    });
  });

  // ── AC3: Row format ─────────────────────────────────────────────────────────

  describe('AC3 – inserted row format', () => {
    it('inserts rows with SHA-256 hex checksum, UUIDv4 id, applied_steps_count=1, UTC timestamps, and NULL for logs and rolled_back_at', async () => {
      const sql = 'CREATE TABLE "Baz" ("id" TEXT NOT NULL PRIMARY KEY);';
      const mig = await createMigration('20250303000000_create_baz', sql);

      const setup = await openDb(dbPath);
      await setup.execute('CREATE TABLE "Baz" ("id" TEXT NOT NULL PRIMARY KEY);');
      setup.close();

      const before = Date.now();
      await backfillMigrations({ databaseUrl: dbPath, migrationsDir });
      const after = Date.now();

      const verify = await openDb(dbPath);
      const rows = await getMigrationRows(verify);
      verify.close();

      expect(rows).toHaveLength(1);
      const row = rows[0];

      expect(row.migration_name).toBe(mig.name);
      expect(row.checksum).toBe(sha256hex(sql));
      expect(String(row.id)).toMatch(UUID_V4_REGEX);
      expect(row.applied_steps_count).toBe(1);
      expect(row.logs).toBeNull();
      expect(row.rolled_back_at).toBeNull();

      // started_at and finished_at must be set and within the test window
      expect(row.started_at).toBeTruthy();
      expect(row.finished_at).toBeTruthy();
      const startedAt = new Date(String(row.started_at)).getTime();
      const finishedAt = new Date(String(row.finished_at)).getTime();
      expect(startedAt).toBeGreaterThanOrEqual(before - 2000);
      expect(startedAt).toBeLessThanOrEqual(after + 2000);
      expect(finishedAt).toBeGreaterThanOrEqual(before - 2000);
      expect(finishedAt).toBeLessThanOrEqual(after + 2000);
    });
  });

  // ── AC4: Partial population ─────────────────────────────────────────────────
  //
  // NEW BEHAVIOR: When _prisma_migrations has ANY rows the backfill skips
  // entirely (post-bootstrap idempotence). Partial-bootstrap state (some rows
  // but not all) is accepted as-is — the script does not attempt to fill gaps.
  // `migrate deploy` handles any unapplied migrations in the normal entrypoint flow.

  describe('AC4 – partially populated DB', () => {
    it('skips entirely and leaves existing rows untouched when _prisma_migrations already has rows (partial-bootstrap is a no-op)', async () => {
      const mA = await createMigration(
        '20250101000000_create_alpha',
        'CREATE TABLE "Alpha" ("id" TEXT NOT NULL PRIMARY KEY);'
      );
      await createMigration(
        '20250202000000_create_beta',
        'CREATE TABLE "Beta" ("id" TEXT NOT NULL PRIMARY KEY);'
      );
      await createMigration(
        '20250303000000_add_gamma',
        'ALTER TABLE "Alpha" ADD COLUMN "gamma" TEXT;'
      );

      const setup = await openDb(dbPath);
      await setup.execute(
        'CREATE TABLE "Alpha" ("id" TEXT NOT NULL PRIMARY KEY, "gamma" TEXT);'
      );
      await setup.execute('CREATE TABLE "Beta" ("id" TEXT NOT NULL PRIMARY KEY);');
      await setup.execute(CREATE_PRISMA_MIGRATIONS_TABLE);
      // Pre-insert only mA — mB and mC are absent
      const originalId = await insertMigrationRow(setup, mA.name, mA.checksum);
      setup.close();

      // Must not throw and must not insert any new rows
      await expect(
        backfillMigrations({ databaseUrl: dbPath, migrationsDir })
      ).resolves.not.toThrow();

      const verify = await openDb(dbPath);
      const rows = await getMigrationRows(verify);
      verify.close();

      // Still only 1 row — no gap-filling in the partial-bootstrap case
      expect(rows).toHaveLength(1);

      // The original row is preserved with its original UUID
      const aRow = rows.find((r) => r.migration_name === mA.name);
      expect(aRow?.id).toBe(originalId);
    });
  });

  // ── AC5: Missing migrations directory ───────────────────────────────────────

  describe('AC5 – missing migrations directory', () => {
    it('throws with an error message naming the missing directory path', async () => {
      const missingDir = join(tmpDir, 'nonexistent-migrations');

      // Create the DB so the DB-not-found error doesn't fire first
      const setup = await openDb(dbPath);
      setup.close();

      await expect(
        backfillMigrations({ databaseUrl: dbPath, migrationsDir: missingDir })
      ).rejects.toThrow(missingDir);
    });
  });

  // ── AC6: Database file does not exist ───────────────────────────────────────

  describe('AC6 – database file does not exist', () => {
    it('throws with an error message naming the database path derived from databaseUrl', async () => {
      const nonExistentDb = join(tmpDir, 'nonexistent.db');
      await createMigration(
        '20250101000000_create_x',
        'CREATE TABLE "X" ("id" TEXT NOT NULL PRIMARY KEY);'
      );

      // nonExistentDb file is never created — script must detect and reject
      await expect(
        backfillMigrations({ databaseUrl: nonExistentDb, migrationsDir })
      ).rejects.toThrow(nonExistentDb);
    });
  });

  // ── AC7: PRAGMA table_info verification ────────────────────────────────────

  describe('AC7 – PRAGMA table_info verification', () => {
    it('throws naming the migration and column when ALTER TABLE ADD COLUMN column is absent from the live DB', async () => {
      const migName = '20250101000000_add_score';
      await createMigration(migName, 'ALTER TABLE "Widget" ADD COLUMN "score" INTEGER;');

      // DB has Widget table but WITHOUT the "score" column
      const setup = await openDb(dbPath);
      await setup.execute(
        'CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT);'
      );
      setup.close();

      let error!: Error;
      try {
        await backfillMigrations({ databaseUrl: dbPath, migrationsDir });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain(migName);
      expect(error.message).toContain('score');
    });

    it('throws naming the migration when a CREATE TABLE table does not exist in the live DB', async () => {
      const migName = '20250101000000_create_widget';
      await createMigration(
        migName,
        'CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT);'
      );

      // Empty DB — Widget table never created
      const setup = await openDb(dbPath);
      setup.close();

      let error!: Error;
      try {
        await backfillMigrations({ databaseUrl: dbPath, migrationsDir });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain(migName);
      expect(error.message).toContain('Widget');
    });

    it('succeeds when all required tables and columns exist in the live DB', async () => {
      await createMigration(
        '20250101000000_create_widget',
        'CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT);'
      );
      await createMigration(
        '20250202000000_add_score',
        'ALTER TABLE "Widget" ADD COLUMN "score" INTEGER;'
      );

      const setup = await openDb(dbPath);
      await setup.execute(
        'CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT, "score" INTEGER);'
      );
      setup.close();

      await expect(
        backfillMigrations({ databaseUrl: dbPath, migrationsDir })
      ).resolves.not.toThrow();
    });
  });

  // ── AC8: Item.objective missing column scenario ─────────────────────────────

  describe('AC8 – failing PRAGMA halts insertions for the failing migration and all later ones', () => {
    it('exits non-zero naming the failing migration and column, inserts no rows for that migration or any later one', async () => {
      // Three migrations in order; the middle one will fail PRAGMA
      await createMigration(
        '20250101000000_create_item',
        'CREATE TABLE "Item" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT);'
      );
      await createMigration(
        '20250202000000_add_objective',
        'ALTER TABLE "Item" ADD COLUMN "objective" TEXT;'
      );
      await createMigration(
        '20250303000000_add_status',
        'ALTER TABLE "Item" ADD COLUMN "status" TEXT;'
      );

      // DB has Item table but WITHOUT objective or status columns
      const setup = await openDb(dbPath);
      await setup.execute(
        'CREATE TABLE "Item" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT);'
      );
      setup.close();

      let error!: Error;
      try {
        await backfillMigrations({ databaseUrl: dbPath, migrationsDir });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('20250202000000_add_objective');
      expect(error.message).toContain('objective');

      const verify = await openDb(dbPath);
      const rows = await getMigrationRows(verify);
      verify.close();

      const names = rows.map((r) => r.migration_name as string);
      expect(names).not.toContain('20250202000000_add_objective');
      expect(names).not.toContain('20250303000000_add_status');
    });

    it('does insert rows for migrations that precede the failing one and pass PRAGMA (the "only later" bound)', async () => {
      // Migration 1 passes PRAGMA (CREATE TABLE, Item table exists)
      // Migration 2 fails PRAGMA (objective column missing)
      await createMigration(
        '20250101000000_create_item',
        'CREATE TABLE "Item" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT);'
      );
      await createMigration(
        '20250202000000_add_objective',
        'ALTER TABLE "Item" ADD COLUMN "objective" TEXT;'
      );

      const setup = await openDb(dbPath);
      await setup.execute(
        'CREATE TABLE "Item" ("id" TEXT NOT NULL PRIMARY KEY, "title" TEXT);'
      );
      setup.close();

      // Script throws on migration 2 — that's expected
      await backfillMigrations({ databaseUrl: dbPath, migrationsDir }).catch(() => {
        /* expected */
      });

      const verify = await openDb(dbPath);
      const rows = await getMigrationRows(verify);
      verify.close();

      const names = rows.map((r) => r.migration_name as string);
      expect(names).toContain('20250101000000_create_item');
    });
  });

  // ── AC9: DATABASE_URL normalization ────────────────────────────────────────

  describe('AC9 – DATABASE_URL normalization (same convention as src/lib/db-path.ts)', () => {
    it('accepts a file: prefixed databaseUrl and strips the prefix to reach the correct DB file', async () => {
      await createMigration(
        '20250101000000_create_thing',
        'CREATE TABLE "Thing" ("id" TEXT NOT NULL PRIMARY KEY);'
      );

      const setup = await openDb(dbPath);
      await setup.execute('CREATE TABLE "Thing" ("id" TEXT NOT NULL PRIMARY KEY);');
      setup.close();

      // Pass database URL with file: prefix — script must normalize
      await expect(
        backfillMigrations({ databaseUrl: `file:${dbPath}`, migrationsDir })
      ).resolves.not.toThrow();

      const verify = await openDb(dbPath);
      const rows = await getMigrationRows(verify);
      verify.close();
      expect(rows).toHaveLength(1);
    });

    it('resolves a relative databaseUrl path to an absolute path before connecting', async () => {
      await createMigration(
        '20250101000000_create_thing',
        'CREATE TABLE "Thing" ("id" TEXT NOT NULL PRIMARY KEY);'
      );

      const setup = await openDb(dbPath);
      await setup.execute('CREATE TABLE "Thing" ("id" TEXT NOT NULL PRIMARY KEY);');
      setup.close();

      // Derive a path relative to process.cwd() so the script must resolve it
      const relPath = relative(process.cwd(), dbPath);

      await expect(
        backfillMigrations({ databaseUrl: relPath, migrationsDir })
      ).resolves.not.toThrow();

      const verify = await openDb(dbPath);
      const rows = await getMigrationRows(verify);
      verify.close();
      expect(rows).toHaveLength(1);
    });

    // SF-1: defense-in-depth against the live-DB-truncation incident — bail out
    // loudly on non-file: schemes instead of silently treating them as paths.
    it('rejects non-file: URL schemes with a clear error', async () => {
      await expect(
        backfillMigrations({
          databaseUrl: 'libsql://example.turso.io',
          migrationsDir,
        })
      ).rejects.toThrow(/file: URLs/i);

      await expect(
        backfillMigrations({
          databaseUrl: 'postgres://localhost/db',
          migrationsDir,
        })
      ).rejects.toThrow(/file: URLs/i);
    });

    it('rejects an empty DATABASE_URL with a clear error', async () => {
      await expect(
        backfillMigrations({ databaseUrl: '', migrationsDir })
      ).rejects.toThrow(/empty/i);
    });
  });

  // ── AC11: Post-bootstrap idempotence ───────────────────────────────────────
  //
  // Once _prisma_migrations has ANY rows the backfill must skip entirely.
  // This prevents a future-migration scenario where the new migration's schema
  // is not yet in the DB (migrate deploy hasn't run yet) from causing a hard-fail
  // PRAGMA error that kills the container before migrate deploy can apply it.

  describe('AC11 – post-bootstrap idempotence', () => {
    it('skips entirely when _prisma_migrations already has rows, even if migrations dir has new entries', async () => {
      // Three migrations; the third adds a column that does NOT exist in the DB yet
      await createMigration(
        '20250101000000_create_widget',
        'CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY);'
      );
      await createMigration(
        '20250202000000_add_name',
        'ALTER TABLE "Widget" ADD COLUMN "name" TEXT;'
      );
      await createMigration(
        '20250303000000_add_future_col',
        'ALTER TABLE "Widget" ADD COLUMN "future_col" TEXT;'
      );

      // DB has Widget with only id — missing future_col (simulates future migration not yet applied)
      const setup = await openDb(dbPath);
      await setup.execute('CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY);');
      // Pre-populate _prisma_migrations with 1 row (bootstrap already ran)
      await setup.execute(CREATE_PRISMA_MIGRATIONS_TABLE);
      await insertMigrationRow(setup, '20250101000000_create_widget', 'fake-checksum-001');
      setup.close();

      // Must NOT throw even though future_col doesn't exist in the DB
      await expect(
        backfillMigrations({ databaseUrl: dbPath, migrationsDir })
      ).resolves.not.toThrow();

      // Row count must be unchanged — the new migrations were NOT processed
      const verify = await openDb(dbPath);
      const rows = await getMigrationRows(verify);
      verify.close();

      expect(rows).toHaveLength(1); // still just the original row
      const names = rows.map((r) => r.migration_name as string);
      expect(names).not.toContain('20250303000000_add_future_col');
    });

    it('skips entirely on a future-migration scenario without raising', async () => {
      // More realistic: 2 migrations bootstrapped, 3rd in dir adds a column not yet applied
      const m1sql = 'CREATE TABLE "Order" ("id" TEXT NOT NULL PRIMARY KEY, "total" INTEGER NOT NULL DEFAULT 0);';
      const m2sql = 'CREATE TABLE "LineItem" ("id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL);';
      await createMigration('20250101000000_create_order', m1sql);
      await createMigration('20250202000000_create_lineitem', m2sql);
      await createMigration(
        '20250303000000_add_discount',
        'ALTER TABLE "Order" ADD COLUMN "discount" INTEGER NOT NULL DEFAULT 0;'
      );

      // DB has Order and LineItem but WITHOUT the discount column
      const setup = await openDb(dbPath);
      await setup.execute(m1sql);
      await setup.execute(m2sql);
      await setup.execute(CREATE_PRISMA_MIGRATIONS_TABLE);
      await insertMigrationRow(setup, '20250101000000_create_order', sha256hex(m1sql));
      await insertMigrationRow(setup, '20250202000000_create_lineitem', sha256hex(m2sql));
      setup.close();

      // Must not throw — migrate deploy will handle the discount migration
      await expect(
        backfillMigrations({ databaseUrl: dbPath, migrationsDir })
      ).resolves.not.toThrow();

      const verify = await openDb(dbPath);
      const rows = await getMigrationRows(verify);
      verify.close();

      // Still exactly 2 rows; the future migration was not touched
      expect(rows).toHaveLength(2);
      const names = rows.map((r) => r.migration_name as string);
      expect(names).not.toContain('20250303000000_add_discount');
    });

    it('logs an informational message when skipping so operators know what happened', async () => {
      await createMigration(
        '20250101000000_create_widget',
        'CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY);'
      );
      // A second migration that would fail PRAGMA if the bootstrap path ran
      await createMigration(
        '20250202000000_add_unseen_col',
        'ALTER TABLE "Widget" ADD COLUMN "unseen_col" TEXT;'
      );

      const setup = await openDb(dbPath);
      await setup.execute('CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY);');
      await setup.execute(CREATE_PRISMA_MIGRATIONS_TABLE);
      await insertMigrationRow(setup, '20250101000000_create_widget', 'fake-checksum-001');
      setup.close();

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await backfillMigrations({ databaseUrl: dbPath, migrationsDir });
      const captured = logSpy.mock.calls.map((args) => args.join(' '));
      logSpy.mockRestore();

      const skipLine = captured.find((line) =>
        /skipping|already populated|bootstrap/i.test(line)
      );
      expect(skipLine).toBeDefined();
    });
  });

  // ── AC10: Prisma table-rebuild pattern (CRITICAL — caught by code review) ───
  //
  // Prisma generates "table-rebuild" migrations any time SQLite can't ALTER:
  //   CREATE TABLE "new_X" (...)         ← intermediate table
  //   INSERT INTO "new_X" SELECT FROM X
  //   DROP TABLE X
  //   ALTER TABLE "new_X" RENAME TO "X"  ← final state
  //
  // Post-migration the live DB has X (renamed), not new_X. A naive PRAGMA
  // verification would hit "table 'new_X' does not exist" and abort the
  // backfill on every legacy DB that has a rebuild migration in its history.
  // Two of the existing migrations use this pattern (20260216203144, 20260216203229).

  describe('AC10 – Prisma table-rebuild pattern (new_X CREATE + RENAME TO X)', () => {
    it('skips the intermediate new_X CREATE TABLE check when an ALTER … RENAME TO is present in the same migration', async () => {
      // Realistic rebuild-pattern migration: rebuild "Foo" via an intermediate
      const rebuildSql = `
        CREATE TABLE "new_Foo" (
          "id"     TEXT NOT NULL PRIMARY KEY,
          "label"  TEXT NOT NULL DEFAULT 'x'
        );
        INSERT INTO "new_Foo" ("id") SELECT "id" FROM "Foo";
        DROP TABLE "Foo";
        ALTER TABLE "new_Foo" RENAME TO "Foo";
      `;
      await createMigration('20250101000000_rebuild_foo', rebuildSql);

      // Live DB has the post-migration state: only "Foo" exists, "new_Foo" does not.
      const setup = await openDb(dbPath);
      await setup.execute(
        'CREATE TABLE "Foo" ("id" TEXT NOT NULL PRIMARY KEY, "label" TEXT NOT NULL DEFAULT \'x\');'
      );
      setup.close();

      await expect(
        backfillMigrations({ databaseUrl: dbPath, migrationsDir })
      ).resolves.not.toThrow();

      const verify = await openDb(dbPath);
      const rows = await getMigrationRows(verify);
      verify.close();
      expect(rows).toHaveLength(1);
      expect(rows[0].migration_name).toBe('20250101000000_rebuild_foo');
    });

    it('still verifies tables that are NOT rebuild intermediates (regression guard)', async () => {
      // A migration that creates a brand-new RealTable AND has a separate
      // unrelated rebuild of OtherTable. RealTable's CREATE must still be checked.
      const sql = `
        CREATE TABLE "RealTable" ("id" TEXT NOT NULL PRIMARY KEY);
        CREATE TABLE "new_OtherTable" ("id" TEXT NOT NULL PRIMARY KEY);
        DROP TABLE "OtherTable";
        ALTER TABLE "new_OtherTable" RENAME TO "OtherTable";
      `;
      await createMigration('20250101000000_mixed', sql);

      // Live DB has OtherTable (post-rename) but is MISSING RealTable.
      // Expected: backfill aborts because RealTable verification fails.
      const setup = await openDb(dbPath);
      await setup.execute('CREATE TABLE "OtherTable" ("id" TEXT NOT NULL PRIMARY KEY);');
      setup.close();

      await expect(
        backfillMigrations({ databaseUrl: dbPath, migrationsDir })
      ).rejects.toThrow(/RealTable/);
    });

    it('pure-rebuild migration (CREATE TABLE new_X + RENAME TO X, no ADD COLUMN) rejects when the renamed-to table X is missing from the live DB', async () => {
      // A pure-rebuild migration: creates new_Foo, renames to Foo, no ADD COLUMN.
      // The live DB does NOT have a Foo table at all.
      // After this fix, parseSqlChecks must emit a check for "Foo" (the rename target),
      // so the backfill throws and names the missing table.
      const rebuildSql = `
        CREATE TABLE "new_Foo" ("id" TEXT NOT NULL PRIMARY KEY);
        INSERT INTO "new_Foo" SELECT * FROM "Foo";
        DROP TABLE "Foo";
        ALTER TABLE "new_Foo" RENAME TO "Foo";
      `;
      const migName = '20250101000000_rebuild_foo_pure';
      await createMigration(migName, rebuildSql);

      // Empty DB — "Foo" does not exist
      const setup = await openDb(dbPath);
      setup.close();

      let error!: Error;
      try {
        await backfillMigrations({ databaseUrl: dbPath, migrationsDir });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain(migName);
      expect(error.message).toContain('Foo');
    });

    it('pure-rebuild migration succeeds when the renamed-to table X exists in the live DB', async () => {
      // Same pure-rebuild SQL, but the live DB already has "Foo" (post-migration state).
      const rebuildSql = `
        CREATE TABLE "new_Foo" ("id" TEXT NOT NULL PRIMARY KEY);
        INSERT INTO "new_Foo" SELECT * FROM "Foo";
        DROP TABLE "Foo";
        ALTER TABLE "new_Foo" RENAME TO "Foo";
      `;
      const migName = '20250101000000_rebuild_foo_pure_ok';
      await createMigration(migName, rebuildSql);

      // Live DB has "Foo" in post-migration state
      const setup = await openDb(dbPath);
      await setup.execute('CREATE TABLE "Foo" ("id" TEXT NOT NULL PRIMARY KEY);');
      setup.close();

      await expect(
        backfillMigrations({ databaseUrl: dbPath, migrationsDir })
      ).resolves.not.toThrow();

      const verify = await openDb(dbPath);
      const rows = await getMigrationRows(verify);
      verify.close();
      expect(rows).toHaveLength(1);
      expect(rows[0].migration_name).toBe(migName);
    });

    it('strips SQL comments before regex scanning (— and /* */ comments)', async () => {
      // A comment that mentions CREATE TABLE for a non-existent table must NOT
      // cause the script to add a check for that table.
      const sql = `
        -- CREATE TABLE "GhostTable" ("id" TEXT)
        /* CREATE TABLE "AnotherGhost" ("id" TEXT) */
        CREATE TABLE "RealTable" ("id" TEXT NOT NULL PRIMARY KEY);
      `;
      await createMigration('20250101000000_with_comments', sql);

      const setup = await openDb(dbPath);
      await setup.execute('CREATE TABLE "RealTable" ("id" TEXT NOT NULL PRIMARY KEY);');
      setup.close();

      // Should succeed — the comments must not be scanned as DDL
      await expect(
        backfillMigrations({ databaseUrl: dbPath, migrationsDir })
      ).resolves.not.toThrow();
    });
  });
});
