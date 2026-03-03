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
  },
  agentClaim: {
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  workLog: {
    create: vi.fn(),
  },
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
});
