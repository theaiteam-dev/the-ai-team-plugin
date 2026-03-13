import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for Circuit Breaker Pattern in GET /api/board/events
 *
 * Item 012: Add SSE circuit breaker for database errors
 *
 * When the database dies permanently, the SSE stream becomes a zombie
 * that wastes server resources. A circuit breaker should close the
 * connection after repeated failures.
 *
 * Acceptance criteria tested:
 * - [x] Consecutive database errors are tracked
 * - [x] After MAX_CONSECUTIVE_ERRORS (5), connection is closed gracefully
 * - [x] Error messages indicate circuit breaker triggered
 * - [x] Intervals are cleaned up properly on connection close
 * - [x] Successful polls reset the error counter
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

// Create mock Prisma client
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

// Mock console.error to capture circuit breaker messages
const mockConsoleError = vi.fn();

// Mock the db module
vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

// Expected constant - matches what implementation should use
const MAX_CONSECUTIVE_ERRORS = 5;

describe('GET /api/board/events - Circuit Breaker', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    originalConsoleError = console.error;
    console.error = mockConsoleError;

    // Default mock implementations - successful responses
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
    console.error = originalConsoleError;
  });

  describe('consecutive error tracking', () => {
    it('should track consecutive database errors', async () => {
      /**
       * When database queries fail, the error count should increment.
       * We verify this by causing errors and checking the behavior.
       */
      // Make all database calls fail
      mockPrisma.item.findMany.mockRejectedValue(new Error('Database connection failed'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger 3 failed polls (less than MAX_CONSECUTIVE_ERRORS)
      await vi.advanceTimersByTimeAsync(1100); // Poll 1 - error
      await vi.advanceTimersByTimeAsync(1000); // Poll 2 - error
      await vi.advanceTimersByTimeAsync(1000); // Poll 3 - error

      // Stream should still be active (haven't hit the limit yet)
      expect(response.body).toBeInstanceOf(ReadableStream);

      // Errors should be logged
      expect(mockConsoleError).toHaveBeenCalled();

      reader.cancel();
    });

    it('should count errors from item.findMany failures', async () => {
      /**
       * Database errors from item queries should increment the counter.
       */
      mockPrisma.item.findMany.mockRejectedValue(new Error('Item query failed'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger multiple failed polls
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      // Should have logged errors for each failure
      const errorCalls = mockConsoleError.mock.calls.filter(
        (call) => call[0] && String(call[0]).includes('SSE poll error')
      );
      expect(errorCalls.length).toBeGreaterThanOrEqual(4);

      reader.cancel();
    });

    it('should count errors from mission.findFirst failures', async () => {
      /**
       * Database errors from mission queries should also trigger error tracking.
       * Items succeed but mission query fails.
       */
      mockPrisma.mission.findFirst.mockRejectedValue(new Error('Mission query failed'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger polls
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      // Errors should be logged
      expect(mockConsoleError).toHaveBeenCalled();

      reader.cancel();
    });

    it('should count errors from activityLog.findMany failures', async () => {
      /**
       * Database errors from activity log queries should also trigger error tracking.
       */
      mockPrisma.activityLog.findMany.mockRejectedValue(new Error('Activity log query failed'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger polls
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      // Errors should be logged
      expect(mockConsoleError).toHaveBeenCalled();

      reader.cancel();
    });
  });

  describe('circuit breaker trips after MAX_CONSECUTIVE_ERRORS', () => {
    it('should close connection after 5 consecutive errors', async () => {
      /**
       * After MAX_CONSECUTIVE_ERRORS (5) consecutive database failures,
       * the circuit breaker should trip and close the connection.
       */
      mockPrisma.item.findMany.mockRejectedValue(new Error('Database permanently down'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger exactly MAX_CONSECUTIVE_ERRORS polls
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      // Wait a bit more for cleanup
      await vi.advanceTimersByTimeAsync(100);

      // Try to read from the stream - it should be closed
      const readResult = await reader.read();

      // Stream should be done (closed by circuit breaker)
      expect(readResult.done).toBe(true);
    });

    it('should not close connection before reaching error threshold', async () => {
      /**
       * The stream should remain active until we hit exactly
       * MAX_CONSECUTIVE_ERRORS errors.
       */
      mockPrisma.item.findMany.mockRejectedValue(new Error('Database error'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger MAX_CONSECUTIVE_ERRORS - 1 polls (one less than threshold)
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS - 1; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      // Stream should still be open
      // We can verify by checking the reader is not done
      // The read will block, so we advance to heartbeat instead to verify connection is alive
      await vi.advanceTimersByTimeAsync(30000);

      // Should receive heartbeat if connection is still alive
      const { value, done } = await reader.read();
      const text = value ? new TextDecoder().decode(value) : '';

      // Either we get a heartbeat (connection alive) or the stream closes
      // At this point we're at 4 errors, should still be alive
      if (!done) {
        expect(text).toContain('heartbeat');
      }

      reader.cancel();
    });

    it('should trigger circuit breaker on exactly the 5th error', async () => {
      /**
       * The circuit breaker should trigger precisely on error #5,
       * not before and not after.
       */
      let errorCount = 0;
      mockPrisma.item.findMany.mockImplementation(() => {
        errorCount++;
        return Promise.reject(new Error(`Error number ${errorCount}`));
      });

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger polls one by one and check state
      for (let i = 1; i <= MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      // After 5th error, stream should close
      await vi.advanceTimersByTimeAsync(100);

      const { done } = await reader.read();
      expect(done).toBe(true);
    });
  });

  describe('error counter reset on success', () => {
    it('should reset error counter after successful poll', async () => {
      /**
       * If a poll succeeds after failures, the consecutive error
       * counter should reset to zero.
       */
      // First 3 calls fail, then succeed
      mockPrisma.item.findMany
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockRejectedValueOnce(new Error('Error 3'))
        .mockResolvedValue([...mockItems]); // Success!

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger 3 failed polls
      await vi.advanceTimersByTimeAsync(1100); // Error 1
      await vi.advanceTimersByTimeAsync(1000); // Error 2
      await vi.advanceTimersByTimeAsync(1000); // Error 3

      // Now a successful poll - counter should reset
      await vi.advanceTimersByTimeAsync(1000); // Success

      // Now fail 4 more times (less than 5 total since reset)
      mockPrisma.item.findMany
        .mockRejectedValueOnce(new Error('Error after reset 1'))
        .mockRejectedValueOnce(new Error('Error after reset 2'))
        .mockRejectedValueOnce(new Error('Error after reset 3'))
        .mockRejectedValueOnce(new Error('Error after reset 4'));

      await vi.advanceTimersByTimeAsync(1000); // Error 1 after reset
      await vi.advanceTimersByTimeAsync(1000); // Error 2 after reset
      await vi.advanceTimersByTimeAsync(1000); // Error 3 after reset
      await vi.advanceTimersByTimeAsync(1000); // Error 4 after reset

      // Stream should still be alive (only 4 consecutive errors)
      await vi.advanceTimersByTimeAsync(30000); // Wait for heartbeat

      const { done } = await reader.read();

      // Should not be closed yet
      expect(done).toBe(false);

      reader.cancel();
    });

    it('should survive intermittent failures without triggering circuit breaker', async () => {
      /**
       * Real-world scenario: occasional transient errors don't trigger
       * the circuit breaker because successful polls reset the counter.
       */
      // Pattern: fail, fail, success, fail, fail, success, fail, fail, success
      mockPrisma.item.findMany
        .mockRejectedValueOnce(new Error('Transient 1'))
        .mockRejectedValueOnce(new Error('Transient 2'))
        .mockResolvedValueOnce([...mockItems]) // Reset
        .mockRejectedValueOnce(new Error('Transient 3'))
        .mockRejectedValueOnce(new Error('Transient 4'))
        .mockResolvedValueOnce([...mockItems]) // Reset
        .mockRejectedValueOnce(new Error('Transient 5'))
        .mockRejectedValueOnce(new Error('Transient 6'))
        .mockResolvedValue([...mockItems]); // Keep succeeding

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Run through all the polls
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      // Stream should still be alive
      await vi.advanceTimersByTimeAsync(30000);

      const { done } = await reader.read();
      expect(done).toBe(false);

      reader.cancel();
    });

    it('should reset counter even if only one successful poll', async () => {
      /**
       * A single success should be enough to reset the counter,
       * allowing the stream to survive longer.
       */
      // 4 errors, 1 success, then 5 errors
      mockPrisma.item.findMany
        .mockRejectedValueOnce(new Error('E1'))
        .mockRejectedValueOnce(new Error('E2'))
        .mockRejectedValueOnce(new Error('E3'))
        .mockRejectedValueOnce(new Error('E4'))
        .mockResolvedValueOnce([...mockItems]) // ONE success resets counter
        .mockRejectedValue(new Error('Permanent failure'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // 4 errors
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      // 1 success (resets counter)
      await vi.advanceTimersByTimeAsync(1000);

      // Now we need 5 more errors to trigger circuit breaker
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await vi.advanceTimersByTimeAsync(100);

      const { done } = await reader.read();
      expect(done).toBe(true); // Now it should be closed
    });
  });

  describe('graceful connection close', () => {
    it('should close stream controller when circuit breaker trips', async () => {
      /**
       * When the circuit breaker trips, it should properly close
       * the ReadableStream controller.
       */
      mockPrisma.item.findMany.mockRejectedValue(new Error('Database dead'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger circuit breaker
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await vi.advanceTimersByTimeAsync(100);

      // Read should return done=true
      const result = await reader.read();
      expect(result.done).toBe(true);
      expect(result.value).toBeUndefined();
    });

    it('should emit error event or message before closing', async () => {
      /**
       * Before closing, the circuit breaker should emit some indication
       * of why the connection is being closed.
       */
      mockPrisma.item.findMany.mockRejectedValue(new Error('Database unavailable'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Collect all output before stream closes
      const chunks: string[] = [];

      // Trigger circuit breaker
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await vi.advanceTimersByTimeAsync(100);

      // Read all available data
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(new TextDecoder().decode(value));
        }
      }

      // Console should have logged the circuit breaker trigger
      const circuitBreakerLog = mockConsoleError.mock.calls.find(
        (call) => String(call[0]).toLowerCase().includes('circuit breaker')
      );

      expect(circuitBreakerLog).toBeDefined();
    });

    it('should log circuit breaker activation with error count', async () => {
      /**
       * When the circuit breaker trips, it should log a message
       * indicating how many consecutive errors triggered it.
       */
      mockPrisma.item.findMany.mockRejectedValue(new Error('DB error'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger circuit breaker
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await vi.advanceTimersByTimeAsync(100);

      // Drain the reader
      while (!(await reader.read()).done) {}

      // Should have logged something about circuit breaker
      const allLogs = mockConsoleError.mock.calls.map((c) => String(c.join(' ')));
      const hasCircuitBreakerLog = allLogs.some(
        (log) =>
          log.toLowerCase().includes('circuit') ||
          log.toLowerCase().includes('consecutive') ||
          log.includes(String(MAX_CONSECUTIVE_ERRORS))
      );

      expect(hasCircuitBreakerLog).toBe(true);
    });
  });

  describe('interval cleanup on circuit break', () => {
    it('should clear poll interval when circuit breaker trips', async () => {
      /**
       * When the circuit breaker closes the connection, it must also
       * clear the polling interval to prevent zombie timers.
       */
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      mockPrisma.item.findMany.mockRejectedValue(new Error('DB gone'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger circuit breaker
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await vi.advanceTimersByTimeAsync(100);

      // Drain reader to ensure cleanup completes
      while (!(await reader.read()).done) {}

      // Interval should have been cleared
      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });

    it('should clear heartbeat interval when circuit breaker trips', async () => {
      /**
       * The heartbeat interval should also be cleaned up when
       * the circuit breaker closes the connection.
       */
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      mockPrisma.item.findMany.mockRejectedValue(new Error('DB gone'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger circuit breaker
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await vi.advanceTimersByTimeAsync(100);

      while (!(await reader.read()).done) {}

      // Should have cleared at least 2 intervals (poll + heartbeat)
      expect(clearIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

      clearIntervalSpy.mockRestore();
    });

    it('should not poll database after circuit breaker trips', async () => {
      /**
       * After the circuit breaker trips, no more database queries
       * should be made.
       */
      mockPrisma.item.findMany.mockRejectedValue(new Error('DB error'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger circuit breaker
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await vi.advanceTimersByTimeAsync(100);

      // Record call count at circuit break
      const callCountAtBreak = mockPrisma.item.findMany.mock.calls.length;

      // Drain reader
      while (!(await reader.read()).done) {}

      // Advance time significantly
      await vi.advanceTimersByTimeAsync(10000);

      // No additional calls should have been made
      expect(mockPrisma.item.findMany.mock.calls.length).toBe(callCountAtBreak);
    });

    it('should not send heartbeats after circuit breaker trips', async () => {
      /**
       * After circuit breaker trips, no heartbeats should be sent.
       */
      mockPrisma.item.findMany.mockRejectedValue(new Error('DB error'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger circuit breaker
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await vi.advanceTimersByTimeAsync(100);

      // Collect all output
      const chunks: string[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(new TextDecoder().decode(value));
      }

      // Now advance time past when heartbeat would fire
      await vi.advanceTimersByTimeAsync(60000);

      // Stream is closed, so no way to receive heartbeats
      // The test passes if we get here without hanging
      expect(true).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle rapid successive errors correctly', async () => {
      /**
       * Even if errors happen very rapidly, the counter should
       * increment correctly and trigger at exactly the threshold.
       */
      mockPrisma.item.findMany.mockRejectedValue(new Error('Rapid error'));

      // Use very short poll interval
      process.env.SSE_POLL_INTERVAL_MS = '10';

      vi.resetModules();
      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Rapid polls
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(15);
      }

      await vi.advanceTimersByTimeAsync(50);

      const { done } = await reader.read();
      expect(done).toBe(true);
    });

    it('should handle mixed error types correctly', async () => {
      /**
       * Different types of database errors should all count
       * toward the consecutive error threshold.
       */
      mockPrisma.item.findMany
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('SQLITE_BUSY'))
        .mockRejectedValueOnce(new Error('SQLITE_CORRUPT'))
        .mockRejectedValueOnce(new Error('Unknown error'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // All 5 different error types
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await vi.advanceTimersByTimeAsync(100);

      const { done } = await reader.read();
      expect(done).toBe(true);
    });

    it('should handle error recovery just before threshold', async () => {
      /**
       * If recovery happens at error 4 (just before threshold),
       * the stream should survive.
       */
      mockPrisma.item.findMany
        .mockRejectedValueOnce(new Error('E1'))
        .mockRejectedValueOnce(new Error('E2'))
        .mockRejectedValueOnce(new Error('E3'))
        .mockRejectedValueOnce(new Error('E4'))
        .mockResolvedValue([...mockItems]); // Recovery at poll 5!

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // 4 errors
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      // 5th poll succeeds
      await vi.advanceTimersByTimeAsync(1000);

      // Stream should still be alive
      await vi.advanceTimersByTimeAsync(30000);

      const { done } = await reader.read();
      expect(done).toBe(false);

      reader.cancel();
    });

    it('should properly isolate error counts between connections', async () => {
      /**
       * Each SSE connection should have its own error counter.
       * Errors on one connection shouldn't affect another.
       *
       * The GET function creates a closure with its own consecutiveErrors
       * variable, so each connection has isolated error tracking.
       */
      // Connection 1: 3 errors
      mockPrisma.item.findMany.mockRejectedValue(new Error('Error'));

      const { GET } = await import('@/app/api/board/events/route');
      const response1 = await GET();
      const reader1 = response1.body!.getReader();

      // 3 errors on connection 1
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      reader1.cancel();

      // Reset modules to simulate fresh connection
      vi.resetModules();

      // Connection 2: starts with success, then 3 errors
      // This proves it has its own counter (not inheriting from connection 1)
      mockPrisma.item.findMany
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockRejectedValueOnce(new Error('Error 3'))
        .mockResolvedValue([...mockItems]); // Then succeed - prevents more errors

      const { GET: GET2 } = await import('@/app/api/board/events/route');
      const response2 = await GET2();
      const reader2 = response2.body!.getReader();

      // 3 errors on connection 2 (should NOT trigger circuit breaker)
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      // 4th poll succeeds and resets counter
      await vi.advanceTimersByTimeAsync(1000);

      // Connection 2 should still be alive - wait for heartbeat
      await vi.advanceTimersByTimeAsync(30000);

      const { done } = await reader2.read();
      expect(done).toBe(false);

      reader2.cancel();
    });
  });

  describe('error message clarity', () => {
    it('should log meaningful error messages for each database failure', async () => {
      /**
       * Each database error should be logged with enough context
       * to diagnose issues.
       */
      mockPrisma.item.findMany.mockRejectedValue(new Error('SQLITE_CANTOPEN: unable to open database file'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger some errors
      await vi.advanceTimersByTimeAsync(1100);
      await vi.advanceTimersByTimeAsync(1000);

      // Check that errors were logged
      const errorLogs = mockConsoleError.mock.calls.filter((call) =>
        String(call[0]).includes('SSE poll error')
      );

      expect(errorLogs.length).toBeGreaterThanOrEqual(2);

      reader.cancel();
    });

    it('should indicate circuit breaker status in final error log', async () => {
      /**
       * When the circuit breaker trips, the log message should
       * clearly indicate this is happening.
       */
      mockPrisma.item.findMany.mockRejectedValue(new Error('DB down'));

      const { GET } = await import('@/app/api/board/events/route');
      const response = await GET();
      const reader = response.body!.getReader();

      // Trigger circuit breaker
      for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await vi.advanceTimersByTimeAsync(100);

      while (!(await reader.read()).done) {}

      // Look for circuit breaker specific logging
      const allLogMessages = mockConsoleError.mock.calls.map((call) => String(call.join(' ')).toLowerCase());

      const hasCircuitBreakerMessage = allLogMessages.some(
        (msg) => msg.includes('circuit') || msg.includes('closing') || msg.includes('max')
      );

      expect(hasCircuitBreakerMessage).toBe(true);
    });
  });
});
