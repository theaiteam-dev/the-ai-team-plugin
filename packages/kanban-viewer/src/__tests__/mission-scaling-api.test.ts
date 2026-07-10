import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for mission scaling metadata storage and retrieval (WI-042).
 *
 * The Mission model gains a scalingRationale String? field. Routes expose it:
 * - POST /api/missions: optional scalingRationale in request body
 * - PATCH /api/missions/:id: update scalingRationale after creation
 * - GET /api/missions: include parsed scalingRationale in list response
 * - GET /api/missions/:id: include parsed scalingRationale in single-mission response
 */

// ============ Mock Setup ============

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

const SCALING_RATIONALE = {
  instanceCount: 2,
  depGraphMaxPerStage: 3,
  memoryBudgetCeiling: 4,
  bindingConstraint: 'memory',
  concurrencyOverride: null,
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
  ...overrides,
});

const makeRequest = (method: string, url: string, body?: unknown, headers?: Record<string, string>) =>
  new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'ai-team', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

// ============ Tests ============

describe('POST /api/missions — scalingRationale', () => {
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

  it('persists scalingRationale as JSON string when provided', async () => {
    mockPrisma.mission.create.mockResolvedValue(
      baseMission({ scalingRationale: JSON.stringify(SCALING_RATIONALE) })
    );

    const { POST } = await import('@/app/api/missions/route');
    const response = await POST(
      makeRequest('POST', 'http://localhost:3000/api/missions', {
        name: 'Scaling Mission',
        prdPath: '/prd/test.md',
        scalingRationale: SCALING_RATIONALE,
      })
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.mission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scalingRationale: JSON.stringify(SCALING_RATIONALE),
        }),
      })
    );
  });

  it('creates mission successfully when scalingRationale is omitted', async () => {
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
  });
});

describe('PATCH /api/missions/:id — update scalingRationale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'ai-team', name: 'ai-team', createdAt: new Date() });
  });

  it('updates scalingRationale on an existing mission', async () => {
    mockPrisma.mission.findUnique.mockResolvedValue(baseMission());
    mockPrisma.mission.update.mockResolvedValue(
      baseMission({ scalingRationale: JSON.stringify(SCALING_RATIONALE) })
    );

    const { PATCH } = await import('@/app/api/missions/[missionId]/route');
    const response = await PATCH(
      makeRequest('PATCH', 'http://localhost:3000/api/missions/M-20260401-001', {
        scalingRationale: SCALING_RATIONALE,
      }),
      { params: Promise.resolve({ missionId: 'M-20260401-001' }) }
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.mission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'M-20260401-001', projectId: 'ai-team' },
        data: expect.objectContaining({
          scalingRationale: JSON.stringify(SCALING_RATIONALE),
        }),
      })
    );
  });

  it('returns 404 when mission does not exist', async () => {
    mockPrisma.mission.findUnique.mockResolvedValue(null);

    const { PATCH } = await import('@/app/api/missions/[missionId]/route');
    const response = await PATCH(
      makeRequest('PATCH', 'http://localhost:3000/api/missions/M-NOTFOUND', {
        scalingRationale: SCALING_RATIONALE,
      }),
      { params: Promise.resolve({ missionId: 'M-NOTFOUND' }) }
    );

    expect(response.status).toBe(404);
  });
});

describe('GET /api/missions — parsed scalingRationale in list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns parsed scalingRationale object (not raw JSON string) in mission list', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([
      baseMission({ scalingRationale: JSON.stringify(SCALING_RATIONALE) }),
    ]);

    const { GET } = await import('@/app/api/missions/route');
    const response = await GET(
      makeRequest('GET', 'http://localhost:3000/api/missions')
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].scalingRationale).toEqual(SCALING_RATIONALE);
  });

  it('returns null scalingRationale when not set', async () => {
    mockPrisma.mission.findMany.mockResolvedValue([baseMission()]);

    const { GET } = await import('@/app/api/missions/route');
    const response = await GET(
      makeRequest('GET', 'http://localhost:3000/api/missions')
    );

    const body = await response.json();
    expect(body.data[0].scalingRationale).toBeNull();
  });
});

describe('GET /api/missions/current — parsed scalingRationale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns parsed scalingRationale object (not raw JSON string) from current mission', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(
      baseMission({ scalingRationale: JSON.stringify(SCALING_RATIONALE) })
    );

    const { GET } = await import('@/app/api/missions/current/route');
    const response = await GET(
      makeRequest('GET', 'http://localhost:3000/api/missions/current')
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.scalingRationale).toEqual(SCALING_RATIONALE);
  });
});

describe('GET /api/missions/:id — parsed scalingRationale in single mission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns parsed scalingRationale object in single-mission response', async () => {
    mockPrisma.mission.findUnique.mockResolvedValue(
      baseMission({ scalingRationale: JSON.stringify(SCALING_RATIONALE) })
    );

    const { GET } = await import('@/app/api/missions/[missionId]/route');
    const response = await GET(
      makeRequest('GET', 'http://localhost:3000/api/missions/M-20260401-001'),
      { params: Promise.resolve({ missionId: 'M-20260401-001' }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.scalingRationale).toEqual(SCALING_RATIONALE);
  });
});

describe('POST /api/scaling/compute — persist to active mission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Compute inputs: no items → depGraphMax defaults to 1; a testing stage WIP.
    mockPrisma.item.findMany.mockResolvedValue([]);
    mockPrisma.stage.findUnique.mockResolvedValue({ id: 'testing', wipLimit: 3 });
  });

  it('persists the rationale to the active mission when persist=true', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'M-20260401-001' });
    mockPrisma.mission.update.mockResolvedValue(baseMission());

    const { POST } = await import('@/app/api/scaling/compute/route');
    const response = await POST(
      makeRequest('POST', 'http://localhost:3000/api/scaling/compute', { persist: true })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.persisted).toBe(true);
    expect(body.missionId).toBe('M-20260401-001');
    expect(mockPrisma.mission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'M-20260401-001' },
        data: { scalingRationale: expect.any(String) },
      })
    );
    // What is saved is exactly the rationale returned to the caller (the "how").
    const saved = mockPrisma.mission.update.mock.calls[0][0].data.scalingRationale;
    expect(JSON.parse(saved)).toEqual(body.data);
  });

  it('reports persisted=false and writes nothing when no active mission exists', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(null);

    const { POST } = await import('@/app/api/scaling/compute/route');
    const response = await POST(
      makeRequest('POST', 'http://localhost:3000/api/scaling/compute', { persist: true })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.persisted).toBe(false);
    expect(body.missionId).toBeNull();
    expect(mockPrisma.mission.update).not.toHaveBeenCalled();
  });

  it('does not touch the mission when persist is omitted (what-if compute)', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'M-should-not-be-read' });

    const { POST } = await import('@/app/api/scaling/compute/route');
    const response = await POST(
      makeRequest('POST', 'http://localhost:3000/api/scaling/compute', {})
    );
    const body = await response.json();

    expect(body.persisted).toBe(false);
    expect(mockPrisma.mission.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.mission.update).not.toHaveBeenCalled();
  });
});
