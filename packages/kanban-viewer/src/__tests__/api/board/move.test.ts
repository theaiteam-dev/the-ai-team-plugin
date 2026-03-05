import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for POST /api/board/move endpoint
 *
 * This endpoint moves work items between stages with full validation:
 * - Validates item exists (ITEM_NOT_FOUND)
 * - Validates stage transition against matrix (INVALID_TRANSITION)
 * - Checks target stage WIP limit (WIP_LIMIT_EXCEEDED unless force=true)
 * - Prevents moving from blocked unless target is ready
 * - Returns MoveItemResponse with updated item, previousStage, and wipStatus
 * - Updates item.updatedAt timestamp
 *
 * 8-Stage A-Team Pipeline transition matrix:
 * - briefings -> ready, blocked
 * - ready -> testing, implementing, probing, blocked, briefings
 * - testing -> implementing, blocked
 * - implementing -> review, blocked
 * - probing -> ready, done, blocked
 * - review -> testing, implementing, probing, blocked
 * - done -> (terminal, no transitions)
 * - blocked -> ready
 */

import type { MoveItemRequest, ApiError } from '@/types/api';
import type { StageId } from '@/types/board';

// Mock data for 8-stage A-Team pipeline with WIP limits
const mockStages = [
  { id: 'briefings', name: 'Briefings', order: 0, wipLimit: null },
  { id: 'ready', name: 'Ready', order: 1, wipLimit: 10 },
  { id: 'testing', name: 'Testing', order: 2, wipLimit: 3 },
  { id: 'implementing', name: 'Implementing', order: 3, wipLimit: 3 },
  { id: 'probing', name: 'Probing', order: 4, wipLimit: 3 },
  { id: 'review', name: 'Review', order: 5, wipLimit: 3 },
  { id: 'done', name: 'Done', order: 6, wipLimit: null },
  { id: 'blocked', name: 'Blocked', order: 7, wipLimit: null },
];

// Mock item in ready stage
const mockItemInReady = {
  id: 'WI-001',
  title: 'Test Item',
  description: 'Test description',
  type: 'feature',
  priority: 'high',
  stageId: 'ready',
  assignedAgent: null,
  rejectionCount: 0,
  createdAt: new Date('2026-01-21T10:00:00Z'),
  updatedAt: new Date('2026-01-21T10:00:00Z'),
  completedAt: null,
  archivedAt: null,
  projectId: 'test-project',
  dependsOn: [],
  workLogs: [],
};

// Mock item in blocked stage
const mockItemInBlocked = {
  ...mockItemInReady,
  id: 'WI-002',
  stageId: 'blocked',
};

// Mock item in done stage
const mockItemInDone = {
  ...mockItemInReady,
  id: 'WI-003',
  stageId: 'done',
  completedAt: new Date('2026-01-21T12:00:00Z'),
};

