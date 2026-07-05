/**
 * Structural tests for the Phase A "global, fingerprint-centric" schema
 * (see /tmp/.../phase-a-spec.md "Target model" and Stage 1's migration
 * `global_fingerprint_tuning`), superseding the original WI-211 draft-model
 * tests (TuningProposal used to be project-scoped and linked to
 * RetroLearning directly via `proposalId`; both are gone now).
 *
 * Three deliverables, each covered below:
 *
 *  1. prisma/schema.prisma —
 *     - a new `model Fingerprint`: global (no projectId), `slug @id`,
 *       `pattern`/`severity` (aggregated/latest), `deferredAtMissions Int?`
 *       (the durable defer watermark added in the collapsed-verb-set stage —
 *       `status`/`dismissalNote` from the original migration are gone),
 *       timestamps, and back-relations to both RetroLearning and
 *       TuningProposal.
 *     - `RetroLearning` gains `origin String @default("local")` (the
 *       unenforced trust-provenance seam) and a real FK relation
 *       `fingerprintRef -> Fingerprint` via the existing `fingerprint` slug
 *       column. `proposalId`/`proposal` are GONE.
 *     - `TuningProposal` drops `projectId` (and its Project relation/index)
 *       entirely — it is global. It links to `Fingerprint[]` (implicit
 *       many-to-many) instead of `RetroLearning[]`.
 *
 *  2. The migration (`prisma/migrations/*_global_fingerprint_tuning`) —
 *     additive for Fingerprint, backfills one Fingerprint row per distinct
 *     pre-existing RetroLearning.fingerprint slug, and is NOT destructive
 *     against Project/Mission (NFR-1). One test applies the migration's
 *     Fingerprint CREATE TABLE to a throwaway SQLite database and inserts a
 *     row, proving the DDL defaults actually fire rather than merely
 *     appearing in the SQL text.
 *
 *  3. openapi.yaml — the `tuning` tag and Phase 2 path stubs still exist
 *     (unchanged surface area from Stage 1; Stage 2 doesn't touch the spec).
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
 * Find the migration.sql that creates the Fingerprint table. The migration
 * directory name (timestamp prefix) is chosen by the implementer, so we
 * locate it by content rather than by a hard-coded path.
 */
function findFingerprintMigrationSql(): string {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(MIGRATIONS_DIR, d.name, 'migration.sql'));
  const matches = dirs.filter((p) => {
    try {
      return /CREATE TABLE\s+"?Fingerprint"?/i.test(readFileSync(p, 'utf-8'));
    } catch {
      return false;
    }
  });
  expect(matches.length, 'exactly one migration should CREATE the Fingerprint table').toBe(1);
  return readFileSync(matches[0], 'utf-8');
}

// ── 1. Prisma schema models ──────────────────────────────────────────────────

describe('schema.prisma — Fingerprint model (global, first-class)', () => {
  it('defines a Fingerprint model keyed by slug, with no projectId', () => {
    const model = modelBlock(readSchema(), 'Fingerprint');

    expect(model).toMatch(/slug\s+String\s+@id/);
    expect(model).toMatch(/pattern\s+String/);
    expect(model).toMatch(/severity\s+String/);
    expect(model).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(model).toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
    // Global — Fingerprint is NOT project-scoped.
    expect(model).not.toMatch(/projectId/);
  });

  it('has deferredAtMissions (the durable defer watermark) and no status/dismissalNote (collapsed verb set — reject/demote are gone)', () => {
    const model = modelBlock(readSchema(), 'Fingerprint');
    expect(model).toMatch(/deferredAtMissions\s+Int\?/);
    expect(model).not.toMatch(/\bstatus\s+String/);
    expect(model).not.toMatch(/dismissalNote/);
  });

  it('has back-relations to RetroLearning and TuningProposal', () => {
    const model = modelBlock(readSchema(), 'Fingerprint');
    expect(model).toMatch(/learnings\s+RetroLearning\[\]/);
    expect(model).toMatch(/proposals\s+TuningProposal\[\]/);
  });
});

describe('schema.prisma — RetroLearning: origin seam + Fingerprint relation', () => {
  it('has origin defaulting to "local" (the unenforced trust-provenance seam)', () => {
    const model = modelBlock(readSchema(), 'RetroLearning');
    expect(model).toMatch(/origin\s+String\s+@default\("local"\)/);
  });

  it('relates fingerprint to Fingerprint.slug via fingerprintRef, and no longer has proposalId/proposal', () => {
    const model = modelBlock(readSchema(), 'RetroLearning');
    expect(model).toMatch(/fingerprint\s+String/);
    expect(model).toMatch(
      /fingerprintRef\s+Fingerprint\s+@relation\(fields:\s*\[fingerprint\],\s*references:\s*\[slug\]\)/
    );
    expect(model).not.toMatch(/proposalId/);
    expect(model).not.toMatch(/\bproposal\s+TuningProposal/);
  });
});

