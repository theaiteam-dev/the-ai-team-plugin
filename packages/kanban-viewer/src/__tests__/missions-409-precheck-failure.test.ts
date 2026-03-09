import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for WI-461: POST /api/missions 409 guard for precheck_failure state.
 *
 * When an active `precheck_failure` mission exists and `force` is NOT set,
 * the endpoint MUST return 409 (Conflict) instead of silently archiving the
 * mission. This protects planning work that would otherwise be lost.
 *
 * When `force: true` is provided, the old mission is archived and a new one
 * is created normally.
 */

// ============ Mock Setup ============

const mockPrisma = vi.hoisted(() => ({
  mission: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  missionItem: {
    findMany: vi.fn(),
  },
  item: {
    updateMany: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

// ============ Fixtures ============

const createMission = (overrides: Record<string, unknown> = {}) => ({
  id: 'M-20260306-001',
  name: 'Test Mission',
  state: 'running',
  prdPath: '/prd/test.md',
  projectId: 'kanban-viewer',
  startedAt: new Date('2026-03-06T09:00:00Z'),
  completedAt: null,
  archivedAt: null,
  ...overrides,
});

const makePostRequest = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost:3000/api/missions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Project-ID': 'kanban-viewer',
    },
    body: JSON.stringify(body),
  });

// ============ Tests ============

describe('POST /api/missions - 409 guard for precheck_failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockPrisma.$transaction.mockImplementation(async (arg) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(mockPrisma);
    });

    mockPrisma.project.findUnique.mockResolvedValue({
      id: 'kanban-viewer',
      name: 'kanban-viewer',
      createdAt: new Date(),
    });
  });

  it('should return 409 when a precheck_failure mission exists and force is not set', async () => {
    const precheckFailureMission = createMission({ state: 'precheck_failure' });
    mockPrisma.mission.findFirst.mockResolvedValue(precheckFailureMission);

    const { POST } = await import('@/app/api/missions/route');
    const response = await POST(
      makePostRequest({ name: 'New Mission', prdPath: '/prd/new.md' })
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    // Error message must mention precheck_failure so caller knows why they got 409
    expect(JSON.stringify(body.error)).toMatch(/precheck_failure/i);
  });

  it('should create new mission and archive precheck_failure mission when force: true', async () => {
    const precheckFailureMission = createMission({ id: 'M-20260306-001', state: 'precheck_failure' });
    const newMission = createMission({ id: 'M-20260306-002', state: 'initializing' });

    // findFirst is called twice: once to find any non-archived mission (force path),
    // and potentially once for count — mock to return the old mission on the first call
    mockPrisma.mission.findFirst.mockResolvedValue(precheckFailureMission);
    mockPrisma.mission.update.mockResolvedValue({ ...precheckFailureMission, state: 'archived' });
    mockPrisma.missionItem.findMany.mockResolvedValue([]);
    mockPrisma.mission.count.mockResolvedValue(1);
    mockPrisma.mission.create.mockResolvedValue(newMission);

    const { POST } = await import('@/app/api/missions/route');
    const response = await POST(
      makePostRequest({ name: 'New Mission', prdPath: '/prd/new.md', force: true })
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.state).toBe('initializing');

    // Old mission was archived
    expect(mockPrisma.mission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'M-20260306-001' },
        data: expect.objectContaining({ state: 'archived' }),
      })
    );
  });

  it('should still return 409 for an active running mission when force is not set', async () => {
    // Existing behavior: running missions also block creation without force
    const runningMission = createMission({ state: 'running' });
    mockPrisma.mission.findFirst.mockResolvedValue(runningMission);

    const { POST } = await import('@/app/api/missions/route');
    const response = await POST(
      makePostRequest({ name: 'New Mission', prdPath: '/prd/new.md' })
    );

    // Should be 409 (same guard, different state) — NOT silently archiving
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('should return 201 and create mission when no active mission exists', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue(null);
    mockPrisma.mission.count.mockResolvedValue(0);
    mockPrisma.mission.create.mockResolvedValue(
      createMission({ id: 'M-20260306-001', state: 'initializing' })
    );

    const { POST } = await import('@/app/api/missions/route');
    const response = await POST(
      makePostRequest({ name: 'Brand New Mission', prdPath: '/prd/brand-new.md' })
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toMatch(/^M-\d{8}-\d{3}$/);
  });
});
