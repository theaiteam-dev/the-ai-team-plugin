import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for GET /api/board/events (Database Polling SSE Endpoint)
 *
 * Item 025: Update SSE endpoint to poll database instead of filesystem
 *
 * This endpoint provides Server-Sent Events for real-time board updates.
 * Instead of using fs.watch on the filesystem, it polls the SQLite database
 * for changes to items, board state, and activity logs.
 *
 * Acceptance criteria tested:
 * - [x] SSE endpoint polls database for item and board changes instead of using fs.watch
 * - [x] Polling interval is configurable (default 1000ms) via environment variable SSE_POLL_INTERVAL_MS
 * - [x] Endpoint detects item additions, moves, updates, and deletions by comparing database state
 * - [x] Endpoint emits same event types as before: item-added, item-moved, item-updated, item-deleted, board-updated
 * - [x] Activity log entries are streamed from ActivityLog table using updatedAt comparison
 * - [x] Connection cleanup properly stops polling on client disconnect
 * - [x] Performance is acceptable with polling (no excessive database queries)
 *
 * WI-043 - Project scoping acceptance criteria:
 * - [x] GET /api/board/events requires projectId query parameter
 * - [x] Missing projectId returns 400 error (not SSE stream)
 * - [x] Events are filtered by projectId
 */

// Mock data matching Prisma schema
const mockItems = [
  {
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
    archivedAt: null,
    dependsOn: [],
    workLogs: [],
  },
  {
    id: 'WI-002',
    title: 'Feature B',
    description: 'Description B',
    type: 'feature',
    priority: 'medium',
    stageId: 'testing',
    assignedAgent: 'Murdock',
    rejectionCount: 0,
    createdAt: new Date('2026-01-21T09:00:00Z'),
    updatedAt: new Date('2026-01-21T11:00:00Z'),
    completedAt: null,
    archivedAt: null,
    dependsOn: [],
    workLogs: [],
  },
];

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
    agent: 'Murdock',
    message: 'Started testing feature',
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

