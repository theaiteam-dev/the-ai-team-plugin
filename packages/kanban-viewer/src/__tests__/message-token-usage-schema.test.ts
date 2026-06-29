import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';

/**
 * Smoke tests for the MessageTokenUsage table (WI-169).
 *
 * MessageTokenUsage is the per-message source-of-truth for token attribution:
 * one row per assistant message, uniquely keyed by messageId so re-emitting the
 * same messageId upserts (idempotent) rather than inserting a duplicate.
 *
 * As a "task" type item, 1-2 smoke tests suffice: prove a row can be created via
 * the prisma client with all schema fields, and prove the @@unique([messageId])
 * constraint makes re-emission idempotent.
 */

const PROJECT_ID = 'test-message-token-usage-project';
const MISSION_ID = 'M-20260628-mtu-test';
const MESSAGE_ID = 'msg_mtu_test_0001';

beforeEach(async () => {
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {},
    create: { id: PROJECT_ID, name: 'Message Token Usage Test Project' },
  });

  await prisma.mission.upsert({
    where: { id: MISSION_ID },
    update: {},
    create: {
      id: MISSION_ID,
      name: 'Message Token Usage Test Mission',
      state: 'running',
      prdPath: '/prd/test.md',
      projectId: PROJECT_ID,
      startedAt: new Date(),
    },
  });

  await prisma.messageTokenUsage.deleteMany({ where: { projectId: PROJECT_ID } });
});

describe('MessageTokenUsage table', () => {
  it('stores one row per message with model and per-message token deltas', async () => {
    const timestamp = new Date('2026-06-28T12:00:00.000Z');

    await prisma.messageTokenUsage.create({
      data: {
        messageId: MESSAGE_ID,
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        agentName: 'murdock',
        model: 'claude-opus-4-8',
        inputTokens: 100,
        outputTokens: 200,
        cacheCreationTokens: 50,
        cacheReadTokens: 25,
        timestamp,
      },
    });

    const row = await prisma.messageTokenUsage.findUnique({
      where: { messageId: MESSAGE_ID },
    });

    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      messageId: MESSAGE_ID,
      projectId: PROJECT_ID,
      missionId: MISSION_ID,
      agentName: 'murdock',
      model: 'claude-opus-4-8',
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationTokens: 50,
      cacheReadTokens: 25,
    });
    expect(typeof row!.id).toBe('number');
    expect(row!.timestamp.toISOString()).toBe(timestamp.toISOString());
  });

  it('upserts on messageId so re-emission leaves exactly one row with updated tokens', async () => {
    const baseData = {
      projectId: PROJECT_ID,
      missionId: MISSION_ID,
      agentName: 'ba',
      model: 'claude-sonnet-4-6',
      timestamp: new Date('2026-06-28T13:00:00.000Z'),
    };

    await prisma.messageTokenUsage.upsert({
      where: { messageId: MESSAGE_ID },
      create: {
        ...baseData,
        messageId: MESSAGE_ID,
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
      update: {
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
    });

    // Re-emit the same messageId with corrected (higher) token values.
    await prisma.messageTokenUsage.upsert({
      where: { messageId: MESSAGE_ID },
      create: {
        ...baseData,
        messageId: MESSAGE_ID,
        inputTokens: 999,
        outputTokens: 888,
        cacheCreationTokens: 7,
        cacheReadTokens: 6,
      },
      update: {
        inputTokens: 999,
        outputTokens: 888,
        cacheCreationTokens: 7,
        cacheReadTokens: 6,
      },
    });

    const rows = await prisma.messageTokenUsage.findMany({
      where: { messageId: MESSAGE_ID },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      inputTokens: 999,
      outputTokens: 888,
      cacheCreationTokens: 7,
      cacheReadTokens: 6,
    });
  });
});
