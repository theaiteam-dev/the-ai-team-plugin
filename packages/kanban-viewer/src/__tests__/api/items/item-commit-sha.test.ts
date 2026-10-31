import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

/**
 * WI-330: A work item stores the SHA of its latest commit, and reading the
 * item returns that SHA.
 *
 * Every route test below runs the UNMODIFIED PATCH /api/items/[id],
 * GET /api/items/[id] and GET /api/items handlers against a REAL SQLite
 * database built by `prisma migrate deploy` (exactly as production does), so
 * the tests fail until the schema column, the migration, the PATCH handling,
 * and the response transform all exist and agree. A mocked prisma could not
 * tell "stored" from "echoed back in the PATCH response".
 *
 * Discrimination check: the cheapest wrong implementation is one that echoes
 * `commitSha` in the PATCH response without persisting it. Every PATCH
 * assertion therefore re-reads through GET (and the list route) afterwards.
 * A second wrong strategy, "PATCH writes commitSha: body.commitSha ?? null on
 * every call", is killed by the preservation tests (a title-only PATCH must
 * leave the SHA alone).
 *
 * Migration: the item context prescribes `prisma/migrations/<ts>_item_commit_sha`.
 */

// ============ Real-DB wiring ============

const holder = vi.hoisted(() => ({ client: null as unknown }));

// The route imports `prisma` from '@/lib/db'; hand it the per-test real client.
vi.mock('@/lib/db', () => ({
  get prisma() {
    return holder.client;
  },
}));

const KANBAN_VIEWER_ROOT = resolve(__dirname, '../../../..');
const MIGRATIONS_ROOT = resolve(KANBAN_VIEWER_ROOT, 'prisma/migrations');
const COMMIT_SHA_MIGRATION_PATTERN = /^\d{14}_item_commit_sha$/;
const TEST_TIMEOUT_MS = 30_000;
const PROJECT_ID = 'test-project';

// Generated the way git would print it, not hand-typed (see fixture rule).
const SHA_A = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
const SHA_B = '0123456789abcdef0123456789abcdef01234567';

async function setUpRealMigratedDb(): Promise<{ tmpDir: string; client: PrismaClient }> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'wi330-real-db-'));
  const dbPath = join(tmpDir, 'test.db');

  execSync('npx prisma migrate deploy --config ./prisma/prisma.config.ts', {
    cwd: KANBAN_VIEWER_ROOT,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: 'pipe',
  });

  const adapter = new PrismaLibSql({ url: `file:${dbPath}` });
  return { tmpDir, client: new PrismaClient({ adapter }) };
}

const makeRequest = (method: string, url: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': PROJECT_ID },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function patchItem(id: string, body: unknown) {
  const { PATCH } = await import('@/app/api/items/[id]/route');
  return PATCH(makeRequest('PATCH', `http://localhost:3000/api/items/${id}`, body), ctx(id));
}

async function getItem(id: string) {
  const { GET } = await import('@/app/api/items/[id]/route');
  const res = await GET(makeRequest('GET', `http://localhost:3000/api/items/${id}`), ctx(id));
  return { status: res.status, body: await res.json() };
}

async function listItems(query = '') {
  const { GET } = await import('@/app/api/items/route');
  const res = await GET(makeRequest('GET', `http://localhost:3000/api/items${query}`));
  return { status: res.status, body: await res.json() };
}

// ============ Route suites (real migrated database) ============

