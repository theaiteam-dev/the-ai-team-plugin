import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for the `advance` flag on POST /api/agents/stop
 *
 * Behavior:
 * - advance=true (default): release claim and record work log first, then check WIP limits.
 *   If the target stage is at capacity, returns 200 with wipExceeded=true and blockedStage
 *   set — the item stays in its current stage but work is always recorded.
 * - advance=false: skip stage transition entirely — only clear claim and log work.
 */

import type { AgentStopRequest } from '@/types/api';

// Mock Prisma client with $transaction support for WIP checking
const mockPrisma = {
  item: {
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  agentClaim: {
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  workLog: {
    create: vi.fn(),
  },
  stage: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => {
    return callback(mockPrisma);
  }),
};

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

// ============ Test Data Fixtures ============

function createMockItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'WI-001',
    title: 'Test Feature',
    description: 'Test description',
    type: 'feature',
    priority: 'high',
    stageId: 'testing',
    assignedAgent: 'Murdock',
    rejectionCount: 0,
    projectId: 'test-project',
    createdAt: new Date('2026-01-21T10:00:00Z'),
    updatedAt: new Date('2026-01-21T12:00:00Z'),
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function createMockClaim(overrides: Record<string, unknown> = {}) {
  return {
    agentName: 'Murdock',
    itemId: 'WI-001',
    claimedAt: new Date('2026-01-21T11:00:00Z'),
    ...overrides,
  };
}

function createMockWorkLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    agent: 'Murdock',
    action: 'completed',
    summary: 'Finished work',
    timestamp: new Date('2026-01-21T14:00:00Z'),
    itemId: 'WI-001',
    ...overrides,
  };
}

function createMockStage(id: string, wipLimit: number | null = 3) {
  return { id, name: id, order: 0, wipLimit };
}

function createRequest(body: AgentStopRequest & { advance?: boolean }): NextRequest {
  return new NextRequest('http://localhost:3000/api/agents/stop', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Project-ID': 'test-project',
    },
    body: JSON.stringify(body),
  });
}

function setupMocksForSuccessfulStop(agentName = 'Murdock', stageId = 'testing') {
  const item = createMockItem({ stageId, assignedAgent: agentName });
  const claim = createMockClaim({ agentName });
  const workLog = createMockWorkLog({ agent: agentName });

  mockPrisma.item.findFirst.mockResolvedValue(item);
  mockPrisma.agentClaim.findFirst.mockResolvedValue(claim);
  mockPrisma.agentClaim.delete.mockResolvedValue(claim);
  mockPrisma.workLog.create.mockResolvedValue(workLog);
  mockPrisma.item.update.mockResolvedValue({ ...item, assignedAgent: null });

  return { item, claim, workLog };
}

// ============ advance flag tests ============

describe('POST /api/agents/stop — advance flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('advance=false (skip stage transition)', () => {
    it('should clear the claim and log work without moving to next stage', async () => {
      setupMocksForSuccessfulStop();

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Tests written',
        advance: false,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      // Claim must be released
      expect(mockPrisma.agentClaim.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { itemId: 'WI-001' } })
      );

      // Work log must be created
      expect(mockPrisma.workLog.create).toHaveBeenCalled();

      // Item must NOT have its stageId changed
      const updateCall = mockPrisma.item.update.mock.calls[0];
      expect(updateCall[0].data.stageId).toBeUndefined();
    });

    it('should succeed even when the target stage is at WIP capacity', async () => {
      setupMocksForSuccessfulStop();
      // Stage is over WIP limit — advance=false should not care
      mockPrisma.stage.findUnique.mockResolvedValue(createMockStage('implementing', 3));
      mockPrisma.item.count.mockResolvedValue(3); // at limit

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Tests written',
        advance: false,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe('advance=true (default) — WIP limit checking', () => {
    it('should move to next stage when target stage is under WIP limit', async () => {
      setupMocksForSuccessfulStop();
      mockPrisma.stage.findUnique.mockResolvedValue(createMockStage('implementing', 3));
      mockPrisma.item.count.mockResolvedValue(1); // under limit

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Tests written',
        advance: true,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nextStage).toBe('implementing');
    });

    it('should return 200 with wipExceeded when target stage is at capacity', async () => {
      setupMocksForSuccessfulStop();
      mockPrisma.stage.findUnique.mockResolvedValue(createMockStage('implementing', 3));
      mockPrisma.item.count.mockResolvedValue(3); // at limit

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Tests written',
        // advance defaults to true
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Work log must still be created
      expect(mockPrisma.workLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agent: 'Murdock',
            summary: 'Tests written',
            action: 'completed',
            itemId: 'WI-001',
          }),
        })
      );

      // Claim must still be released
      expect(mockPrisma.agentClaim.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { itemId: 'WI-001' } })
      );

      // Item should NOT advance — stays in current stage
      const updateCall = mockPrisma.item.update.mock.calls[0];
      expect(updateCall[0].data.stageId).toBeUndefined();
      expect(updateCall[0].data.assignedAgent).toBeNull();

      // Response indicates WIP was exceeded and which stage was blocked
      expect(data.data.wipExceeded).toBe(true);
      expect(data.data.blockedStage).toBe('implementing');
      expect(data.data.nextStage).toBe('testing'); // stays at current stage
    });
  });
});
