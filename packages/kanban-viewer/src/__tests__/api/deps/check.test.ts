import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for GET /api/deps/check endpoint
 *
 * This endpoint validates the dependency graph and returns:
 * - valid: true if no cycles exist
 * - cycles: arrays of item IDs forming circular dependencies
 * - readyItems: item IDs where all dependencies are in done stage
 * - blockedItems: item IDs waiting on incomplete dependencies
 *
 * Acceptance criteria tested:
 * - [x] GET /api/deps/check returns DepsCheckResponse
 * - [x] Detects circular dependencies and returns them in cycles array
 * - [x] Returns valid=true only if no cycles exist
 * - [x] readyItems lists item IDs where all dependencies are in done stage
 * - [x] blockedItems lists item IDs waiting on incomplete dependencies
 * - [x] Uses efficient graph traversal algorithm
 */

// Mock items with no cycles - simple dependency chain
const mockItemsNoCycle = [
  {
    id: 'WI-001',
    title: 'Base Feature',
    stageId: 'done',
    archivedAt: null,
    dependsOn: [],
  },
  {
    id: 'WI-002',
    title: 'Feature A',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-001' }],
  },
  {
    id: 'WI-003',
    title: 'Feature B',
    stageId: 'testing',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-002' }],
  },
];

// Mock items with a simple cycle: A -> B -> C -> A
const mockItemsWithCycle = [
  {
    id: 'WI-001',
    title: 'Feature A',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-003' }],
  },
  {
    id: 'WI-002',
    title: 'Feature B',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-001' }],
  },
  {
    id: 'WI-003',
    title: 'Feature C',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-002' }],
  },
];

// Mock items with multiple cycles
const mockItemsMultipleCycles = [
  // Cycle 1: A -> B -> A
  {
    id: 'WI-001',
    title: 'Feature A',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-002' }],
  },
  {
    id: 'WI-002',
    title: 'Feature B',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-001' }],
  },
  // Cycle 2: C -> D -> C
  {
    id: 'WI-003',
    title: 'Feature C',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-004' }],
  },
  {
    id: 'WI-004',
    title: 'Feature D',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-003' }],
  },
];

// Mock items for ready/blocked testing
const mockItemsReadyBlocked = [
  {
    id: 'WI-001',
    title: 'Completed Base',
    stageId: 'done',
    archivedAt: null,
    dependsOn: [],
  },
  {
    id: 'WI-002',
    title: 'Also Completed',
    stageId: 'done',
    archivedAt: null,
    dependsOn: [],
  },
  {
    id: 'WI-003',
    title: 'Ready - deps done',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-001' }],
  },
  {
    id: 'WI-004',
    title: 'Blocked - dep not done',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-005' }],
  },
  {
    id: 'WI-005',
    title: 'In Progress blocker',
    stageId: 'testing',
    archivedAt: null,
    dependsOn: [],
  },
  {
    id: 'WI-006',
    title: 'Ready - multiple deps all done',
    stageId: 'briefings',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-001' }, { dependsOnId: 'WI-002' }],
  },
  {
    id: 'WI-007',
    title: 'Blocked - one dep not done',
    stageId: 'briefings',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-001' }, { dependsOnId: 'WI-005' }],
  },
  {
    id: 'WI-008',
    title: 'No dependencies - ready',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [],
  },
];

// WI-788: dependency satisfaction now accepts 'staged' as complete, not just
// 'done' — the pipeline ends at 'staged' and nothing reaches 'done' until the
// mission tail promotes it, so wave-2+ items must not deadlock on 'staged'
// dependencies.
const mockItemsStagedDeps = [
  {
    id: 'WI-101',
    title: 'Dep in staged',
    stageId: 'staged',
    archivedAt: null,
    dependsOn: [],
  },
  {
    id: 'WI-102',
    title: 'Dep in done',
    stageId: 'done',
    archivedAt: null,
    dependsOn: [],
  },
  {
    id: 'WI-103',
    title: 'Dep in probing (non-terminal)',
    stageId: 'probing',
    archivedAt: null,
    dependsOn: [],
  },
  {
    id: 'WI-104',
    title: 'Dep in review (non-terminal)',
    stageId: 'review',
    archivedAt: null,
    dependsOn: [],
  },
  {
    id: 'WI-105',
    title: 'Ready - single dependency staged',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-101' }],
  },
  {
    id: 'WI-106',
    title: 'Ready - mixed dependencies (one staged, one done)',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-101' }, { dependsOnId: 'WI-102' }],
  },
  {
    id: 'WI-107',
    title: 'Blocked - dependency in probing',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-103' }],
  },
  {
    id: 'WI-108',
    title: 'Blocked - dependency in review',
    stageId: 'ready',
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-104' }],
  },
];

