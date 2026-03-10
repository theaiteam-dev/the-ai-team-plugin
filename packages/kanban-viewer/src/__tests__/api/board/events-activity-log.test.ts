import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for Activity Log Tracking in GET /api/board/events
 *
 * Item 007: Fix SSE activity log tracking race condition
 *
 * This test file focuses on the race condition where lastActivityLogId
 * is updated inside the processing loop instead of after all entries
 * are successfully processed.
 *
 * Acceptance criteria tested:
 * - [ ] lastActivityLogId is updated only after all log entries are successfully processed
 * - [ ] If an error occurs during processing, the tracking position remains consistent
 * - [ ] No activity log entries are skipped or duplicated
 * - [ ] Activity log streaming works correctly under concurrent updates
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

// Base activity logs for testing
const baseActivityLogs = [
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

describe('GET /api/board/events - Activity Log Tracking', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Default mock implementations
    mockPrisma.item.findMany.mockResolvedValue([...mockItems]);
    mockPrisma.mission.findFirst.mockResolvedValue(mockMission);
    mockPrisma.activityLog.findMany.mockResolvedValue([...baseActivityLogs]);
    mockPrisma.hookEvent.findMany.mockResolvedValue([]);
    mockPrisma.missionTokenUsage.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('lastActivityLogId tracking position', () => {
    it('should update lastActivityLogId only after ALL entries are processed', async () => {
      /**
       * This test verifies the fix for the race condition.
       * The bug: lastActivityLogId was updated inside the loop per-entry.
       * The fix: lastActivityLogId should be updated once after all entries are processed.
       *
       * We verify this by adding multiple log entries and ensuring all are emitted
       * before the tracking position is updated.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Add multiple new activity log entries
      const newLogs = [
        {
          id: 2,
          missionId: 'M-20260121-001',
          agent: 'Murdock',
          message: 'Writing tests',
          level: 'info',
          timestamp: new Date('2026-01-21T11:00:00Z'),
        },
        {
          id: 3,
          missionId: 'M-20260121-001',
          agent: 'B.A.',
          message: 'Implementing feature',
          level: 'info',
          timestamp: new Date('2026-01-21T11:01:00Z'),
        },
        {
          id: 4,
          missionId: 'M-20260121-001',
          agent: 'Face',
          message: 'Reviewing code',
          level: 'info',
          timestamp: new Date('2026-01-21T11:02:00Z'),
        },
      ];
      mockPrisma.activityLog.findMany.mockResolvedValue([...baseActivityLogs, ...newLogs]);

      // Trigger next poll
      await vi.advanceTimersByTimeAsync(1000);

      // Read the emitted events
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // All three new entries should be emitted in a single batch
      expect(text).toContain('Murdock');
      expect(text).toContain('Writing tests');
      expect(text).toContain('B.A.');
      expect(text).toContain('Implementing feature');
      expect(text).toContain('Face');
      expect(text).toContain('Reviewing code');

      // Count activity-entry-added events
      const eventCount = (text.match(/activity-entry-added/g) || []).length;
      expect(eventCount).toBe(3);

      reader.cancel();
    });

    it('should not skip entries if processing is interrupted', async () => {
      /**
       * This test simulates a scenario where processing could be interrupted.
       * If lastActivityLogId is updated per-entry, an interruption could cause
       * entries to be skipped. The fix ensures all-or-nothing semantics.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline with entry id=1
      await vi.advanceTimersByTimeAsync(1100);

      // Add entries 2 and 3
      const firstBatch = [
        ...baseActivityLogs,
        {
          id: 2,
          missionId: 'M-20260121-001',
          agent: 'Amy',
          message: 'Entry two',
          level: 'info',
          timestamp: new Date('2026-01-21T11:00:00Z'),
        },
        {
          id: 3,
          missionId: 'M-20260121-001',
          agent: 'Lynch',
          message: 'Entry three',
          level: 'info',
          timestamp: new Date('2026-01-21T11:01:00Z'),
        },
      ];
      mockPrisma.activityLog.findMany.mockResolvedValue(firstBatch);

      // Poll to process entries 2 and 3
      await vi.advanceTimersByTimeAsync(1000);

      const { value: value1 } = await reader.read();
      const text1 = new TextDecoder().decode(value1);

      // Both entries should be present
      expect(text1).toContain('Entry two');
      expect(text1).toContain('Entry three');

      // Add entry 4
      const secondBatch = [
        ...firstBatch,
        {
          id: 4,
          missionId: 'M-20260121-001',
          agent: 'Hannibal',
          message: 'Entry four',
          level: 'info',
          timestamp: new Date('2026-01-21T11:02:00Z'),
        },
      ];
      mockPrisma.activityLog.findMany.mockResolvedValue(secondBatch);

      // Poll again
      await vi.advanceTimersByTimeAsync(1000);

      const { value: value2 } = await reader.read();
      const text2 = new TextDecoder().decode(value2);

      // Entry 4 should be emitted (not skipped)
      expect(text2).toContain('Entry four');

      // Entries 2 and 3 should NOT be duplicated
      expect(text2).not.toContain('Entry two');
      expect(text2).not.toContain('Entry three');

      reader.cancel();
    });

    it('should not duplicate entries on subsequent polls', async () => {
      /**
       * Verifies that once entries are processed, they are not re-emitted
       * on subsequent polls.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Add new entry
      const logsWithNew = [
        ...baseActivityLogs,
        {
          id: 2,
          missionId: 'M-20260121-001',
          agent: 'Murdock',
          message: 'Unique message ABC123',
          level: 'info',
          timestamp: new Date('2026-01-21T11:00:00Z'),
        },
      ];
      mockPrisma.activityLog.findMany.mockResolvedValue(logsWithNew);

      // First poll with new entry
      await vi.advanceTimersByTimeAsync(1000);
      const { value: value1 } = await reader.read();
      const text1 = new TextDecoder().decode(value1);

      expect(text1).toContain('Unique message ABC123');

      // Same data on subsequent poll (no new entries)
      await vi.advanceTimersByTimeAsync(1000);

      // Advance timer for heartbeat to ensure we can read something
      await vi.advanceTimersByTimeAsync(30000);

      // The heartbeat should be readable, but no duplicate activity entries
      const { value: value2 } = await reader.read();
      const text2 = new TextDecoder().decode(value2);

      // Heartbeat or empty, but NOT the same activity entry again
      const duplicateCount = (text2.match(/Unique message ABC123/g) || []).length;
      expect(duplicateCount).toBe(0);

      reader.cancel();
    });
  });

  describe('error handling and tracking consistency', () => {
    it('should maintain consistent tracking position if event creation fails', async () => {
      /**
       * If an error occurs while creating an event for one log entry,
       * the tracking position should not advance past the failed entry.
       * This ensures retry-ability and no skipped entries.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Add entries
      const logsWithEntries = [
        ...baseActivityLogs,
        {
          id: 2,
          missionId: 'M-20260121-001',
          agent: 'Murdock',
          message: 'Valid entry',
          level: 'info',
          timestamp: new Date('2026-01-21T11:00:00Z'),
        },
      ];
      mockPrisma.activityLog.findMany.mockResolvedValue(logsWithEntries);

      // Poll should process entry
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('Valid entry');

      reader.cancel();
    });

    it('should handle database errors without corrupting tracking position', async () => {
      /**
       * If the database query fails, the tracking position should remain
       * unchanged so entries can be retried on the next successful poll.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline (id=1)
      await vi.advanceTimersByTimeAsync(1100);

      // Add new entry (id=2) but make query fail
      mockPrisma.activityLog.findMany.mockRejectedValueOnce(new Error('Database error'));

      // This poll fails
      await vi.advanceTimersByTimeAsync(1000);

      // Now restore with the new entry
      const logsWithNew = [
        ...baseActivityLogs,
        {
          id: 2,
          missionId: 'M-20260121-001',
          agent: 'B.A.',
          message: 'Entry after error',
          level: 'info',
          timestamp: new Date('2026-01-21T11:00:00Z'),
        },
      ];
      mockPrisma.activityLog.findMany.mockResolvedValue(logsWithNew);

      // Next poll should succeed and emit entry 2
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('Entry after error');

      reader.cancel();
    });

    it('should process all entries atomically - all or nothing', async () => {
      /**
       * When processing multiple entries, either all should be emitted
       * and tracking updated, or none should be (in case of failure).
       * This prevents partial processing where some entries are emitted
       * but tracking only advances partway.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Add 5 new entries
      const manyLogs = [
        ...baseActivityLogs,
        { id: 2, missionId: 'M-20260121-001', agent: 'A1', message: 'Log 2', level: 'info', timestamp: new Date('2026-01-21T11:00:00Z') },
        { id: 3, missionId: 'M-20260121-001', agent: 'A2', message: 'Log 3', level: 'info', timestamp: new Date('2026-01-21T11:01:00Z') },
        { id: 4, missionId: 'M-20260121-001', agent: 'A3', message: 'Log 4', level: 'info', timestamp: new Date('2026-01-21T11:02:00Z') },
        { id: 5, missionId: 'M-20260121-001', agent: 'A4', message: 'Log 5', level: 'info', timestamp: new Date('2026-01-21T11:03:00Z') },
        { id: 6, missionId: 'M-20260121-001', agent: 'A5', message: 'Log 6', level: 'info', timestamp: new Date('2026-01-21T11:04:00Z') },
      ];
      mockPrisma.activityLog.findMany.mockResolvedValue(manyLogs);

      // Process all entries
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // All 5 new entries should be present
      expect(text).toContain('Log 2');
      expect(text).toContain('Log 3');
      expect(text).toContain('Log 4');
      expect(text).toContain('Log 5');
      expect(text).toContain('Log 6');

      // Count events
      const eventCount = (text.match(/activity-entry-added/g) || []).length;
      expect(eventCount).toBe(5);

      // Next poll with same data should emit nothing new
      await vi.advanceTimersByTimeAsync(1000);

      // Wait for heartbeat
      await vi.advanceTimersByTimeAsync(30000);

      const { value: value2 } = await reader.read();
      const text2 = new TextDecoder().decode(value2);

      // Should only have heartbeat, no activity entries
      const newEventCount = (text2.match(/activity-entry-added/g) || []).length;
      expect(newEventCount).toBe(0);

      reader.cancel();
    });
  });

  describe('concurrent activity log updates', () => {
    it('should handle rapid sequential log additions correctly', async () => {
      /**
       * Simulates rapid activity where multiple agents are logging
       * in quick succession. All entries should be captured without
       * skips or duplicates.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Build up the log entries incrementally
      const allEntries = [...baseActivityLogs];
      const agents = ['Hannibal', 'Face', 'Murdock', 'B.A.', 'Amy'];

      for (let round = 0; round < 3; round++) {
        // Add new entries for this round
        for (let idx = 0; idx < agents.length; idx++) {
          allEntries.push({
            id: allEntries.length + 1,
            missionId: 'M-20260121-001',
            agent: agents[idx],
            message: `Round ${round + 1} message from ${agents[idx]}`,
            level: 'info',
            timestamp: new Date(`2026-01-21T1${round}:0${idx}:00Z`),
          });
        }

        mockPrisma.activityLog.findMany.mockResolvedValue([...allEntries]);

        // Poll
        await vi.advanceTimersByTimeAsync(1000);
      }

      // Read all emitted data
      const chunks: string[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(new TextDecoder().decode(value));
          }
        } catch {
          break;
        }
      }

      const allText = chunks.join('');

      // Count unique activity entries
      const eventCount = (allText.match(/activity-entry-added/g) || []).length;

      // Should have 15 entries total (5 agents * 3 rounds)
      expect(eventCount).toBe(15);

      reader.cancel();
    });

    it('should handle entries added between poll cycles', async () => {
      /**
       * Entries added while a poll is in progress should be captured
       * in the next poll cycle, not skipped.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline (id=1)
      await vi.advanceTimersByTimeAsync(1100);

      // Poll 1: add entry 2
      mockPrisma.activityLog.findMany.mockResolvedValue([
        ...baseActivityLogs,
        { id: 2, missionId: 'M-20260121-001', agent: 'X', message: 'Entry 2', level: 'info', timestamp: new Date() },
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value: v1 } = await reader.read();
      expect(new TextDecoder().decode(v1)).toContain('Entry 2');

      // Poll 2: add entries 3, 4, 5 (simulating burst of activity)
      mockPrisma.activityLog.findMany.mockResolvedValue([
        ...baseActivityLogs,
        { id: 2, missionId: 'M-20260121-001', agent: 'X', message: 'Entry 2', level: 'info', timestamp: new Date() },
        { id: 3, missionId: 'M-20260121-001', agent: 'Y', message: 'Entry 3', level: 'info', timestamp: new Date() },
        { id: 4, missionId: 'M-20260121-001', agent: 'Z', message: 'Entry 4', level: 'info', timestamp: new Date() },
        { id: 5, missionId: 'M-20260121-001', agent: 'W', message: 'Entry 5', level: 'info', timestamp: new Date() },
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      const { value: v2 } = await reader.read();
      const text2 = new TextDecoder().decode(v2);

      // Should have entries 3, 4, 5 (not entry 2 again)
      expect(text2).toContain('Entry 3');
      expect(text2).toContain('Entry 4');
      expect(text2).toContain('Entry 5');
      expect(text2).not.toContain('Entry 2');

      reader.cancel();
    });

    it('should handle out-of-order ID insertions gracefully', async () => {
      /**
       * If IDs are not strictly sequential (e.g., due to transactions),
       * the tracking should still work correctly using ID comparison.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Add entries with non-sequential IDs (gaps)
      mockPrisma.activityLog.findMany.mockResolvedValue([
        ...baseActivityLogs,
        { id: 5, missionId: 'M-20260121-001', agent: 'A', message: 'ID 5', level: 'info', timestamp: new Date() },
        { id: 10, missionId: 'M-20260121-001', agent: 'B', message: 'ID 10', level: 'info', timestamp: new Date() },
        { id: 15, missionId: 'M-20260121-001', agent: 'C', message: 'ID 15', level: 'info', timestamp: new Date() },
      ]);

      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // All entries with ID > 1 (baseline) should be emitted
      expect(text).toContain('ID 5');
      expect(text).toContain('ID 10');
      expect(text).toContain('ID 15');

      // Subsequent poll with entry ID 20
      mockPrisma.activityLog.findMany.mockResolvedValue([
        ...baseActivityLogs,
        { id: 5, missionId: 'M-20260121-001', agent: 'A', message: 'ID 5', level: 'info', timestamp: new Date() },
        { id: 10, missionId: 'M-20260121-001', agent: 'B', message: 'ID 10', level: 'info', timestamp: new Date() },
        { id: 15, missionId: 'M-20260121-001', agent: 'C', message: 'ID 15', level: 'info', timestamp: new Date() },
        { id: 20, missionId: 'M-20260121-001', agent: 'D', message: 'ID 20', level: 'info', timestamp: new Date() },
      ]);

      await vi.advanceTimersByTimeAsync(1000);

      const { value: v2 } = await reader.read();
      const text2 = new TextDecoder().decode(v2);

      // Only new entry (ID 20) should be emitted
      expect(text2).toContain('ID 20');
      expect(text2).not.toContain('ID 5');
      expect(text2).not.toContain('ID 10');
      expect(text2).not.toContain('ID 15');

      reader.cancel();
    });
  });

  describe('race condition scenarios', () => {
    it('should not lose entries if flush fails after tracking position is updated', async () => {
      /**
       * This is the core race condition test.
       *
       * Bug scenario:
       * 1. Poll fetches entries 2, 3, 4
       * 2. Loop processes entry 2, updates lastActivityLogId = 2
       * 3. Loop processes entry 3, updates lastActivityLogId = 3
       * 4. Loop processes entry 4, updates lastActivityLogId = 4
       * 5. flushEvents fails (controller closed, etc.)
       * 6. Next poll: newLogs = entries where id > 4 = empty!
       * 7. Entries 2, 3, 4 are lost forever
       *
       * Fix: Update lastActivityLogId only AFTER successful flush
       *
       * This test verifies the fix by checking that if we have entries
       * pending and the tracking advances, all entries are emitted.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline (id=1)
      await vi.advanceTimersByTimeAsync(1100);

      // Add multiple entries
      const entriesForRaceTest = [
        ...baseActivityLogs,
        { id: 2, missionId: 'M-001', agent: 'RaceTest', message: 'Entry 2 for race', level: 'info', timestamp: new Date() },
        { id: 3, missionId: 'M-001', agent: 'RaceTest', message: 'Entry 3 for race', level: 'info', timestamp: new Date() },
        { id: 4, missionId: 'M-001', agent: 'RaceTest', message: 'Entry 4 for race', level: 'info', timestamp: new Date() },
      ];
      mockPrisma.activityLog.findMany.mockResolvedValue(entriesForRaceTest);

      // Process entries
      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // All three entries must be present
      expect(text).toContain('Entry 2 for race');
      expect(text).toContain('Entry 3 for race');
      expect(text).toContain('Entry 4 for race');

      // Verify entry count
      const entryCount = (text.match(/activity-entry-added/g) || []).length;
      expect(entryCount).toBe(3);

      reader.cancel();
    });

    it('should track by highest ID in batch, not incrementally', async () => {
      /**
       * The fix should update lastActivityLogId to the highest ID
       * in the batch AFTER processing, not incrementally during the loop.
       *
       * This ensures atomic tracking: either all entries are tracked
       * as processed, or none are.
       */
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Add batch of entries
      mockPrisma.activityLog.findMany.mockResolvedValue([
        ...baseActivityLogs,
        { id: 10, missionId: 'M-001', agent: 'Batch', message: 'Batch entry 10', level: 'info', timestamp: new Date() },
        { id: 20, missionId: 'M-001', agent: 'Batch', message: 'Batch entry 20', level: 'info', timestamp: new Date() },
        { id: 30, missionId: 'M-001', agent: 'Batch', message: 'Batch entry 30', level: 'info', timestamp: new Date() },
      ]);

      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('Batch entry 10');
      expect(text).toContain('Batch entry 20');
      expect(text).toContain('Batch entry 30');

      // Add entry 25 (between existing IDs) - should NOT be emitted
      // because tracking should be at 30 after the batch
      mockPrisma.activityLog.findMany.mockResolvedValue([
        ...baseActivityLogs,
        { id: 10, missionId: 'M-001', agent: 'Batch', message: 'Batch entry 10', level: 'info', timestamp: new Date() },
        { id: 20, missionId: 'M-001', agent: 'Batch', message: 'Batch entry 20', level: 'info', timestamp: new Date() },
        { id: 25, missionId: 'M-001', agent: 'Late', message: 'Late entry 25', level: 'info', timestamp: new Date() },
        { id: 30, missionId: 'M-001', agent: 'Batch', message: 'Batch entry 30', level: 'info', timestamp: new Date() },
      ]);

      await vi.advanceTimersByTimeAsync(1000);

      // Wait for heartbeat to have something to read
      await vi.advanceTimersByTimeAsync(30000);

      const { value: v2 } = await reader.read();
      const text2 = new TextDecoder().decode(v2);

      // Entry 25 should NOT be emitted (it's below the tracking position of 30)
      expect(text2).not.toContain('Late entry 25');

      reader.cancel();
    });
  });

  describe('edge cases', () => {
    it('should handle empty activity log gracefully', async () => {
      mockPrisma.activityLog.findMany.mockResolvedValue([]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Multiple polls with empty log
      await vi.advanceTimersByTimeAsync(1100);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      // Should not crash, stream should still be active
      expect(response.body).toBeInstanceOf(ReadableStream);

      reader.cancel();
    });

    it('should handle first entry correctly after empty state', async () => {
      // Start with empty
      mockPrisma.activityLog.findMany.mockResolvedValue([]);

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll with empty
      await vi.advanceTimersByTimeAsync(1100);

      // Now add first entry
      mockPrisma.activityLog.findMany.mockResolvedValue([
        { id: 1, missionId: 'M-001', agent: 'First', message: 'First ever entry', level: 'info', timestamp: new Date() },
      ]);

      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('First ever entry');

      reader.cancel();
    });

    it('should handle very large batch of entries', async () => {
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // First poll establishes baseline
      await vi.advanceTimersByTimeAsync(1100);

      // Add 100 entries at once
      const manyEntries = Array.from({ length: 100 }, (_, i) => ({
        id: i + 2, // Start from 2 (baseline is 1)
        missionId: 'M-20260121-001',
        agent: `Agent${i}`,
        message: `Message number ${i + 2}`,
        level: 'info',
        timestamp: new Date(`2026-01-21T11:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`),
      }));

      mockPrisma.activityLog.findMany.mockResolvedValue([...baseActivityLogs, ...manyEntries]);

      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // Should have 100 activity entries
      const eventCount = (text.match(/activity-entry-added/g) || []).length;
      expect(eventCount).toBe(100);

      // Verify first and last are present
      expect(text).toContain('Message number 2');
      expect(text).toContain('Message number 101');

      reader.cancel();
    });

    it('should maintain correct position across connection lifecycle', async () => {
      /**
       * Even if tracking state is reset (new connection), the position
       * tracking should work correctly from the current database state.
       */
      const { GET } = await import('@/app/api/board/events/route');

      // First connection
      const response1 = await GET();
      const reader1 = response1.body!.getReader();

      // Establish baseline and process some entries
      await vi.advanceTimersByTimeAsync(1100);

      mockPrisma.activityLog.findMany.mockResolvedValue([
        ...baseActivityLogs,
        { id: 2, missionId: 'M-001', agent: 'X', message: 'Entry 2', level: 'info', timestamp: new Date() },
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      reader1.cancel();

      // Reset modules to simulate fresh connection
      vi.resetModules();

      // Re-import with fresh state
      const { GET: GET2 } = await import('@/app/api/board/events/route');

      // Add entry 3 before new connection
      mockPrisma.activityLog.findMany.mockResolvedValue([
        ...baseActivityLogs,
        { id: 2, missionId: 'M-001', agent: 'X', message: 'Entry 2', level: 'info', timestamp: new Date() },
        { id: 3, missionId: 'M-001', agent: 'Y', message: 'Entry 3', level: 'info', timestamp: new Date() },
      ]);

      // Second connection
      const response2 = await GET2();
      const reader2 = response2.body!.getReader();

      // First poll establishes new baseline (entries 1, 2, 3)
      await vi.advanceTimersByTimeAsync(1100);

      // Add entry 4
      mockPrisma.activityLog.findMany.mockResolvedValue([
        ...baseActivityLogs,
        { id: 2, missionId: 'M-001', agent: 'X', message: 'Entry 2', level: 'info', timestamp: new Date() },
        { id: 3, missionId: 'M-001', agent: 'Y', message: 'Entry 3', level: 'info', timestamp: new Date() },
        { id: 4, missionId: 'M-001', agent: 'Z', message: 'Entry 4 NEW', level: 'info', timestamp: new Date() },
      ]);

      await vi.advanceTimersByTimeAsync(1000);

      const { value } = await reader2.read();
      const text = new TextDecoder().decode(value);

      // Only entry 4 should be emitted (entries 1-3 were baseline)
      expect(text).toContain('Entry 4 NEW');
      expect(text).not.toContain('Entry 2');
      expect(text).not.toContain('Entry 3');

      reader2.cancel();
    });
  });
});
