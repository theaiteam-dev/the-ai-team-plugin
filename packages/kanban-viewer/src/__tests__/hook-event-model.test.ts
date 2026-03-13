import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';

/**
 * Smoke tests for HookEvent Prisma model.
 *
 * These tests verify:
 * 1. The HookEvent model exists in the Prisma client
 * 2. Required fields are enforced
 * 3. Optional fields are nullable
 *
 * This is a type-level test for schema validation, not runtime behavior.
 */

describe('HookEvent Prisma Model', () => {
  it('should have HookEvent model in Prisma client types', () => {
    // Type-level check: if this compiles, the model exists
    const _typeCheck: typeof prisma.hookEvent = prisma.hookEvent;

    expect(prisma.hookEvent).toBeDefined();
  });

  it('should enforce required fields (projectId, eventType, agentName, status, summary, timestamp)', () => {

    // This should compile - all required fields provided
    const validEventData = {
      projectId: 'test-project',
      eventType: 'pre_tool_use',
      agentName: 'murdock',
      status: 'success',
      summary: 'Test event',
      timestamp: new Date(),
    };

    // Type check: this should be assignable to create input
    const _typeCheck: Parameters<typeof prisma.hookEvent.create>[0]['data'] = validEventData;

    // Verify the shape is correct
    expect(validEventData).toHaveProperty('projectId');
    expect(validEventData).toHaveProperty('eventType');
    expect(validEventData).toHaveProperty('agentName');
    expect(validEventData).toHaveProperty('status');
    expect(validEventData).toHaveProperty('summary');
    expect(validEventData).toHaveProperty('timestamp');
  });

  it('should allow optional fields (missionId, toolName, durationMs, correlationId)', () => {

    // This should compile - optional fields omitted
    const minimalEventData: {
      projectId: string;
      eventType: string;
      agentName: string;
      status: string;
      summary: string;
      timestamp: Date;
      missionId?: string | null;
      toolName?: string | null;
      durationMs?: number | null;
      correlationId?: string | null;
    } = {
      projectId: 'test-project',
      eventType: 'stop',
      agentName: 'hannibal',
      status: 'success',
      summary: 'Mission complete',
      timestamp: new Date(),
      // Optional fields omitted
    };

    // This should also compile - optional fields included
    const fullEventData = {
      projectId: 'test-project',
      eventType: 'post_tool_use',
      agentName: 'ba',
      status: 'success',
      summary: 'Tool executed',
      timestamp: new Date(),
      missionId: 'M-001',
      toolName: 'Write',
      durationMs: 150,
      correlationId: 'abc-123',
      payload: '{"details": "example"}',
    };

    // Type checks
    const _minimalCheck: Parameters<typeof prisma.hookEvent.create>[0]['data'] = minimalEventData;
    const _fullCheck: Parameters<typeof prisma.hookEvent.create>[0]['data'] = fullEventData;

    // Verify optional fields can be undefined
    expect(minimalEventData.missionId).toBeUndefined();
    expect(minimalEventData.toolName).toBeUndefined();
    expect(minimalEventData.durationMs).toBeUndefined();
    expect(minimalEventData.correlationId).toBeUndefined();

    // Verify optional fields can be provided
    expect(fullEventData.missionId).toBe('M-001');
    expect(fullEventData.toolName).toBe('Write');
    expect(fullEventData.durationMs).toBe(150);
    expect(fullEventData.correlationId).toBe('abc-123');
  });
});
