import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/hooks/events/backfill/route';
import { prisma } from '@/lib/db';
import { NextRequest } from 'next/server';

/**
 * Tests for POST /api/hooks/events/backfill
 *
 * Retroactively matches orphan hook events (missionId: null) to missions
 * by timestamp range [startedAt, archivedAt ?? now()].
 */

const PROJECT_ID = 'test-backfill-project';
const PROJECT_B_ID = 'test-backfill-project-b';

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/hooks/events/backfill', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Project-ID': PROJECT_ID,
    },
  });
}

beforeEach(async () => {
  // Clean up all test data
  await prisma.hookEvent.deleteMany({
    where: { projectId: { in: [PROJECT_ID, PROJECT_B_ID] } },
  });
  await prisma.mission.deleteMany({
    where: { projectId: { in: [PROJECT_ID, PROJECT_B_ID] } },
  });
  await prisma.project.deleteMany({
    where: { id: { in: [PROJECT_ID, PROJECT_B_ID] } },
  });

  // Seed projects
  await prisma.project.create({ data: { id: PROJECT_ID, name: 'Backfill Test' } });
});

describe('POST /api/hooks/events/backfill', () => {
  it('should match orphan events to correct mission by timestamp', async () => {
    const mission1Start = new Date('2026-03-01T10:00:00Z');
    const mission1Archive = new Date('2026-03-01T12:00:00Z');
    const mission2Start = new Date('2026-03-01T13:00:00Z');
    const mission2Archive = new Date('2026-03-01T15:00:00Z');

    // Create two sequential missions
    await prisma.mission.createMany({
      data: [
        {
          id: 'M-backfill-001',
          name: 'Mission 1',
          state: 'archived',
          prdPath: '/prd/m1.md',
          projectId: PROJECT_ID,
          startedAt: mission1Start,
          archivedAt: mission1Archive,
        },
        {
          id: 'M-backfill-002',
          name: 'Mission 2',
          state: 'archived',
          prdPath: '/prd/m2.md',
          projectId: PROJECT_ID,
          startedAt: mission2Start,
          archivedAt: mission2Archive,
        },
      ],
    });

    // Create orphan events at different timestamps
    await prisma.hookEvent.createMany({
      data: [
        {
          projectId: PROJECT_ID,
          missionId: null,
          eventType: 'stop',
          agentName: 'hannibal',
          status: 'stopped',
          summary: 'Event during mission 1',
          timestamp: new Date('2026-03-01T11:00:00Z'),
          inputTokens: 1000,
          outputTokens: 200,
          model: 'claude-opus-4-6',
        },
        {
          projectId: PROJECT_ID,
          missionId: null,
          eventType: 'stop',
          agentName: 'murdock',
          status: 'stopped',
          summary: 'Event during mission 2',
          timestamp: new Date('2026-03-01T14:00:00Z'),
          inputTokens: 2000,
          outputTokens: 400,
          model: 'claude-sonnet-4-6',
        },
      ],
    });

    const response = await POST(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.updated).toBe(2);
    expect(data.data.unmatched).toBe(0);

    // Verify correct mission assignment
    const events = await prisma.hookEvent.findMany({
      where: { projectId: PROJECT_ID },
      orderBy: { timestamp: 'asc' },
    });

    expect(events[0].missionId).toBe('M-backfill-001');
    expect(events[1].missionId).toBe('M-backfill-002');
  });

  it('should leave events outside any mission range as unmatched', async () => {
    const missionStart = new Date('2026-03-01T10:00:00Z');
    const missionArchive = new Date('2026-03-01T12:00:00Z');

    await prisma.mission.create({
      data: {
        id: 'M-backfill-003',
        name: 'Single Mission',
        state: 'archived',
        prdPath: '/prd/m3.md',
        projectId: PROJECT_ID,
        startedAt: missionStart,
        archivedAt: missionArchive,
      },
    });

    await prisma.hookEvent.createMany({
      data: [
        // Before mission started
        {
          projectId: PROJECT_ID,
          missionId: null,
          eventType: 'stop',
          agentName: 'hannibal',
          status: 'stopped',
          summary: 'Event before mission',
          timestamp: new Date('2026-03-01T09:00:00Z'),
          inputTokens: 500,
          outputTokens: 100,
          model: 'claude-opus-4-6',
        },
        // During mission
        {
          projectId: PROJECT_ID,
          missionId: null,
          eventType: 'stop',
          agentName: 'murdock',
          status: 'stopped',
          summary: 'Event during mission',
          timestamp: new Date('2026-03-01T11:00:00Z'),
          inputTokens: 1000,
          outputTokens: 200,
          model: 'claude-sonnet-4-6',
        },
        // After mission archived
        {
          projectId: PROJECT_ID,
          missionId: null,
          eventType: 'stop',
          agentName: 'ba',
          status: 'stopped',
          summary: 'Event after mission',
          timestamp: new Date('2026-03-01T13:00:00Z'),
          inputTokens: 700,
          outputTokens: 150,
          model: 'claude-sonnet-4-6',
        },
      ],
    });

    const response = await POST(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.updated).toBe(1);
    expect(data.data.unmatched).toBe(2);

    // Verify only the middle event got matched
    const matchedEvent = await prisma.hookEvent.findFirst({
      where: { projectId: PROJECT_ID, missionId: 'M-backfill-003' },
    });
    expect(matchedEvent).not.toBeNull();
    expect(matchedEvent!.agentName).toBe('murdock');

    // Others remain orphaned
    const orphans = await prisma.hookEvent.findMany({
      where: { projectId: PROJECT_ID, missionId: null },
    });
    expect(orphans).toHaveLength(2);
  });

  it('should isolate projects — events from project A not matched to project B missions', async () => {
    // Create project B
    await prisma.project.create({ data: { id: PROJECT_B_ID, name: 'Project B' } });

    // Mission belongs to project A
    await prisma.mission.create({
      data: {
        id: 'M-backfill-004',
        name: 'Project A Mission',
        state: 'running',
        prdPath: '/prd/m4.md',
        projectId: PROJECT_ID,
        startedAt: new Date('2026-03-01T10:00:00Z'),
        archivedAt: null,
      },
    });

    // Orphan event belongs to project B
    await prisma.hookEvent.create({
      data: {
        projectId: PROJECT_B_ID,
        missionId: null,
        eventType: 'stop',
        agentName: 'hannibal',
        status: 'stopped',
        summary: 'Project B event',
        timestamp: new Date('2026-03-01T11:00:00Z'),
        inputTokens: 1000,
        outputTokens: 200,
        model: 'claude-opus-4-6',
      },
    });

    // Backfill for project A — should not touch project B events
    const response = await POST(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.updated).toBe(0);
    expect(data.data.unmatched).toBe(0); // No orphans for project A

    // Project B event should remain orphaned
    const projectBEvent = await prisma.hookEvent.findFirst({
      where: { projectId: PROJECT_B_ID },
    });
    expect(projectBEvent!.missionId).toBeNull();
  });

  it('should return 400 when X-Project-ID header is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/hooks/events/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
  });
});
