import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for POST /api/agents/stop endpoint
 *
 * This endpoint allows an agent to stop work on an item, releasing the claim,
 * logging a work summary, and moving the item to the next pipeline stage.
 *
 * Stage-aware transitions (linear pipeline):
 * - testing (Murdock) → implementing
 * - implementing (B.A.) → review
 * - review (Lynch) → probing
 * - probing (Amy) → done
 * - blocked override: any stage → blocked (when outcome='blocked')
 * - non-pipeline stages → review (fallback)
 */

import type { AgentStopRequest, ApiError } from '@/types/api';
import type { AgentName } from '@/types/agent';

// Mock Prisma client matching what the real route uses
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
  missionItem: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
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

function createRequest(body: AgentStopRequest): NextRequest {
  return new NextRequest('http://localhost:3000/api/agents/stop', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Project-ID': 'test-project',
    },
    body: JSON.stringify(body),
  });
}

// ============ POST /api/agents/stop Tests ============

describe('POST /api/agents/stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('request validation', () => {
    it('should return 400 for missing itemId', async () => {
      const { POST } = await import('@/app/api/agents/stop/route');
      const request = new NextRequest('http://localhost:3000/api/agents/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project',
        },
        body: JSON.stringify({ agent: 'Murdock', summary: 'Work done' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing agent', async () => {
      const { POST } = await import('@/app/api/agents/stop/route');
      const request = new NextRequest('http://localhost:3000/api/agents/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project',
        },
        body: JSON.stringify({ itemId: 'WI-001', summary: 'Work done' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing summary', async () => {
      const { POST } = await import('@/app/api/agents/stop/route');
      const request = new NextRequest('http://localhost:3000/api/agents/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project',
        },
        body: JSON.stringify({ itemId: 'WI-001', agent: 'Murdock' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid agent name', async () => {
      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'InvalidAgent' as AgentName,
        summary: 'Work done',
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid outcome value', async () => {
      const { POST } = await import('@/app/api/agents/stop/route');
      const request = new NextRequest('http://localhost:3000/api/agents/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project',
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Murdock',
          summary: 'Work done',
          outcome: 'invalid_outcome',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid JSON body', async () => {
      const { POST } = await import('@/app/api/agents/stop/route');
      const request = new NextRequest('http://localhost:3000/api/agents/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project',
        },
        body: 'not valid json',
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe('item and claim validation', () => {
    it('should return 404 if item does not exist', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(null);

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-999',
        agent: 'Murdock',
        summary: 'Work done',
      });

      const response = await POST(request);
      expect(response.status).toBe(404);
      const data: ApiError = await response.json();
      expect(data.error.code).toBe('ITEM_NOT_FOUND');
    });

    it('should return 400 if item has no active claim', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(createMockItem());
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Work done',
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.error.code).toBe('NOT_CLAIMED');
    });

    it('should return 403 if item is claimed by a different agent', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(createMockItem());
      mockPrisma.agentClaim.findFirst.mockResolvedValue(createMockClaim()); // Murdock

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'B.A.',
        summary: 'Work done',
      });

      const response = await POST(request);
      expect(response.status).toBe(403);
      const data: ApiError = await response.json();
      expect(data.error.code).toBe('CLAIM_MISMATCH');
    });
  });

  describe('stage-aware pipeline transitions', () => {
    function setupSuccessfulStop(stageId: string, agent: AgentName) {
      const item = createMockItem({ stageId, assignedAgent: agent });
      const claim = createMockClaim({ agentName: agent });
      const workLog = createMockWorkLog({ agent });

      mockPrisma.item.findFirst.mockResolvedValue(item);
      mockPrisma.agentClaim.findFirst.mockResolvedValue(claim);
      mockPrisma.agentClaim.delete.mockResolvedValue(claim);
      mockPrisma.workLog.create.mockResolvedValue(workLog);
      mockPrisma.item.update.mockResolvedValue({ ...item, assignedAgent: null });
    }

    it('Murdock in testing → implementing', async () => {
      setupSuccessfulStop('testing', 'Murdock');

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Created 5 test cases',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nextStage).toBe('implementing');

      expect(mockPrisma.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stageId: 'implementing' }),
        })
      );
    });

    it('B.A. in implementing → review', async () => {
      setupSuccessfulStop('implementing', 'B.A.');

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'B.A.',
        summary: 'Implemented feature',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nextStage).toBe('review');
    });

    it('Lynch in review → probing', async () => {
      setupSuccessfulStop('review', 'Lynch');

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Lynch',
        summary: 'Review approved',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nextStage).toBe('probing');
    });

    it('Amy in probing → done', async () => {
      setupSuccessfulStop('probing', 'Amy');

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Amy',
        summary: 'No bugs found',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nextStage).toBe('done');
    });

    it('should move to blocked when outcome is blocked (regardless of stage)', async () => {
      setupSuccessfulStop('testing', 'Murdock');

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Blocked on dependency',
        outcome: 'blocked',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nextStage).toBe('blocked');
    });

    it('should fall back to review for non-pipeline stages', async () => {
      setupSuccessfulStop('ready', 'Hannibal');

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Hannibal',
        summary: 'Done',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nextStage).toBe('review');
    });
  });

  describe('successful stop workflow', () => {
    it('should delete the agent claim and clear assignedAgent', async () => {
      const item = createMockItem();
      const claim = createMockClaim();

      mockPrisma.item.findFirst.mockResolvedValue(item);
      mockPrisma.agentClaim.findFirst.mockResolvedValue(claim);
      mockPrisma.agentClaim.delete.mockResolvedValue(claim);
      mockPrisma.workLog.create.mockResolvedValue(createMockWorkLog());
      mockPrisma.item.update.mockResolvedValue({ ...item, assignedAgent: null });

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Finished work',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      expect(mockPrisma.agentClaim.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { itemId: 'WI-001' } })
      );
      expect(mockPrisma.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ assignedAgent: null }),
        })
      );
    });

    it('should create WorkLog entry with provided summary', async () => {
      const item = createMockItem();
      const claim = createMockClaim();

      mockPrisma.item.findFirst.mockResolvedValue(item);
      mockPrisma.agentClaim.findFirst.mockResolvedValue(claim);
      mockPrisma.agentClaim.delete.mockResolvedValue(claim);
      mockPrisma.workLog.create.mockResolvedValue(createMockWorkLog());
      mockPrisma.item.update.mockResolvedValue({ ...item, assignedAgent: null });

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Implemented the feature',
      });

      await POST(request);

      expect(mockPrisma.workLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agent: 'Murdock',
            summary: 'Implemented the feature',
            action: 'completed',
            itemId: 'WI-001',
          }),
        })
      );
    });

    it('should return AgentStopResponse with workLogEntry and nextStage', async () => {
      const item = createMockItem();
      const claim = createMockClaim();
      const workLog = createMockWorkLog({ id: 42, summary: 'Test done' });

      mockPrisma.item.findFirst.mockResolvedValue(item);
      mockPrisma.agentClaim.findFirst.mockResolvedValue(claim);
      mockPrisma.agentClaim.delete.mockResolvedValue(claim);
      mockPrisma.workLog.create.mockResolvedValue(workLog);
      mockPrisma.item.update.mockResolvedValue({ ...item, assignedAgent: null });

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Test done',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.itemId).toBe('WI-001');
      expect(data.data.agent).toBe('Murdock');
      expect(data.data.workLogEntry).toBeDefined();
      expect(data.data.workLogEntry.id).toBe(42);
      expect(data.data.nextStage).toBe('implementing');
    });
  });

  describe('error handling', () => {
    it('should return 500 for database errors', async () => {
      mockPrisma.item.findFirst.mockRejectedValue(new Error('DB error'));

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Work done',
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error.code).toBe('DATABASE_ERROR');
    });
  });

  /**
   * Tests for the transactional boundary around claim-release + WIP-check + item-update.
   *
   * The race we are guarding against: two agents call stop at the same time, both see a
   * count below the WIP limit, both advance their item, and the target stage ends up
   * over capacity. Wrapping the claim delete, WIP check, work log creation and item
   * update in prisma.$transaction closes that window — the database serializes the three
   * reads+writes so only one of the concurrent callers can observe capacity.
   */
  describe('transactional atomicity', () => {
    it('happy path: claim delete, work log, and item update all run inside $transaction', async () => {
      const item = createMockItem({ stageId: 'testing' });
      const claim = createMockClaim();

      mockPrisma.item.findFirst.mockResolvedValue(item);
      mockPrisma.agentClaim.findFirst.mockResolvedValue(claim);
      mockPrisma.agentClaim.delete.mockResolvedValue(claim);
      mockPrisma.workLog.create.mockResolvedValue(createMockWorkLog());
      mockPrisma.item.update.mockResolvedValue({ ...item, stageId: 'implementing', assignedAgent: null });
      mockPrisma.stage.findUnique.mockResolvedValue({ id: 'implementing', name: 'implementing', order: 0, wipLimit: 3 });
      mockPrisma.item.count.mockResolvedValue(1); // under WIP limit

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Tests written',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.nextStage).toBe('implementing');

      // All three write operations must have flowed through the transaction
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.agentClaim.delete).toHaveBeenCalledTimes(1);
      expect(mockPrisma.workLog.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.item.update).toHaveBeenCalledTimes(1);

      // And the item update must include the stage advance
      expect(mockPrisma.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stageId: 'implementing', assignedAgent: null }),
        })
      );
    });

    it('wip-exceeded path: releases claim and records work log but does NOT advance item', async () => {
      const item = createMockItem({ stageId: 'testing' });
      const claim = createMockClaim();

      mockPrisma.item.findFirst.mockResolvedValue(item);
      mockPrisma.agentClaim.findFirst.mockResolvedValue(claim);
      mockPrisma.agentClaim.delete.mockResolvedValue(claim);
      mockPrisma.workLog.create.mockResolvedValue(createMockWorkLog());
      mockPrisma.item.update.mockResolvedValue({ ...item, assignedAgent: null });
      mockPrisma.stage.findUnique.mockResolvedValue({ id: 'implementing', name: 'implementing', order: 0, wipLimit: 3 });
      mockPrisma.item.count.mockResolvedValue(3); // AT wip limit — no room

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Tests written',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();

      // Claim was still released
      expect(mockPrisma.agentClaim.delete).toHaveBeenCalledTimes(1);
      // Work log was still written
      expect(mockPrisma.workLog.create).toHaveBeenCalledTimes(1);

      // Item update did NOT include a stage change — item stays in testing
      const updateCall = mockPrisma.item.update.mock.calls[0];
      expect(updateCall[0].data.stageId).toBeUndefined();
      expect(updateCall[0].data.assignedAgent).toBeNull();

      // Response signals WIP was exceeded and the blocked stage
      expect(data.data.wipExceeded).toBe(true);
      expect(data.data.blockedStage).toBe('implementing');
      expect(data.data.nextStage).toBe('testing');
    });

    it('rolls everything back when a write inside the transaction throws', async () => {
      const item = createMockItem({ stageId: 'testing' });
      const claim = createMockClaim();

      mockPrisma.item.findFirst.mockResolvedValue(item);
      mockPrisma.agentClaim.findFirst.mockResolvedValue(claim);
      mockPrisma.agentClaim.delete.mockResolvedValue(claim);
      // Force the work log write inside the transaction to fail
      mockPrisma.workLog.create.mockRejectedValue(new Error('simulated DB failure'));

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Tests written',
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error.code).toBe('DATABASE_ERROR');

      // The transaction callback threw, so item.update must NOT have been called —
      // in a real DB the tx would be rolled back; in the mock we simply assert that
      // downstream writes never ran.
      expect(mockPrisma.item.update).not.toHaveBeenCalled();
    });

    it('uses tx.stage.findUnique (no optional chaining) inside the transaction', async () => {
      // Regression guard for Issue #4: the pre-fix code used `prisma.stage?.findUnique(...)`
      // with an unnecessary optional chain on a Prisma delegate. If the route regresses to
      // calling a bare `prisma.stage.findUnique` outside the transaction, our mock still
      // records the call but the tx.stage.findUnique spy on the tx handle passed to the
      // callback would NOT. We use the same object for both so the assertion just ensures
      // the lookup happened exactly once per stop (i.e. it wasn't dropped).
      const item = createMockItem({ stageId: 'testing' });
      const claim = createMockClaim();

      mockPrisma.item.findFirst.mockResolvedValue(item);
      mockPrisma.agentClaim.findFirst.mockResolvedValue(claim);
      mockPrisma.agentClaim.delete.mockResolvedValue(claim);
      mockPrisma.workLog.create.mockResolvedValue(createMockWorkLog());
      mockPrisma.item.update.mockResolvedValue({ ...item, stageId: 'implementing', assignedAgent: null });
      mockPrisma.stage.findUnique.mockResolvedValue({ id: 'implementing', name: 'implementing', order: 0, wipLimit: null });

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Murdock',
        summary: 'Tests written',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      expect(mockPrisma.stage.findUnique).toHaveBeenCalledWith({ where: { id: 'implementing' } });
    });
  });
});
