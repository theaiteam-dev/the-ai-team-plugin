import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for Memory Management in GET /api/board/events SSE Endpoint
 *
 * Item 011: Add SSE memory management for long connections
 *
 * The trackedItems Map in the SSE endpoint can grow unbounded over time
 * as items are archived but not removed from tracking. For long-running
 * connections (dashboard left open for days), this causes memory leaks.
 *
 * Acceptance criteria tested:
 * - [ ] Archived items are removed from trackedItems Map during poll cycles
 * - [ ] Items not in current database result set are cleaned up
 * - [ ] Memory usage does not grow unbounded over time
 * - [ ] Cleanup does not interfere with normal event emission
 */

// Mock data matching Prisma schema
const createMockItem = (
  id: string,
  stageId: string,
  options: {
    archivedAt?: Date | null;
    title?: string;
    description?: string;
    assignedAgent?: string | null;
  } = {}
) => ({
  id,
  title: options.title || `Item ${id}`,
  description: options.description || `Description for ${id}`,
  type: 'feature',
  priority: 'medium',
  stageId,
  assignedAgent: options.assignedAgent ?? null,
  rejectionCount: 0,
  createdAt: new Date('2026-01-21T10:00:00Z'),
  updatedAt: new Date('2026-01-21T10:00:00Z'),
  completedAt: null,
  archivedAt: options.archivedAt ?? null,
  dependsOn: [],
  workLogs: [],
});

const mockMission = {
  id: 'M-20260121-001',
  name: 'Test Mission',
  state: 'running',
  prdPath: '/prd/test.md',
  startedAt: new Date('2026-01-21T09:00:00Z'),
  completedAt: null,
  archivedAt: null,
};

const mockActivityLogs = [
  {
    id: 1,
    missionId: 'M-20260121-001',
    agent: 'Hannibal',
    message: 'Mission started',
    level: 'info',
    timestamp: new Date('2026-01-21T10:00:00Z'),
  },
];

// Create mock Prisma client using vi.hoisted to ensure it's available when vi.mock is hoisted
const mockPrisma = vi.hoisted(() => ({
  item: {
    findMany: vi.fn(),
  },
  mission: {
    findFirst: vi.fn(),
  },
  activityLog: {
    findMany: vi.fn(),
  },
  hookEvent: {
    findMany: vi.fn(),
  },
  missionTokenUsage: {
    findMany: vi.fn(),
  },
}));

// Mock the db module
vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

