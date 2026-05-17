import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the controller-checkpoint API routes (WI-002).
 *
 * Routes under test:
 *   - GET  /api/controller-checkpoint/:missionId
 *   - POST /api/controller-checkpoint/:missionId
 *   - POST /api/controller-checkpoint/:missionId/confirm
 *
 * These routes persist the tick-based controller's per-mission checkpoint
 * document (last tick timestamp, activity cursor, pending/confirmed action
 * IDs, retry counters, last lane state) outside Claude's context. The
 * /confirm endpoint exists so the tick loop can append executed action IDs
 * atomically without a read-modify-write round-trip from the client.
 *
 * Guardrails under test:
 *  1. Project scoping — every operation is scoped via X-Project-ID. Cross-project
 *     reads/writes must return 404 without leaking existence.
 *  2. 404 sentinel — GET and /confirm return the literal body {error:'not_found'}
 *     (NOT the standard ApiError envelope) when no checkpoint exists for the
 *     mission+project.
 *  3. POST validation — malformed JSON or missing/invalid fields produce a 400
 *     VALIDATION_ERROR response shape consistent with src/lib/errors.ts.
 *  4. /confirm contract — accepts only {actionId: string}, deduplicates
 *     server-side, and mutates ONLY the confirmedActionIds column on the row.
 *  5. Persisted document shape — JSON-string columns in the DB are parsed
 *     before being returned to the HTTP client so the consumer doesn't have
 *     to double-decode (arrays/records, not strings).
 */

// ----------------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------------

const mockPrisma = vi.hoisted(() => ({
  mission: { findFirst: vi.fn() },
  controllerCheckpoint: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

// Routes are imported AFTER the mock is registered (vi.hoisted lifts the mock).
import { GET, POST } from '@/app/api/controller-checkpoint/[missionId]/route';
import { POST as POST_CONFIRM } from '@/app/api/controller-checkpoint/[missionId]/confirm/route';

// ----------------------------------------------------------------------------
// Fixtures and helpers
// ----------------------------------------------------------------------------

const MISSION_ID = 'M-001';
const PROJECT_A = 'project-a';
const PROJECT_B = 'project-b';

interface DbCheckpoint {
  missionId: string;
  tickedAt: Date;
  activityCursor: number;
  // SQLite stores these as JSON-stringified columns
  pendingActionIds: string;
  confirmedActionIds: string;
  retryCounters: string;
  lastLaneState: string;
}

function makeDbCheckpoint(overrides: Partial<DbCheckpoint> = {}): DbCheckpoint {
  return {
    missionId: MISSION_ID,
    tickedAt: new Date('2026-05-17T00:00:00.000Z'),
    activityCursor: 0,
    pendingActionIds: '[]',
    confirmedActionIds: '[]',
    retryCounters: '{}',
    lastLaneState: '{}',
    ...overrides,
  };
}

/** A well-formed POST body — JSON fields are arrays/objects, not stringified. */
const validBody = {
  tickedAt: '2026-05-17T00:00:00.000Z',
  activityCursor: 7,
  pendingActionIds: ['p1', 'p2'],
  confirmedActionIds: ['c1'],
  retryCounters: { 'a-1': 2 },
  lastLaneState: { 'murdock-1': 'idle' as const, 'ba-1': 'busy' as const },
};

function buildGetRequest(projectId: string): Request {
  return new Request(`http://localhost:3000/api/controller-checkpoint/${MISSION_ID}`, {
    method: 'GET',
    headers: { 'X-Project-ID': projectId },
  });
}

function buildPostRequest(projectId: string, body: unknown): Request {
  return new Request(`http://localhost:3000/api/controller-checkpoint/${MISSION_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': projectId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function buildMalformedPostRequest(projectId: string): Request {
  return new Request(`http://localhost:3000/api/controller-checkpoint/${MISSION_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': projectId },
    body: '{not valid json',
  });
}

function buildConfirmRequest(projectId: string, body: unknown): Request {
  return new Request(
    `http://localhost:3000/api/controller-checkpoint/${MISSION_ID}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Project-ID': projectId },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );
}

function buildContext(missionId: string = MISSION_ID) {
  return { params: Promise.resolve({ missionId }) };
}

// ----------------------------------------------------------------------------
// Shared beforeEach — wire $transaction to pass our mocked prisma into the
// callback form so handlers that use `prisma.$transaction(async (tx) => ...)`
// still hit our mock methods.
// ----------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockPrisma.$transaction.mockImplementation(async (fnOrOps: any) => {
    if (typeof fnOrOps === 'function') return fnOrOps(mockPrisma);
    return Promise.all(fnOrOps);
  });
}

// ============================================================================
// GET /api/controller-checkpoint/:missionId
// ============================================================================

describe('GET /api/controller-checkpoint/:missionId', () => {
  beforeEach(resetMocks);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 with the persisted checkpoint when one exists for the requesting project', async () => {
    mockPrisma.controllerCheckpoint.findFirst.mockResolvedValue(
      makeDbCheckpoint({
        pendingActionIds: '["p1"]',
        confirmedActionIds: '["c1","c2"]',
        retryCounters: '{"a-1":3}',
        lastLaneState: '{"murdock-1":"busy"}',
        activityCursor: 12,
      })
    );

    const res = await GET(buildGetRequest(PROJECT_A), buildContext());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.missionId).toBe(MISSION_ID);
    expect(json.data.activityCursor).toBe(12);
    // JSON-string columns are parsed before being returned to the HTTP client.
    expect(json.data.pendingActionIds).toEqual(['p1']);
    expect(json.data.confirmedActionIds).toEqual(['c1', 'c2']);
    expect(json.data.retryCounters).toEqual({ 'a-1': 3 });
    expect(json.data.lastLaneState).toEqual({ 'murdock-1': 'busy' });
  });

  it("returns 404 with {error:'not_found'} when no checkpoint exists for the given mission+project", async () => {
    mockPrisma.controllerCheckpoint.findFirst.mockResolvedValue(null);

    const res = await GET(buildGetRequest(PROJECT_A), buildContext());

    expect(res.status).toBe(404);
    const json = await res.json();
    // The AC specifies the literal sentinel shape — NOT the standard ApiError envelope.
    expect(json).toEqual({ error: 'not_found' });
  });

  it('scopes the lookup by X-Project-ID — cross-project GET returns 404 without leaking existence', async () => {
    // From project B's perspective, the scoped findFirst returns null because
    // the projectId filter excludes project A's row. The response must NOT
    // differ from "no checkpoint exists" — otherwise existence leaks.
    mockPrisma.controllerCheckpoint.findFirst.mockResolvedValue(null);

    const res = await GET(buildGetRequest(PROJECT_B), buildContext());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });

    // The where clause must include project scoping (either directly or through
    // a mission relation). We don't pin the exact shape — only that the
    // requesting project's ID and the mission ID are both present in the filter.
    const findFirstCall = mockPrisma.controllerCheckpoint.findFirst.mock.calls[0][0];
    const whereJson = JSON.stringify(findFirstCall.where);
    expect(whereJson).toContain(MISSION_ID);
    expect(whereJson).toContain(PROJECT_B);
  });

  it('returns 400 VALIDATION_ERROR when X-Project-ID header is missing', async () => {
    const req = new Request(
      `http://localhost:3000/api/controller-checkpoint/${MISSION_ID}`,
      { method: 'GET' }
    );

    const res = await GET(req, buildContext());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    // The DB must not be touched when the request is rejected up front.
    expect(mockPrisma.controllerCheckpoint.findFirst).not.toHaveBeenCalled();
  });
});

