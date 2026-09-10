import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { TESTING_LEVEL_VALUES, REVIEW_TIER_VALUES } from '@/types/mission-execution-contract';

/**
 * Tests for WI-934: Mission record stores a resolved execution contract.
 *
 * The Mission model gains a nullable `executionContract` String field, following
 * the exact additive shape `scalingRationale` already uses (see
 * mission-scaling-api.test.ts, the analogue this file mirrors):
 * - POST /api/missions: optional executionContract in the request body
 * - PATCH /api/missions/:id: stamp executionContract onto an existing mission
 *   (added to the existing scalingRationale allow-list, not a new endpoint)
 * - GET /api/missions/:id: include the parsed executionContract in the response
 *
 * Enum vocabularies reused verbatim from scripts/hooks/lib/qa-contract.js:
 *   TESTING_LEVEL_VALUES = ['smoke', 'critical-path', 'full-dod']
 *   REVIEW_TIER_VALUES   = ['hands-on', 'evidence-only', 'auto']
 *
 * A separate real-database suite at the bottom of this file (no mocking)
 * proves the migration itself is additive: existing Mission rows survive
 * with executionContract NULL, and no other column is altered or dropped.
 */

// ============ Mock Setup (route suites) ============

const mockPrisma = vi.hoisted(() => ({
  mission: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  missionItem: { findMany: vi.fn() },
  item: { updateMany: vi.fn(), findMany: vi.fn() },
  stage: { findUnique: vi.fn() },
  project: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

// ============ Fixtures ============

const EXECUTION_CONTRACT = {
  testing_level: 'critical-path',
  review_tier: 'hands-on',
  profile: 'normal',
};

const STAMPED_EXECUTION_CONTRACT = {
  testing_level: 'full-dod',
  review_tier: 'hands-on',
  profile: 'deep',
};

const baseMission = (overrides: Record<string, unknown> = {}) => ({
  id: 'M-20260401-001',
  name: 'Test Mission',
  state: 'running',
  prdPath: '/prd/test.md',
  projectId: 'ai-team',
  startedAt: new Date('2026-04-01T09:00:00Z'),
  completedAt: null,
  archivedAt: null,
  precheckBlockers: null,
  precheckOutput: null,
  scalingRationale: null,
  executionContract: null,
  ...overrides,
});

const makeRequest = (method: string, url: string, body?: unknown, headers?: Record<string, string>) =>
  new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'ai-team', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

// ============ POST /api/missions — create-time executionContract (AC1, AC2) ============

describe('POST /api/missions — executionContract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPrisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (db: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
    });
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'ai-team', name: 'ai-team', createdAt: new Date() });
    mockPrisma.mission.findFirst.mockResolvedValue(null);
    mockPrisma.mission.count.mockResolvedValue(0);
  });

  it('persists executionContract as JSON string when provided', async () => {
    mockPrisma.mission.create.mockResolvedValue(
      baseMission({ executionContract: JSON.stringify(EXECUTION_CONTRACT) })
    );

    const { POST } = await import('@/app/api/missions/route');
    const response = await POST(
      makeRequest('POST', 'http://localhost:3000/api/missions', {
        name: 'Contract Mission',
        prdPath: '/prd/test.md',
        executionContract: EXECUTION_CONTRACT,
      })
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.mission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          executionContract: JSON.stringify(EXECUTION_CONTRACT),
        }),
      })
    );
  });

  it('creates mission successfully when executionContract is omitted — existing missions keep behaving as today', async () => {
    mockPrisma.mission.create.mockResolvedValue(baseMission());

    const { POST } = await import('@/app/api/missions/route');
    const response = await POST(
      makeRequest('POST', 'http://localhost:3000/api/missions', {
        name: 'Plain Mission',
        prdPath: '/prd/test.md',
      })
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    // No executionContract key was sent, so the create call must not fabricate one.
    expect(mockPrisma.mission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ executionContract: expect.anything() }),
      })
    );
  });
});

// ============ GET /api/missions/:missionId — fetching the contract (AC1, AC2) ============