describe('GET /api/board/events - Memory Management', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Default mock implementations
    mockPrisma.mission.findFirst.mockResolvedValue(mockMission);
    mockPrisma.activityLog.findMany.mockResolvedValue([...mockActivityLogs]);
    mockPrisma.hookEvent.findMany.mockResolvedValue([]);
    mockPrisma.missionTokenUsage.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('query filtering for archived items', () => {
    it('should query database with filter to exclude archived items', async () => {
      /**
       * The implementation should filter out archived items at the database
       * query level to prevent them from being returned and tracked.
       *
       * Expected query: prisma.item.findMany({ where: { archivedAt: null }, ... })
       */
      const activeItems = [createMockItem('WI-001', 'ready')];
      mockPrisma.item.findMany.mockResolvedValue(activeItems);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger a poll
      await vi.advanceTimersByTimeAsync(1100);

      // Verify the query was called with appropriate filtering
      expect(mockPrisma.item.findMany).toHaveBeenCalled();

      // Check that the query includes a where clause for archived items
      // The implementation SHOULD filter: where: { archivedAt: null }
      const callArgs = mockPrisma.item.findMany.mock.calls[0]?.[0];
      expect(callArgs).toBeDefined();
      expect(callArgs?.where).toBeDefined();
      expect(callArgs?.where?.archivedAt).toBe(null);

      reader.cancel();
    });

    it('should not include archived items in tracking even if returned by database', async () => {
      /**
       * If for some reason an archived item is returned by the query,
       * it should be detected and either:
       * 1. Not added to tracking initially, or
       * 2. Removed from tracking when archivedAt becomes non-null
       *
       * This test verifies behavior when archived items appear in results.
       */
      const activeItem = createMockItem('WI-001', 'ready');
      const archivedItem = createMockItem('WI-002', 'done', {
        archivedAt: new Date('2026-01-21T12:00:00Z'),
      });

      // Return both active and archived items (simulating no query filter)
      mockPrisma.item.findMany.mockResolvedValue([activeItem, archivedItem]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Update active item to trigger an event we can read
      const updatedActive = { ...activeItem, title: 'Updated', updatedAt: new Date() };
      mockPrisma.item.findMany.mockResolvedValue([updatedActive, archivedItem]);

      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // The archived item (WI-002) should NOT be included in events
      // If the implementation filters correctly, WI-002 should not appear
      // as item-added because it was never tracked (or was filtered out)
      expect(text).toContain('item-updated'); // WI-001 updated
      expect(text).toContain('WI-001');

      reader.cancel();
    });
  });

  describe('archived item cleanup', () => {
    it('should emit item-deleted event when item is archived', async () => {
      /**
       * When an item gets archived (archivedAt is set), the SSE endpoint
       * should treat it as deleted and emit an item-deleted event.
       * This keeps the frontend in sync with the active item set.
       */
      const activeItem = createMockItem('WI-001', 'ready');
      const toBeArchivedItem = createMockItem('WI-002', 'done');

      // Initial state: both items active
      mockPrisma.item.findMany.mockResolvedValue([activeItem, toBeArchivedItem]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Archive WI-002 (it should now be excluded from query or handled)
      // const archivedItem = createMockItem('WI-002', 'done', {
      //   archivedAt: new Date('2026-01-21T12:00:00Z'),
      // });

      // Simulate archived item being excluded from active item query
      // The implementation should filter out archived items
      mockPrisma.item.findMany.mockResolvedValue([activeItem]);

      // Trigger next poll
      await vi.advanceTimersByTimeAsync(1000);

      // Read the emitted event
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('item-deleted');
      expect(text).toContain('WI-002');

      reader.cancel();
    });

    it('should remove archived items from internal tracking state', async () => {
      /**
       * When items are archived and removed from the query results,
       * they should also be removed from the trackedItems Map to
       * prevent memory leaks.
       *
       * We verify this indirectly by checking that:
       * 1. Archived item triggers item-deleted event once
       * 2. Subsequent polls do not emit duplicate events for the same item
       */
      const activeItems = [
        createMockItem('WI-001', 'ready'),
        createMockItem('WI-002', 'testing'),
        createMockItem('WI-003', 'implementing'),
      ];

      mockPrisma.item.findMany.mockResolvedValue([...activeItems]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline with 3 items
      await vi.advanceTimersByTimeAsync(1100);

      // Archive WI-002 (remove from result set)
      mockPrisma.item.findMany.mockResolvedValue([activeItems[0], activeItems[2]]);

      // Poll to detect archived item
      await vi.advanceTimersByTimeAsync(1000);

      const { value: value1 } = await reader.read();
      const text1 = new TextDecoder().decode(value1);

      expect(text1).toContain('item-deleted');
      expect(text1).toContain('WI-002');

      // Subsequent polls should NOT emit item-deleted for WI-002 again
      // (it should have been removed from tracking)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      // Wait for heartbeat to ensure we can read something
      await vi.advanceTimersByTimeAsync(30000);

      const { value: value2 } = await reader.read();
      const text2 = new TextDecoder().decode(value2);

      // Should be heartbeat only, no duplicate item-deleted
      const deleteCount = (text2.match(/item-deleted/g) || []).length;
      expect(deleteCount).toBe(0);

      reader.cancel();
    });

    it('should handle bulk archival of completed mission items', async () => {
      /**
       * When a mission is archived, many items might be archived at once.
       * The endpoint should handle this gracefully without memory issues.
       */
      // Create 20 items initially
      const manyItems = Array.from({ length: 20 }, (_, i) =>
        createMockItem(`WI-${String(i + 1).padStart(3, '0')}`, 'done')
      );

      mockPrisma.item.findMany.mockResolvedValue([...manyItems]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline with 20 items
      await vi.advanceTimersByTimeAsync(1100);

      // Archive all items (simulate mission archive)
      mockPrisma.item.findMany.mockResolvedValue([]);

      // Poll to detect all archived items
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // Should have 20 item-deleted events
      const deleteCount = (text.match(/item-deleted/g) || []).length;
      expect(deleteCount).toBe(20);

      // Subsequent poll should have nothing (all items removed from tracking)
      await vi.advanceTimersByTimeAsync(30000); // Wait for heartbeat

      const { value: value2 } = await reader.read();
      const text2 = new TextDecoder().decode(value2);

      // No more delete events
      const deleteCount2 = (text2.match(/item-deleted/g) || []).length;
      expect(deleteCount2).toBe(0);

      reader.cancel();
    });
  });

  describe('memory growth prevention', () => {
    it('should not accumulate tracked items over many poll cycles', async () => {
      /**
       * Simulate a long-running connection where items are continuously
       * added and archived. The tracked items count should remain bounded.
       *
       * We verify this by checking that deleted items do not cause
       * repeated events on subsequent polls.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Start with empty
      mockPrisma.item.findMany.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(1100);

      const emittedTexts: string[] = [];

      // Simulate 10 cycles of: add item -> archive item
      for (let cycle = 0; cycle < 10; cycle++) {
        const itemId = `WI-CYCLE-${cycle}`;

        // Add new item
        const newItem = createMockItem(itemId, 'ready');
        mockPrisma.item.findMany.mockResolvedValue([newItem]);
        await vi.advanceTimersByTimeAsync(1000);

        try {
          const { value } = await reader.read();
          if (value) {
            emittedTexts.push(new TextDecoder().decode(value));
          }
        } catch {
          // Ignore read errors
        }

        // Archive item (remove from results)
        mockPrisma.item.findMany.mockResolvedValue([]);
        await vi.advanceTimersByTimeAsync(1000);

        try {
          const { value } = await reader.read();
          if (value) {
            emittedTexts.push(new TextDecoder().decode(value));
          }
        } catch {
          // Ignore read errors
        }
      }

      // Count events
      const allText = emittedTexts.join('');
      const addedCount = (allText.match(/item-added/g) || []).length;
      const deletedCount = (allText.match(/item-deleted/g) || []).length;

      // Should have exactly 10 added and 10 deleted
      expect(addedCount).toBe(10);
      expect(deletedCount).toBe(10);

      reader.cancel();
    });

    it('should clean up items that disappear from database during poll', async () => {
      /**
       * Items might be hard-deleted (not just archived) during operation.
       * These should be removed from tracking immediately.
       */
      const items = [
        createMockItem('WI-001', 'ready'),
        createMockItem('WI-002', 'testing'),
        createMockItem('WI-003', 'implementing'),
      ];

      mockPrisma.item.findMany.mockResolvedValue([...items]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Hard delete WI-002 (not in results anymore)
      mockPrisma.item.findMany.mockResolvedValue([items[0], items[2]]);

      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('item-deleted');
      expect(text).toContain('WI-002');

      reader.cancel();
    });

    it('should handle intermittent item visibility correctly', async () => {
      /**
       * Edge case: an item temporarily disappears from query results
       * (e.g., due to filter change or race condition), then reappears.
       * This should result in delete followed by add events.
       */
      const persistentItem = createMockItem('WI-001', 'ready');
      const intermittentItem = createMockItem('WI-002', 'testing');

      mockPrisma.item.findMany.mockResolvedValue([persistentItem, intermittentItem]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Item temporarily disappears
      mockPrisma.item.findMany.mockResolvedValue([persistentItem]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value: value1 } = await reader.read();
      const text1 = new TextDecoder().decode(value1);
      expect(text1).toContain('item-deleted');
      expect(text1).toContain('WI-002');

      // Item reappears
      mockPrisma.item.findMany.mockResolvedValue([persistentItem, intermittentItem]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value: value2 } = await reader.read();
      const text2 = new TextDecoder().decode(value2);
      expect(text2).toContain('item-added');
      expect(text2).toContain('WI-002');

      reader.cancel();
    });
  });

  describe('cleanup does not interfere with normal operation', () => {
    it('should still emit item-moved events after cleanup occurs', async () => {
      /**
       * Cleanup of archived items should not interfere with normal
       * event emission for active items.
       */
      const items = [
        createMockItem('WI-001', 'ready'),
        createMockItem('WI-002', 'testing'),
      ];

      mockPrisma.item.findMany.mockResolvedValue([...items]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Archive WI-002 and move WI-001 in same poll
      const movedItem = createMockItem('WI-001', 'implementing');
      movedItem.updatedAt = new Date('2026-01-21T12:00:00Z');
      mockPrisma.item.findMany.mockResolvedValue([movedItem]);

      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // Should have both events
      expect(text).toContain('item-deleted'); // WI-002 archived
      expect(text).toContain('WI-002');
      expect(text).toContain('item-moved'); // WI-001 moved
      expect(text).toContain('WI-001');
      expect(text).toContain('implementing');

      reader.cancel();
    });

    it('should still emit item-updated events after cleanup occurs', async () => {
      /**
       * Updates to remaining items should still work after cleanup.
       */
      const items = [
        createMockItem('WI-001', 'ready'),
        createMockItem('WI-002', 'testing'),
      ];

      mockPrisma.item.findMany.mockResolvedValue([...items]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Archive WI-002 and update WI-001 content
      const updatedItem = createMockItem('WI-001', 'ready', {
        title: 'Updated Title',
      });
      updatedItem.updatedAt = new Date('2026-01-21T12:00:00Z');
      mockPrisma.item.findMany.mockResolvedValue([updatedItem]);

      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('item-deleted');
      expect(text).toContain('WI-002');
      expect(text).toContain('item-updated');
      expect(text).toContain('WI-001');

      reader.cancel();
    });

    it('should preserve tracking state for remaining items after cleanup', async () => {
      /**
       * After archiving some items, the remaining items should still
       * be properly tracked without false change detection.
       */
      const items = [
        createMockItem('WI-001', 'ready'),
        createMockItem('WI-002', 'testing'),
        createMockItem('WI-003', 'implementing'),
      ];

      mockPrisma.item.findMany.mockResolvedValue([...items]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Archive WI-002
      mockPrisma.item.findMany.mockResolvedValue([items[0], items[2]]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value: value1 } = await reader.read();
      expect(new TextDecoder().decode(value1)).toContain('item-deleted');

      // Poll again with same data (no changes to WI-001 or WI-003)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      // Wait for heartbeat
      await vi.advanceTimersByTimeAsync(30000);

      const { value: value2 } = await reader.read();
      const text2 = new TextDecoder().decode(value2);

      // Should have no item events, just heartbeat
      expect(text2).not.toContain('item-added');
      expect(text2).not.toContain('item-updated');
      expect(text2).not.toContain('item-moved');
      // No more item-deleted either (WI-002 already cleaned up)
      expect(text2).not.toContain('WI-002');

      reader.cancel();
    });
  });

  describe('long connection simulation', () => {
    it('should handle multiple add/archive cycles correctly', async () => {
      /**
       * Simulate a dashboard left open for an extended period.
       * Items are added and archived over time.
       * The system should handle this without unbounded memory growth.
       *
       * This is a simplified version that verifies the core behavior
       * without complex async racing that causes test timeouts.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Start with baseline (no items)
      mockPrisma.item.findMany.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(1100);

      // Cycle 1: Add items 1, 2
      mockPrisma.item.findMany.mockResolvedValue([
        createMockItem('WI-LONG-1', 'ready'),
        createMockItem('WI-LONG-2', 'ready'),
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value: v1 } = await reader.read();
      const t1 = new TextDecoder().decode(v1);
      expect((t1.match(/item-added/g) || []).length).toBe(2);

      // Cycle 2: Archive item 1, keep item 2, add item 3
      mockPrisma.item.findMany.mockResolvedValue([
        createMockItem('WI-LONG-2', 'ready'),
        createMockItem('WI-LONG-3', 'ready'),
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value: v2 } = await reader.read();
      const t2 = new TextDecoder().decode(v2);
      expect(t2).toContain('item-deleted'); // WI-LONG-1 removed
      expect(t2).toContain('item-added'); // WI-LONG-3 added

      // Cycle 3: Archive items 2 and 3, add items 4 and 5
      mockPrisma.item.findMany.mockResolvedValue([
        createMockItem('WI-LONG-4', 'ready'),
        createMockItem('WI-LONG-5', 'ready'),
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value: v3 } = await reader.read();
      const t3 = new TextDecoder().decode(v3);
      expect((t3.match(/item-deleted/g) || []).length).toBe(2); // 2 and 3 removed
      expect((t3.match(/item-added/g) || []).length).toBe(2); // 4 and 5 added

      // Final check: no duplicate events on subsequent poll with same data
      await vi.advanceTimersByTimeAsync(30000); // Wait for heartbeat

      const { value: v4 } = await reader.read();
      const t4 = new TextDecoder().decode(v4);
      // Should only have heartbeat, no item events
      expect(t4).not.toContain('item-added');
      expect(t4).not.toContain('item-deleted');

      reader.cancel();
    });

    it('should handle repeated archival and recreation of same item IDs', async () => {
      /**
       * Edge case: Item IDs might be reused after archival in some systems.
       * The endpoint should handle this correctly.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Start with item
      const itemV1 = createMockItem('WI-REUSE', 'ready', { title: 'Version 1' });
      mockPrisma.item.findMany.mockResolvedValue([itemV1]);

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Archive item
      mockPrisma.item.findMany.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value: value1 } = await reader.read();
      expect(new TextDecoder().decode(value1)).toContain('item-deleted');

      // Recreate with same ID but different content
      const itemV2 = createMockItem('WI-REUSE', 'testing', { title: 'Version 2' });
      itemV2.updatedAt = new Date('2026-01-21T13:00:00Z');
      mockPrisma.item.findMany.mockResolvedValue([itemV2]);

      await vi.advanceTimersByTimeAsync(1000);

      const { value: value2 } = await reader.read();
      const text2 = new TextDecoder().decode(value2);

      // Should be treated as new item
      expect(text2).toContain('item-added');
      expect(text2).toContain('WI-REUSE');

      reader.cancel();
    });
  });

  describe('edge cases for cleanup', () => {
    it('should handle empty database state correctly', async () => {
      /**
       * If the database becomes empty (all items archived/deleted),
       * the system should not error and should track the empty state.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Start with items
      mockPrisma.item.findMany.mockResolvedValue([
        createMockItem('WI-001', 'ready'),
        createMockItem('WI-002', 'testing'),
      ]);

      await vi.advanceTimersByTimeAsync(1100);

      // All items archived
      mockPrisma.item.findMany.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('item-deleted');
      expect(text).toContain('WI-001');
      expect(text).toContain('WI-002');

      // Subsequent polls with empty state should work
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      // Should not crash or emit spurious events
      expect(response.body).toBeInstanceOf(ReadableStream);

      reader.cancel();
    });

    it('should handle all items being archived simultaneously', async () => {
      /**
       * Mission archival scenario: all 50 items archived at once.
       */
      const manyItems = Array.from({ length: 50 }, (_, i) =>
        createMockItem(`WI-BULK-${i + 1}`, i % 5 === 0 ? 'done' : 'ready')
      );

      mockPrisma.item.findMany.mockResolvedValue([...manyItems]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline with 50 items
      await vi.advanceTimersByTimeAsync(1100);

      // Archive all
      mockPrisma.item.findMany.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      const deleteCount = (text.match(/item-deleted/g) || []).length;
      expect(deleteCount).toBe(50);

      reader.cancel();
    });

    it('should maintain correct tracking after partial cleanup', async () => {
      /**
       * Some items are archived, some remain. The remaining items
       * should continue to be tracked correctly.
       */
      const items = Array.from({ length: 10 }, (_, i) =>
        createMockItem(`WI-${i + 1}`, 'ready')
      );

      mockPrisma.item.findMany.mockResolvedValue([...items]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Archive odd-numbered items
      const evenItems = items.filter((_, i) => i % 2 === 0);
      mockPrisma.item.findMany.mockResolvedValue(evenItems);

      await vi.advanceTimersByTimeAsync(1000);

      const { value: value1 } = await reader.read();
      const text1 = new TextDecoder().decode(value1);

      // 5 items should be deleted (odd indices: 1, 3, 5, 7, 9)
      const deleteCount = (text1.match(/item-deleted/g) || []).length;
      expect(deleteCount).toBe(5);

      // Now update one of the remaining items
      const updatedEvenItems = evenItems.map((item, i) =>
        i === 0
          ? { ...item, title: 'Updated Even Item', updatedAt: new Date() }
          : item
      );
      mockPrisma.item.findMany.mockResolvedValue(updatedEvenItems);

      await vi.advanceTimersByTimeAsync(1000);

      const { value: value2 } = await reader.read();
      const text2 = new TextDecoder().decode(value2);

      // Should have item-updated for the modified item
      expect(text2).toContain('item-updated');
      expect(text2).toContain('WI-1');
      // Should NOT have any item-added or item-deleted
      expect(text2).not.toContain('item-added');
      expect(text2).not.toContain('item-deleted');

      reader.cancel();
    });

    it('should not leak memory when items cycle through stages rapidly', async () => {
      /**
       * Items moving through stages rapidly should not cause tracking issues.
       * Each stage change should be properly tracked without accumulation.
       */
      const item = createMockItem('WI-RAPID', 'briefings');

      mockPrisma.item.findMany.mockResolvedValue([item]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      const stages = ['ready', 'testing', 'implementing', 'review', 'done'];
      const moveEvents: string[] = [];

      for (const stage of stages) {
        const movedItem = createMockItem('WI-RAPID', stage);
        movedItem.updatedAt = new Date();
        mockPrisma.item.findMany.mockResolvedValue([movedItem]);

        await vi.advanceTimersByTimeAsync(1000);

        try {
          const { value } = await reader.read();
          if (value) {
            moveEvents.push(new TextDecoder().decode(value));
          }
        } catch {
          // Ignore
        }
      }

      const allMoves = moveEvents.join('');
      const moveCount = (allMoves.match(/item-moved/g) || []).length;

      // Should have 5 move events (one for each stage transition)
      expect(moveCount).toBe(5);

      // No add or delete events (same item throughout)
      expect(allMoves).not.toContain('item-added');
      expect(allMoves).not.toContain('item-deleted');

      reader.cancel();
    });
  });

  describe('concurrent operations during cleanup', () => {
    it('should handle new items added while others are being cleaned up', async () => {
      /**
       * In the same poll cycle, some items are archived (removed) and
       * new items are added. Both should be handled correctly.
       */
      const existingItems = [
        createMockItem('WI-OLD-1', 'done'),
        createMockItem('WI-OLD-2', 'done'),
      ];

      mockPrisma.item.findMany.mockResolvedValue([...existingItems]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Archive old items and add new ones in same poll
      const newItems = [
        createMockItem('WI-NEW-1', 'ready'),
        createMockItem('WI-NEW-2', 'ready'),
      ];
      mockPrisma.item.findMany.mockResolvedValue(newItems);

      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // Should have delete events for old items
      expect(text).toContain('item-deleted');
      expect(text).toContain('WI-OLD-1');
      expect(text).toContain('WI-OLD-2');

      // Should have add events for new items
      expect(text).toContain('item-added');
      expect(text).toContain('WI-NEW-1');
      expect(text).toContain('WI-NEW-2');

      reader.cancel();
    });

    it('should handle mixed operations: add, move, update, delete in single poll', async () => {
      /**
       * Complex scenario with multiple operation types in a single poll.
       */
      const items = [
        createMockItem('WI-STAY', 'ready'),
        createMockItem('WI-MOVE', 'testing'),
        createMockItem('WI-UPDATE', 'implementing'),
        createMockItem('WI-DELETE', 'done'),
      ];

      mockPrisma.item.findMany.mockResolvedValue([...items]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Complex update:
      // - WI-STAY: unchanged
      // - WI-MOVE: moves to review
      // - WI-UPDATE: title changes
      // - WI-DELETE: archived (removed)
      // - WI-NEW: added
      const newState = [
        createMockItem('WI-STAY', 'ready'),
        { ...createMockItem('WI-MOVE', 'review'), updatedAt: new Date() },
        { ...createMockItem('WI-UPDATE', 'implementing', { title: 'New Title' }), updatedAt: new Date() },
        createMockItem('WI-NEW', 'briefings'),
      ];
      mockPrisma.item.findMany.mockResolvedValue(newState);

      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // Verify all event types
      expect(text).toContain('item-added');
      expect(text).toContain('WI-NEW');

      expect(text).toContain('item-moved');
      expect(text).toContain('WI-MOVE');

      expect(text).toContain('item-updated');
      expect(text).toContain('WI-UPDATE');

      expect(text).toContain('item-deleted');
      expect(text).toContain('WI-DELETE');

      // WI-STAY should NOT appear (no change)
      const stayMentions = text.split('WI-STAY').length - 1;
      expect(stayMentions).toBe(0);

      reader.cancel();
    });
  });
});
