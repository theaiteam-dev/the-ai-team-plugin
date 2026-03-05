import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

import type { AgentStartRequest, ApiError } from '@/types/api';

/**
 * Tests for POST /api/agents/start endpoint
 *
 * This endpoint combines claim + move + log into a single atomic operation.
 * It allows an agent to start work on an item, enforcing:
 * - Item must be in ready stage
 * - All item dependencies must be in done stage
 * - Agent must not already have an active claim
 * - Creates agent claim
 * - Moves item to in_progress stage
 * - Sets assignedAgent on the item
 * - Creates WorkLog entry with action=started
 * - Returns AgentStartResponse with item details and claimedAt
 *
 * Acceptance criteria tested:
 * - [x] POST /api/agents/start accepts AgentStartRequest with itemId and agent
 * - [x] Validates item is in ready stage
 * - [x] Validates all item dependencies are in done stage
 * - [x] Validates agent does not have an active claim
 * - [x] Creates agent claim
 * - [x] Moves item to in_progress stage
 * - [x] Sets assignedAgent on the item
 * - [x] Creates WorkLog entry with action=started
 * - [x] Returns AgentStartResponse with item details and claimedAt
 */

// Mock data for items
const mockItemInReady = {
  id: 'WI-001',
  title: 'Feature A',
  description: 'Description A',
  type: 'feature',
  priority: 'high',
  stageId: 'ready',
  assignedAgent: null,
  rejectionCount: 0,
  createdAt: new Date('2026-01-21T10:00:00Z'),
  updatedAt: new Date('2026-01-21T10:00:00Z'),
  completedAt: null,
  dependsOn: [],
  workLogs: [],
};

const mockItemInInProgress = {
  ...mockItemInReady,
  id: 'WI-002',
  stageId: 'testing',
};

const mockItemInDone = {
  ...mockItemInReady,
  id: 'WI-003',
  stageId: 'done',
  completedAt: new Date('2026-01-20T18:00:00Z'),
};

const mockItemInBacklog = {
  ...mockItemInReady,
  id: 'WI-004',
  stageId: 'briefings',
};

const mockItemWithDependencies = {
  ...mockItemInReady,
  id: 'WI-005',
  dependsOn: [{ dependsOnId: 'WI-003' }, { dependsOnId: 'WI-006' }],
};

const mockItemWithUnmetDependencies = {
  ...mockItemInReady,
  id: 'WI-007',
  dependsOn: [{ dependsOnId: 'WI-002' }], // Depends on item in in_progress
};

const mockDependencyInProgress = {
  id: 'WI-006',
  title: 'Dependency Item',
  description: 'A dependency',
  type: 'feature',
  priority: 'medium',
  stageId: 'testing',
  assignedAgent: null,
  rejectionCount: 0,
  createdAt: new Date('2026-01-21T09:00:00Z'),
  updatedAt: new Date('2026-01-21T09:00:00Z'),
  completedAt: null,
};

const mockDependencyDone = {
  ...mockDependencyInProgress,
  stageId: 'done',
  completedAt: new Date('2026-01-21T11:00:00Z'),
};

const mockExistingClaim = {
  agentName: 'Murdock',
  itemId: 'WI-999',
  claimedAt: new Date('2026-01-21T11:00:00Z'),
};

// Create mock Prisma client
const mockPrisma = {
  item: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  agentClaim: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  workLog: {
    create: vi.fn(),
  },
  stage: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
};

// Mock the db module
vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