describe('GET /api/missions/:missionId — executionContract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns the same testing level, review tier, and profile name the mission was created with', async () => {
    mockPrisma.mission.findUnique.mockResolvedValue(
      baseMission({ executionContract: JSON.stringify(EXECUTION_CONTRACT) })
    );

    const { GET } = await import('@/app/api/missions/[missionId]/route');
    const response = await GET(
      makeRequest('GET', 'http://localhost:3000/api/missions/M-20260401-001'),
      { params: Promise.resolve({ missionId: 'M-20260401-001' }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.executionContract).toEqual(EXECUTION_CONTRACT);
    expect(body.data.executionContract.testing_level).toBe('critical-path');
    expect(body.data.executionContract.review_tier).toBe('hands-on');
    expect(body.data.executionContract.profile).toBe('normal');
  });

  it('reports no contract for a mission created without one — pre-existing missions are unaffected', async () => {
    mockPrisma.mission.findUnique.mockResolvedValue(baseMission());

    const { GET } = await import('@/app/api/missions/[missionId]/route');
    const response = await GET(
      makeRequest('GET', 'http://localhost:3000/api/missions/M-20260401-001'),
      { params: Promise.resolve({ missionId: 'M-20260401-001' }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.executionContract).toBeNull();
  });
});

// ============ GET /api/missions/current — executionContract (AC1) ============
//
// WI-934 rework (Lynch rejection): AC1 says "fetching the CURRENT mission
// returns that same contract" — the by-id GET above does not exercise that
// literal endpoint. WI-942 depends on `ateam missions-current
// getCurrentMission --json` (which hits this route) already returning the
// contract, so a silent omission here breaks a downstream item's design
// assumption. Mirrors mission-scaling-api.test.ts's own
// "GET /api/missions/current — parsed scalingRationale" block, which
// established the precedent of testing this endpoint from this dedicated
// field-focused file rather than the endpoint's generic current.test.ts.

describe('GET /api/missions/current — executionContract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns the same testing level, review tier, and profile name for the current mission', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(
      baseMission({ executionContract: JSON.stringify(EXECUTION_CONTRACT) })
    );

    const { GET } = await import('@/app/api/missions/current/route');
    const response = await GET(makeRequest('GET', 'http://localhost:3000/api/missions/current'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.executionContract).toEqual(EXECUTION_CONTRACT);
  });

  it('reports no contract when the current mission was created without one', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(baseMission());

    const { GET } = await import('@/app/api/missions/current/route');
    const response = await GET(makeRequest('GET', 'http://localhost:3000/api/missions/current'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.executionContract).toBeNull();
  });
});

// ============ GET /api/missions — executionContract in list response (AC1, P2) ============
//
// Not named by AC1's literal wording ("fetching the current mission"), but
// the item's own objective states "any reader of that mission gets the same
// contract back" — flagged as a same-pass recommendation in the WI-934
// rejection to avoid a second cycle once Lynch (or Amy) reaches the list
// endpoint. Same mirrored-precedent rationale as the current-mission block
// above (mission-scaling-api.test.ts covers this endpoint too).

describe('GET /api/missions — executionContract in list response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('includes the parsed executionContract for each mission in the list', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([
      baseMission({ executionContract: JSON.stringify(EXECUTION_CONTRACT) }),
    ]);

    const { GET } = await import('@/app/api/missions/route');
    const response = await GET(makeRequest('GET', 'http://localhost:3000/api/missions'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].executionContract).toEqual(EXECUTION_CONTRACT);
  });

  it('reports null executionContract for missions in the list that have none', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([baseMission()]);

    const { GET } = await import('@/app/api/missions/route');
    const response = await GET(makeRequest('GET', 'http://localhost:3000/api/missions'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].executionContract).toBeNull();
  });
});

// ============ PATCH /api/missions/:missionId — stamp executionContract (AC3) ============