describe('schema.prisma — TuningProposal: global, fingerprint-linked', () => {
  it('has no projectId (proposals are global, not project-scoped)', () => {
    const model = modelBlock(readSchema(), 'TuningProposal');
    expect(model).not.toMatch(/projectId/);
    expect(model).not.toMatch(/project\s+Project\s+@relation/);
  });

  it('has the columns required by the acceptance criteria with status defaulting to draft', () => {
    const model = modelBlock(readSchema(), 'TuningProposal');

    expect(model).toMatch(/id\s+Int\s+@id\s+@default\(autoincrement\(\)\)/);
    expect(model).toMatch(/targetSurface\s+String/);
    expect(model).toMatch(/altitude\s+String/);
    expect(model).toMatch(/proposalText\s+String/);
    expect(model).toMatch(/status\s+String\s+@default\("draft"\)/);
    expect(model).toMatch(/evalResult\s+String\?/);
    expect(model).toMatch(/dismissalNote\s+String\?/);
    expect(model).toMatch(/shippedInCommit\s+String\?/);
    expect(model).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(model).toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
  });

  it('links to Fingerprint[] (many-to-many) instead of RetroLearning[]', () => {
    const model = modelBlock(readSchema(), 'TuningProposal');
    expect(model).toMatch(/fingerprints\s+Fingerprint\[\]/);
    expect(model).not.toMatch(/learnings\s+RetroLearning\[\]/);
  });
});

describe('schema.prisma — Project no longer carries a tuningProposals back-relation', () => {
  it('does not expose tuningProposals on Project (TuningProposal is global now)', () => {
    const model = modelBlock(readSchema(), 'Project');
    expect(model).not.toMatch(/tuningProposals/);
  });
});

// ── 2. Migration SQL (structure + NFR-1 additive-only) ───────────────────────

describe('migration.sql — Fingerprint table + backfill', () => {
  it('creates the Fingerprint table with the required columns and default', () => {
    const sql = findFingerprintMigrationSql();

    expect(sql).toMatch(/CREATE TABLE\s+"?Fingerprint"?/i);
    for (const col of ['slug', 'pattern', 'severity', 'status', 'dismissalNote', 'createdAt', 'updatedAt']) {
      expect(sql, `migration should define column ${col}`).toMatch(new RegExp(`"${col}"`));
    }
    expect(sql).toMatch(/"status"[^,]*DEFAULT\s+'open'/i);
  });

  it('backfills a Fingerprint row per distinct pre-existing RetroLearning.fingerprint', () => {
    const sql = findFingerprintMigrationSql();
    expect(sql).toMatch(/INSERT INTO\s+"?Fingerprint"?/i);
    expect(sql).toMatch(/GROUP BY\s+"fingerprint"/i);
  });

  it('is additive for Fingerprint — does not drop Project or Mission, nor bare-DELETE a data-bearing table (NFR-1)', () => {
    const sql = findFingerprintMigrationSql();
    expect(sql).not.toMatch(/DROP TABLE\s+"?Project"?/i);
    expect(sql).not.toMatch(/DROP TABLE\s+"?Mission"?/i);
    // The migration deletes only pre-agreement 'draft' TuningProposal rows
    // (browsing cruft from the old eager-propose flow) — never a bare,
    // unconditional DELETE FROM.
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"?RetroLearning"?(?!\s+WHERE)/i);
  });
});

// ── 3. Behavioral: defaults actually fire against a real SQLite engine ────────

describe('Fingerprint DDL — runtime behavior', () => {
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

  /** Pull the `CREATE TABLE "Fingerprint" (...);` statement out of the migration. */
  function extractCreateTable(sql: string): string {
    const match = sql.match(/CREATE TABLE\s+"?Fingerprint"?\s*\([\s\S]*?\)\s*;/i);
    expect(match, 'migration should contain a CREATE TABLE Fingerprint statement').not.toBeNull();
    return match![0];
  }

  it('inserting only required fields defaults status to open and auto-populates createdAt', async () => {
    const createTable = extractCreateTable(findFingerprintMigrationSql());

    tmpDir = await mkdtemp(join(tmpdir(), 'fingerprint-'));
    client = createClient({ url: `file:${join(tmpDir, 'test.db')}` });

    await client.execute('PRAGMA foreign_keys = OFF');
    await client.executeMultiple(createTable);

    // `updatedAt` is `@updatedAt` in Prisma — the client supplies it on every
    // write, so the raw DDL leaves it NOT NULL with no default. We supply it
    // here exactly as the Prisma client would; the DDL-level defaults under
    // test are `status` (DEFAULT 'open') and `createdAt` (DEFAULT
    // CURRENT_TIMESTAMP).
    await client.execute({
      sql:
        'INSERT INTO "Fingerprint" ("slug", "pattern", "severity", "updatedAt") ' +
        'VALUES (?, ?, ?, ?)',
      args: ['missing-error-handling', 'missing-error-handling', 'high', new Date().toISOString()],
    });

    const rows = await client.execute('SELECT * FROM "Fingerprint"');
    expect(rows.rows.length).toBe(1);

    const row = rows.rows[0] as Record<string, unknown>;
    expect(row.status).toBe('open');
    expect(row.createdAt).toBeTruthy();
    expect(row.dismissalNote).toBeNull();
  });
});

// ── 4. OpenAPI spec stubs ────────────────────────────────────────────────────

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
    const tuningTagged = spec.match(/tags:\s*\[\s*tuning\s*\]/g) ?? [];
    // POST + GET + PATCH + GET corroboration + GET candidates = 5 tuning-tagged ops.
    expect(tuningTagged.length).toBeGreaterThanOrEqual(5);
  });
});
