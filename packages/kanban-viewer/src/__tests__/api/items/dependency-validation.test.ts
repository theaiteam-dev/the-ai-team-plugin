import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for dependency validation in POST /api/items endpoint.
 *
 * Bug fix for work item 017: Fix N+1 query in dependency validation
 *
 * The current implementation queries each dependency individually in a loop.
 * This causes N+1 queries when creating an item with N dependencies.
 *
 * These tests verify that:
 * - Dependency validation uses a single batch query (findMany with id: { in: dependencies })
 * - Missing dependencies are reported with ALL their IDs, not just the first one found
 * - Performance is improved for items with multiple dependencies
 *
 * NOTE: These tests verify the FIX behavior. They will fail until the
 * implementation at src/app/api/items/route.ts is updated to use batch queries.
 */

import type { CreateItemRequest } from '@/types/api';

// Create mock Prisma client
const mockPrisma = {
  item: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  itemDependency: {
    findMany: vi.fn(),
  },
  mission: {
    findFirst: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
};

// Mock the db module
vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

// ============ Test Data Fixtures ============

function createMockDbItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'WI-001',
    title: 'Test Item',
    description: 'Test description',
    type: 'feature',
    priority: 'medium',
    stageId: 'briefings',
    assignedAgent: null,
    rejectionCount: 0,
    projectId: 'kanban-viewer',
    createdAt: new Date('2026-01-21T10:00:00Z'),
    updatedAt: new Date('2026-01-21T10:00:00Z'),
    completedAt: null,
    archivedAt: null,
    dependsOn: [],
    workLogs: [],
    ...overrides,
  };
}

function createPostRequest(body: CreateItemRequest | Record<string, unknown>): NextRequest {
  const defaults = {
    objective: 'Test objective',
    acceptance: ['Test criterion'],
    context: 'Test context',
  };
  return new NextRequest('http://localhost:3000/api/items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Project-ID': 'kanban-viewer'
    },
    body: JSON.stringify({ ...defaults, ...body }),
  });
}

// ============ Dependency Validation Tests ============