describe('PATCH /api/missions/:missionId — stamp executionContract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'ai-team', name: 'ai-team', createdAt: new Date() });
  });

  it('stamps executionContract onto a mission that was created without one', async () => {
    mockPrisma.mission.findUnique.mockResolvedValue(baseMission({ executionContract: null }));
    mockPrisma.mission.update.mockResolvedValue(
      baseMission({ executionContract: JSON.stringify(STAMPED_EXECUTION_CONTRACT) })
    );

    const { PATCH } = await import('@/app/api/missions/[missionId]/route');
    const response = await PATCH(
      makeRequest('PATCH', 'http://localhost:3000/api/missions/M-20260401-001', {
        executionContract: STAMPED_EXECUTION_CONTRACT,
      }),
      { params: Promise.resolve({ missionId: 'M-20260401-001' }) }
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.mission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'M-20260401-001', projectId: 'ai-team' },
        data: expect.objectContaining({
          executionContract: JSON.stringify(STAMPED_EXECUTION_CONTRACT),
        }),
      })
    );
    const body = await response.json();
    expect(body.data.executionContract).toEqual(STAMPED_EXECUTION_CONTRACT);
  });

  it('fetching a mission after stamping returns the stamped contract', async () => {
    // Simulates the read that follows a stamp: findUnique now reflects the
    // persisted value written by the PATCH above.
    mockPrisma.mission.findUnique.mockResolvedValue(
      baseMission({ executionContract: JSON.stringify(STAMPED_EXECUTION_CONTRACT) })
    );

    const { GET } = await import('@/app/api/missions/[missionId]/route');
    const response = await GET(
      makeRequest('GET', 'http://localhost:3000/api/missions/M-20260401-001'),
      { params: Promise.resolve({ missionId: 'M-20260401-001' }) }
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.executionContract).toEqual(STAMPED_EXECUTION_CONTRACT);
  });

  it('returns 404 when stamping a mission that does not exist', async () => {
    mockPrisma.mission.findUnique.mockResolvedValue(null);

    const { PATCH } = await import('@/app/api/missions/[missionId]/route');
    const response = await PATCH(
      makeRequest('PATCH', 'http://localhost:3000/api/missions/M-NOTFOUND', {
        executionContract: EXECUTION_CONTRACT,
      }),
      { params: Promise.resolve({ missionId: 'M-NOTFOUND' }) }
    );

    expect(response.status).toBe(404);
  });
});

// ============ Validation — enum cross-product (AC4) ============
//
// "Creating OR stamping" x "testing_level OR review_tier out of range" — each
// combination is a distinct path through the route handlers and gets its own
// test (AC Cross-Product Testing). Both entry points must reject with 400 and
// name the valid values in the error message.