// ============================================================================
// POST /api/controller-checkpoint/:missionId
// ============================================================================

describe('POST /api/controller-checkpoint/:missionId', () => {
  beforeEach(resetMocks);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('upserts a valid checkpoint body and returns 200 with the persisted document', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({
      id: MISSION_ID,
      projectId: PROJECT_A,
    });
    mockPrisma.controllerCheckpoint.upsert.mockResolvedValue(
      makeDbCheckpoint({
        tickedAt: new Date('2026-05-17T00:00:00.000Z'),
        activityCursor: 7,
        pendingActionIds: '["p1","p2"]',
        confirmedActionIds: '["c1"]',
        retryCounters: '{"a-1":2}',
        lastLaneState: '{"murdock-1":"idle","ba-1":"busy"}',
      })
    );

    const res = await POST(buildPostRequest(PROJECT_A, validBody), buildContext());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.missionId).toBe(MISSION_ID);
    expect(json.data.activityCursor).toBe(7);
    // JSON-string columns must be parsed before being returned to the HTTP client.
    expect(json.data.pendingActionIds).toEqual(['p1', 'p2']);
    expect(json.data.confirmedActionIds).toEqual(['c1']);
    expect(json.data.retryCounters).toEqual({ 'a-1': 2 });
    expect(json.data.lastLaneState).toEqual({
      'murdock-1': 'idle',
      'ba-1': 'busy',
    });
    expect(mockPrisma.controllerCheckpoint.upsert).toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when the POST body is malformed JSON', async () => {
    const res = await POST(buildMalformedPostRequest(PROJECT_A), buildContext());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.controllerCheckpoint.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['empty body', {}],
    ['missing tickedAt', { ...validBody, tickedAt: undefined }],
    ['missing activityCursor', { ...validBody, activityCursor: undefined }],
    ['missing pendingActionIds', { ...validBody, pendingActionIds: undefined }],
    ['missing confirmedActionIds', { ...validBody, confirmedActionIds: undefined }],
    ['missing retryCounters', { ...validBody, retryCounters: undefined }],
    ['missing lastLaneState', { ...validBody, lastLaneState: undefined }],
  ])('returns 400 VALIDATION_ERROR when %s', async (_label, body) => {
    mockPrisma.mission.findFirst.mockResolvedValue({
      id: MISSION_ID,
      projectId: PROJECT_A,
    });

    const res = await POST(buildPostRequest(PROJECT_A, body), buildContext());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.controllerCheckpoint.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['activityCursor is a string', { ...validBody, activityCursor: 'seven' }],
    ['pendingActionIds is not an array', { ...validBody, pendingActionIds: 'not-an-array' }],
    ['confirmedActionIds contains a non-string', { ...validBody, confirmedActionIds: [1, 2, 3] }],
    ['retryCounters is not an object', { ...validBody, retryCounters: [1, 2, 3] }],
    ['lastLaneState value is neither "idle" nor "busy"', { ...validBody, lastLaneState: { 'murdock-1': 'sleeping' } }],
  ])('returns 400 VALIDATION_ERROR when %s', async (_label, body) => {
    mockPrisma.mission.findFirst.mockResolvedValue({
      id: MISSION_ID,
      projectId: PROJECT_A,
    });

    const res = await POST(buildPostRequest(PROJECT_A, body), buildContext());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.controllerCheckpoint.upsert).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when X-Project-ID header is missing', async () => {
    const req = new Request(
      `http://localhost:3000/api/controller-checkpoint/${MISSION_ID}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      }
    );

    const res = await POST(req, buildContext());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.controllerCheckpoint.upsert).not.toHaveBeenCalled();
  });

  it('scopes the upsert by X-Project-ID — project B cannot upsert against project A\'s mission', async () => {
    // From project B's perspective, the mission (which belongs to project A)
    // is not visible. The route must NOT create or overwrite a checkpoint
    // for that mission under project B's credentials.
    mockPrisma.mission.findFirst.mockResolvedValue(null);

    const res = await POST(buildPostRequest(PROJECT_B, validBody), buildContext());

    expect(res.status).toBe(404);
    expect(mockPrisma.controllerCheckpoint.upsert).not.toHaveBeenCalled();

    // The mission lookup must have been scoped to project-b.
    expect(mockPrisma.mission.findFirst).toHaveBeenCalled();
    const callArgs = mockPrisma.mission.findFirst.mock.calls[0][0];
    const whereJson = JSON.stringify(callArgs.where);
    expect(whereJson).toContain(MISSION_ID);
    expect(whereJson).toContain(PROJECT_B);
  });
});

// ============================================================================
// POST /api/controller-checkpoint/:missionId/confirm
// ============================================================================

describe('POST /api/controller-checkpoint/:missionId/confirm', () => {
  beforeEach(resetMocks);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends a new actionId to confirmedActionIds and returns 200 with the updated document', async () => {
    mockPrisma.controllerCheckpoint.findFirst.mockResolvedValue(
      makeDbCheckpoint({ confirmedActionIds: '["c1"]' })
    );
    // Echo the data back so the route's read-after-update path also works.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockPrisma.controllerCheckpoint.update.mockImplementation(async ({ data }: any) =>
      makeDbCheckpoint({ confirmedActionIds: data.confirmedActionIds })
    );

    const res = await POST_CONFIRM(
      buildConfirmRequest(PROJECT_A, { actionId: 'c2' }),
      buildContext()
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // The new actionId is present in the returned document (parsed array).
    expect(json.data.confirmedActionIds).toEqual(['c1', 'c2']);

    // The update payload must encode the appended list as JSON (string column).
    const updateCall = mockPrisma.controllerCheckpoint.update.mock.calls[0][0];
    expect(JSON.parse(updateCall.data.confirmedActionIds)).toEqual(['c1', 'c2']);
  });

  it('deduplicates server-side — posting an actionId that is already confirmed produces no duplicate entry', async () => {
    mockPrisma.controllerCheckpoint.findFirst.mockResolvedValue(
      makeDbCheckpoint({ confirmedActionIds: '["c1","c2"]' })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockPrisma.controllerCheckpoint.update.mockImplementation(async ({ data }: any) =>
      makeDbCheckpoint({ confirmedActionIds: data.confirmedActionIds ?? '["c1","c2"]' })
    );

    const res = await POST_CONFIRM(
      buildConfirmRequest(PROJECT_A, { actionId: 'c1' }),
      buildContext()
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    // The returned list has c1 exactly once.
    expect(json.data.confirmedActionIds).toEqual(['c1', 'c2']);
    expect(
      (json.data.confirmedActionIds as string[]).filter((id) => id === 'c1')
    ).toHaveLength(1);
  });

  it('mutates ONLY confirmedActionIds — other fields are not changed by /confirm', async () => {
    // This is the "only/never" qualifier from the work-item context:
    // "mutates ONLY confirmedActionIds (append + dedupe), leaving other fields untouched."
    const original = makeDbCheckpoint({
      confirmedActionIds: '[]',
      pendingActionIds: '["p1"]',
      activityCursor: 42,
      retryCounters: '{"a-1":3}',
      lastLaneState: '{"murdock-1":"busy"}',
    });
    mockPrisma.controllerCheckpoint.findFirst.mockResolvedValue(original);
    // Spread original then apply only the data argument — any extra field in
    // `data` (e.g. an accidentally-touched tickedAt or activityCursor) would
    // surface in the response and fail the assertions below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockPrisma.controllerCheckpoint.update.mockImplementation(async ({ data }: any) => ({
      ...original,
      ...data,
    }));

    const res = await POST_CONFIRM(
      buildConfirmRequest(PROJECT_A, { actionId: 'c1' }),
      buildContext()
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    // confirmedActionIds has the new entry...
    expect(json.data.confirmedActionIds).toEqual(['c1']);
    // ...and every other field is preserved from the original row.
    expect(json.data.pendingActionIds).toEqual(['p1']);
    expect(json.data.activityCursor).toBe(42);
    expect(json.data.retryCounters).toEqual({ 'a-1': 3 });
    expect(json.data.lastLaneState).toEqual({ 'murdock-1': 'busy' });
  });

  it("returns 404 with {error:'not_found'} when no checkpoint exists for the mission", async () => {
    mockPrisma.controllerCheckpoint.findFirst.mockResolvedValue(null);

    const res = await POST_CONFIRM(
      buildConfirmRequest(PROJECT_A, { actionId: 'c1' }),
      buildContext()
    );

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: 'not_found' });
    expect(mockPrisma.controllerCheckpoint.update).not.toHaveBeenCalled();
  });

  it.each([
    ['actionId is missing', {}],
    ['actionId is null', { actionId: null }],
    ['actionId is a number', { actionId: 42 }],
    ['actionId is an object', { actionId: { id: 'c1' } }],
    ['actionId is an array', { actionId: ['c1'] }],
  ])('returns 400 VALIDATION_ERROR when %s', async (_label, body) => {
    // findFirst returning a checkpoint ensures the route would otherwise be
    // happy to mutate — if validation is skipped, the dispatch reaches update
    // and the not.toHaveBeenCalled assertion below catches it.
    mockPrisma.controllerCheckpoint.findFirst.mockResolvedValue(makeDbCheckpoint());

    const res = await POST_CONFIRM(buildConfirmRequest(PROJECT_A, body), buildContext());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.controllerCheckpoint.update).not.toHaveBeenCalled();
  });

  it('scopes the lookup by X-Project-ID — cross-project /confirm returns 404 without leaking existence', async () => {
    // From project B's perspective, the scoped findFirst returns null. The
    // response must match the "no checkpoint" path (same body, same status).
    mockPrisma.controllerCheckpoint.findFirst.mockResolvedValue(null);

    const res = await POST_CONFIRM(
      buildConfirmRequest(PROJECT_B, { actionId: 'c1' }),
      buildContext()
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    // No write may occur across projects.
    expect(mockPrisma.controllerCheckpoint.update).not.toHaveBeenCalled();

    // The scoped where clause includes project-b.
    const callArgs = mockPrisma.controllerCheckpoint.findFirst.mock.calls[0][0];
    expect(JSON.stringify(callArgs.where)).toContain(PROJECT_B);
  });

  it('returns 400 VALIDATION_ERROR when X-Project-ID header is missing', async () => {
    const req = new Request(
      `http://localhost:3000/api/controller-checkpoint/${MISSION_ID}/confirm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: 'c1' }),
      }
    );

    const res = await POST_CONFIRM(req, buildContext());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.controllerCheckpoint.update).not.toHaveBeenCalled();
  });
});
