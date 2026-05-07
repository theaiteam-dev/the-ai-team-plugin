/**
 * backfill-migrations.ts
 *
 * Populates the _prisma_migrations table for databases originally created via
 * `prisma db push`. After backfilling, `prisma migrate deploy` treats those
 * migrations as already applied and skips them.
 *
 * Usage:
 *   npx tsx prisma/scripts/backfill-migrations.ts
 *
 * Or imported programmatically:
 *   import { backfillMigrations } from './backfill-migrations';
 *   await backfillMigrations({ databaseUrl, migrationsDir });
 */

import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync, readFileSync, readdirSync } from 'node:fs';
import { createClient } from '@libsql/client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BackfillOptions {
  /** Absolute path, relative path, or `file:`-prefixed URL to the SQLite DB. */
  databaseUrl: string;
  /** Absolute path to the directory containing Prisma migration subdirectories. */
  migrationsDir: string;
}

/** A single structural check derived from parsing a migration's SQL. */
interface SchemaCheck {
  table: string;
  /** When present: an `ADD COLUMN` check. When absent: a `CREATE TABLE` check. */
  column?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalizes a database URL/path using the same convention as src/lib/db-path.ts:
 * strips the `file:` prefix, then resolves relative paths to absolute.
 */
function normalizeDatabasePath(databaseUrl: string): string {
  const stripped = databaseUrl.replace(/^file:/, '');
  return path.resolve(stripped);
}

function sha256hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Parses migration SQL for structural statements that require PRAGMA verification.
 *
 * Handles:
 *   CREATE TABLE ["']TableName["']  → verify the table exists
 *   ALTER TABLE ["']TableName["'] ADD COLUMN ["']colName["']  → verify the column exists
 */
function parseSqlChecks(sql: string): SchemaCheck[] {
  const checks: SchemaCheck[] = [];

  const createTableRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi;
  let match: RegExpExecArray | null;
  while ((match = createTableRegex.exec(sql)) !== null) {
    checks.push({ table: match[1] });
  }

  const alterAddColumnRegex =
    /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+COLUMN\s+["'`]?(\w+)["'`]?/gi;
  while ((match = alterAddColumnRegex.exec(sql)) !== null) {
    checks.push({ table: match[1], column: match[2] });
  }

  return checks;
}

// ── DDL ─────────────────────────────────────────────────────────────────────

const CREATE_PRISMA_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
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

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Backfills the `_prisma_migrations` table from the on-disk migrations directory.
 *
 * Idempotent: already-recorded migrations are skipped. For each unrecorded
 * migration the script verifies the expected tables and columns exist in the
 * live DB (PRAGMA table_info), then inserts a row matching the Prisma 7 format.
 *
 * Throws on the first schema mismatch — rows for that migration and all later
 * ones are NOT inserted, while rows for earlier passing migrations are preserved.
 */
export async function backfillMigrations({
  databaseUrl,
  migrationsDir,
}: BackfillOptions): Promise<void> {
  // Step 1: Normalize the database path (strip file: prefix, resolve relative)
  const resolvedDbPath = normalizeDatabasePath(databaseUrl);

  // Step 2: Guard — database file must already exist
  if (!existsSync(resolvedDbPath)) {
    throw new Error(`Database file not found: ${resolvedDbPath}`);
  }

  // Step 3: Guard — migrations directory must be readable
  try {
    accessSync(migrationsDir, constants.R_OK);
  } catch {
    throw new Error(`Cannot read migrations directory: ${migrationsDir}`);
  }

  // Step 4: Connect to the SQLite database
  const client = createClient({ url: `file:${resolvedDbPath}` });

  try {
    // Step 5: Create _prisma_migrations table if it doesn't exist yet
    await client.execute(CREATE_PRISMA_MIGRATIONS_TABLE);

    // Step 6: Fetch migration names that are already recorded
    const existingResult = await client.execute(
      'SELECT migration_name FROM "_prisma_migrations"'
    );
    const appliedNames = new Set<string>(
      existingResult.rows.map((row) => row.migration_name as string)
    );

    // Step 7: Read migration subdirectories sorted alphabetically
    const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    let insertedCount = 0;

    for (const migrationName of migrationNames) {
      // Skip migrations already recorded in the table
      if (appliedNames.has(migrationName)) {
        continue;
      }

      // Read the migration SQL file
      const sqlFilePath = path.join(migrationsDir, migrationName, 'migration.sql');
      const sql = readFileSync(sqlFilePath, 'utf8');

      // Step 8: Parse and verify structural expectations via PRAGMA table_info
      const checks = parseSqlChecks(sql);
      for (const check of checks) {
        const pragmaResult = await client.execute(
          `PRAGMA table_info("${check.table}")`
        );

        if (check.column === undefined) {
          // CREATE TABLE check: the table must exist (PRAGMA returns ≥ 1 row)
          if (pragmaResult.rows.length === 0) {
            throw new Error(
              `Migration ${migrationName}: table "${check.table}" does not exist in the database`
            );
          }
        } else {
          // ALTER TABLE ADD COLUMN check: the column must be present
          const columnExists = pragmaResult.rows.some(
            (row) => row.name === check.column
          );
          if (!columnExists) {
            throw new Error(
              `Migration ${migrationName}: column "${check.column}" not found in table "${check.table}"`
            );
          }
        }
      }

      // Step 9: Insert the migration row in Prisma 7 format
      const id = randomUUID();
      const checksum = sha256hex(sql);
      const now = new Date().toISOString();

      await client.execute({
        sql: `INSERT INTO "_prisma_migrations"
                (id, checksum, migration_name, applied_steps_count, started_at, finished_at, logs, rolled_back_at)
              VALUES (?, ?, ?, 1, ?, ?, NULL, NULL)`,
        args: [id, checksum, migrationName, now, now],
      });
      insertedCount++;
    }

    if (insertedCount === 0) {
      console.log('All migrations already applied. Nothing to do.');
    }
  } finally {
    client.close();
  }
}

// ── CLI entrypoint ───────────────────────────────────────────────────────────

if (process.argv[1] === import.meta.filename) {
  const databaseUrl =
    process.env.DATABASE_URL?.replace(/^file:/, '') ??
    './prisma/data/ateam.db';

  const migrationsDir = path.resolve(
    path.dirname(import.meta.filename),
    '../migrations'
  );

  backfillMigrations({ databaseUrl, migrationsDir })
    .then(() => {
      console.log('Backfill complete.');
    })
    .catch((error: unknown) => {
      console.error('Backfill failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
