import { NextRequest } from 'next/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/hooks/events/route';
import { prisma } from '@/lib/db';

/**
 * Tests for POST /api/hooks/events endpoint
 *
 * This endpoint receives hook event payloads from observer hook scripts,
 * validates them, and stores them in the database.
 *
 * Supports both single events and batch payloads (array of events).
 */

describe('POST /api/hooks/events', () => {
  beforeEach(async () => {
    // Clean up test data
    await prisma.hookEvent.deleteMany({
      where: { projectId: 'test-project' },
    });
  });

  it('should create a HookEvent record with correct projectId and missionId for single event', async () => {
    const eventPayload = {
      eventType: 'pre_tool_use',
      agentName: 'murdock',
      toolName: 'Write',
      status: 'pending',
      summary: 'About to write test file',
      payload: JSON.stringify({ file: 'test.ts' }),
      timestamp: new Date().toISOString(),
    };

    const request = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify(eventPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('id');
    expect(data.data.projectId).toBe('test-project');
    expect(data.data.eventType).toBe('pre_tool_use');
    expect(data.data.agentName).toBe('murdock');
    expect(data.data.toolName).toBe('Write');
    expect(data.data.status).toBe('pending');

    // Verify database record
    const dbEvent = await prisma.hookEvent.findFirst({
      where: { projectId: 'test-project' },
    });
    expect(dbEvent).not.toBeNull();
    expect(dbEvent?.eventType).toBe('pre_tool_use');
  });

  it('should create multiple records for batch POST (array of events)', async () => {
    const batchPayload = [
      {
        eventType: 'pre_tool_use',
        agentName: 'murdock',
        toolName: 'Write',
        status: 'pending',
        summary: 'Writing test 1',
        timestamp: new Date().toISOString(),
      },
      {
        eventType: 'post_tool_use',
        agentName: 'murdock',
        toolName: 'Write',
        status: 'success',
        summary: 'Wrote test 1',
        durationMs: 150,
        timestamp: new Date().toISOString(),
      },
      {
        eventType: 'pre_tool_use',
        agentName: 'ba',
        toolName: 'Edit',
        status: 'pending',
        summary: 'Editing implementation',
        timestamp: new Date().toISOString(),
      },
    ];

    const request = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify(batchPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.data.created).toBe(3);

    // Verify all records in database
    const dbEvents = await prisma.hookEvent.findMany({
      where: { projectId: 'test-project' },
      orderBy: { timestamp: 'asc' },
    });
    expect(dbEvents).toHaveLength(3);
    expect(dbEvents[0].eventType).toBe('pre_tool_use');
    expect(dbEvents[1].eventType).toBe('post_tool_use');
    expect(dbEvents[1].durationMs).toBe(150);
    expect(dbEvents[2].agentName).toBe('ba');
  });

  it('should enforce deduplication for events with same correlationId and eventType, but always store events without correlationId', async () => {
    const correlationId = 'test-correlation-123';

    // First batch with correlationId
    const firstBatch = [
      {
        eventType: 'pre_tool_use',
        agentName: 'murdock',
        toolName: 'Write',
        status: 'pending',
        summary: 'First pre event',
        correlationId,
        timestamp: new Date().toISOString(),
      },
      {
        eventType: 'post_tool_use',
        agentName: 'murdock',
        toolName: 'Write',
        status: 'success',
        summary: 'First post event',
        correlationId,
        durationMs: 100,
        timestamp: new Date().toISOString(),
      },
    ];

    const request1 = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify(firstBatch),
    });

    const response1 = await POST(request1);
    const data1 = await response1.json();

    expect(response1.status).toBe(201);
    expect(data1.data.created).toBe(2);
    expect(data1.data.skipped).toBe(0);

    // Second batch - duplicate correlationId + eventType should be skipped
    const secondBatch = [
      {
        eventType: 'pre_tool_use', // Duplicate: same correlationId + eventType
        agentName: 'murdock',
        toolName: 'Write',
        status: 'pending',
        summary: 'Duplicate pre event',
        correlationId,
        timestamp: new Date().toISOString(),
      },
      {
        eventType: 'stop', // New eventType with same correlationId - should be created
        agentName: 'murdock',
        status: 'success',
        summary: 'Stop event',
        correlationId,
        timestamp: new Date().toISOString(),
      },
      {
        eventType: 'pre_tool_use', // No correlationId - always created
        agentName: 'ba',
        toolName: 'Edit',
        status: 'pending',
        summary: 'Event without correlation',
        timestamp: new Date().toISOString(),
      },
    ];

    const request2 = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify(secondBatch),
    });

    const response2 = await POST(request2);
    const data2 = await response2.json();

    expect(response2.status).toBe(201);
    expect(data2.data.created).toBe(2); // stop event + event without correlationId
    expect(data2.data.skipped).toBe(1); // duplicate pre_tool_use

    // Verify final database state
    const dbEvents = await prisma.hookEvent.findMany({
      where: { projectId: 'test-project' },
    });
    expect(dbEvents).toHaveLength(4); // 2 from first batch + 2 from second batch
  });

  it('should return 400 when X-Project-ID header is missing', async () => {
    const eventPayload = {
      eventType: 'pre_tool_use',
      agentName: 'murdock',
      status: 'pending',
      summary: 'Test event',
      timestamp: new Date().toISOString(),
    };

    const request = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Missing X-Project-ID header
      },
      body: JSON.stringify(eventPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('X-Project-ID');
  });

  it('should return 400 for invalid eventType with descriptive error', async () => {
    const eventPayload = {
      eventType: 'invalid_event_type', // Invalid
      agentName: 'murdock',
      status: 'pending',
      summary: 'Test event',
      timestamp: new Date().toISOString(),
    };

    const request = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify(eventPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('eventType');
    expect(data.error.message).toMatch(/pre_tool_use|post_tool_use|post_tool_use_failure|subagent_start|subagent_stop|stop/);
  });

  // Amy's findings: Security and reliability tests
  it('should reject payloads over 1MB size limit', async () => {
    const largePayload = 'x'.repeat(1024 * 1024 + 1); // 1MB + 1 byte

    const eventPayload = {
      eventType: 'pre_tool_use',
      agentName: 'murdock',
      toolName: 'Write',
      status: 'pending',
      summary: 'Large payload test',
      payload: largePayload,
      timestamp: new Date().toISOString(),
    };

    const request = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify(eventPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('payload');
    expect(data.error.message).toMatch(/size|limit|1MB/i);
  });

  it('should handle concurrent duplicate submissions atomically', async () => {
    const correlationId = 'concurrent-test-123';

    const eventPayload = {
      eventType: 'pre_tool_use',
      agentName: 'murdock',
      toolName: 'Write',
      status: 'pending',
      summary: 'Concurrent duplicate test',
      correlationId,
      timestamp: new Date().toISOString(),
    };

    const request = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify(eventPayload),
    });

    // Submit the same event concurrently 5 times
    const responses = await Promise.all([
      POST(request.clone() as unknown as NextRequest),
      POST(request.clone() as unknown as NextRequest),
      POST(request.clone() as unknown as NextRequest),
      POST(request.clone() as unknown as NextRequest),
      POST(request.clone() as unknown as NextRequest),
    ]);

    // All responses should succeed (201)
    for (const response of responses) {
      expect(response.status).toBe(201);
    }

    // But only ONE event should be created (atomic deduplication)
    const dbEvents = await prisma.hookEvent.findMany({
      where: {
        projectId: 'test-project',
        correlationId,
        eventType: 'pre_tool_use',
      },
    });

    expect(dbEvents).toHaveLength(1);
  });

  it('should reject malformed timestamps', async () => {
    const eventPayload = {
      eventType: 'pre_tool_use',
      agentName: 'murdock',
      status: 'pending',
      summary: 'Invalid timestamp test',
      timestamp: 'not-a-valid-timestamp', // Invalid
    };

    const request = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify(eventPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('timestamp');
  });

  it('should associate events with completed/failed missions not yet archived', async () => {
    // A mission in "failed" or "completed" state that hasn't been archived
    // (archivedAt is null) should still receive events. This is the fix for
    // the bug where 71% of token-bearing events got missionId: null.
    const missionId = 'M-test-failed-mission';
    const projectId = 'test-project';

    // Ensure project exists
    await prisma.project.upsert({
      where: { id: projectId },
      update: {},
      create: { id: projectId, name: 'Test Project' },
    });

    // Create a failed mission (not archived)
    await prisma.mission.upsert({
      where: { id: missionId },
      update: { state: 'failed', archivedAt: null },
      create: {
        id: missionId,
        name: 'Failed Mission',
        state: 'failed',
        prdPath: '/prd/test.md',
        projectId,
        startedAt: new Date(),
        archivedAt: null,
      },
    });

    const eventPayload = {
      eventType: 'stop',
      agentName: 'hannibal',
      status: 'stopped',
      summary: 'Late-arriving stop event',
      timestamp: new Date().toISOString(),
      inputTokens: 5000,
      outputTokens: 1000,
      model: 'claude-opus-4-6',
    };

    const request = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': projectId,
      },
      body: JSON.stringify(eventPayload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.data.missionId).toBe(missionId);

    // Clean up
    await prisma.hookEvent.deleteMany({ where: { missionId } });
    await prisma.mission.delete({ where: { id: missionId } });
  });

  it('accepts handoff-start/handoff-stop events (latency instrumentation shape)', async () => {
    // These were emitted by the observer since the latency instrumentation
    // shipped but 400'd on the eventType enum — every event dropped in prod.
    // Pin the exact shape the observer sends (itemId inside payload).
    for (const [eventType, status] of [['handoff-start', 'started'], ['handoff-stop', 'completed']] as const) {
      const request = new NextRequest('http://localhost:3000/api/hooks/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
        body: JSON.stringify({
          eventType,
          agentName: 'ba',
          status,
          summary: `${eventType}: WI-042`,
          payload: JSON.stringify({ itemId: 'WI-042', timestampMs: Date.now() }),
          timestamp: new Date().toISOString(),
        }),
      });
      const response = await POST(request);
      expect(response.status).toBe(201);
    }

    const stored = await prisma.hookEvent.findMany({
      where: { projectId: 'test-project', eventType: { in: ['handoff-start', 'handoff-stop'] } },
    });
    expect(stored).toHaveLength(2);
    expect(JSON.parse(stored[0].payload)).toMatchObject({ itemId: 'WI-042' });
    await prisma.hookEvent.deleteMany({ where: { projectId: 'test-project' } });
  });

  describe('mission-attach grace window', () => {
    const projectId = 'test-project';

    /** Create a terminal (completed) unarchived mission with the given completedAt. */
    async function createCompletedMission(missionId: string, completedAt: Date) {
      await prisma.project.upsert({
        where: { id: projectId },
        update: {},
        create: { id: projectId, name: 'Test Project' },
      });
      await prisma.mission.upsert({
        where: { id: missionId },
        update: { state: 'completed', archivedAt: null, completedAt },
        create: {
          id: missionId,
          name: 'Grace Window Mission',
          state: 'completed',
          prdPath: '/prd/test.md',
          projectId,
          startedAt: new Date(completedAt.getTime() - 3600_000),
          completedAt,
          archivedAt: null,
        },
      });
    }

    async function postEvent() {
      const request = new NextRequest('http://localhost:3000/api/hooks/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': projectId },
        body: JSON.stringify({
          eventType: 'pre_tool_use',
          agentName: 'explorer',
          toolName: 'Read',
          status: 'pending',
          summary: 'Post-mission session activity',
          timestamp: new Date().toISOString(),
        }),
      });
      const response = await POST(request);
      return { response, data: await response.json() };
    }

    async function cleanup(missionId: string) {
      await prisma.hookEvent.deleteMany({ where: { projectId } });
      await prisma.mission.delete({ where: { id: missionId } }).catch(() => {});
      delete process.env.ATEAM_MISSION_ATTACH_GRACE_MINUTES;
    }

    it('does NOT attach events to a completed mission beyond the grace window', async () => {
      // Real prod failure: sessions on 07-14 attributed to a mission completed 07-01.
      const missionId = 'M-test-grace-expired';
      await createCompletedMission(missionId, new Date(Date.now() - 2 * 3600_000)); // 2h ago > 60min default
      try {
        const { response, data } = await postEvent();
        expect(response.status).toBe(201);
        expect(data.data.missionId).toBeNull();
      } finally {
        await cleanup(missionId);
      }
    });

    it('still attaches events to a completed mission within the grace window (trailing postcheck/docs/retro work)', async () => {
      const missionId = 'M-test-grace-fresh';
      await createCompletedMission(missionId, new Date(Date.now() - 5 * 60_000)); // 5 min ago
      try {
        const { response, data } = await postEvent();
        expect(response.status).toBe(201);
        expect(data.data.missionId).toBe(missionId);
      } finally {
        await cleanup(missionId);
      }
    });

    it('honors ATEAM_MISSION_ATTACH_GRACE_MINUTES override', async () => {
      const missionId = 'M-test-grace-override';
      await createCompletedMission(missionId, new Date(Date.now() - 2 * 3600_000)); // 2h ago
      process.env.ATEAM_MISSION_ATTACH_GRACE_MINUTES = '180'; // 3h window
      try {
        const { response, data } = await postEvent();
        expect(response.status).toBe(201);
        expect(data.data.missionId).toBe(missionId);
      } finally {
        await cleanup(missionId);
      }
    });

    it('prefers a still-active mission over a newer, grace-expired terminal one', async () => {
      // An older active mission must receive events even when a later-started
      // mission has already completed and aged out — newest-by-startedAt alone
      // would resolve to null here.
      const terminalId = 'M-test-grace-terminal-newer';
      const activeId = 'M-test-grace-active-older';
      await createCompletedMission(terminalId, new Date(Date.now() - 2 * 3600_000)); // expired
      await prisma.mission.upsert({
        where: { id: activeId },
        update: { state: 'running', archivedAt: null },
        create: {
          id: activeId,
          name: 'Older Active Mission',
          state: 'running',
          prdPath: '/prd/test.md',
          projectId,
          startedAt: new Date(Date.now() - 24 * 3600_000), // older than the terminal one
          archivedAt: null,
        },
      });
      try {
        const { response, data } = await postEvent();
        expect(response.status).toBe(201);
        expect(data.data.missionId).toBe(activeId);
      } finally {
        await prisma.hookEvent.deleteMany({ where: { projectId } });
        await prisma.mission.delete({ where: { id: activeId } }).catch(() => {});
        await cleanup(terminalId);
      }
    });
  });

  it('should reject batches over 100 events limit', async () => {
    // Create a batch of 101 events
    const largeBatch = Array.from({ length: 101 }, (_, i) => ({
      eventType: 'pre_tool_use',
      agentName: 'murdock',
      toolName: 'Write',
      status: 'pending',
      summary: `Event ${i + 1}`,
      timestamp: new Date().toISOString(),
    }));

    const request = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify(largeBatch),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toMatch(/batch|limit|100/i);
  });

  /**
   * FIX 1: Stop-event dedup via per-turn-stable correlationId.
   *
   * observe-stop.js sets correlationId = `${session_id}:${lastAssistantMessageId}`,
   * which is identical across retries of the same turn's stop but distinct
   * across different turns. The route must:
   *   (a) collapse retries of the SAME stop into ONE row, keeping the LATEST
   *       (largest) cumulative token totals (upsert, not skip-first), and
   *   (b) store DIFFERENT turns' stops as SEPARATE rows (never collapse).
   */
  describe('stop-event dedup (FIX 1)', () => {
    function stopEvent(correlationId: string, outputTokens: number, inputTokens: number) {
      return {
        eventType: 'stop',
        agentName: 'hannibal',
        status: 'stopped',
        summary: 'hannibal stopped',
        timestamp: new Date().toISOString(),
        correlationId,
        model: 'claude-sonnet-4-6',
        inputTokens,
        outputTokens,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
    }

    async function post(body: unknown) {
      const request = new NextRequest('http://localhost:3000/api/hooks/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
        body: JSON.stringify(body),
      });
      const response = await POST(request);
      return response.json();
    }

    it('(a) two retries of the SAME stop → ONE row, keeping the latest token totals', async () => {
      const correlationId = 'sess-A:msg_turn1';

      // First send (e.g. network glitch caused a retry) with smaller cumulative totals.
      await post(stopEvent(correlationId, 100, 1000));
      // Retry of the SAME turn's stop, carrying NEWER (larger) cumulative totals.
      const retry = await post(stopEvent(correlationId, 175, 1800));

      // Retry is reported as skipped-create (it was an upsert of the existing row).
      expect(retry.data.created).toBe(0);
      expect(retry.data.skipped).toBe(1);

      const rows = await prisma.hookEvent.findMany({
        where: { projectId: 'test-project', eventType: 'stop', correlationId },
      });
      expect(rows).toHaveLength(1); // collapsed to a single row
      // Latest values win — NOT the stale first-write values.
      expect(rows[0].outputTokens).toBe(175);
      expect(rows[0].inputTokens).toBe(1800);
    });

    it('(b) two DIFFERENT turns’ stops → TWO rows (not collapsed)', async () => {
      const turn1 = await post(stopEvent('sess-A:msg_turn1', 100, 1000));
      const turn2 = await post(stopEvent('sess-A:msg_turn2', 250, 2500));

      expect(turn1.data.id ?? turn1.data.created).toBeTruthy();
      expect(turn2.data.id ?? turn2.data.created).toBeTruthy();

      const rows = await prisma.hookEvent.findMany({
        where: { projectId: 'test-project', eventType: 'stop' },
        orderBy: { outputTokens: 'asc' },
      });
      expect(rows).toHaveLength(2); // per-turn stops remain distinct
      expect(rows.map((r) => r.correlationId).sort()).toEqual([
        'sess-A:msg_turn1',
        'sess-A:msg_turn2',
      ]);
    });
  });
});
