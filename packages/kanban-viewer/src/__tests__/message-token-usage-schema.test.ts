import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';

/**
 * Smoke tests for the MessageTokenUsage table (WI-169).
 *
 * MessageTokenUsage is the per-message source-of-truth for token attribution:
 * one row per assistant message, uniquely keyed by (projectId, messageId) so
 * re-emitting the same messageId within a project upserts (idempotent) rather
 * than inserting a duplicate, while two projects that happen to emit the same
 * messageId get independent rows.
 *
 * As a "task" type item, 1-2 smoke tests suffice: prove a row can be created via
 * the prisma client with all schema fields, and prove the
 * @@unique([projectId, messageId]) constraint makes re-emission idempotent
 * per-project without colliding across projects.
 */

const PROJECT_ID = 'test-message-token-usage-project';
const OTHER_PROJECT_ID = 'test-message-token-usage-project-2';
const MISSION_ID = 'M-20260628-mtu-test';
const MESSAGE_ID = 'msg_mtu_test_0001';

beforeEach(async () => {
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {},
    create: { id: PROJECT_ID, name: 'Message Token Usage Test Project' },
  });
  await prisma.project.upsert({
    where: { id: OTHER_PROJECT_ID },
    update: {},
    create: { id: OTHER_PROJECT_ID, name: 'Message Token Usage Test Project 2' },
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
  await prisma.messageTokenUsage.deleteMany({ where: { projectId: OTHER_PROJECT_ID } });
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
      where: { projectId_messageId: { projectId: PROJECT_ID, messageId: MESSAGE_ID } },
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

  it('upserts on (projectId, messageId) so re-emission leaves exactly one row with updated tokens', async () => {
    const baseData = {
      projectId: PROJECT_ID,
      missionId: MISSION_ID,
      agentName: 'ba',
      model: 'claude-sonnet-4-6',
      timestamp: new Date('2026-06-28T13:00:00.000Z'),
    };

    await prisma.messageTokenUsage.upsert({
      where: { projectId_messageId: { projectId: PROJECT_ID, messageId: MESSAGE_ID } },
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
      where: { projectId_messageId: { projectId: PROJECT_ID, messageId: MESSAGE_ID } },
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
      where: { projectId: PROJECT_ID, messageId: MESSAGE_ID },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      inputTokens: 999,
      outputTokens: 888,
      cacheCreationTokens: 7,
      cacheReadTokens: 6,
    });
  });

  it('lets two projects store the same messageId as independent rows, each still idempotent', async () => {
    const dataFor = (projectId: string, inputTokens: number) => ({
      projectId,
      messageId: MESSAGE_ID,
      agentName: 'murdock',
      model: 'claude-opus-4-8',
      inputTokens,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      timestamp: new Date('2026-06-28T14:00:00.000Z'),
    });

    // Same messageId, two different projects: must land in two distinct rows.
    await prisma.messageTokenUsage.upsert({
      where: { projectId_messageId: { projectId: PROJECT_ID, messageId: MESSAGE_ID } },
      create: dataFor(PROJECT_ID, 1),
      update: { inputTokens: 1 },
    });
    await prisma.messageTokenUsage.upsert({
      where: { projectId_messageId: { projectId: OTHER_PROJECT_ID, messageId: MESSAGE_ID } },
      create: dataFor(OTHER_PROJECT_ID, 2),
      update: { inputTokens: 2 },
    });

    const rows = await prisma.messageTokenUsage.findMany({
      where: { messageId: MESSAGE_ID },
      orderBy: { projectId: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ projectId: PROJECT_ID, inputTokens: 1 });
    expect(rows[1]).toMatchObject({ projectId: OTHER_PROJECT_ID, inputTokens: 2 });

    // Re-upserting the first project's row again must still be idempotent
    // (update, not a second insert) even though OTHER_PROJECT_ID shares the messageId.
    await prisma.messageTokenUsage.upsert({
      where: { projectId_messageId: { projectId: PROJECT_ID, messageId: MESSAGE_ID } },
      create: dataFor(PROJECT_ID, 999),
      update: { inputTokens: 999 },
    });
    const afterReupsert = await prisma.messageTokenUsage.findMany({
      where: { messageId: MESSAGE_ID },
    });
    expect(afterReupsert).toHaveLength(2);
  });
});
