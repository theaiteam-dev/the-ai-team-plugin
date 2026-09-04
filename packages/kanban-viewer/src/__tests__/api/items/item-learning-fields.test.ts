import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
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
 * Tests for WI-936: Work items and learnings carry finding provenance.
 *
 * Two migration halves, both in scope (FR-11 capture half + FR-12 idempotency key):
 *
 * 1. Item gains three nullable columns: severity, attributedAgent, fingerprint
 *    (no FK on fingerprint — deliberately: an item is stamped at decomposition,
 *    long before any Fingerprint row exists; see POST /api/learnings' own
 *    fingerprint.upsert, which is what makes a freshly minted slug safe THERE).
 *    Reuses the exact severity vocabulary and field names RetroLearning already
 *    uses (severity, attributedAgent) — see prisma/schema.prisma:274-275 and
 *    the VALID_SEVERITIES list in src/app/api/learnings/route.ts:27.
 * 2. RetroLearning gains a nullable `sourceItemId` reference plus a NEW
 *    uniqueness constraint (projectId, missionId, sourceItemId) so a
 *    source-item-derived row can be updated instead of duplicated. POST
 *    /api/learnings' dedupe (the findFirst fast path AND the P2002 backstop)
 *    must key derived rows on sourceItemId instead of fingerprint, while
 *    PRESERVING the existing fingerprint-keyed dedupe for rows with no source
 *    item, and preserving null-missionId rows as always-distinct inserts.
 *    Existing coverage for those preserved paths lives in
 *    learnings-capture-api.test.ts — it must stay green; this file does not
 *    duplicate it.
 *
 * Test conventions: vitest, hand-rolled mockPrisma via vi.mock, real
 * NextRequest — mirrors mission-execution-contract.test.ts (the WI-934
 * analogue for schema+API+migration coverage in one field-focused file) and
 * learnings-capture-api.test.ts (the dedupe-testing precedent this file
 * extends for the new sourceItemId key).
 *
 * MISSION-TAIL REWORK (Frankie's DoD 13 finding, rejectionCount now 2):
 * every existing "second capture updates instead of duplicates" assertion
 * below (mocked AND real-DB) only ever checked NON-duplication — same id
 * returned, single create() call, one row in the table. Nothing asserted
 * the row's CONTENT after a second capture with different `detail`. Frankie
 * ran the same sourceItemId three times with three different `detail`
 * payloads and the stored row still carried run 1's text: POST
 * /api/learnings finds the existing row by sourceItemId and returns it
 * UNCHANGED — there is no `prisma.retroLearning.update` call anywhere in
 * the route. That is exactly the shape of test gap this rework closes: a
 * "does not duplicate" test is not the same claim as "does update", and the
 * suite below asserted only the former. Fixed by (1) adding `update:
 * vi.fn()` to this file's retroLearning mock (it did not exist before — a
 * direct symptom of the gap), (2) a new mocked test with a stateful
 * find/create/update store (mirroring the existing P2002 race test's `rows`
 * pattern) that captures one sourceItemId twice with different `detail` and
 * asserts the SECOND payload is what's returned AND what
 * `retroLearning.update` was called with, and (3) tightening the real-DB
 * "still updates the existing row" test to assert the persisted `detail`
 * column itself reflects the second capture, fetched directly from the
 * database — not just the HTTP response shape.
 *
 * MIGRATION NAMING (prescribed here, following the `npm run migrate:create --
 * <description>` convention WI-934 established): two migrations, run in
 * order after WI-934's — `add_finding_provenance_to_item` (Item's three
 * columns) and `add_source_item_to_retro_learning` (RetroLearning's
 * sourceItemId + unique constraint). The migration suite at the bottom of
 * this file locates each by that exact directory-name pattern.
 */

// ============ Mock Setup (route suites) ============

const mockPrisma = vi.hoisted(() => ({
  item: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  itemDependency: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  retroLearning: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mission: {
    findFirst: vi.fn(),
  },
  fingerprint: {
    upsert: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

// ============ Fixtures ============

/** Reuses the exact vocabulary from src/app/api/learnings/route.ts's VALID_SEVERITIES. */
const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];

const BASE_VALID_ITEM_BODY = {
  title: 'Test item',
  type: 'feature',
  priority: 'medium',
  description: 'A test item',
  objective: 'Users can do the thing',
  acceptance: ['It works', 'It fails gracefully'],
  context: 'Integrates with existing service',
};

const baseDbItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'WI-001',
  title: 'Existing item',
  description: 'desc',
  type: 'feature',
  priority: 'medium',
  stageId: 'briefings',
  projectId: 'test-project',
  assignedAgent: null,
  rejectionCount: 0,
  objective: 'Some objective',
  acceptance: '["criterion 1"]',
  context: 'Some context',
  outputTest: null,
  outputImpl: null,
  outputTypes: null,
  severity: null,
  attributedAgent: null,
  fingerprint: null,
  archivedAt: null,
  createdAt: new Date('2026-04-01T09:00:00Z'),
  updatedAt: new Date('2026-04-01T09:00:00Z'),
  completedAt: null,
  dependsOn: [],
  workLogs: [],
  ...overrides,
});

const makePostRequest = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost:3000/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
    body: JSON.stringify(body),
  });