describe('POST /api/agents/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-21T12:00:00Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('request validation', () => {
    it('should accept AgentStartRequest with itemId and agent', async () => {
      // Setup: Item exists in ready stage, no dependencies, no existing claims
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        agentName: 'Hannibal',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        assignedAgent: 'Hannibal',
        updatedAt: new Date('2026-01-21T12:00:00Z'),
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Hannibal',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Hannibal',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should return 400 for missing itemId', async () => {
      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          agent: 'Hannibal',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing agent', async () => {
      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
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

      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid agent name', async () => {
      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'InvalidAgent',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid JSON body', async () => {
      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: 'not valid json',
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe('item stage validation', () => {
    it('should return ITEM_NOT_FOUND if item does not exist', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(null);

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-999',
          agent: 'Hannibal',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(404);

      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('ITEM_NOT_FOUND');
    });

    it('should validate item is in ready stage', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        agentName: 'Face',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        assignedAgent: 'Face',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Face',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Face',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should return INVALID_STAGE if item is in backlog', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInBacklog,
        dependsOn: [],
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-004',
          agent: 'Hannibal',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_STAGE');
    });

    it('should return INVALID_STAGE if non-pipeline agent tries to claim from work stage', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInInProgress,
        dependsOn: [],
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-002',
          agent: 'Hannibal',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_STAGE');
    });

    it('should return INVALID_STAGE if item is in done', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInDone,
        dependsOn: [],
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-003',
          agent: 'Hannibal',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_STAGE');
    });
  });

  describe('work-stage claims (pipeline agents)', () => {
    function setupWorkStageClaim(stageId: string, agent: string) {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        stageId,
        dependsOn: [],
      });
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        agentName: agent,
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId,
        assignedAgent: agent,
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent,
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });
    }

    it('should allow B.A. to claim item already in implementing stage', async () => {
      setupWorkStageClaim('implementing', 'B.A.');

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
        body: JSON.stringify({ itemId: 'WI-001', agent: 'B.A.' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should allow Lynch to claim item already in review stage', async () => {
      setupWorkStageClaim('review', 'Lynch');

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
        body: JSON.stringify({ itemId: 'WI-001', agent: 'Lynch' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should allow Amy to claim item already in probing stage', async () => {
      setupWorkStageClaim('probing', 'Amy');

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
        body: JSON.stringify({ itemId: 'WI-001', agent: 'Amy' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should reject Murdock from review (wrong work stage)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'review',
        dependsOn: [],
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
        body: JSON.stringify({ itemId: 'WI-001', agent: 'Murdock' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.error.code).toBe('INVALID_STAGE');
    });

    it('should reject B.A. from testing (wrong work stage)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        dependsOn: [],
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
        body: JSON.stringify({ itemId: 'WI-001', agent: 'B.A.' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.error.code).toBe('INVALID_STAGE');
    });

    it('should skip deps/WIP checks for work-stage claims', async () => {
      setupWorkStageClaim('implementing', 'B.A.');

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
        body: JSON.stringify({ itemId: 'WI-001', agent: 'B.A.' }),
      });

      await POST(request);

      // WIP check should NOT have been called (no stage.findUnique, no item.count)
      expect(mockPrisma.stage.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.item.count).not.toHaveBeenCalled();
    });
  });

  describe('dependency validation', () => {
    it('should validate all item dependencies are in done stage', async () => {
      // Item with dependencies that are all done
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemWithDependencies,
        dependsOn: [
          { dependsOnId: 'WI-003', dependsOn: { ...mockItemInDone } },
          { dependsOnId: 'WI-006', dependsOn: { ...mockDependencyDone } },
        ],
      });
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        agentName: 'B.A.',
        itemId: 'WI-005',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemWithDependencies,
        stageId: 'testing',
        assignedAgent: 'B.A.',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-005',
        agent: 'B.A.',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-005',
          agent: 'B.A.',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should return DEPENDENCIES_NOT_MET if any dependency is not in done stage', async () => {
      // Item with a dependency that is still in testing (not done)
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemWithUnmetDependencies,
        dependsOn: [
          { dependsOnId: 'WI-002', dependsOn: { ...mockItemInInProgress } },
        ],
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-007',
          agent: 'Hannibal',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DEPENDENCIES_NOT_MET');
    });

    it('should include unmet dependency IDs in error details', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemWithDependencies,
        dependsOn: [
          { dependsOnId: 'WI-003', dependsOn: { ...mockItemInDone } },
          { dependsOnId: 'WI-006', dependsOn: { ...mockDependencyInProgress } },
        ],
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-005',
          agent: 'Hannibal',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data: ApiError = await response.json();
      expect(data.error.code).toBe('DEPENDENCIES_NOT_MET');
      expect(data.error.details).toBeDefined();
      expect((data.error.details as { unmetDependencies: string[] }).unmetDependencies).toContain('WI-006');
    });

    it('should allow start when item has no dependencies', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        agentName: 'Lynch',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        assignedAgent: 'Lynch',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Lynch',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Lynch',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });

  describe('agent claim validation', () => {
    it('should allow agent to claim multiple items', async () => {
      // Agents can now claim multiple items - only WIP limits constrain this
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        id: 1,
        agentName: 'Amy',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'probing',
        assignedAgent: 'Amy',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Amy',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Amy',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify the request succeeded
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.claimedAt).toBeDefined();
    });
  });

  describe('successful start operation', () => {
    it('should create agent claim', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        agentName: 'Hannibal',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        assignedAgent: 'Hannibal',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Hannibal',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Hannibal',
        } as AgentStartRequest),
      });

      await POST(request);

      // Verify claim was created
      expect(mockPrisma.agentClaim.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentName: 'Hannibal',
            itemId: 'WI-001',
          }),
        })
      );
    });

    it('should move item to agent-specific stage (Murdock -> testing)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        agentName: 'Murdock',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        assignedAgent: 'Murdock',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Murdock',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Murdock',
        } as AgentStartRequest),
      });

      await POST(request);

      // Verify Murdock moves item to testing stage
      expect(mockPrisma.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'WI-001' },
          data: expect.objectContaining({
            stageId: 'testing',
          }),
        })
      );
    });

    it('should set assignedAgent on the item (BA -> implementing)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        agentName: 'B.A.',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'implementing',
        assignedAgent: 'B.A.',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'B.A.',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'B.A.',
        } as AgentStartRequest),
      });

      await POST(request);

      // Verify BA moves item to implementing stage and sets assignedAgent
      expect(mockPrisma.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stageId: 'implementing',
            assignedAgent: 'B.A.',
          }),
        })
      );
    });

    it('should create WorkLog entry with action=started', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        agentName: 'Lynch',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        assignedAgent: 'Lynch',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Lynch',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Lynch',
        } as AgentStartRequest),
      });

      await POST(request);

      // Verify work log was created with action=started
      expect(mockPrisma.workLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            itemId: 'WI-001',
            agent: 'Lynch',
            action: 'started',
          }),
        })
      );
    });
  });

  describe('response format (AgentStartResponse)', () => {
    it('should return AgentStartResponse with item details and claimedAt', async () => {
      const claimedAt = new Date('2026-01-21T12:00:00Z');
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        agentName: 'Hannibal',
        itemId: 'WI-001',
        claimedAt,
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        assignedAgent: 'Hannibal',
        updatedAt: claimedAt,
        dependsOn: [],
        workLogs: [
          {
            id: 1,
            agent: 'Hannibal',
            action: 'started',
            summary: 'Started work on item',
            timestamp: claimedAt,
          },
        ],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Hannibal',
        action: 'started',
        summary: 'Started work on item',
        timestamp: claimedAt,
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Hannibal',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.itemId).toBe('WI-001');
      expect(data.data.agent).toBe('Hannibal');
      expect(data.data.item).toBeDefined();
      expect(data.data.claimedAt).toBeDefined();
    });

    it('should return item with updated stageId (Amy -> probing)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        agentName: 'Amy',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'probing',
        assignedAgent: 'Amy',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Amy',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Amy',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      const data = await response.json();

      // Amy moves items to probing stage
      expect(data.data.item.stageId).toBe('probing');
    });

    it('should return item with assignedAgent set (Murdock -> testing)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        agentName: 'Murdock',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',  // Murdock goes to testing
        assignedAgent: 'Murdock',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Murdock',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Murdock',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.item.assignedAgent).toBe('Murdock');
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error during item lookup', async () => {
      mockPrisma.item.findFirst.mockRejectedValue(new Error('Database connection failed'));

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Hannibal',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(500);

      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
    });

    it('should return 500 on database error during claim creation', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.agentClaim.findFirst.mockResolvedValue(null);
      mockPrisma.stage.findUnique.mockResolvedValue({ id: 'implementing', wipLimit: null });
      mockPrisma.$transaction.mockRejectedValue(new Error('Transaction failed'));

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Hannibal',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(500);

      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DATABASE_ERROR');
    });
  });

  describe('WIP limit enforcement', () => {
    it('should allow work when below WIP limit', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      // Stage has WIP limit of 3, currently 2 items
      mockPrisma.stage.findUnique.mockResolvedValue({ id: 'testing', name: 'Testing', wipLimit: 3, order: 2 });
      mockPrisma.item.count.mockResolvedValue(2);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        id: 1,
        agentName: 'Murdock',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        assignedAgent: 'Murdock',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Murdock',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Murdock',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should return WIP_LIMIT_EXCEEDED when stage is at capacity', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      // Stage has WIP limit of 3, already has 3 items
      mockPrisma.stage.findUnique.mockResolvedValue({ id: 'testing', name: 'Testing', wipLimit: 3, order: 2 });
      mockPrisma.item.count.mockResolvedValue(3);

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Murdock',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('WIP_LIMIT_EXCEEDED');
      expect(data.error.details).toBeDefined();
      expect((data.error.details as { stageId: string }).stageId).toBe('testing');
      expect((data.error.details as { limit: number }).limit).toBe(3);
      expect((data.error.details as { current: number }).current).toBe(3);
    });

    it('should allow work when stage has no WIP limit (null)', async () => {
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      // Stage has unlimited WIP (null)
      mockPrisma.stage.findUnique.mockResolvedValue({ id: 'testing', name: 'Testing', wipLimit: null, order: 2 });
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        id: 1,
        agentName: 'Murdock',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        assignedAgent: 'Murdock',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Murdock',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Murdock',
        } as AgentStartRequest),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should allow multiple agents to work up to the WIP limit', async () => {
      // First agent claims - count is 0, limit is 2
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        dependsOn: [],
      });
      mockPrisma.stage.findUnique.mockResolvedValue({ id: 'testing', name: 'Testing', wipLimit: 2, order: 2 });
      mockPrisma.item.count.mockResolvedValue(0);
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(mockPrisma);
      });
      mockPrisma.agentClaim.create.mockResolvedValue({
        id: 1,
        agentName: 'Murdock',
        itemId: 'WI-001',
        claimedAt: new Date('2026-01-21T12:00:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        stageId: 'testing',
        assignedAgent: 'Murdock',
        dependsOn: [],
        workLogs: [],
      });
      mockPrisma.workLog.create.mockResolvedValue({
        id: 1,
        itemId: 'WI-001',
        agent: 'Murdock',
        action: 'started',
        summary: 'Started work on item',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      });

      const { POST } = await import('@/app/api/agents/start/route');
      const request1 = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-001',
          agent: 'Murdock',
        } as AgentStartRequest),
      });

      const response1 = await POST(request1);
      expect(response1.status).toBe(200);

      // Second agent claims - count is now 1, still under limit of 2
      vi.resetModules();
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        id: 'WI-002',
        dependsOn: [],
      });
      mockPrisma.item.count.mockResolvedValue(1);
      mockPrisma.agentClaim.create.mockResolvedValue({
        id: 2,
        agentName: 'Murdock',
        itemId: 'WI-002',
        claimedAt: new Date('2026-01-21T12:01:00Z'),
      });
      mockPrisma.item.update.mockResolvedValue({
        ...mockItemInReady,
        id: 'WI-002',
        stageId: 'testing',
        assignedAgent: 'Murdock',
        dependsOn: [],
        workLogs: [],
      });

      const { POST: POST2 } = await import('@/app/api/agents/start/route');
      const request2 = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-002',
          agent: 'Murdock',
        } as AgentStartRequest),
      });

      const response2 = await POST2(request2);
      expect(response2.status).toBe(200);

      // Third claim should fail - count is now 2, at limit
      vi.resetModules();
      mockPrisma.item.findFirst.mockResolvedValue({
        ...mockItemInReady,
        id: 'WI-003',
        dependsOn: [],
      });
      mockPrisma.item.count.mockResolvedValue(2);

      const { POST: POST3 } = await import('@/app/api/agents/start/route');
      const request3 = new NextRequest('http://localhost:3000/api/agents/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          itemId: 'WI-003',
          agent: 'Murdock',
        } as AgentStartRequest),
      });

      const response3 = await POST3(request3);
      expect(response3.status).toBe(400);

      const data3: ApiError = await response3.json();
      expect(data3.error.code).toBe('WIP_LIMIT_EXCEEDED');
    });
  });
});