// Create mock Prisma client
const mockPrisma = {
  item: {
    findMany: vi.fn(),
  },
};

// Mock the db module
vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

describe('GET /api/deps/check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('response format (DepsCheckResponse)', () => {
    it('should return DepsCheckResponse with valid, cycles, readyItems, and blockedItems', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsNoCycle);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('valid');
      expect(data.data).toHaveProperty('cycles');
      expect(data.data).toHaveProperty('readyItems');
      expect(data.data).toHaveProperty('blockedItems');
      expect(typeof data.data.valid).toBe('boolean');
      expect(Array.isArray(data.data.cycles)).toBe(true);
      expect(Array.isArray(data.data.readyItems)).toBe(true);
      expect(Array.isArray(data.data.blockedItems)).toBe(true);
    });

    it('should return HTTP 200 status on success', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsNoCycle);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe('cycle detection', () => {
    it('should return valid=true when no cycles exist', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsNoCycle);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data.data.valid).toBe(true);
      expect(data.data.cycles).toHaveLength(0);
    });

    it('should return valid=false when a cycle exists', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsWithCycle);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data.data.valid).toBe(false);
      expect(data.data.cycles.length).toBeGreaterThan(0);
    });

    it('should return cycle participants in cycles array', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsWithCycle);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      // The cycle should contain WI-001, WI-002, WI-003
      const allCycleIds = data.data.cycles.flat();
      expect(allCycleIds).toContain('WI-001');
      expect(allCycleIds).toContain('WI-002');
      expect(allCycleIds).toContain('WI-003');
    });

    it('should detect multiple independent cycles', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsMultipleCycles);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data.data.valid).toBe(false);
      // Should detect at least the cycles exist
      const allCycleIds = data.data.cycles.flat();
      // Both cycles should be represented
      expect(allCycleIds).toContain('WI-001');
      expect(allCycleIds).toContain('WI-002');
      expect(allCycleIds).toContain('WI-003');
      expect(allCycleIds).toContain('WI-004');
    });

    it('should return empty cycles array when graph is acyclic', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsNoCycle);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data.data.cycles).toEqual([]);
    });
  });

  describe('ready items detection', () => {
    it('should list items with all dependencies in done stage as ready', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsReadyBlocked);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      // WI-003 depends on WI-001 (done) - should be ready
      // WI-006 depends on WI-001 and WI-002 (both done) - should be ready
      // WI-008 has no dependencies - should be ready
      expect(data.data.readyItems).toContain('WI-003');
      expect(data.data.readyItems).toContain('WI-006');
      expect(data.data.readyItems).toContain('WI-008');
    });

    it('should include items with no dependencies as ready', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsReadyBlocked);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      // WI-008 has no dependencies and is not in done stage
      expect(data.data.readyItems).toContain('WI-008');
    });

    it('should not include done items in readyItems', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsReadyBlocked);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      // WI-001 and WI-002 are done - should not be in ready list
      expect(data.data.readyItems).not.toContain('WI-001');
      expect(data.data.readyItems).not.toContain('WI-002');
    });
  });

  describe('blocked items detection', () => {
    it('should list items with incomplete dependencies as blocked', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsReadyBlocked);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      // WI-004 depends on WI-005 (in_progress) - should be blocked
      expect(data.data.blockedItems).toContain('WI-004');
    });

    it('should list items where any dependency is not done as blocked', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsReadyBlocked);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      // WI-007 depends on WI-001 (done) and WI-005 (in_progress) - should be blocked
      expect(data.data.blockedItems).toContain('WI-007');
    });

    it('should not include items with no dependencies in blockedItems', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsReadyBlocked);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      // WI-008 has no dependencies - should not be blocked
      expect(data.data.blockedItems).not.toContain('WI-008');
    });

    it('should not include done items in blockedItems', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsReadyBlocked);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      // WI-001 and WI-002 are done - should not be in blocked list
      expect(data.data.blockedItems).not.toContain('WI-001');
      expect(data.data.blockedItems).not.toContain('WI-002');
    });
  });

  describe('edge cases', () => {
    it('should handle empty item list', async () => {
      mockPrisma.item.findMany.mockResolvedValue([]);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.valid).toBe(true);
      expect(data.data.cycles).toEqual([]);
      expect(data.data.readyItems).toEqual([]);
      expect(data.data.blockedItems).toEqual([]);
    });

    it('should handle items with self-referential dependency as cycle', async () => {
      const selfRefItem = [
        {
          id: 'WI-001',
          title: 'Self Reference',
          stageId: 'ready',
          archivedAt: null,
          dependsOn: [{ dependsOnId: 'WI-001' }],
        },
      ];
      mockPrisma.item.findMany.mockResolvedValue(selfRefItem);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data.data.valid).toBe(false);
      expect(data.data.cycles.length).toBeGreaterThan(0);
      const allCycleIds = data.data.cycles.flat();
      expect(allCycleIds).toContain('WI-001');
    });

    it('should exclude archived items from analysis', async () => {
      const itemsWithArchived = [
        ...mockItemsNoCycle,
        {
          id: 'WI-ARCHIVED',
          title: 'Archived Item',
          stageId: 'done',
          archivedAt: new Date('2026-01-20T10:00:00Z'),
          dependsOn: [],
        },
      ];
      mockPrisma.item.findMany.mockResolvedValue(itemsWithArchived);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      await GET(request);

      // Verify that archived items are filtered out via the query and projectId is included
      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            archivedAt: null,
            projectId: 'test-project',
          }),
        })
      );
    });
  });

  describe('error handling', () => {
    it('should return 500 with ApiError on database failure', async () => {
      mockPrisma.item.findMany.mockRejectedValue(new Error('Database connection failed'));

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBeDefined();
      expect(data.error.message).toBeDefined();
    });
  });

  describe('efficient graph traversal', () => {
    it('should query items with dependencies included', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsNoCycle);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      await GET(request);

      // Verify the query includes dependencies
      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            dependsOn: true,
          }),
        })
      );
    });

    it('should perform single database query for all items', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsNoCycle);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      await GET(request);

      // Should only call findMany once (efficient - no N+1 queries)
      expect(mockPrisma.item.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('projectId validation', () => {
    it('should return 400 when projectId is missing', async () => {
      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: {}
      });
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('Project-ID');
    });

    it('should return 400 when projectId is empty', async () => {
      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check?projectId=');
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should filter items by projectId', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsNoCycle);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'my-project' }
      });
      await GET(request);

      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'my-project',
          }),
        })
      );
    });
  });

  describe('WI-788: staged counts as complete for dependency-wave satisfaction', () => {
    it('reports an item ready when its only dependency is in staged, and for a mixed staged+done graph', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsStagedDeps);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      // WI-105 depends only on WI-101 (staged)
      expect(data.data.readyItems).toContain('WI-105');
      expect(data.data.blockedItems).not.toContain('WI-105');

      // WI-106 depends on WI-101 (staged) AND WI-102 (done) — mixed graph (AC6)
      expect(data.data.readyItems).toContain('WI-106');
      expect(data.data.blockedItems).not.toContain('WI-106');
    });

    it('still reports an item blocked when a dependency is in probing or review (non-terminal stages)', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsStagedDeps);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      // WI-107 depends on WI-103 (probing) — AC5/AC6
      expect(data.data.blockedItems).toContain('WI-107');
      expect(data.data.readyItems).not.toContain('WI-107');

      // WI-108 depends on WI-104 (review) — AC5
      expect(data.data.blockedItems).toContain('WI-108');
      expect(data.data.readyItems).not.toContain('WI-108');
    });

    it('does not list items that are themselves in staged (or done) as ready or blocked (AC3)', async () => {
      mockPrisma.item.findMany.mockResolvedValue(mockItemsStagedDeps);

      const { GET } = await import('@/app/api/deps/check/route');
      const request = new NextRequest('http://localhost:3000/api/deps/check', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data = await response.json();

      // WI-101 is itself in staged — must be skipped entirely, same as done
      expect(data.data.readyItems).not.toContain('WI-101');
      expect(data.data.blockedItems).not.toContain('WI-101');

      // WI-102 is itself in done — regression guard alongside the staged case
      expect(data.data.readyItems).not.toContain('WI-102');
      expect(data.data.blockedItems).not.toContain('WI-102');
    });
  });
});