describe('WI-330: item commitSha through the items API (real migrated database)', () => {
  let tmpDir: string;
  let realPrisma: PrismaClient;

  beforeEach(async () => {
    vi.resetModules();
    const setup = await setUpRealMigratedDb();
    tmpDir = setup.tmpDir;
    realPrisma = setup.client;
    holder.client = realPrisma;

    await realPrisma.project.create({
      data: { id: PROJECT_ID, name: 'Test Project', updatedAt: new Date() },
    });
    await realPrisma.stage.upsert({
      where: { id: 'briefings' },
      update: {},
      create: { id: 'briefings', name: 'Briefings', order: 0 },
    });
    await realPrisma.item.create({
      data: {
        id: 'WI-001',
        title: 'Original title',
        description: 'desc',
        type: 'feature',
        priority: 'medium',
        stageId: 'briefings',
        projectId: PROJECT_ID,
        objective: 'Original objective',
        outputImpl: 'src/impl.ts',
        updatedAt: new Date(),
      },
    });
  }, TEST_TIMEOUT_MS);

  afterEach(async () => {
    holder.client = null;
    await realPrisma?.$disconnect();
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  // AC1: PATCH {commitSha} returns 200 and GET returns that commitSha
  it('stores a commitSha via PATCH and returns it from GET /api/items/:id', async () => {
    const res = await patchItem('WI-001', { commitSha: SHA_A });
    expect(res.status).toBe(200);
    expect((await res.json()).data.commitSha).toBe(SHA_A);

    const got = await getItem('WI-001');
    expect(got.status).toBe(200);
    expect(got.body.data.commitSha).toBe(SHA_A);
  });

  // AC2: a second PATCH replaces the first
  it('replaces the stored SHA on a second PATCH so GET returns only the latest', async () => {
    await patchItem('WI-001', { commitSha: SHA_A });
    const second = await patchItem('WI-001', { commitSha: SHA_B });
    expect(second.status).toBe(200);

    const got = await getItem('WI-001');
    expect(got.body.data.commitSha).toBe(SHA_B);
    expect(JSON.stringify(got.body.data)).not.toContain(SHA_A);
  });

  // AC3: 7 to 40 hex characters; anything else is a 400 VALIDATION_ERROR that leaves the SHA unchanged
  describe('commitSha validation', () => {
    it.each([
      ['6 hex characters (one too short)', 'a1b2c3'],
      ['41 hex characters (one too long)', SHA_A + 'f'],
      ['non-hex characters at valid length', 'g1h2i3j4k5'],
      ['non-hex character hiding at the end of a long value', SHA_A.slice(0, 39) + 'z'],
      ['empty string', ''],
      ['leading/trailing whitespace', ` ${SHA_A.slice(0, 12)} `],
      ['embedded newline', `${SHA_A.slice(0, 8)}\n${SHA_A.slice(8, 16)}`],
      ['shell metacharacters', 'a1b2c3d; rm -rf /'],
      ['a number', 1234567],
      ['an object', { sha: SHA_A }],
      ['an array of a valid SHA', [SHA_A]],
    ])('rejects %s with 400 VALIDATION_ERROR and leaves the stored SHA unchanged', async (_label, bad) => {
      await patchItem('WI-001', { commitSha: SHA_A });

      const res = await patchItem('WI-001', { commitSha: bad });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');

      const got = await getItem('WI-001');
      expect(got.body.data.commitSha).toBe(SHA_A);
    });

    it('rejects an invalid SHA on an item that never had one, leaving it null', async () => {
      const res = await patchItem('WI-001', { commitSha: 'nothex!' });
      expect(res.status).toBe(400);

      const got = await getItem('WI-001');
      expect(got.body.data.commitSha).toBeNull();
    });

    it('does not apply other fields from a PATCH whose commitSha is invalid', async () => {
      const res = await patchItem('WI-001', { title: 'Sneaky title', commitSha: 'zzzzzzz' });
      expect(res.status).toBe(400);

      const got = await getItem('WI-001');
      expect(got.body.data.title).toBe('Original title');
    });

    it.each([
      ['7 characters (lower bound)', SHA_A.slice(0, 7)],
      ['40 characters (upper bound)', SHA_B],
      ['mixed 0-9 and a-f digits', '0123abc'],
    ])('accepts %s', async (_label, sha) => {
      const res = await patchItem('WI-001', { commitSha: sha });
      expect(res.status).toBe(200);
      expect((await getItem('WI-001')).body.data.commitSha).toBe(sha);
    });
  });

  // AC4: never committed -> null (not absent, not empty string)
  it('returns commitSha null for an item that has never been committed', async () => {
    const got = await getItem('WI-001');
    expect(got.status).toBe(200);
    expect(got.body.data).toHaveProperty('commitSha', null);
  });

  // Preservation (only/never): writing the SHA must not disturb other fields, and other
  // writes must not disturb the SHA. Outcome layer; the second direction is what kills a
  // `commitSha: body.commitSha ?? null` on every PATCH.
  it('leaves other item fields untouched when only commitSha is patched', async () => {
    await patchItem('WI-001', { commitSha: SHA_A });

    const { data } = (await getItem('WI-001')).body;
    expect(data.title).toBe('Original title');
    expect(data.objective).toBe('Original objective');
    expect(data.outputs).toEqual({ impl: 'src/impl.ts' });
  });

  it('keeps the stored SHA when a later PATCH touches only other fields', async () => {
    await patchItem('WI-001', { commitSha: SHA_A });
    const res = await patchItem('WI-001', { title: 'Renamed' });
    expect(res.status).toBe(200);

    const { data } = (await getItem('WI-001')).body;
    expect(data.title).toBe('Renamed');
    expect(data.commitSha).toBe(SHA_A);
  });

  // AC5: workLogNote appends a 'note' work-log entry
  describe('workLogNote', () => {
    const NOTE = { agent: 'ateam-cli', summary: 'No changes to commit' };

    it("appends a work-log entry with action 'note' and the given agent and summary", async () => {
      const res = await patchItem('WI-001', { workLogNote: NOTE });
      expect(res.status).toBe(200);

      const { workLogs } = (await getItem('WI-001')).body.data;
      expect(workLogs).toHaveLength(1);
      expect(workLogs[0]).toMatchObject({
        agent: 'ateam-cli',
        action: 'note',
        summary: 'No changes to commit',
      });
    });

    it('appends rather than replaces: two notes leave two entries in order', async () => {
      await patchItem('WI-001', { workLogNote: NOTE });
      await patchItem('WI-001', { workLogNote: { agent: 'ateam-cli', summary: 'Second note' } });

      const { workLogs } = (await getItem('WI-001')).body.data;
      expect(workLogs.map((w: { summary: string }) => w.summary)).toEqual([
        'No changes to commit',
        'Second note',
      ]);
    });

    it('does not set a commitSha: a no-changes note leaves the SHA null', async () => {
      await patchItem('WI-001', { workLogNote: NOTE });
      expect((await getItem('WI-001')).body.data.commitSha).toBeNull();
    });

    it('keeps an existing SHA when a note is recorded', async () => {
      await patchItem('WI-001', { commitSha: SHA_A });
      await patchItem('WI-001', { workLogNote: NOTE });
      expect((await getItem('WI-001')).body.data.commitSha).toBe(SHA_A);
    });

    it('writes no note when none is sent (a commitSha PATCH adds no work-log entry)', async () => {
      await patchItem('WI-001', { commitSha: SHA_A });
      expect((await getItem('WI-001')).body.data.workLogs).toHaveLength(0);
    });

    it('applies commitSha and workLogNote together in one PATCH', async () => {
      const res = await patchItem('WI-001', { commitSha: SHA_A, workLogNote: NOTE });
      expect(res.status).toBe(200);

      const { data } = (await getItem('WI-001')).body;
      expect(data.commitSha).toBe(SHA_A);
      expect(data.workLogs).toHaveLength(1);
    });

    it.each([
      ['a string instead of an object', 'No changes to commit'],
      ['missing summary', { agent: 'ateam-cli' }],
      ['missing agent', { summary: 'No changes to commit' }],
      ['empty summary', { agent: 'ateam-cli', summary: '' }],
      ['non-string summary', { agent: 'ateam-cli', summary: 42 }],
    ])('rejects a malformed workLogNote (%s) with 400 and writes nothing', async (_label, bad) => {
      const res = await patchItem('WI-001', { workLogNote: bad });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
      expect((await getItem('WI-001')).body.data.workLogs).toHaveLength(0);
    });

    it('writes no work-log entry when the same PATCH has an invalid commitSha', async () => {
      const res = await patchItem('WI-001', { commitSha: 'nothex!', workLogNote: NOTE });
      expect(res.status).toBe(400);
      expect((await getItem('WI-001')).body.data.workLogs).toHaveLength(0);
    });
  });

  // AC6: list and single reads both include commitSha
  describe('read surfaces', () => {
    it('includes commitSha for each item in GET /api/items (set and never-committed)', async () => {
      await realPrisma.item.create({
        data: {
          id: 'WI-002',
          title: 'Uncommitted',
          description: 'd',
          type: 'feature',
          priority: 'medium',
          stageId: 'briefings',
          projectId: PROJECT_ID,
          updatedAt: new Date(),
        },
      });
      await patchItem('WI-001', { commitSha: SHA_A });

      const { status, body } = await listItems();
      expect(status).toBe(200);
      const byId = Object.fromEntries(
        body.data.map((i: { id: string; commitSha: string | null }) => [i.id, i.commitSha])
      );
      expect(byId['WI-001']).toBe(SHA_A);
      expect(byId['WI-002']).toBeNull();
    });

    it('includes commitSha in the missionId-filtered list (listItems) the CLI uses', async () => {
      await realPrisma.mission.create({
        data: {
          id: 'M-330',
          name: 'Mission',
          state: 'running',
          prdPath: '/x.md',
          projectId: PROJECT_ID,
          startedAt: new Date(),
        },
      });
      await realPrisma.missionItem.create({ data: { missionId: 'M-330', itemId: 'WI-001' } });
      await patchItem('WI-001', { commitSha: SHA_B });

      const { status, body } = await listItems('?missionId=M-330');
      expect(status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].commitSha).toBe(SHA_B);
    });
  });
});

// ============ Migration suite (existing database) ============

function findMigrationSql(pattern: RegExp): string {
  const match = readdirSync(MIGRATIONS_ROOT, { withFileTypes: true }).find(
    (e) => e.isDirectory() && pattern.test(e.name)
  );
  if (!match) {
    throw new Error(
      `Expected a prisma/migrations/<YYYYMMDDHHmmss>_item_commit_sha directory matching ${pattern} under ${MIGRATIONS_ROOT}, none found.`
    );
  }
  return readFileSync(join(MIGRATIONS_ROOT, match.name, 'migration.sql'), 'utf8');
}

describe('WI-330: item_commit_sha migration (existing database)', () => {
  let migrationSql: string;
  let tmpDir: string;
  let client: Client;

  beforeAll(() => {
    migrationSql = findMigrationSql(COMMIT_SHA_MIGRATION_PATTERN);
  });

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wi330-migration-'));
    client = createClient({ url: `file:${join(tmpDir, 'test.db')}` });

    // Minimal pre-migration Item table plus a child table that references it, so a
    // table-recreating migration (DROP/RENAME) would visibly lose the child row.
    await client.executeMultiple(`
      CREATE TABLE "Item" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "objective" TEXT,
        "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE "WorkLog" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "itemId" TEXT NOT NULL,
        "summary" TEXT NOT NULL,
        CONSTRAINT "WorkLog_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await client.execute({
      sql: `INSERT INTO "Item" (id, title, objective, updatedAt) VALUES (?, ?, ?, datetime('now'))`,
      args: ['WI-100', 'Pre-existing item', 'Legacy objective'],
    });
    await client.execute({
      sql: `INSERT INTO "WorkLog" (itemId, summary) VALUES (?, ?)`,
      args: ['WI-100', 'legacy log'],
    });
  }, TEST_TIMEOUT_MS);

  afterEach(async () => {
    client.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('adds a nullable commitSha column; existing items and their child rows survive with commitSha NULL', async () => {
    await client.executeMultiple(migrationSql);

    const info = await client.execute(`PRAGMA table_info("Item")`);
    const col = info.rows.find((r) => r.name === 'commitSha');
    expect(col).toBeDefined();
    expect(Number(col?.notnull)).toBe(0);

    const item = await client.execute(`SELECT * FROM "Item" WHERE id = 'WI-100'`);
    expect(item.rows).toHaveLength(1);
    expect(item.rows[0].title).toBe('Pre-existing item');
    expect(item.rows[0].objective).toBe('Legacy objective');
    expect(item.rows[0].commitSha).toBeNull();

    const logs = await client.execute(`SELECT * FROM "WorkLog" WHERE itemId = 'WI-100'`);
    expect(logs.rows).toHaveLength(1);
  });
});
