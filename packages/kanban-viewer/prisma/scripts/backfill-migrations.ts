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
import { fileURLToPath, pathToFileURL } from 'node:url';
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
 *
 * Throws on non-`file:` URL schemes (e.g. `libsql://`, `postgres://`) — the
 * backfill speaks SQLite only and silently treating those as host-relative
 * paths produced confusing error messages in the past.
 */
function normalizeDatabasePath(databaseUrl: string): string {
  if (databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is empty');
  }
  const schemeMatch = databaseUrl.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch && schemeMatch[1].toLowerCase() !== 'file') {
    throw new Error(
      `Backfill only supports file: URLs (got ${schemeMatch[1]}://...). ` +
        `Set DATABASE_URL to file:./prisma/data/ateam.db or similar.`
    );
  }
  const stripped = databaseUrl.replace(/^file:/, '');
  return path.resolve(stripped);
}

/**
 * Strips SQL line comments (`--` until end-of-line) and block comments
 * (`/* … *​/`) before regex scanning. Without this, a comment like
 * `-- CREATE TABLE old_foo` would be mistaken for a real DDL statement.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');
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
 *
 * Skips Prisma's table-rebuild pattern: `CREATE TABLE "new_X"` followed later
 * in the same migration by `ALTER TABLE "new_X" RENAME TO "X"`. The new_X table
 * does not exist post-migration (it was renamed to X), so verifying it would
 * always fail. Instead, the rename TARGET ("X") is emitted as a table-existence
 * check — ensuring the final post-migration state is verified even when no
 * ADD COLUMN statement is present in the migration.
 */
function parseSqlChecks(sql: string): SchemaCheck[] {
  const cleaned = stripSqlComments(sql);
  const checks: SchemaCheck[] = [];

  // First pass: collect all rebuild-temporary tables (rename sources) and their
  // rename targets so we can (a) skip the CREATE TABLE check for new_X and
  // (b) emit a table-existence check for X (the renamed-to destination).
  const renameSources = new Set<string>();
  const renameTargets = new Set<string>();
  const renameRegex =
    /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+RENAME\s+TO\s+["'`]?(\w+)["'`]?/gi;
  let match: RegExpExecArray | null;
  while ((match = renameRegex.exec(cleaned)) !== null) {
    renameSources.add(match[1]);
    renameTargets.add(match[2]);
  }

  // Second pass: emit CREATE TABLE checks, skipping any rename source.
  // Track emitted table names so we can deduplicate rename-target checks below.
  const emittedTables = new Set<string>();
  const createTableRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi;
  while ((match = createTableRegex.exec(cleaned)) !== null) {
    if (renameSources.has(match[1])) continue;
    checks.push({ table: match[1] });
    emittedTables.add(match[1]);
  }

  // Third pass: emit a table-existence check for each rename target that has
  // not already been covered by a CREATE TABLE check in this migration.
  for (const dst of renameTargets) {
    if (!emittedTables.has(dst)) {
      checks.push({ table: dst });
    }
  }

  const alterAddColumnRegex =
    /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+COLUMN\s+["'`]?(\w+)["'`]?/gi;
  while ((match = alterAddColumnRegex.exec(cleaned)) !== null) {
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

    // Step 5b: If the table already has rows, the legacy bootstrap has already
    // run once. Skip the entire bootstrap loop so that future migrations (whose
    // schema is not yet in the DB) don't cause a spurious PRAGMA hard-fail
    // before `migrate deploy` has had a chance to apply them.
    const countResult = await client.execute(
      'SELECT COUNT(*) AS rowCount FROM "_prisma_migrations"'
    );
    const rowCount = Number(countResult.rows[0]?.rowCount ?? 0);
    if (rowCount > 0) {
      console.log(
        `Backfill: _prisma_migrations already populated (${rowCount} row${rowCount === 1 ? '' : 's'}), skipping legacy bootstrap.`
      );
      return;
    }

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

// Compare URL forms so symlinks, relative paths, and alternate loaders all
// resolve to the same canonical form. The string comparison
// `process.argv[1] === import.meta.filename` works under tsx but is brittle.
if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const databaseUrl =
    process.env.DATABASE_URL?.replace(/^file:/, '') ??
    './prisma/data/ateam.db';

  // Use import.meta.url + fileURLToPath rather than import.meta.filename —
  // import.meta.filename is undefined when tsx transpiles to CJS under Node 24,
  // crashing the script before the DB is touched. Caught by the prod-snapshot
  // smoke test against data/prod.db; would have hard-failed first deploy.
  const scriptPath = fileURLToPath(import.meta.url);
  const migrationsDir = path.resolve(
    path.dirname(scriptPath),
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