const makeGetRequest = (url: string) =>
  new NextRequest(url, { headers: { 'X-Project-ID': 'test-project' } });

const makePatchRequest = (id: string, body: Record<string, unknown>) =>
  new NextRequest(`http://localhost:3000/api/items/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
    body: JSON.stringify(body),
  });

const makeContext = (id: string) => ({ params: Promise.resolve({ id }) });

// ============ POST /api/items — severity, attributedAgent, fingerprint (AC1, AC3) ============

describe('POST /api/items — finding provenance fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPrisma.item.findMany.mockResolvedValue([]); // generateItemId's MAX(id) scan
    mockPrisma.mission.findFirst.mockResolvedValue(null); // no active mission
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'test-project', name: 'test-project' });
  });

  it('persists severity, attributedAgent, and fingerprint when provided', async () => {
    mockPrisma.item.create.mockResolvedValue(
      baseDbItem({
        id: 'WI-001',
        severity: 'high',
        attributedAgent: 'ba',
        fingerprint: 'fp-missing-error-handling',
      })
    );

    const response = await (
      await import('@/app/api/items/route')
    ).POST(
      makePostRequest({
        ...BASE_VALID_ITEM_BODY,
        severity: 'high',
        attributedAgent: 'ba',
        fingerprint: 'fp-missing-error-handling',
      })
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.item.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          severity: 'high',
          attributedAgent: 'ba',
          fingerprint: 'fp-missing-error-handling',
        }),
      })
    );
  });

  it('creates an item successfully when severity, attributedAgent, and fingerprint are all omitted', async () => {
    mockPrisma.item.create.mockResolvedValue(baseDbItem({ id: 'WI-002' }));

    const response = await (
      await import('@/app/api/items/route')
    ).POST(makePostRequest(BASE_VALID_ITEM_BODY));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.severity).toBeFalsy();
    expect(body.data.attributedAgent).toBeFalsy();
    expect(body.data.fingerprint).toBeFalsy();
  });

  it('rejects an out-of-range severity with a 400 naming the valid values', async () => {
    const response = await (
      await import('@/app/api/items/route')
    ).POST(makePostRequest({ ...BASE_VALID_ITEM_BODY, severity: 'catastrophic' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    for (const value of VALID_SEVERITIES) {
      expect(body.error.message).toContain(value);
    }
    expect(mockPrisma.item.create).not.toHaveBeenCalled();
  });
});

// ============ GET /api/items/:id and GET /api/items — fetch fields back (AC1) ============

describe('GET /api/items/:id — finding provenance fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns the same severity, attributedAgent, and fingerprint the item was created with', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(
      baseDbItem({ severity: 'critical', attributedAgent: 'lynch', fingerprint: 'fp-race-condition' })
    );

    const { GET } = await import('@/app/api/items/[id]/route');
    const response = await GET(makeGetRequest('http://localhost:3000/api/items/WI-001'), makeContext('WI-001'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.severity).toBe('critical');
    expect(body.data.attributedAgent).toBe('lynch');
    expect(body.data.fingerprint).toBe('fp-race-condition');
  });

  it('returns empty severity/attributedAgent/fingerprint for an item that has none', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseDbItem());

    const { GET } = await import('@/app/api/items/[id]/route');
    const response = await GET(makeGetRequest('http://localhost:3000/api/items/WI-001'), makeContext('WI-001'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.severity).toBeFalsy();
    expect(body.data.attributedAgent).toBeFalsy();
    expect(body.data.fingerprint).toBeFalsy();
  });
});

describe('GET /api/items (list) — finding provenance fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('includes severity, attributedAgent, and fingerprint for each item in the list response', async () => {
    // Insurance against the WI-934-style gap (a route that reads Item but
    // forgets a field the shared transform was supposed to carry): both GET
    // /api/items and GET /api/items/:id route through
    // transformItemWithRelationsToResponse, but that architectural sharing
    // is exactly the kind of assumption a real test should verify, not take
    // on faith.
    mockPrisma.item.findMany.mockResolvedValue([
      baseDbItem({ severity: 'medium', attributedAgent: 'amy', fingerprint: 'fp-flaky-test' }),
    ]);

    const { GET } = await import('@/app/api/items/route');
    const response = await GET(makeGetRequest('http://localhost:3000/api/items'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].severity).toBe('medium');
    expect(body.data[0].attributedAgent).toBe('amy');
    expect(body.data[0].fingerprint).toBe('fp-flaky-test');
  });
});

// ============ PATCH /api/items/:id — set/change fields (AC2, AC3) ============

describe('PATCH /api/items/:id — finding provenance fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPrisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
      }
      return arg;
    });
  });

  it('sets severity, attributedAgent, and fingerprint on an item that had none, without disturbing its other fields', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseDbItem());
    mockPrisma.item.update.mockResolvedValue(
      baseDbItem({ severity: 'high', attributedAgent: 'stockwell', fingerprint: 'fp-new' })
    );

    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-001', { severity: 'high', attributedAgent: 'stockwell', fingerprint: 'fp-new' }),
      makeContext('WI-001')
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'WI-001' },
        data: expect.objectContaining({
          severity: 'high',
          attributedAgent: 'stockwell',
          fingerprint: 'fp-new',
        }),
      })
    );
    // The update call must NOT carry unrelated fields the request never sent —
    // this is the "without disturbing its other fields" half of AC2.
    const updateData = mockPrisma.item.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('title');
    expect(updateData).not.toHaveProperty('description');

    const body = await response.json();
    expect(body.data.severity).toBe('high');
    expect(body.data.attributedAgent).toBe('stockwell');
    expect(body.data.fingerprint).toBe('fp-new');
  });

  it('changes an existing severity/attributedAgent/fingerprint to new values', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(
      baseDbItem({ severity: 'low', attributedAgent: 'murdock', fingerprint: 'fp-old' })
    );
    mockPrisma.item.update.mockResolvedValue(
      baseDbItem({ severity: 'critical', attributedAgent: 'ba', fingerprint: 'fp-changed' })
    );

    const { PATCH } = await import('@/app/api/items/[id]/route');
    await PATCH(
      makePatchRequest('WI-001', { severity: 'critical', attributedAgent: 'ba', fingerprint: 'fp-changed' }),
      makeContext('WI-001')
    );

    expect(mockPrisma.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          severity: 'critical',
          attributedAgent: 'ba',
          fingerprint: 'fp-changed',
        }),
      })
    );
  });

  it('rejects an out-of-range severity on PATCH with a 400 naming the valid values', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseDbItem());

    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-001', { severity: 'catastrophic' }),
      makeContext('WI-001')
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    for (const value of VALID_SEVERITIES) {
      expect(body.error.message).toContain(value);
    }
    expect(mockPrisma.item.update).not.toHaveBeenCalled();
  });
});

// ============ POST /api/learnings — sourceItemId (AC4, AC5) ============

function validLearningBody(overrides: Record<string, unknown> = {}) {
  return {
    source: 'stockwell',
    severity: 'high',
    attributedAgent: 'ba',
    targetSurface: 'agents/ba.md',
    pattern: 'missing-error-handling',
    fingerprint: 'fp-1',
    title: 'B.A. skips error handling on async calls',
    detail: 'Three rejections traced to unhandled promise rejections.',
    missionId: 'm-20260702-001',
    ...overrides,
  };
}

function buildLearningRequest(projectId: string, body: unknown): Request {
  return new Request('http://localhost:3000/api/learnings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': projectId },
    body: JSON.stringify(body),
  });
}

describe('POST /api/learnings — sourceItemId provenance and dedupe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'm-20260702-001', projectId: 'project-a' });
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-a', name: 'project-a' });
  });

  it('creates a learning carrying the source item id', async () => {
    mockPrisma.retroLearning.findFirst.mockResolvedValue(null);
    mockPrisma.retroLearning.create.mockResolvedValue({ id: 100 });

    const { POST } = await import('@/app/api/learnings/route');
    const response = await POST(
      buildLearningRequest('project-a', validLearningBody({ sourceItemId: 'WI-050', fingerprint: 'fp-src' }))
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.id).toBe(100);
    expect(mockPrisma.retroLearning.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceItemId: 'WI-050' }),
      })
    );
  });

  it('a second POST naming the same source item for this mission updates the existing row instead of inserting a second', async () => {
    const { POST } = await import('@/app/api/learnings/route');

    mockPrisma.retroLearning.findFirst.mockResolvedValueOnce(null);
    mockPrisma.retroLearning.create.mockResolvedValue({ id: 200 });
    const first = await POST(
      buildLearningRequest('project-a', validLearningBody({ sourceItemId: 'WI-051', fingerprint: 'fp-a' }))
    );
    expect(first.status).toBe(201);
    expect((await first.json()).data.id).toBe(200);

    // Second capture derived from the SAME source item — even with a
    // DIFFERENT fingerprint value, it must resolve to the existing row
    // (dedupe is keyed on the source item now, not the fingerprint).
    mockPrisma.retroLearning.findFirst.mockResolvedValueOnce({ id: 200 });
    const second = await POST(
      buildLearningRequest('project-a', validLearningBody({ sourceItemId: 'WI-051', fingerprint: 'fp-b' }))
    );

    expect(second.status).toBe(200);
    expect((await second.json()).data.id).toBe(200);
    expect(mockPrisma.retroLearning.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.retroLearning.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: 'project-a', missionId: 'm-20260702-001', sourceItemId: 'WI-051' }),
      })
    );
  });

  it('a second POST for the same source item with a DIFFERENT detail payload updates the stored row CONTENT, not just its id (WI-936 mission-tail rework, Frankie DoD 13)', async () => {
    // The pre-existing test above ("a second POST naming the same source
    // item... updates the existing row instead of inserting a second") only
    // proves non-duplication — it never inspects the row's content. That gap
    // is precisely how Frankie caught this at the mission tail: a route that
    // finds the existing row and returns it UNCHANGED satisfies every
    // assertion in that test while never actually updating anything. This
    // test uses a stateful find/create/update store (same pattern as the
    // P2002 race test below) so the row's stored content is directly
    // observable, not just its id.
    const rows: Array<{ id: number; sourceItemId: string; detail: string; [key: string]: unknown }> = [];
    let nextId = 1;

    mockPrisma.retroLearning.findFirst.mockImplementation(
      async ({ where }: { where: { sourceItemId?: string } }) =>
        rows.find((r) => r.sourceItemId === where.sourceItemId) ?? null
    );
    mockPrisma.retroLearning.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: nextId++, ...data } as { id: number; sourceItemId: string; detail: string };
      rows.push(row);
      return row;
    });
    mockPrisma.retroLearning.update.mockImplementation(
      async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('row not found in stateful mock store');
        Object.assign(row, data);
        return row;
      }
    );

    const { POST } = await import('@/app/api/learnings/route');

    const first = await POST(
      buildLearningRequest(
        'project-a',
        validLearningBody({
          sourceItemId: 'WI-090',
          fingerprint: 'fp-update-1',
          severity: 'medium',
          detail: 'Run 1: fixed on first pass.',
        })
      )
    );
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await POST(
      buildLearningRequest(
        'project-a',
        validLearningBody({
          sourceItemId: 'WI-090',
          fingerprint: 'fp-update-2',
          severity: 'high',
          detail: 'Run 2: bounced once before landing.',
        })
      )
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    // Non-duplication (the part the pre-existing test already covered):
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(rows).toHaveLength(1);

    // The part that was missing: content must reflect the SECOND capture.
    expect(secondBody.data.detail).toBe('Run 2: bounced once before landing.');
    expect(secondBody.data.detail).not.toBe('Run 1: fixed on first pass.');
    expect(secondBody.data.severity).toBe('high');
    expect(rows[0].detail).toBe('Run 2: bounced once before landing.');
    expect(rows[0].severity).toBe('high');

    // Proves an actual UPDATE happened — not a re-fetch-and-return-unchanged.
    expect(mockPrisma.retroLearning.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.retroLearning.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: firstBody.data.id },
        data: expect.objectContaining({ detail: 'Run 2: bounced once before landing.', severity: 'high' }),
      })
    );
  });

  it('sends independent create calls, keyed on sourceItemId, for different source items that share one fingerprint (mocked routing only — see the REAL-DATABASE suite below for the actual unique-constraint interaction, which this mock cannot exercise)', async () => {
    // WI-936 rework (Amy's rejection): this test, on its own, is NOT proof
    // AC5 holds — it only proves the route computes distinct create() calls
    // and reports both as created when Prisma happens to say yes. It cannot
    // see that the pre-existing @@unique([projectId,missionId,fingerprint])
    // constraint and the new @@unique([projectId,missionId,sourceItemId])
    // constraint are mutually exclusive for this exact scenario, because
    // mocking retroLearning.create to always resolve bypasses SQLite's
    // constraint enforcement entirely. The real-DB suite below is the
    // authoritative AC5 check; keep this one as a narrower routing/plumbing
    // regression (dedupe key selection, response shape) — do not read it as
    // "AC5 verified".
    mockPrisma.retroLearning.findFirst.mockResolvedValue(null);
    mockPrisma.retroLearning.create
      .mockResolvedValueOnce({ id: 301 })
      .mockResolvedValueOnce({ id: 302 });

    const { POST } = await import('@/app/api/learnings/route');
    const a = await POST(
      buildLearningRequest(
        'project-a',
        validLearningBody({ sourceItemId: 'WI-060', fingerprint: 'fp-shared' })
      )
    );
    const b = await POST(
      buildLearningRequest(
        'project-a',
        validLearningBody({ sourceItemId: 'WI-061', fingerprint: 'fp-shared' })
      )
    );

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(mockPrisma.retroLearning.create).toHaveBeenCalledTimes(2);
    const sourceItemIds = mockPrisma.retroLearning.create.mock.calls.map((c) => c[0].data.sourceItemId);
    expect(sourceItemIds).toEqual(['WI-060', 'WI-061']);
  });

  it('preserves fingerprint-keyed dedupe for a learning with no source item', async () => {
    // No sourceItemId in the body — the OLD (projectId, missionId, fingerprint)
    // dedupe path must still apply unchanged.
    mockPrisma.retroLearning.findFirst.mockResolvedValueOnce({ id: 400 });

    const { POST } = await import('@/app/api/learnings/route');
    const response = await POST(
      buildLearningRequest('project-a', validLearningBody({ fingerprint: 'fp-no-source' }))
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.id).toBe(400);
    expect(mockPrisma.retroLearning.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: 'project-a', missionId: 'm-20260702-001', fingerprint: 'fp-no-source' }),
      })
    );
    expect(mockPrisma.retroLearning.create).not.toHaveBeenCalled();
  });

  it('serializes concurrent duplicate source-item captures via the new unique constraint: both succeed, one row, same id', async () => {
    // Mirrors learnings-capture-api.test.ts's fingerprint P2002 race test —
    // the sibling backstop (context: "the P2002 backstop... must key on the
    // source work item instead") needs the same concurrency guarantee.
    const rows: Array<{ id: number; projectId: string; missionId: string | null; sourceItemId: string }> = [];
    let nextId = 1;

    mockPrisma.retroLearning.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      return (
        rows.find(
          (r) =>
            r.projectId === where.projectId &&
            r.missionId === where.missionId &&
            r.sourceItemId === where.sourceItemId
        ) ?? null
      );
    });

    mockPrisma.retroLearning.create.mockImplementation(
      async ({ data }: { data: { projectId: string; missionId: string | null; sourceItemId: string } }) => {
        const conflict = rows.find(
          (r) =>
            r.projectId === data.projectId &&
            r.missionId === data.missionId &&
            r.sourceItemId === data.sourceItemId
        );
        if (conflict) {
          const err = new Error('Unique constraint failed') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }
        const row = { id: nextId++, projectId: data.projectId, missionId: data.missionId, sourceItemId: data.sourceItemId };
        rows.push(row);
        return row;
      }
    );

    const { POST } = await import('@/app/api/learnings/route');

    // Simulate the race: both requests pass the app-level findFirst fast
    // path (empty `rows`) before either insert lands. Deliberately DIFFERENT
    // fingerprints on the two calls — this is what proves the collision is
    // driven by sourceItemId, not by the old fingerprint-keyed dedupe still
    // silently doing the work. (An earlier version of this test used the
    // SAME fingerprint on both calls and passed even against an
    // unimplemented route, because two `undefined === undefined` sourceItemId
    // comparisons in the mock's own conflict check collided vacuously — a
    // false positive caught by re-checking this test against RED before
    // trusting it. Different fingerprints close that hole.)
    const [first, second] = await Promise.all([
      POST(buildLearningRequest('project-a', validLearningBody({ sourceItemId: 'WI-070', fingerprint: 'fp-race-1' }))),
      POST(buildLearningRequest('project-a', validLearningBody({ sourceItemId: 'WI-070', fingerprint: 'fp-race-2' }))),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.data.id).toBe(secondBody.data.id);
    expect(rows).toHaveLength(1);
    // Forces the create() payload to have actually carried a real
    // sourceItemId — without this, the assertions above could pass on an
    // accidental undefined/undefined collision instead of a real one.
    expect(rows[0].sourceItemId).toBe('WI-070');
    expect(mockPrisma.retroLearning.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sourceItemId: 'WI-070' }) })
    );
  });
});

// ============ Migration — additive Item + RetroLearning columns (AC6) ============
//
// Real temp SQLite databases, no mocking — mirrors mission-execution-contract.test.ts's
// migration suite. Frozen "before" DDL captured from the live schema.prisma
// BEFORE this item's columns are added (Item, Stage, Project, Fingerprint,
// RetroLearning) — not derived from schema.prisma at test-run time, since by
// the time this test runs green, schema.prisma will already declare the new
// columns and a db-push-based "before" state would be impossible to construct.

// This test file lives at src/__tests__/api/items/ — the kanban-viewer
// package root is four levels up (items -> api -> __tests__ -> src -> root).
const KANBAN_VIEWER_ROOT = resolve(__dirname, '../../../..');
const MIGRATIONS_ROOT = resolve(KANBAN_VIEWER_ROOT, 'prisma/migrations');
const ITEM_MIGRATION_PATTERN = /^\d{14}_add_finding_provenance_to_item$/;
const RETRO_LEARNING_MIGRATION_PATTERN = /^\d{14}_add_source_item_to_retro_learning$/;

const PRE_MIGRATION_PROJECT_TABLE_SQL = `
  CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )
`;

const PRE_MIGRATION_STAGE_TABLE_SQL = `
  CREATE TABLE "Stage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "wipLimit" INTEGER
  )
`;

const PRE_MIGRATION_ITEM_TABLE_SQL = `
  CREATE TABLE "Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assignedAgent" TEXT,
    "rejectionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "archivedAt" DATETIME,
    "objective" TEXT,
    "acceptance" TEXT,
    "context" TEXT,
    "outputTest" TEXT,
    "outputImpl" TEXT,
    "outputTypes" TEXT,
    CONSTRAINT "Item_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Item_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )
`;

const PRE_MIGRATION_FINGERPRINT_TABLE_SQL = `
  CREATE TABLE "Fingerprint" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "pattern" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "deferredAtMissions" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )
`;

const PRE_MIGRATION_RETRO_LEARNING_TABLE_SQL = `
  CREATE TABLE "RetroLearning" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" TEXT NOT NULL,
    "missionId" TEXT,
    "source" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "attributedAgent" TEXT NOT NULL,
    "targetSurface" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "origin" TEXT NOT NULL DEFAULT 'local',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RetroLearning_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RetroLearning_fingerprint_fkey" FOREIGN KEY ("fingerprint") REFERENCES "Fingerprint" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE
  )
`;

const PRE_MIGRATION_ITEM_COLUMNS = [
  'id', 'title', 'description', 'type', 'priority', 'stageId', 'projectId',
  'assignedAgent', 'rejectionCount', 'createdAt', 'updatedAt', 'completedAt',
  'archivedAt', 'objective', 'acceptance', 'context', 'outputTest', 'outputImpl', 'outputTypes',
];

const PRE_MIGRATION_RETRO_LEARNING_COLUMNS = [
  'id', 'projectId', 'missionId', 'source', 'severity', 'attributedAgent',
  'targetSurface', 'pattern', 'fingerprint', 'title', 'detail', 'status', 'origin', 'createdAt',
];

interface ColumnInfo {
  name: string;
  notnull: number;
}

async function getTableColumns(client: Client, table: string): Promise<ColumnInfo[]> {
  const result = await client.execute(`PRAGMA table_info("${table}")`);
  return result.rows.map((row) => ({ name: row.name as string, notnull: Number(row.notnull) }));
}

function findMigrationDir(pattern: RegExp): string {
  const entries = readdirSync(MIGRATIONS_ROOT, { withFileTypes: true });
  const match = entries.find((e) => e.isDirectory() && pattern.test(e.name));
  if (!match) {
    throw new Error(
      `Expected a prisma/migrations/<YYYYMMDDHHmmss>_<name> directory matching ${pattern} under ${MIGRATIONS_ROOT} — none found.`
    );
  }
  return join(MIGRATIONS_ROOT, match.name, 'migration.sql');
}

// ============ POST /api/learnings — REAL DATABASE constraint verification (AC5 rework) ============
//
// WI-936 rework (Amy's rejection, CRITICAL): the mocked test above cannot see
// that RetroLearning carries TWO independently-enforced unique constraints —
// the pre-existing @@unique([projectId,missionId,fingerprint]) and the new
// @@unique([projectId,missionId,sourceItemId]) — which are mutually exclusive
// for exactly the scenario AC5 requires: two different source items sharing
// one fingerprint under the same mission. Amy proved live that inserting the
// second row throws P2002 against the FINGERPRINT constraint (not the
// sourceItemId one), the route's dedupeWhere-keyed re-fetch finds nothing
// (wrong constraint fired, row never created), and the error is re-thrown as
// a 500 — the row is lost, not preserved.
//
// This suite applies EVERY real migration (via `prisma migrate deploy`,
// exactly as production does) to a fresh temp SQLite database, connects a
// REAL PrismaClient (the same @prisma/adapter-libsql adapter src/lib/db.ts
// uses) to it, and redirects this file's mockPrisma functions to delegate to
// that real client for the duration of these tests only — so the ACTUAL
// route handler (POST /api/learnings, unmodified) runs against ACTUAL SQLite
// constraint enforcement, with real Prisma P2002 error semantics. This is
// the authoritative AC5 check; the mocked test above is routing/plumbing
// coverage only.

const LEARNINGS_TEST_TIMEOUT_MS = 30_000;

async function setUpRealMigratedDb(): Promise<{ tmpDir: string; client: PrismaClient }> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'wi936-real-db-'));
  const dbPath = join(tmpDir, 'test.db');

  execSync('npx prisma migrate deploy --config ./prisma/prisma.config.ts', {
    cwd: KANBAN_VIEWER_ROOT,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: 'pipe',
  });

  const adapter = new PrismaLibSql({ url: `file:${dbPath}` });
  const client = new PrismaClient({ adapter });
  return { tmpDir, client };
}

describe('POST /api/learnings — REAL DATABASE: sourceItemId dedupe vs the fingerprint constraint (WI-936 rework, AC5)', () => {
  let tmpDir: string;
  let realPrisma: PrismaClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const setup = await setUpRealMigratedDb();
    tmpDir = setup.tmpDir;
    realPrisma = setup.client;

    await realPrisma.project.create({ data: { id: 'proj-real', name: 'Real DB Project', updatedAt: new Date() } });
    await realPrisma.mission.create({
      data: { id: 'm-real', name: 'Real DB Mission', state: 'running', prdPath: '/x.md', projectId: 'proj-real', startedAt: new Date() },
    });

    // Redirect this file's mocked prisma functions to the REAL client, so
    // the unmodified route handler runs against real constraint enforcement.
    mockPrisma.project.findUnique.mockImplementation((args: { where: { id: string } }) =>
      realPrisma.project.findUnique(args)
    );
    mockPrisma.mission.findFirst.mockImplementation((args: unknown) =>
      // @ts-expect-error - delegating to the real client with the same args shape
      realPrisma.mission.findFirst(args)
    );
    mockPrisma.fingerprint.upsert.mockImplementation((args: unknown) =>
      // @ts-expect-error - delegating to the real client with the same args shape
      realPrisma.fingerprint.upsert(args)
    );
    mockPrisma.retroLearning.findFirst.mockImplementation((args: unknown) =>
      // @ts-expect-error - delegating to the real client with the same args shape
      realPrisma.retroLearning.findFirst(args)
    );
    mockPrisma.retroLearning.create.mockImplementation((args: unknown) =>
      // @ts-expect-error - delegating to the real client with the same args shape
      realPrisma.retroLearning.create(args)
    );
    mockPrisma.retroLearning.update.mockImplementation((args: unknown) =>
      // @ts-expect-error - delegating to the real client with the same args shape
      realPrisma.retroLearning.update(args)
    );
  }, LEARNINGS_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await realPrisma.$disconnect();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it(
    'creates two DISTINCT rows for different source items that share one fingerprint, against the real migrated schema (AC5)',
    async () => {
      const { POST } = await import('@/app/api/learnings/route');

      const a = await POST(
        buildLearningRequest(
          'proj-real',
          validLearningBody({ missionId: 'm-real', sourceItemId: 'WI-060', fingerprint: 'fp-shared-real' })
        )
      );
      const aBody = await a.json();
      expect(a.status, `first capture failed: ${JSON.stringify(aBody)}`).toBe(201);

      const b = await POST(
        buildLearningRequest(
          'proj-real',
          validLearningBody({ missionId: 'm-real', sourceItemId: 'WI-061', fingerprint: 'fp-shared-real' })
        )
      );
      const bBody = await b.json();
      expect(
        b.status,
        `second capture must succeed as a DISTINCT row (AC5), not fail with the fingerprint constraint: ${JSON.stringify(bBody)}`
      ).toBe(201);

      expect(aBody.data.id).not.toBe(bBody.data.id);

      // Confirm directly against the database — not just the HTTP response —
      // that both rows genuinely exist.
      const rows = await realPrisma.retroLearning.findMany({
        where: { projectId: 'proj-real', missionId: 'm-real', fingerprint: 'fp-shared-real' },
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.sourceItemId).sort()).toEqual(['WI-060', 'WI-061']);
    },
    LEARNINGS_TEST_TIMEOUT_MS
  );

  it(
    'still updates the existing row (does not duplicate) when the SAME source item captures twice, against the real schema',
    async () => {
      const { POST } = await import('@/app/api/learnings/route');

      const first = await POST(
        buildLearningRequest(
          'proj-real',
          validLearningBody({
            missionId: 'm-real',
            sourceItemId: 'WI-070',
            fingerprint: 'fp-a-real',
            detail: 'Run 1: fixed on first pass.',
          })
        )
      );
      expect(first.status).toBe(201);
      const firstId = (await first.json()).data.id;

      const second = await POST(
        buildLearningRequest(
          'proj-real',
          validLearningBody({
            missionId: 'm-real',
            sourceItemId: 'WI-070',
            fingerprint: 'fp-b-real',
            detail: 'Run 2: bounced once before landing.',
          })
        )
      );
      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody.data.id).toBe(firstId);
      // WI-936 mission-tail rework (Frankie DoD 13): the response itself
      // must carry the SECOND run's detail — a route that finds-and-returns
      // the existing row unchanged would still pass every assertion above.
      expect(secondBody.data.detail).toBe('Run 2: bounced once before landing.');

      const rows = await realPrisma.retroLearning.findMany({
        where: { projectId: 'proj-real', missionId: 'm-real', sourceItemId: 'WI-070' },
      });
      expect(rows).toHaveLength(1);
      // Fetched directly from the database, not from the HTTP response —
      // proves the row was actually persisted with the updated content,
      // not just faked in the response body.
      expect(rows[0].detail).toBe('Run 2: bounced once before landing.');
    },
    LEARNINGS_TEST_TIMEOUT_MS
  );
});

describe('WI-936: Item finding-provenance migration SQL (existing database)', () => {
  let migrationSql: string;

  beforeAll(() => {
    migrationSql = readFileSync(findMigrationDir(ITEM_MIGRATION_PATTERN), 'utf8');
  });

  let tmpDir: string;
  let client: Client;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wi936-item-migration-'));
    client = createClient({ url: `file:${join(tmpDir, 'test.db')}` });

    await client.executeMultiple(PRE_MIGRATION_PROJECT_TABLE_SQL);
    await client.executeMultiple(PRE_MIGRATION_STAGE_TABLE_SQL);
    await client.executeMultiple(PRE_MIGRATION_ITEM_TABLE_SQL);

    await client.execute({
      sql: `INSERT INTO "Project" (id, name, createdAt, updatedAt) VALUES (?, ?, datetime('now'), datetime('now'))`,
      args: ['proj-test', 'Test Project'],
    });
    await client.execute({
      sql: `INSERT INTO "Stage" (id, name, "order", wipLimit) VALUES (?, ?, ?, ?)`,
      args: ['briefings', 'Briefings', 0, null],
    });
    await client.execute({
      sql: `INSERT INTO "Item" (id, title, description, type, priority, stageId, projectId, updatedAt, objective)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      args: ['WI-100', 'Pre-existing item', 'A legacy item', 'feature', 'medium', 'briefings', 'proj-test', 'Legacy objective'],
    });
  }, 30_000);

  afterEach(async () => {
    client.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('adds nullable severity, attributedAgent, and fingerprint columns without dropping or altering existing columns; existing rows survive with them NULL', async () => {
    const before = await getTableColumns(client, 'Item');
    for (const col of PRE_MIGRATION_ITEM_COLUMNS) {
      expect(before.map((c) => c.name)).toContain(col);
    }

    await client.executeMultiple(migrationSql);

    const after = await getTableColumns(client, 'Item');
    const afterNames = after.map((c) => c.name);
    for (const col of PRE_MIGRATION_ITEM_COLUMNS) {
      expect(afterNames).toContain(col);
    }
    for (const newCol of ['severity', 'attributedAgent', 'fingerprint']) {
      expect(afterNames).toContain(newCol);
      expect(after.find((c) => c.name === newCol)?.notnull).toBe(0);
    }

    const result = await client.execute({ sql: `SELECT * FROM "Item" WHERE id = ?`, args: ['WI-100'] });
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.title).toBe('Pre-existing item');
    expect(row.objective).toBe('Legacy objective');
    expect(row.severity).toBeNull();
    expect(row.attributedAgent).toBeNull();
    expect(row.fingerprint).toBeNull();
  });
});

