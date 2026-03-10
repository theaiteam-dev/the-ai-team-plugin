import { NextRequest } from 'next/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/hooks/events/prune/route';
import { prisma } from '@/lib/db';

/**
 * Smoke tests for POST /api/hooks/events/prune endpoint
 *
 * This endpoint implements pruning to prevent unbounded database growth.
 * It removes old hook events while preserving events for active missions.
 *
 * As a "task" type item, we need 1-3 smoke tests covering core functionality.
 */

describe('POST /api/hooks/events/prune', () => {
  beforeEach(async () => {
    // Clean up test data (missions and events)
    await prisma.hookEvent.deleteMany({
      where: { projectId: 'test-project' },
    });
    await prisma.mission.deleteMany({
      where: { projectId: 'test-project' },
    });

    // Ensure test project exists
    await prisma.project.upsert({
      where: { id: 'test-project' },
      create: {
        id: 'test-project',
        name: 'Test Project',
      },
      update: {},
    });
  });

  it('should remove events older than specified timestamp', async () => {
    const oldTimestamp = new Date('2026-01-01T00:00:00Z');
    const cutoffTimestamp = new Date('2026-02-01T00:00:00Z');
    const recentTimestamp = new Date('2026-02-15T00:00:00Z');

    // Create test events: 2 old, 2 recent
    await prisma.hookEvent.createMany({
      data: [
        {
          projectId: 'test-project',
          eventType: 'pre_tool_use',
          agentName: 'murdock',
          status: 'success',
          summary: 'Old event 1',
          timestamp: oldTimestamp,
        },
        {
          projectId: 'test-project',
          eventType: 'post_tool_use',
          agentName: 'ba',
          status: 'success',
          summary: 'Old event 2',
          timestamp: new Date('2026-01-15T00:00:00Z'),
        },
        {
          projectId: 'test-project',
          eventType: 'pre_tool_use',
          agentName: 'lynch',
          status: 'pending',
          summary: 'Recent event 1',
          timestamp: recentTimestamp,
        },
        {
          projectId: 'test-project',
          eventType: 'stop',
          agentName: 'hannibal',
          status: 'success',
          summary: 'Recent event 2',
          timestamp: new Date('2026-02-14T00:00:00Z'),
        },
      ],
    });

    // Prune events older than cutoff
    const request = new NextRequest('http://localhost:3000/api/hooks/events/prune', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify({
        olderThan: cutoffTimestamp.toISOString(),
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.pruned).toBe(2); // 2 old events removed

    // Verify database state
    const remainingEvents = await prisma.hookEvent.findMany({
      where: { projectId: 'test-project' },
      orderBy: { timestamp: 'asc' },
    });

    expect(remainingEvents).toHaveLength(2);
    expect(remainingEvents[0].summary).toBe('Recent event 2');
    expect(remainingEvents[1].summary).toBe('Recent event 1');
  });

  it('should not prune events for current active mission', async () => {
    const oldTimestamp = new Date('2026-01-01T00:00:00Z');
    const cutoffTimestamp = new Date('2026-02-01T00:00:00Z');

    // Create a test mission (project already exists from beforeEach)
    const mission = await prisma.mission.create({
      data: {
        id: 'M-001',
        name: 'Active Mission',
        state: 'in_progress',
        prdPath: '/path/to/prd.md',
        projectId: 'test-project',
        archivedAt: null,
      },
    });

    // Create old events: some for active mission, some without mission
    await prisma.hookEvent.createMany({
      data: [
        {
          projectId: 'test-project',
          missionId: mission.id,
          eventType: 'pre_tool_use',
          agentName: 'murdock',
          status: 'success',
          summary: 'Old event for active mission',
          timestamp: oldTimestamp,
        },
        {
          projectId: 'test-project',
          missionId: null,
          eventType: 'post_tool_use',
          agentName: 'ba',
          status: 'success',
          summary: 'Old event without mission',
          timestamp: oldTimestamp,
        },
      ],
    });

    // Prune events older than cutoff
    const request = new NextRequest('http://localhost:3000/api/hooks/events/prune', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify({
        olderThan: cutoffTimestamp.toISOString(),
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.pruned).toBe(1); // Only 1 pruned (the one without mission)

    // Verify database state
    const remainingEvents = await prisma.hookEvent.findMany({
      where: { projectId: 'test-project' },
    });

    expect(remainingEvents).toHaveLength(1);
    expect(remainingEvents[0].summary).toBe('Old event for active mission');
    expect(remainingEvents[0].missionId).toBe(mission.id);
  });

  it('should return count of pruned events', async () => {
    const oldTimestamp = new Date('2026-01-01T00:00:00Z');
    const cutoffTimestamp = new Date('2026-02-01T00:00:00Z');

    // Create 5 old events
    const oldEvents = Array.from({ length: 5 }, (_, i) => ({
      projectId: 'test-project',
      eventType: 'pre_tool_use' as const,
      agentName: 'murdock',
      status: 'success' as const,
      summary: `Old event ${i + 1}`,
      timestamp: new Date(oldTimestamp.getTime() + i * 1000),
    }));

    await prisma.hookEvent.createMany({
      data: oldEvents,
    });

    // Prune all old events
    const request = new NextRequest('http://localhost:3000/api/hooks/events/prune', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify({
        olderThan: cutoffTimestamp.toISOString(),
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('pruned');
    expect(data.data.pruned).toBe(5);

    // Verify all events were removed
    const remainingEvents = await prisma.hookEvent.count({
      where: { projectId: 'test-project' },
    });
    expect(remainingEvents).toBe(0);
  });

  // Amy's findings: Transaction safety and deletion limits
  it('should prune large deletions atomically within a transaction', async () => {
    const oldTimestamp = new Date('2026-01-01T00:00:00Z');
    const cutoffTimestamp = new Date('2026-02-01T00:00:00Z');

    // Create 1000 old events (large deletion scenario)
    const oldEvents = Array.from({ length: 1000 }, (_, i) => ({
      projectId: 'test-project',
      eventType: 'pre_tool_use' as const,
      agentName: 'murdock',
      status: 'success' as const,
      summary: `Old event ${i + 1}`,
      timestamp: new Date(oldTimestamp.getTime() + i * 1000),
    }));

    await prisma.hookEvent.createMany({
      data: oldEvents,
    });

    // Also create 5 recent events that should NOT be deleted
    const recentTimestamp = new Date('2026-02-15T00:00:00Z');
    await prisma.hookEvent.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        projectId: 'test-project',
        eventType: 'post_tool_use' as const,
        agentName: 'ba',
        status: 'success' as const,
        summary: `Recent event ${i + 1}`,
        timestamp: new Date(recentTimestamp.getTime() + i * 1000),
      })),
    });

    // Prune old events
    const request = new NextRequest('http://localhost:3000/api/hooks/events/prune', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify({
        olderThan: cutoffTimestamp.toISOString(),
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify atomicity: either ALL 1000 deleted or NONE (no partial deletion)
    const remainingEvents = await prisma.hookEvent.count({
      where: { projectId: 'test-project' },
    });

    // If transaction failed, we'd have > 5 remaining (partial deletion)
    // If transaction succeeded, we should have exactly 5 (recent events)
    expect(remainingEvents).toBe(5);
    expect(data.data.pruned).toBe(1000);
  });

  it('should cap deletions at 1000 events per prune call', async () => {
    const oldTimestamp = new Date('2026-01-01T00:00:00Z');
    const cutoffTimestamp = new Date('2026-02-01T00:00:00Z');

    // Create 1500 old events
    const oldEvents = Array.from({ length: 1500 }, (_, i) => ({
      projectId: 'test-project',
      eventType: 'pre_tool_use' as const,
      agentName: 'murdock',
      status: 'success' as const,
      summary: `Old event ${i + 1}`,
      timestamp: new Date(oldTimestamp.getTime() + i * 1000),
    }));

    await prisma.hookEvent.createMany({
      data: oldEvents,
    });

    // First prune call
    const request = new NextRequest('http://localhost:3000/api/hooks/events/prune', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-project',
      },
      body: JSON.stringify({
        olderThan: cutoffTimestamp.toISOString(),
      }),
    });

    const response1 = await POST(request.clone() as unknown as NextRequest);
    const data1 = await response1.json();

    expect(response1.status).toBe(200);
    expect(data1.success).toBe(true);

    // Should prune at most 1000 events
    expect(data1.data.pruned).toBeLessThanOrEqual(1000);

    // Verify at least 500 events remain (since we created 1500)
    const remainingAfterFirst = await prisma.hookEvent.count({
      where: { projectId: 'test-project' },
    });
    expect(remainingAfterFirst).toBeGreaterThanOrEqual(500);

    // Second prune call should get the rest (up to 1000 more)
    const response2 = await POST(request.clone() as unknown as NextRequest);
    const data2 = await response2.json();

    expect(response2.status).toBe(200);
    expect(data2.success).toBe(true);
    expect(data2.data.pruned).toBeLessThanOrEqual(1000);

    // After two calls, all events should be pruned
    const remainingAfterSecond = await prisma.hookEvent.count({
      where: { projectId: 'test-project' },
    });
    expect(remainingAfterSecond).toBe(0);
  });
});