describe('POST /api/items - Dependency Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks for successful flow
    mockPrisma.item.count.mockResolvedValue(0);
    mockPrisma.itemDependency.findMany.mockResolvedValue([]);
    mockPrisma.mission.findFirst.mockResolvedValue(null);
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'kanban-viewer', name: 'kanban-viewer', createdAt: new Date() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('batch query usage', () => {
    it('should use findMany with id: { in: dependencies } instead of individual findUnique calls', async () => {
      const dependencies = ['WI-001', 'WI-002', 'WI-003'];

      // Mock findMany to return all dependencies exist
      mockPrisma.item.findMany.mockResolvedValue([
        createMockDbItem({ id: 'WI-001' }),
        createMockDbItem({ id: 'WI-002' }),
        createMockDbItem({ id: 'WI-003' }),
      ]);

      // Mock successful item creation
      mockPrisma.item.create.mockResolvedValue(
        createMockDbItem({
          id: 'WI-004',
          dependsOn: dependencies.map((id) => ({ dependsOnId: id })),
        })
      );

      const { POST } = await import('@/app/api/items/route');
      const request = createPostRequest({
        title: 'New Item with Dependencies',
        description: 'Test description',
        type: 'feature',
        priority: 'medium',
        dependencies,
      });

      await POST(request);

      // The implementation SHOULD use findMany with id: { in: dependencies }
      // for batch validation instead of multiple findUnique calls
      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: dependencies },
          }),
        })
      );
    });

    it('should make exactly ONE database query for dependency existence check regardless of dependency count', async () => {
      const dependencies = ['WI-001', 'WI-002', 'WI-003', 'WI-004', 'WI-005'];

      // Mock findMany returns all exist
      mockPrisma.item.findMany.mockResolvedValue(
        dependencies.map((id) => createMockDbItem({ id }))
      );

      mockPrisma.item.create.mockResolvedValue(
        createMockDbItem({
          id: 'WI-006',
          dependsOn: dependencies.map((id) => ({ dependsOnId: id })),
        })
      );

      const { POST } = await import('@/app/api/items/route');
      const request = createPostRequest({
        title: 'Item with 5 dependencies',
        description: 'Test description',
        type: 'feature',
        priority: 'medium',
        dependencies,
      });

      await POST(request);

      // Count calls where we check for dependency existence with id: { in: ... }
      const batchQueryCalls = mockPrisma.item.findMany.mock.calls.filter(
        (call) => call[0]?.where?.id?.in !== undefined
      );

      // Should be exactly one batch query for all dependencies
      expect(batchQueryCalls).toHaveLength(1);

      // Should NOT use findUnique for dependency validation
      // (findUnique may still be used for other purposes, but not in a loop for deps)
      const findUniqueCalls = mockPrisma.item.findUnique.mock.calls.filter(
        (call) => dependencies.includes(call[0]?.where?.id)
      );
      expect(findUniqueCalls).toHaveLength(0);
    });

    it('should NOT call findUnique in a loop for dependency validation', async () => {
      const dependencies = ['WI-001', 'WI-002', 'WI-003'];

      mockPrisma.item.findMany.mockResolvedValue(
        dependencies.map((id) => createMockDbItem({ id }))
      );

      mockPrisma.item.create.mockResolvedValue(
        createMockDbItem({ id: 'WI-004' })
      );

      const { POST } = await import('@/app/api/items/route');
      const request = createPostRequest({
        title: 'Test Item',
        description: 'Description',
        type: 'feature',
        priority: 'medium',
        dependencies,
      });

      await POST(request);

      // The old N+1 pattern would call findUnique for each dependency ID
      // The fix should NOT do this
      const depFindUniqueCalls = mockPrisma.item.findUnique.mock.calls.filter((call) =>
        dependencies.includes(call[0]?.where?.id)
      );

      expect(depFindUniqueCalls).toHaveLength(0);
    });
  });

  describe('missing dependency reporting', () => {
    it('should report ALL missing dependency IDs in error message, not just the first one', async () => {
      const dependencies = ['WI-001', 'WI-002', 'WI-003'];

      // Only WI-002 exists, WI-001 and WI-003 are missing
      mockPrisma.item.findMany.mockResolvedValue([createMockDbItem({ id: 'WI-002' })]);

      const { POST } = await import('@/app/api/items/route');
      const request = createPostRequest({
        title: 'Item with missing deps',
        description: 'Description',
        type: 'feature',
        priority: 'medium',
        dependencies,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');

      // Error message should include ALL missing IDs
      expect(data.error.message).toContain('WI-001');
      expect(data.error.message).toContain('WI-003');
    });

    it('should report single missing dependency correctly', async () => {
      const dependencies = ['WI-001', 'WI-002'];

      // WI-001 exists, WI-002 is missing
      mockPrisma.item.findMany.mockResolvedValue([createMockDbItem({ id: 'WI-001' })]);

      const { POST } = await import('@/app/api/items/route');
      const request = createPostRequest({
        title: 'Item with one missing dep',
        description: 'Description',
        type: 'feature',
        priority: 'medium',
        dependencies,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('WI-002');
    });

    it('should report all missing when none of the dependencies exist', async () => {
      const dependencies = ['WI-001', 'WI-002', 'WI-003'];

      // None exist
      mockPrisma.item.findMany.mockResolvedValue([]);

      const { POST } = await import('@/app/api/items/route');
      const request = createPostRequest({
        title: 'Item with all deps missing',
        description: 'Description',
        type: 'feature',
        priority: 'medium',
        dependencies,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);

      // All IDs should be mentioned
      expect(data.error.message).toContain('WI-001');
      expect(data.error.message).toContain('WI-002');
      expect(data.error.message).toContain('WI-003');
    });
  });

  describe('successful validation', () => {
    it('should allow creation when all dependencies exist', async () => {
      const dependencies = ['WI-001', 'WI-002'];

      // Both exist
      mockPrisma.item.findMany.mockResolvedValue([
        createMockDbItem({ id: 'WI-001' }),
        createMockDbItem({ id: 'WI-002' }),
      ]);

      mockPrisma.item.create.mockResolvedValue(
        createMockDbItem({
          id: 'WI-003',
          dependsOn: [{ dependsOnId: 'WI-001' }, { dependsOnId: 'WI-002' }],
        })
      );

      const { POST } = await import('@/app/api/items/route');
      const request = createPostRequest({
        title: 'Item with valid deps',
        description: 'Description',
        type: 'feature',
        priority: 'medium',
        dependencies,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.dependencies).toContain('WI-001');
      expect(data.data.dependencies).toContain('WI-002');
    });

    it('should skip dependency validation when no dependencies provided', async () => {
      mockPrisma.item.create.mockResolvedValue(
        createMockDbItem({ id: 'WI-001', dependsOn: [] })
      );

      const { POST } = await import('@/app/api/items/route');
      const request = createPostRequest({
        title: 'Item without deps',
        description: 'Description',
        type: 'feature',
        priority: 'medium',
        dependencies: [],
      });

      await POST(request);

      // Should not call findMany for dependency validation when there are no deps
      const depValidationCalls = mockPrisma.item.findMany.mock.calls.filter(
        (call) => call[0]?.where?.id?.in !== undefined
      );
      expect(depValidationCalls).toHaveLength(0);
    });

    it('should skip dependency validation when dependencies field is omitted', async () => {
      mockPrisma.item.create.mockResolvedValue(
        createMockDbItem({ id: 'WI-001', dependsOn: [] })
      );

      const { POST } = await import('@/app/api/items/route');
      const request = createPostRequest({
        title: 'Item without deps field',
        description: 'Description',
        type: 'feature',
        priority: 'medium',
        // dependencies field omitted entirely
      });

      await POST(request);

      const depValidationCalls = mockPrisma.item.findMany.mock.calls.filter(
        (call) => call[0]?.where?.id?.in !== undefined
      );
      expect(depValidationCalls).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should handle single dependency correctly', async () => {
      const dependencies = ['WI-001'];

      mockPrisma.item.findMany.mockResolvedValue([createMockDbItem({ id: 'WI-001' })]);
      mockPrisma.item.create.mockResolvedValue(
        createMockDbItem({ id: 'WI-002', dependsOn: [{ dependsOnId: 'WI-001' }] })
      );

      const { POST } = await import('@/app/api/items/route');
      const request = createPostRequest({
        title: 'Item with one dep',
        description: 'Description',
        type: 'feature',
        priority: 'medium',
        dependencies,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });

    it('should handle duplicate dependency IDs in request', async () => {
      // User accidentally provides same ID twice
      const dependencies = ['WI-001', 'WI-001', 'WI-002'];

      mockPrisma.item.findMany.mockResolvedValue([
        createMockDbItem({ id: 'WI-001' }),
        createMockDbItem({ id: 'WI-002' }),
      ]);

      mockPrisma.item.create.mockResolvedValue(
        createMockDbItem({
          id: 'WI-003',
          dependsOn: [{ dependsOnId: 'WI-001' }, { dependsOnId: 'WI-002' }],
        })
      );

      const { POST } = await import('@/app/api/items/route');
      const request = createPostRequest({
        title: 'Item with duplicate dep IDs',
        description: 'Description',
        type: 'feature',
        priority: 'medium',
        dependencies,
      });

      const response = await POST(request);

      // Should still succeed - duplicates should be handled gracefully
      expect(response.status).toBe(201);
    });
  });
});