describe('WI-936: RetroLearning sourceItemId migration SQL (existing database)', () => {
  let migrationSql: string;

  beforeAll(() => {
    migrationSql = readFileSync(findMigrationDir(RETRO_LEARNING_MIGRATION_PATTERN), 'utf8');
  });

  let tmpDir: string;
  let client: Client;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wi936-retro-learning-migration-'));
    client = createClient({ url: `file:${join(tmpDir, 'test.db')}` });

    await client.executeMultiple(PRE_MIGRATION_PROJECT_TABLE_SQL);
    await client.executeMultiple(PRE_MIGRATION_FINGERPRINT_TABLE_SQL);
    await client.executeMultiple(PRE_MIGRATION_RETRO_LEARNING_TABLE_SQL);

    await client.execute({
      sql: `INSERT INTO "Project" (id, name, createdAt, updatedAt) VALUES (?, ?, datetime('now'), datetime('now'))`,
      args: ['proj-test', 'Test Project'],
    });
    await client.execute({
      sql: `INSERT INTO "Fingerprint" (slug, pattern, severity, createdAt, updatedAt) VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      args: ['fp-legacy', 'legacy-pattern', 'medium'],
    });
    await client.execute({
      sql: `INSERT INTO "RetroLearning"
              (projectId, missionId, source, severity, attributedAgent, targetSurface, pattern, fingerprint, title, detail, status, origin, createdAt)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: ['proj-test', 'stockwell', 'medium', 'ba', 'agents/ba.md', 'legacy-pattern', 'fp-legacy', 'Legacy finding', 'Legacy detail', 'open', 'local'],
    });
  }, 30_000);

  afterEach(async () => {
    client.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('adds a nullable sourceItemId column without dropping or altering existing columns; existing rows survive with it NULL', async () => {
    const before = await getTableColumns(client, 'RetroLearning');
    for (const col of PRE_MIGRATION_RETRO_LEARNING_COLUMNS) {
      expect(before.map((c) => c.name)).toContain(col);
    }

    await client.executeMultiple(migrationSql);

    const after = await getTableColumns(client, 'RetroLearning');
    const afterNames = after.map((c) => c.name);
    for (const col of PRE_MIGRATION_RETRO_LEARNING_COLUMNS) {
      expect(afterNames).toContain(col);
    }
    expect(afterNames).toContain('sourceItemId');
    expect(after.find((c) => c.name === 'sourceItemId')?.notnull).toBe(0);

    const result = await client.execute({ sql: `SELECT * FROM "RetroLearning" WHERE fingerprint = ?`, args: ['fp-legacy'] });
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.title).toBe('Legacy finding');
    expect(row.severity).toBe('medium');
    expect(row.sourceItemId).toBeNull();
  });

  it('the new (projectId, missionId, sourceItemId) unique index exists after migration', async () => {
    await client.executeMultiple(migrationSql);

    const result = await client.execute(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'RetroLearning'`
    );
    const indexSqls = result.rows.map((r) => String(r.sql ?? ''));
    const hasSourceItemIndex = indexSqls.some(
      (sql) => sql.includes('sourceItemId') && /UNIQUE/i.test(sql)
    );
    expect(
      hasSourceItemIndex,
      `expected a UNIQUE index on RetroLearning including sourceItemId; found indexes: ${JSON.stringify(indexSqls)}`
    ).toBe(true);

    // The OLD (projectId, missionId, fingerprint) unique index must still
    // exist — this migration is additive, not a replacement.
    const hasFingerprintIndex = indexSqls.some(
      (sql) => sql.includes('fingerprint') && /UNIQUE/i.test(sql)
    );
    expect(hasFingerprintIndex).toBe(true);
  });
});
