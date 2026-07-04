/**
 * Tests for WI-211: TuningProposal schema + migration + proposalId relation.
 *
 * This item is the Phase 2 foundation. It has three deliverables, each covered
 * below:
 *
 *  1. prisma/schema.prisma — a new `model TuningProposal` (MessageTokenUsage
 *     convention: autoincrement id, projectId FK to Project, indexed), a
 *     `learnings RetroLearning[]` back-relation, a `tuningProposals` back-relation
 *     on Project, and RetroLearning.proposalId upgraded from a bare Int? into a
 *     real `proposal TuningProposal?` relation.
 *
 *  2. A new prisma/migrations/<timestamp> dir with a migration.sql — a NEW additive migration that
 *     CREATEs the TuningProposal table (with `status` defaulting to 'draft' and
 *     `createdAt` defaulting to CURRENT_TIMESTAMP) plus a (projectId, status)
 *     index. `updatedAt` is Prisma's `@updatedAt` — supplied by the client on
 *     each write, so at the raw-DDL level it is NOT NULL with no default.
 *     NFR-1: additive only — the new migration does not DROP or DELETE existing
 *     data-bearing tables. One test applies the real CREATE TABLE statement to a
 *     throwaway SQLite database and inserts a row, proving the DDL defaults
 *     actually fire rather than merely appearing in the SQL text.
 *
 *  3. openapi.yaml — a `tuning` tag and path stubs for EVERY Phase 2 endpoint,
 *     so downstream tuning-api items (WI-212..215b) never touch the spec.
 *
 * Test approach mirrors the repo's existing schema tests
 * (src/__tests__/prisma/indexes.test.ts) for structural assertions and
 * src/__tests__/backfill-migrations.test.ts (real temp SQLite via @libsql/client)
 * for the behavioral default/timestamp check.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient, type Client } from '@libsql/client';

// ── File locations ───────────────────────────────────────────────────────────

const SCHEMA_PATH = join(process.cwd(), 'prisma', 'schema.prisma');
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');
const OPENAPI_PATH = join(process.cwd(), 'openapi.yaml');

const readSchema = (): string => readFileSync(SCHEMA_PATH, 'utf-8');
const readOpenapi = (): string => readFileSync(OPENAPI_PATH, 'utf-8');

/** Isolate a single `model X { ... }` block from the schema text. */
function modelBlock(schema: string, name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?^\\}`, 'm'));
  expect(match, `model ${name} should exist in schema.prisma`).not.toBeNull();
  return match![0];
}

/**
 * Find the migration.sql that creates the TuningProposal table. The migration
 * directory name (timestamp prefix) is chosen by the implementer, so we locate
 * it by content rather than by a hard-coded path.
 */
function findTuningMigrationSql(): string {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(MIGRATIONS_DIR, d.name, 'migration.sql'));
  const matches = dirs.filter((p) => {
    try {
      return /CREATE TABLE\s+"?TuningProposal"?/i.test(readFileSync(p, 'utf-8'));
    } catch {
      return false;
    }
  });
  expect(
    matches.length,
    'exactly one migration should CREATE the TuningProposal table',
  ).toBe(1);
  return readFileSync(matches[0], 'utf-8');
}

// ── 1. Prisma schema model ───────────────────────────────────────────────────

describe('schema.prisma — TuningProposal model', () => {
  it('defines a TuningProposal model following the MessageTokenUsage convention', () => {
    const model = modelBlock(readSchema(), 'TuningProposal');

    // autoincrement integer PK
    expect(model).toMatch(/id\s+Int\s+@id\s+@default\(autoincrement\(\)\)/);
    // projectId FK to Project, indexed
    expect(model).toMatch(/projectId\s+String/);
    expect(model).toMatch(
      /project\s+Project\s+@relation\(fields:\s*\[projectId\],\s*references:\s*\[id\]\)/,
    );
    expect(model).toMatch(/@@index\(\[projectId,\s*status\]\)/);
  });

  it('has the columns required by the acceptance criteria with status defaulting to draft', () => {
    const model = modelBlock(readSchema(), 'TuningProposal');

    expect(model).toMatch(/targetSurface\s+String/);
    expect(model).toMatch(/altitude\s+String/);
    expect(model).toMatch(/proposalText\s+String/);
    expect(model).toMatch(/status\s+String\s+@default\("draft"\)/);
    // Nullable metadata columns that exist for schema completeness.
    expect(model).toMatch(/evalResult\s+String\?/);
    expect(model).toMatch(/dismissalNote\s+String\?/);
    expect(model).toMatch(/shippedInCommit\s+String\?/);
    // Timestamps auto-populate.
    expect(model).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(model).toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
  });

  it('has a learnings back-relation to RetroLearning', () => {
    const model = modelBlock(readSchema(), 'TuningProposal');
    expect(model).toMatch(/learnings\s+RetroLearning\[\]/);
  });
});

// ── 2. Relation wiring on existing models ────────────────────────────────────

describe('schema.prisma — proposalId relation upgrade', () => {
  it('upgrades RetroLearning.proposalId into a real nullable TuningProposal relation', () => {
    const model = modelBlock(readSchema(), 'RetroLearning');

    // The scalar FK column stays nullable...
    expect(model).toMatch(/proposalId\s+Int\?/);
    // ...and is now backed by a relation field to TuningProposal.
    expect(model).toMatch(
      /proposal\s+TuningProposal\?\s+@relation\(fields:\s*\[proposalId\],\s*references:\s*\[id\]\)/,
    );
  });

  it('adds a tuningProposals back-relation to Project', () => {
    const model = modelBlock(readSchema(), 'Project');
    expect(model).toMatch(/tuningProposals\s+TuningProposal\[\]/);
  });
});

// ── 3. Migration SQL (structure + NFR-1 additive-only) ───────────────────────

describe('migration.sql — TuningProposal table', () => {
  it('creates the TuningProposal table with the required columns and default', () => {
    const sql = findTuningMigrationSql();

    expect(sql).toMatch(/CREATE TABLE\s+"?TuningProposal"?/i);
    for (const col of [
      'id',
      'projectId',
      'targetSurface',
      'altitude',
      'proposalText',
      'status',
      'evalResult',
      'dismissalNote',
      'shippedInCommit',
      'createdAt',
      'updatedAt',
    ]) {
      expect(sql, `migration should define column ${col}`).toMatch(
        new RegExp(`"${col}"`),
      );
    }
    // status column defaults to 'draft'
    expect(sql).toMatch(/"status"[^,]*DEFAULT\s+'draft'/i);
    // index on (projectId, status)
    expect(sql).toMatch(
      /CREATE INDEX[\s\S]*"TuningProposal"\s*\(\s*"projectId"\s*,\s*"status"\s*\)/i,
    );
  });

  it('is additive only — does not drop or delete existing data-bearing tables (NFR-1)', () => {
    const sql = findTuningMigrationSql();

    // No destructive statements against the pre-existing Project/Mission tables.
    // (A Prisma-style RetroLearning rebuild may create/rename temp tables, but it
    // must never drop Project or Mission, nor issue a bare DELETE FROM.)
    expect(sql).not.toMatch(/DROP TABLE\s+"?Project"?/i);
    expect(sql).not.toMatch(/DROP TABLE\s+"?Mission"?/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
  });
});

// ── 4. Behavioral: defaults actually fire against a real SQLite engine ────────

describe('TuningProposal DDL — runtime behavior', () => {
  let tmpDir: string | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    client?.close();
    client = undefined;
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  /** Pull the `CREATE TABLE "TuningProposal" (...);` statement out of the migration. */
  function extractCreateTable(sql: string): string {
    const match = sql.match(
      /CREATE TABLE\s+"?TuningProposal"?\s*\([\s\S]*?\)\s*;/i,
    );
    expect(match, 'migration should contain a CREATE TABLE TuningProposal statement').not.toBeNull();
    return match![0];
  }

  it('inserting only required fields defaults status to draft and auto-populates timestamps', async () => {
    const createTable = extractCreateTable(findTuningMigrationSql());

    tmpDir = await mkdtemp(join(tmpdir(), 'tuning-proposal-'));
    client = createClient({ url: `file:${join(tmpDir, 'test.db')}` });

    // @libsql/client enables PRAGMA foreign_keys by default, so we disable it to
    // exercise the TuningProposal DDL in isolation without materializing the
    // Project table its projectId FK references.
    await client.execute('PRAGMA foreign_keys = OFF');
    await client.executeMultiple(createTable);

    // `updatedAt` is `@updatedAt` in Prisma — the client supplies it on every
    // write, so the raw DDL leaves it NOT NULL with no default. We supply it
    // here exactly as the Prisma client would; the DDL-level defaults under test
    // are `status` (DEFAULT 'draft') and `createdAt` (DEFAULT CURRENT_TIMESTAMP).
    await client.execute({
      sql:
        'INSERT INTO "TuningProposal" ' +
        '("projectId", "targetSurface", "altitude", "proposalText", "updatedAt") ' +
        'VALUES (?, ?, ?, ?, ?)',
      args: [
        'ai-team',
        'agents/ba.md',
        'agent',
        'Tighten error handling guidance.',
        new Date().toISOString(),
      ],
    });

    const rows = await client.execute('SELECT * FROM "TuningProposal"');
    expect(rows.rows.length).toBe(1);

    const row = rows.rows[0] as Record<string, unknown>;
    // Omitted `status` fell back to the DDL default.
    expect(row.status).toBe('draft');
    // Omitted `id` autoincremented; omitted `createdAt` got CURRENT_TIMESTAMP.
    expect(row.id).toBeTypeOf('number');
    expect(row.createdAt).toBeTruthy();
    // Optional columns are null when omitted.
    expect(row.evalResult).toBeNull();
    expect(row.dismissalNote).toBeNull();
    expect(row.shippedInCommit).toBeNull();
  });
});

// ── 5. OpenAPI spec stubs ────────────────────────────────────────────────────

describe('openapi.yaml — tuning tag and Phase 2 path stubs', () => {
  it('declares a tuning tag', () => {
    expect(readOpenapi()).toMatch(/-\s*name:\s*tuning\b/);
  });

  it('defines path stubs for every Phase 2 tuning endpoint', () => {
    const spec = readOpenapi();
    for (const path of [
      '/api/tuning/proposals',
      '/api/tuning/proposals/{id}',
      '/api/tuning/corroboration',
      '/api/tuning/candidates',
    ]) {
      expect(spec, `openapi.yaml should document ${path}`).toContain(`${path}:`);
    }
  });

  it('covers the create, list, and patch operations on proposals', () => {
    const spec = readOpenapi();
    // The proposals collection path carries both POST (create) and GET (list);
    // the {id} path carries PATCH. Assert the verbs appear under the tuning tag.
    const tuningTagged = spec.match(/tags:\s*\[\s*tuning\s*\]/g) ?? [];
    // POST + GET + PATCH + GET corroboration + GET candidates = 5 tuning-tagged ops.
    expect(tuningTagged.length).toBeGreaterThanOrEqual(5);
  });
});
