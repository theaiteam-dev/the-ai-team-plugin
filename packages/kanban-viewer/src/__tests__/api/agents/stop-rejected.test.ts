import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for outcome='rejected' on POST /api/agents/stop
 *
 * When an agent rejects an item it sends it backward through the pipeline:
 * - Lynch rejects test issues  → returnTo: 'testing'   (Murdock re-runs)
 * - Lynch rejects impl issues  → returnTo: 'implementing' (B.A. re-runs)
 * - Amy flags a code bug       → returnTo: 'implementing' (B.A. re-runs)
 *
 * The API must:
 * 1. Increment rejectionCount on the item
 * 2. Move the item to the stage specified by returnTo
 * 3. If rejectionCount reaches the escalation threshold (2), move to 'blocked' instead
 * 4. Log a WorkLog entry with action='rejected'
 * 5. Return VALIDATION_ERROR when outcome='rejected' but returnTo is missing or invalid
 */

import type { AgentStopRequest } from '@/types/api';
import type { AgentName } from '@/types/agent';

const ESCALATION_THRESHOLD = 2;

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
};

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

// ============ Fixtures ============

function createMockItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'WI-001',
    title: 'Test Feature',
    description: 'Test description',
    type: 'feature',
    priority: 'high',
    stageId: 'review',
    assignedAgent: 'Lynch',
    rejectionCount: 0,
    projectId: 'test-project',
    createdAt: new Date('2026-01-21T10:00:00Z'),
    updatedAt: new Date('2026-01-21T12:00:00Z'),
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function createMockClaim(agentName: string, overrides: Record<string, unknown> = {}) {
  return {
    agentName,
    itemId: 'WI-001',
    claimedAt: new Date('2026-01-21T11:00:00Z'),
    ...overrides,
  };
}

function createMockWorkLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    agent: 'Lynch',
    action: 'rejected',
    summary: 'Tests are wrong',
    timestamp: new Date('2026-01-21T14:00:00Z'),
    itemId: 'WI-001',
    ...overrides,
  };
}

function createRequest(body: AgentStopRequest & { returnTo?: string }): NextRequest {
  return new NextRequest('http://localhost:3000/api/agents/stop', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Project-ID': 'test-project',
    },
    body: JSON.stringify(body),
  });
}

function setupSuccessfulReject(agent: AgentName, stageId: string, rejectionCount = 0) {
  const item = createMockItem({ stageId, assignedAgent: agent, rejectionCount });
  const claim = createMockClaim(agent);
  const workLog = createMockWorkLog({ agent });

  mockPrisma.item.findFirst.mockResolvedValue(item);
  mockPrisma.agentClaim.findFirst.mockResolvedValue(claim);
  mockPrisma.agentClaim.delete.mockResolvedValue(claim);
  mockPrisma.workLog.create.mockResolvedValue(workLog);
  mockPrisma.item.update.mockResolvedValue({
    ...item,
    assignedAgent: null,
    rejectionCount: rejectionCount + 1,
  });

  return { item, claim, workLog };
}

// ============ Tests ============

describe('POST /api/agents/stop — outcome=rejected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validation', () => {
    it('should return 400 when outcome=rejected but returnTo is missing', async () => {
      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Lynch',
        summary: 'Tests are wrong',
        outcome: 'rejected',
        // returnTo intentionally omitted
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when returnTo is not a valid pipeline stage', async () => {
      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Lynch',
        summary: 'Tests are wrong',
        outcome: 'rejected',
        returnTo: 'not-a-stage',
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when returnTo is provided without outcome=rejected', async () => {
      setupSuccessfulReject('Lynch', 'review');

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Lynch',
        summary: 'Done',
        outcome: 'completed',
        returnTo: 'testing',
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('first rejection (rejectionCount goes from 0 → 1)', () => {
    it('Lynch rejecting for bad tests sends item to testing stage', async () => {
      setupSuccessfulReject('Lynch', 'review', 0);

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Lynch',
        summary: 'Test coverage is insufficient',
        outcome: 'rejected',
        returnTo: 'testing',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nextStage).toBe('testing');
      expect(data.data.rejectionCount).toBe(1);
      expect(data.data.escalated).toBe(false);
    });

    it('Lynch rejecting for bad impl sends item to implementing stage', async () => {
      setupSuccessfulReject('Lynch', 'review', 0);

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Lynch',
        summary: 'Implementation does not match spec',
        outcome: 'rejected',
        returnTo: 'implementing',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nextStage).toBe('implementing');
      expect(data.data.rejectionCount).toBe(1);
      expect(data.data.escalated).toBe(false);
    });

    it('Amy flagging a code bug sends item back to implementing', async () => {
      setupSuccessfulReject('Amy', 'probing', 0);

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Amy',
        summary: 'FLAG: requireOk crashes on plain-text error body',
        outcome: 'rejected',
        returnTo: 'implementing',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nextStage).toBe('implementing');
      expect(data.data.rejectionCount).toBe(1);
      expect(data.data.escalated).toBe(false);
    });
  });

  describe('escalation (rejectionCount reaches threshold)', () => {
    it(`should move item to blocked when rejectionCount reaches ${ESCALATION_THRESHOLD}`, async () => {
      // Item already has 1 rejection; this is the second → should escalate
      const rejectionCount = ESCALATION_THRESHOLD - 1;
      setupSuccessfulReject('Lynch', 'review', rejectionCount);
      // Update mock to reflect escalation
      mockPrisma.item.update.mockResolvedValue(
        createMockItem({ rejectionCount: ESCALATION_THRESHOLD, stageId: 'blocked', assignedAgent: null })
      );

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Lynch',
        summary: 'Still broken after two attempts',
        outcome: 'rejected',
        returnTo: 'implementing',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.nextStage).toBe('blocked');
      expect(data.data.escalated).toBe(true);
      expect(data.data.rejectionCount).toBe(ESCALATION_THRESHOLD);
    });
  });

  describe('database operations', () => {
    it('should increment rejectionCount on the item', async () => {
      setupSuccessfulReject('Lynch', 'review', 0);

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Lynch',
        summary: 'Bad tests',
        outcome: 'rejected',
        returnTo: 'testing',
      });

      await POST(request);

      expect(mockPrisma.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rejectionCount: { increment: 1 },
          }),
        })
      );
    });

    it('should release the claim on rejection', async () => {
      setupSuccessfulReject('Lynch', 'review', 0);

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Lynch',
        summary: 'Bad tests',
        outcome: 'rejected',
        returnTo: 'testing',
      });

      await POST(request);

      expect(mockPrisma.agentClaim.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { itemId: 'WI-001' } })
      );
    });

    it('should log a WorkLog entry with action=rejected', async () => {
      setupSuccessfulReject('Lynch', 'review', 0);

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Lynch',
        summary: 'Test assertions are flipped',
        outcome: 'rejected',
        returnTo: 'testing',
      });

      await POST(request);

      expect(mockPrisma.workLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agent: 'Lynch',
            action: 'rejected',
            summary: 'Test assertions are flipped',
            itemId: 'WI-001',
          }),
        })
      );
    });

    it('should clear assignedAgent on the item', async () => {
      setupSuccessfulReject('Amy', 'probing', 0);

      const { POST } = await import('@/app/api/agents/stop/route');
      const request = createRequest({
        itemId: 'WI-001',
        agent: 'Amy',
        summary: 'FLAG: null deref in edge case',
        outcome: 'rejected',
        returnTo: 'implementing',
      });

      await POST(request);

      expect(mockPrisma.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignedAgent: null,
          }),
        })
      );
    });
  });
});