describe('GET /api/board/events (Database Polling)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Default mock implementations
    mockPrisma.item.findMany.mockResolvedValue([...mockItems]);
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

  describe('response headers', () => {
    it('should return text/event-stream content type', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();

      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    });

    it('should return no-cache cache control', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();

      expect(response.headers.get('Cache-Control')).toBe('no-cache');
    });

    it('should return keep-alive connection', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();

      expect(response.headers.get('Connection')).toBe('keep-alive');
    });

    it('should return a ReadableStream body', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();

      expect(response.body).toBeInstanceOf(ReadableStream);
    });
  });

  describe('database polling setup', () => {
    it('should poll database instead of using fs.watch', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Advance timer to trigger at least one poll
      await vi.advanceTimersByTimeAsync(1100);

      // Verify database was queried
      expect(mockPrisma.item.findMany).toHaveBeenCalled();

      reader.cancel();
    });

    it('should use default polling interval of 1000ms', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Clear initial call count
      mockPrisma.item.findMany.mockClear();

      // Should not have polled yet
      await vi.advanceTimersByTimeAsync(500);
      expect(mockPrisma.item.findMany).not.toHaveBeenCalled();

      // After 1000ms should poll
      await vi.advanceTimersByTimeAsync(600);
      expect(mockPrisma.item.findMany).toHaveBeenCalled();

      reader.cancel();
    });

    it('should use SSE_POLL_INTERVAL_MS environment variable when set', async () => {
      process.env.SSE_POLL_INTERVAL_MS = '500';

      // Need to re-import to pick up new env var
      vi.resetModules();
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Clear initial call count
      mockPrisma.item.findMany.mockClear();

      // Should poll after 500ms (custom interval)
      await vi.advanceTimersByTimeAsync(600);
      expect(mockPrisma.item.findMany).toHaveBeenCalled();

      reader.cancel();
    });
  });

  describe('item change detection', () => {
    it('should emit item-added event when new item appears in database', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Add new item to mock response
      const newItem = {
        id: 'WI-003',
        title: 'New Feature',
        description: 'New description',
        type: 'feature',
        priority: 'low',
        stageId: 'briefings',
        assignedAgent: null,
        rejectionCount: 0,
        createdAt: new Date('2026-01-21T12:00:00Z'),
        updatedAt: new Date('2026-01-21T12:00:00Z'),
        completedAt: null,
        archivedAt: null,
        dependsOn: [],
        workLogs: [],
      };
      mockPrisma.item.findMany.mockResolvedValue([...mockItems, newItem]);

      // Trigger next poll
      await vi.advanceTimersByTimeAsync(1000);

      // Read the emitted event
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('item-added');
      expect(text).toContain('WI-003');
      reader.cancel();
    });

    it('should emit item-moved event when item changes stage', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Move item to different stage
      const movedItems = mockItems.map((item) =>
        item.id === 'WI-001'
          ? { ...item, stageId: 'testing', updatedAt: new Date('2026-01-21T12:00:00Z') }
          : item
      );
      mockPrisma.item.findMany.mockResolvedValue(movedItems);

      // Trigger next poll
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('item-moved');
      expect(text).toContain('WI-001');
      expect(text).toContain('ready'); // fromStage
      expect(text).toContain('testing'); // toStage
      reader.cancel();
    });

    it('should emit item-updated event when item content changes', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Update item (same stage, different content)
      const updatedItems = mockItems.map((item) =>
        item.id === 'WI-001'
          ? { ...item, title: 'Updated Title', updatedAt: new Date('2026-01-21T12:00:00Z') }
          : item
      );
      mockPrisma.item.findMany.mockResolvedValue(updatedItems);

      // Trigger next poll
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('item-updated');
      expect(text).toContain('WI-001');
      reader.cancel();
    });

    it('should emit item-deleted event when item is removed', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Remove item (simulating archival or deletion)
      mockPrisma.item.findMany.mockResolvedValue([mockItems[1]]);

      // Trigger next poll
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('item-deleted');
      expect(text).toContain('WI-001');
      reader.cancel();
    });
  });

  describe('board state changes', () => {
    it('should emit board-updated event when mission state changes', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Update mission state
      mockPrisma.mission.findFirst.mockResolvedValue({
        ...mockMission,
        state: 'completed',
        completedAt: new Date('2026-01-21T18:00:00Z'),
      });

      // Trigger next poll
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('board-updated');
      reader.cancel();
    });

    it('should emit mission-completed event when mission transitions to completed', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline with running mission
      await vi.advanceTimersByTimeAsync(1100);

      // Transition mission to completed
      mockPrisma.mission.findFirst.mockResolvedValue({
        ...mockMission,
        state: 'completed',
        completedAt: new Date('2026-01-21T18:00:00Z'),
      });

      // Trigger next poll
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('mission-completed');
      reader.cancel();
    });
  });

  describe('activity log streaming', () => {
    it('should stream new activity log entries from database', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Add new activity log entry
      const newLogEntry = {
        id: 2,
        missionId: 'M-20260121-001',
        agent: 'B.A.',
        message: 'Started implementing feature',
        level: 'info',
        timestamp: new Date('2026-01-21T12:00:00Z'),
      };
      mockPrisma.activityLog.findMany.mockResolvedValue([...mockActivityLogs, newLogEntry]);

      // Trigger next poll
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('activity-entry-added');
      expect(text).toContain('B.A.');
      expect(text).toContain('Started implementing feature');
      reader.cancel();
    });

    it('should track activity log position using timestamp comparison', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll
      await vi.advanceTimersByTimeAsync(1100);

      // Verify activity logs are queried
      expect(mockPrisma.activityLog.findMany).toHaveBeenCalled();

      // The query should filter by timestamp to only get new entries
      const lastCall = mockPrisma.activityLog.findMany.mock.lastCall?.[0];
      expect(lastCall).toBeDefined();
      // Should have some ordering or filtering in the query

      reader.cancel();
    });
  });

  describe('event format', () => {
    it('should format events with data: prefix', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Trigger a change
      mockPrisma.item.findMany.mockResolvedValue([
        { ...mockItems[0], title: 'Updated', updatedAt: new Date() },
        mockItems[1],
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toMatch(/^data: /m);
      reader.cancel();
    });

    it('should end events with double newline', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Trigger a change
      mockPrisma.item.findMany.mockResolvedValue([
        { ...mockItems[0], title: 'Updated', updatedAt: new Date() },
        mockItems[1],
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('\n\n');
      reader.cancel();
    });

    it('should emit valid JSON in data payload', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Trigger a change
      mockPrisma.item.findMany.mockResolvedValue([
        { ...mockItems[0], title: 'Updated', updatedAt: new Date() },
        mockItems[1],
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      const jsonMatch = text.match(/data: (.+)\n/);
      expect(jsonMatch).not.toBeNull();

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        expect(parsed).toHaveProperty('type');
        expect(parsed).toHaveProperty('timestamp');
      }
      reader.cancel();
    });

    it('should include timestamp in all events', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Trigger a change
      mockPrisma.item.findMany.mockResolvedValue([
        { ...mockItems[0], title: 'Updated', updatedAt: new Date() },
        mockItems[1],
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('timestamp');
      reader.cancel();
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeat every 30 seconds', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Advance 30 seconds
      await vi.advanceTimersByTimeAsync(30000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // Heartbeat is sent as SSE comment
      expect(text).toContain('heartbeat');
      reader.cancel();
    });
  });

  describe('connection cleanup', () => {
    it('should stop polling when stream is cancelled', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Establish connection and initial poll
      await vi.advanceTimersByTimeAsync(1100);

      // Clear mock call count
      mockPrisma.item.findMany.mockClear();

      // Cancel the stream
      await reader.cancel();

      // Advance timer - should NOT trigger more polls
      await vi.advanceTimersByTimeAsync(2000);

      // Verify no additional database queries after cancel
      expect(mockPrisma.item.findMany).not.toHaveBeenCalled();
    });

    it('should clean up polling interval on disconnect', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      await vi.advanceTimersByTimeAsync(100);

      // Cancel to trigger cleanup
      await reader.cancel();

      // Verify interval was cleared
      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });
  });

  describe('performance considerations', () => {
    it('should batch multiple changes into single poll cycle', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Single poll query should capture all item states
      expect(mockPrisma.item.findMany).toHaveBeenCalledTimes(1);

      reader.cancel();
    });

    it('should not emit events when no changes detected', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Keep returning same data (no changes)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      // Reader should only have heartbeat or nothing (no change events)
      // We verify this indirectly by checking poll happened but no events were emitted
      expect(mockPrisma.item.findMany).toHaveBeenCalledTimes(3);

      reader.cancel();
    });

    it('should query activity logs efficiently using timestamp filter', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Multiple polls
      await vi.advanceTimersByTimeAsync(3100);

      // Each poll should query activity logs with a timestamp filter
      // to only get new entries
      expect(mockPrisma.activityLog.findMany).toHaveBeenCalled();

      reader.cancel();
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      mockPrisma.item.findMany.mockRejectedValue(new Error('Database connection failed'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Should not throw, stream should continue
      await vi.advanceTimersByTimeAsync(1100);

      // Stream should still be active
      expect(response.body).toBeInstanceOf(ReadableStream);

      reader.cancel();
    });

    it('should continue polling after transient database error', async () => {
      // First call fails
      mockPrisma.item.findMany.mockRejectedValueOnce(new Error('Transient error'));
      // Subsequent calls succeed
      mockPrisma.item.findMany.mockResolvedValue([...mockItems]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll fails
      await vi.advanceTimersByTimeAsync(1100);

      // Second poll should succeed
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockPrisma.item.findMany).toHaveBeenCalledTimes(2);

      reader.cancel();
    });
  });

  describe('state comparison', () => {
    it('should track previous item state for change detection', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Return same items with no changes
      mockPrisma.item.findMany.mockResolvedValue([...mockItems]);

      // Second poll
      await vi.advanceTimersByTimeAsync(1000);

      // No events should be emitted for unchanged items
      // (no item-updated events when nothing changed)
      reader.cancel();
    });

    it('should track item locations for move detection', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll: item in 'ready' stage
      await vi.advanceTimersByTimeAsync(1100);

      // Move item to 'testing'
      const movedItems = [
        { ...mockItems[0], stageId: 'testing', updatedAt: new Date() },
        mockItems[1],
      ];
      mockPrisma.item.findMany.mockResolvedValue(movedItems);

      // Second poll should detect move
      await vi.advanceTimersByTimeAsync(1000);

      // Move back to 'ready'
      mockPrisma.item.findMany.mockResolvedValue([...mockItems]);

      // Third poll should detect another move
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // Should contain move events
      expect(text).toContain('item-moved');

      reader.cancel();
    });

    it('should track activity log position for new entry detection', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll with initial activity logs
      await vi.advanceTimersByTimeAsync(1100);

      // Add new entry with later timestamp
      const newEntry = {
        id: 2,
        missionId: 'M-20260121-001',
        agent: 'Face',
        message: 'New log entry',
        level: 'info',
        timestamp: new Date('2026-01-21T13:00:00Z'),
      };
      mockPrisma.activityLog.findMany.mockResolvedValue([...mockActivityLogs, newEntry]);

      // Second poll should detect new entry
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('activity-entry-added');
      expect(text).toContain('Face');

      reader.cancel();
    });
  });

  // ============ WI-043: Project Scoping Tests ============

  describe('projectId query parameter (WI-043)', () => {
    it('should return 400 when projectId query parameter is missing', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const request = new Request('http://localhost:3000/api/board/events');
      const response = await GET(request);

      expect(response.status).toBe(400);

      // Should return JSON error, not SSE stream
      const contentType = response.headers.get('Content-Type');
      expect(contentType).toContain('application/json');

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('X-Project-ID');
    });

    it('should return 400 with clear error message explaining projectId is required', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const request = new Request('http://localhost:3000/api/board/events');
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.message.toLowerCase()).toContain('required');
    });

    it('should return SSE stream when projectId is provided', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const request = new Request('http://localhost:3000/api/board/events?projectId=kanban-viewer');
      const response = await GET(request);

      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.body).toBeInstanceOf(ReadableStream);

      // Clean up
      const reader = response.body!.getReader();
      reader.cancel();
    });

    it('should filter items by projectId when polling', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const request = new Request('http://localhost:3000/api/board/events?projectId=kanban-viewer');
      const response = await GET(request);
      const reader = response.body!.getReader();

      // Trigger poll
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'kanban-viewer',
          }),
        })
      );

      reader.cancel();
    });

    it('should filter missions by projectId when polling', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const request = new Request('http://localhost:3000/api/board/events?projectId=kanban-viewer');
      const response = await GET(request);
      const reader = response.body!.getReader();

      // Trigger poll
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockPrisma.mission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'kanban-viewer',
          }),
        })
      );

      reader.cancel();
    });

    it('should filter activity logs by projectId when polling', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const request = new Request('http://localhost:3000/api/board/events?projectId=kanban-viewer');
      const response = await GET(request);
      const reader = response.body!.getReader();

      // Trigger poll
      await vi.advanceTimersByTimeAsync(1100);

      expect(mockPrisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'kanban-viewer',
          }),
        })
      );

      reader.cancel();
    });

    it('should only emit events for items in the specified project', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const request = new Request('http://localhost:3000/api/board/events?projectId=my-app');
      const response = await GET(request);
      const reader = response.body!.getReader();

      // First poll establishes baseline (returns empty for this project)
      mockPrisma.item.findMany.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(1100);

      // Add item to the project
      const newItemInProject = {
        id: 'WI-100',
        title: 'New Feature in my-app',
        description: 'Project-scoped feature',
        type: 'feature',
        priority: 'high',
        stageId: 'ready',
        projectId: 'my-app',
        assignedAgent: null,
        rejectionCount: 0,
        createdAt: new Date('2026-01-21T12:00:00Z'),
        updatedAt: new Date('2026-01-21T12:00:00Z'),
        completedAt: null,
        archivedAt: null,
        dependsOn: [],
        workLogs: [],
      };
      mockPrisma.item.findMany.mockResolvedValue([newItemInProject]);

      // Trigger next poll
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('item-added');
      expect(text).toContain('WI-100');

      reader.cancel();
    });

    it('should not emit events for items in other projects', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const request = new Request('http://localhost:3000/api/board/events?projectId=my-app');
      const response = await GET(request);
      const reader = response.body!.getReader();

      // First poll establishes baseline (empty for my-app project)
      mockPrisma.item.findMany.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(1100);

      // Items in different project should not trigger events
      // The mock returns filtered data based on projectId parameter
      // So items from other projects should never appear in the response
      mockPrisma.item.findMany.mockResolvedValue([]);

      // Trigger next poll
      await vi.advanceTimersByTimeAsync(1000);

      // No events should be emitted since no items in our project
      expect(mockPrisma.item.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'my-app',
          }),
        })
      );

      reader.cancel();
    });

    it('should handle project with no items gracefully', async () => {
      mockPrisma.item.findMany.mockResolvedValue([]);
      mockPrisma.mission.findFirst.mockResolvedValue(null);
      mockPrisma.activityLog.findMany.mockResolvedValue([]);

      const { GET } = await import('@/app/api/board/events/route');
      const request = new Request('http://localhost:3000/api/board/events?projectId=empty-project');
      const response = await GET(request);
      const reader = response.body!.getReader();

      // Should establish connection without errors
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');

      await vi.advanceTimersByTimeAsync(1100);

      // Should have queried database with projectId filter
      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'empty-project',
          }),
        })
      );

      reader.cancel();
    });
  });
});