// Create mock Prisma client
const mockPrisma = {
  item: {
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  stage: {
    findUnique: vi.fn(),
  },
  // Transaction mock that passes the same mock objects to the callback
  $transaction: vi.fn(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => {
    return callback(mockPrisma);
  }),
};

// Mock the db module
vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

describe('POST /api/board/move', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-21T15:00:00Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('request validation', () => {
    it('should accept valid MoveItemRequest body with itemId and toStage', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[2]); // testing
      mockPrisma.item.count.mockResolvedValue(0); // No items in target stage
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      });

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should accept optional force flag', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[2]); // testing at WIP limit
      mockPrisma.item.count.mockResolvedValue(3); // At WIP limit of 3
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      });

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
          force: true,
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should return 400 for missing itemId', async () => {
      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          toStage: 'testing',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing toStage', async () => {
      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid JSON body', async () => {
      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move?projectId=test-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe('item existence validation', () => {
    it('should return ITEM_NOT_FOUND if item does not exist', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(null);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-999',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(404);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('ITEM_NOT_FOUND');
      expect(data.error.message).toContain('WI-999');
    });
  });

  describe('stage transition validation', () => {
    it('should allow valid transition: ready -> testing', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[2]);
      mockPrisma.item.count.mockResolvedValue(0);
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      });

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should allow valid transition: ready -> implementing', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[3]);
      mockPrisma.item.count.mockResolvedValue(0);
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'implementing',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      });

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'implementing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should allow valid transition: ready -> probing', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[4]);
      mockPrisma.item.count.mockResolvedValue(0);
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'probing',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      });

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'probing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should allow valid transition: ready -> briefings', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[0]);
      mockPrisma.item.count.mockResolvedValue(0);
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'briefings',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      });

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'briefings',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should allow valid transition: ready -> blocked', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[7]);
      mockPrisma.item.count.mockResolvedValue(0);
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'blocked',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      });

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'blocked',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should return INVALID_TRANSITION for ready -> done (invalid)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'done',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_TRANSITION');
    });

    it('should return INVALID_TRANSITION for ready -> review (invalid)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'review',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_TRANSITION');
    });

    it('should return INVALID_TRANSITION for done -> any (terminal state)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInDone);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-003',
          toStage: 'review',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_TRANSITION');
    });

    it('should return INVALID_TRANSITION for self-transition (same stage)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'ready',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_TRANSITION');
    });
  });

  describe('blocked stage restrictions', () => {
    it('should allow blocked -> ready transition', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInBlocked);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[1]); // ready
      mockPrisma.item.count.mockResolvedValue(0);
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInBlocked,
        stageId: 'ready',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      });

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-002',
          toStage: 'ready',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should return INVALID_TRANSITION for blocked -> testing (only ready allowed)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInBlocked);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-002',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_TRANSITION');
    });

    it('should return INVALID_TRANSITION for blocked -> done', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInBlocked);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-002',
          toStage: 'done',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_TRANSITION');
    });
  });

  describe('WIP limit validation', () => {
    it('should return WIP_LIMIT_EXCEEDED when target stage is at limit', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[2]); // testing with limit 3
      mockPrisma.item.count.mockResolvedValue(3); // At WIP limit

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('WIP_LIMIT_EXCEEDED');
    });

    it('should allow move when target stage is below WIP limit', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[2]); // testing with limit 3
      mockPrisma.item.count.mockResolvedValue(2); // Below WIP limit
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      });

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should override WIP limit when force=true', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[2]); // testing with limit 3
      mockPrisma.item.count.mockResolvedValue(3); // At WIP limit
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      });

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
          force: true,
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should allow move to stage with null WIP limit (unlimited)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[0]); // briefings with null limit
      mockPrisma.item.count.mockResolvedValue(100); // Many items but unlimited
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'briefings',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      });

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'briefings',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });

  describe('successful response format (MoveItemResponse)', () => {
    it('should return MoveItemResponse with updated item', async () => {
      const updatedItem = {
        ...mockItemInReady,
        stageId: 'testing',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      };
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[2]);
      mockPrisma.item.count.mockResolvedValue(1);
      mockPrisma.item.update.mockResolvedValue(updatedItem);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.item).toBeDefined();
      expect(data.data.item.id).toBe('WI-001');
      expect(data.data.item.stageId).toBe('testing');
    });

    it('should return previousStage in response', async () => {
      const updatedItem = {
        ...mockItemInReady,
        stageId: 'testing',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      };
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[2]);
      mockPrisma.item.count.mockResolvedValue(1);
      mockPrisma.item.update.mockResolvedValue(updatedItem);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.previousStage).toBe('ready');
    });

    it('should return wipStatus in response', async () => {
      const updatedItem = {
        ...mockItemInReady,
        stageId: 'testing',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      };
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[2]); // testing with limit 3
      mockPrisma.item.count.mockResolvedValue(1); // 1 item before move, will be 2 after
      mockPrisma.item.update.mockResolvedValue(updatedItem);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.wipStatus).toBeDefined();
      expect(data.data.wipStatus.stageId).toBe('testing');
      expect(data.data.wipStatus.limit).toBe(3);
      expect(typeof data.data.wipStatus.current).toBe('number');
      expect(typeof data.data.wipStatus.available).toBe('number');
    });

    it('should return null available when stage has no WIP limit', async () => {
      const updatedItem = {
        ...mockItemInReady,
        stageId: 'briefings',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      };
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[0]); // briefings with null limit
      mockPrisma.item.count.mockResolvedValue(10);
      mockPrisma.item.update.mockResolvedValue(updatedItem);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'briefings',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.wipStatus.limit).toBeNull();
      expect(data.data.wipStatus.available).toBeNull();
    });
  });

  describe('updatedAt timestamp', () => {
    it('should update item.updatedAt timestamp when moving', async () => {
      const updatedItem = {
        ...mockItemInReady,
        stageId: 'testing',
        updatedAt: new Date('2026-01-21T15:00:00Z'),
      };
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[2]);
      mockPrisma.item.count.mockResolvedValue(0);
      mockPrisma.item.update.mockResolvedValue(updatedItem);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      await POST(request);

      // Verify Prisma update was called with updatedAt
      expect(mockPrisma.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stageId: 'testing',
            updatedAt: expect.any(Date),
          }),
        })
      );
    });

    it('should return updated item with new updatedAt timestamp', async () => {
      const originalUpdatedAt = new Date('2026-01-21T10:00:00Z');
      const newUpdatedAt = new Date('2026-01-21T15:00:00Z');

      const itemBeforeMove = {
        ...mockItemInReady,
        updatedAt: originalUpdatedAt,
      };

      const updatedItem = {
        ...mockItemInReady,
        stageId: 'testing',
        updatedAt: newUpdatedAt,
      };

      mockPrisma.item.findFirst.mockResolvedValue(itemBeforeMove);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[2]);
      mockPrisma.item.count.mockResolvedValue(0);
      mockPrisma.item.update.mockResolvedValue(updatedItem);

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      const data = await response.json();

      // updatedAt should be different from original
      expect(new Date(data.data.item.updatedAt).getTime()).not.toBe(
        originalUpdatedAt.getTime()
      );
    });
  });

  describe('complete transition matrix coverage', () => {
    // 8-stage A-Team pipeline valid transitions
    const validTransitions: Array<{ from: StageId; to: StageId }> = [
      // briefings transitions
      { from: 'briefings', to: 'ready' },
      { from: 'briefings', to: 'blocked' },
      // ready transitions
      { from: 'ready', to: 'testing' },
      { from: 'ready', to: 'implementing' },
      { from: 'ready', to: 'probing' },
      { from: 'ready', to: 'blocked' },
      { from: 'ready', to: 'briefings' },
      // testing transitions
      { from: 'testing', to: 'implementing' },
      { from: 'testing', to: 'blocked' },
      // implementing transitions
      { from: 'implementing', to: 'review' },
      { from: 'implementing', to: 'blocked' },
      // probing transitions
      { from: 'probing', to: 'ready' },
      { from: 'probing', to: 'done' },
      { from: 'probing', to: 'blocked' },
      // review transitions (review -> done removed: must go through probing)
      { from: 'review', to: 'testing' },
      { from: 'review', to: 'implementing' },
      { from: 'review', to: 'probing' },
      { from: 'review', to: 'blocked' },
      // blocked transitions
      { from: 'blocked', to: 'ready' },
    ];

    for (const { from, to } of validTransitions) {
      it(`should allow valid transition: ${from} -> ${to}`, async () => {
        const itemInStage = { ...mockItemInReady, stageId: from };
        const targetStage = mockStages.find((s) => s.id === to);

        mockPrisma.item.findFirst.mockResolvedValue(itemInStage);
        mockPrisma.stage.findUnique.mockResolvedValue(targetStage);
        mockPrisma.item.count.mockResolvedValue(0);
        mockPrisma.item.update.mockResolvedValue({
          ...itemInStage,
          stageId: to,
          updatedAt: new Date('2026-01-21T15:00:00Z'),
        });

        const { POST } = await import('@/app/api/board/move/route');
        const request = new NextRequest('http://localhost:3000/api/board/move', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Project-ID': 'test-project'
          },
          body: JSON.stringify({
            itemId: 'WI-001',
            toStage: to,
          } as MoveItemRequest),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
      });
    }

    // 8-stage A-Team pipeline invalid transitions
    const invalidTransitions: Array<{ from: StageId; to: StageId }> = [
      // briefings invalid
      { from: 'briefings', to: 'testing' },
      { from: 'briefings', to: 'implementing' },
      { from: 'briefings', to: 'probing' },
      { from: 'briefings', to: 'review' },
      { from: 'briefings', to: 'done' },
      // ready invalid
      { from: 'ready', to: 'review' },
      { from: 'ready', to: 'done' },
      // testing invalid
      { from: 'testing', to: 'briefings' },
      { from: 'testing', to: 'ready' },
      { from: 'testing', to: 'review' },
      { from: 'testing', to: 'probing' },
      { from: 'testing', to: 'done' },
      // implementing invalid
      { from: 'implementing', to: 'briefings' },
      { from: 'implementing', to: 'ready' },
      { from: 'implementing', to: 'testing' },
      { from: 'implementing', to: 'probing' },
      { from: 'implementing', to: 'done' },
      // probing invalid
      { from: 'probing', to: 'briefings' },
      { from: 'probing', to: 'testing' },
      { from: 'probing', to: 'implementing' },
      { from: 'probing', to: 'review' },
      // review invalid (review -> done is invalid: must go through probing first)
      { from: 'review', to: 'done' },
      { from: 'review', to: 'briefings' },
      { from: 'review', to: 'ready' },
      // done invalid (terminal)
      { from: 'done', to: 'briefings' },
      { from: 'done', to: 'ready' },
      { from: 'done', to: 'testing' },
      { from: 'done', to: 'implementing' },
      { from: 'done', to: 'probing' },
      { from: 'done', to: 'review' },
      { from: 'done', to: 'blocked' },
      // blocked invalid
      { from: 'blocked', to: 'briefings' },
      { from: 'blocked', to: 'testing' },
      { from: 'blocked', to: 'implementing' },
      { from: 'blocked', to: 'probing' },
      { from: 'blocked', to: 'review' },
      { from: 'blocked', to: 'done' },
    ];

    for (const { from, to } of invalidTransitions) {
      it(`should reject invalid transition: ${from} -> ${to}`, async () => {
        const itemInStage = { ...mockItemInReady, stageId: from };
        mockPrisma.item.findFirst.mockResolvedValue(itemInStage);

        const { POST } = await import('@/app/api/board/move/route');
        const request = new NextRequest('http://localhost:3000/api/board/move', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Project-ID': 'test-project'
          },
          body: JSON.stringify({
            itemId: 'WI-001',
            toStage: to,
          } as MoveItemRequest),
        });

        const response = await POST(request);
        expect(response.status).toBe(400);
        const data: ApiError = await response.json();
        expect(data.error.code).toBe('INVALID_TRANSITION');
      });
    }
  });

  describe('error handling', () => {
    it('should return 500 for database errors during item lookup', async () => {
      mockPrisma.item.findFirst.mockRejectedValue(new Error('Database error'));

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
    });

    it('should return 500 for database errors during update', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(mockItemInReady);
      mockPrisma.stage.findUnique.mockResolvedValue(mockStages[2]);
      mockPrisma.item.count.mockResolvedValue(0);
      mockPrisma.item.update.mockRejectedValue(new Error('Update failed'));

      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'testing',
        } as MoveItemRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
    });

    it('should return 400 for invalid toStage value', async () => {
      const { POST } = await import('@/app/api/board/move/route');
      const request = new NextRequest('http://localhost:3000/api/board/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          toStage: 'invalid_stage',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