describe('Validation — testing_level and review_tier enum values', () => {
  describe('POST /api/missions', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.resetModules();
      mockPrisma.$transaction.mockImplementation(async (arg: unknown) => {
        if (Array.isArray(arg)) return Promise.all(arg);
        return (arg as (db: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
      });
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'ai-team', name: 'ai-team', createdAt: new Date() });
      mockPrisma.mission.findFirst.mockResolvedValue(null);
      mockPrisma.mission.count.mockResolvedValue(0);
    });

    it('rejects an out-of-range testing_level with a 400 naming the valid values', async () => {
      const { POST } = await import('@/app/api/missions/route');
      const response = await POST(
        makeRequest('POST', 'http://localhost:3000/api/missions', {
          name: 'Bad Mission',
          prdPath: '/prd/test.md',
          executionContract: { ...EXECUTION_CONTRACT, testing_level: 'ultra-deep' },
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      for (const value of TESTING_LEVEL_VALUES) {
        expect(body.error.message).toContain(value);
      }
      expect(mockPrisma.mission.create).not.toHaveBeenCalled();
    });

    it('rejects an out-of-range review_tier with a 400 naming the valid values', async () => {
      const { POST } = await import('@/app/api/missions/route');
      const response = await POST(
        makeRequest('POST', 'http://localhost:3000/api/missions', {
          name: 'Bad Mission',
          prdPath: '/prd/test.md',
          executionContract: { ...EXECUTION_CONTRACT, review_tier: 'rubber-stamp' },
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      for (const value of REVIEW_TIER_VALUES) {
        expect(body.error.message).toContain(value);
      }
      expect(mockPrisma.mission.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/missions/:missionId (stamp)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.resetModules();
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'ai-team', name: 'ai-team', createdAt: new Date() });
      mockPrisma.mission.findUnique.mockResolvedValue(baseMission({ executionContract: null }));
    });

    it('rejects an out-of-range testing_level with a 400 naming the valid values', async () => {
      const { PATCH } = await import('@/app/api/missions/[missionId]/route');
      const response = await PATCH(
        makeRequest('PATCH', 'http://localhost:3000/api/missions/M-20260401-001', {
          executionContract: { ...EXECUTION_CONTRACT, testing_level: 'ultra-deep' },
        }),
        { params: Promise.resolve({ missionId: 'M-20260401-001' }) }
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      for (const value of TESTING_LEVEL_VALUES) {
        expect(body.error.message).toContain(value);
      }
      expect(mockPrisma.mission.update).not.toHaveBeenCalled();
    });

    it('rejects an out-of-range review_tier with a 400 naming the valid values', async () => {
      const { PATCH } = await import('@/app/api/missions/[missionId]/route');
      const response = await PATCH(
        makeRequest('PATCH', 'http://localhost:3000/api/missions/M-20260401-001', {
          executionContract: { ...EXECUTION_CONTRACT, review_tier: 'rubber-stamp' },
        }),
        { params: Promise.resolve({ missionId: 'M-20260401-001' }) }
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      for (const value of REVIEW_TIER_VALUES) {
        expect(body.error.message).toContain(value);
      }
      expect(mockPrisma.mission.update).not.toHaveBeenCalled();
    });
  });
});

// ============ Migration — additive executionContract column (AC5) ============
//
// Real temp SQLite databases, no mocking — mirrors the pattern in
// staged-stage-migration.test.ts. The "before" schema below is a frozen
// snapshot of the Mission/Project tables as they exist on disk today
// (captured via `prisma db push` + `.schema` against the current
// schema.prisma, BEFORE this item's executionContract column is added) —
// not derived from the live schema.prisma at test-run time, since by the
// time this test runs green, schema.prisma will already declare the new
// column and db-push would make the "before" state impossible to construct.

// This test file lives at src/__tests__/api/missions/ — the kanban-viewer
// package root is four levels up (missions -> api -> __tests__ -> src -> root).
const MIGRATIONS_ROOT = resolve(__dirname, '../../../../prisma/migrations');
const MIGRATION_DIR_PATTERN = /^\d{14}_add_execution_contract_to_mission$/;

const PRE_MIGRATION_PROJECT_TABLE_SQL = `
  CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )
`;

const PRE_MIGRATION_MISSION_TABLE_SQL = `
  CREATE TABLE "Mission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "prdPath" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "archivedAt" DATETIME,
    "precheckBlockers" TEXT,
    "precheckOutput" TEXT,
    "retroReport" TEXT,
    "finalReview" TEXT,
    "scalingRationale" TEXT,
    CONSTRAINT "Mission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )
`;

/** The exact pre-migration Mission column set, used to prove none is dropped. */
const PRE_MIGRATION_MISSION_COLUMNS = [
  'id',
  'name',
  'state',
  'prdPath',
  'projectId',
  'startedAt',
  'completedAt',
  'archivedAt',
  'precheckBlockers',
  'precheckOutput',
  'retroReport',
  'finalReview',
  'scalingRationale',
];

interface ColumnInfo {
  name: string;
  notnull: number;
}

async function getMissionColumns(client: Client): Promise<ColumnInfo[]> {
  const result = await client.execute(`PRAGMA table_info("Mission")`);
  return result.rows.map((row) => ({
    name: row.name as string,
    notnull: Number(row.notnull),
  }));
}

describe('WI-934: executionContract migration SQL (existing database)', () => {
  let migrationSql: string;

  beforeAll(() => {
    const entries = readdirSync(MIGRATIONS_ROOT, { withFileTypes: true });
    const match = entries.find((e) => e.isDirectory() && MIGRATION_DIR_PATTERN.test(e.name));

    if (!match) {
      throw new Error(
        `Expected a prisma/migrations/<YYYYMMDDHHmmss>_add_execution_contract_to_mission ` +
          `directory containing migration.sql under ${MIGRATIONS_ROOT} — none found.`
      );
    }

    migrationSql = readFileSync(join(MIGRATIONS_ROOT, match.name, 'migration.sql'), 'utf8');
  });

  let tmpDir: string;
  let dbPath: string;
  let client: Client;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wi934-migration-'));
    dbPath = join(tmpDir, 'test.db');
    client = createClient({ url: `file:${dbPath}` });

    await client.executeMultiple(PRE_MIGRATION_PROJECT_TABLE_SQL);
    await client.executeMultiple(PRE_MIGRATION_MISSION_TABLE_SQL);

    await client.execute({
      sql: `INSERT INTO "Project" (id, name, createdAt, updatedAt) VALUES (?, ?, datetime('now'), datetime('now'))`,
      args: ['proj-test', 'Test Project'],
    });

    // An existing mission, predating this migration, with several columns
    // populated — the migration must leave every one of these untouched.
    await client.execute({
      sql: `INSERT INTO "Mission"
              (id, name, state, prdPath, projectId, startedAt, completedAt, archivedAt,
               precheckBlockers, precheckOutput, retroReport, finalReview, scalingRationale)
            VALUES (?, ?, ?, ?, ?, datetime('now'), NULL, NULL, ?, ?, ?, ?, ?)`,
      args: [
        'M-20260101-001',
        'Pre-existing Mission',
        'completed',
        '/prd/legacy.md',
        'proj-test',
        JSON.stringify(['blocker']),
        JSON.stringify({ unit: { stdout: 'ok', stderr: '', timedOut: false } }),
        '# Retro',
        '# Final Review',
        JSON.stringify({ instanceCount: 2 }),
      ],
    });
  }, 30_000);

  afterEach(async () => {
    client.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('adds a nullable executionContract column without dropping or altering existing columns', async () => {
    const before = await getMissionColumns(client);
    const beforeNames = before.map((c) => c.name);
    for (const col of PRE_MIGRATION_MISSION_COLUMNS) {
      expect(beforeNames).toContain(col);
    }

    await client.executeMultiple(migrationSql);

    const after = await getMissionColumns(client);
    const afterNames = after.map((c) => c.name);

    // Every pre-existing column survives — none dropped.
    for (const col of PRE_MIGRATION_MISSION_COLUMNS) {
      expect(afterNames).toContain(col);
    }
    // Exactly one new column was added.
    expect(afterNames).toContain('executionContract');
    expect(afterNames).toHaveLength(PRE_MIGRATION_MISSION_COLUMNS.length + 1);

    // The new column is nullable — additive, not a breaking NOT NULL addition.
    const newColumn = after.find((c) => c.name === 'executionContract');
    expect(newColumn?.notnull).toBe(0);
  });

  it('leaves every pre-existing Mission row intact with executionContract NULL', async () => {
    await client.executeMultiple(migrationSql);

    const result = await client.execute({
      sql: `SELECT * FROM "Mission" WHERE id = ?`,
      args: ['M-20260101-001'],
    });
    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];
    expect(row.name).toBe('Pre-existing Mission');
    expect(row.state).toBe('completed');
    expect(row.prdPath).toBe('/prd/legacy.md');
    expect(row.projectId).toBe('proj-test');
    expect(row.precheckBlockers).toBe(JSON.stringify(['blocker']));
    expect(row.scalingRationale).toBe(JSON.stringify({ instanceCount: 2 }));
    expect(row.retroReport).toBe('# Retro');
    expect(row.finalReview).toBe('# Final Review');
    expect(row.executionContract).toBeNull();
  });
});
