import { NextRequest } from 'next/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/hooks/events/route';
import { prisma } from '@/lib/db';

/**
 * Integration tests for token usage fields on HookEvent (WI-272)
 *
 * Verifies:
 * 1. API endpoint accepts and stores token fields
 * 2. Existing events without token fields are unaffected (backward compatibility)
 */

describe('HookEvent token usage fields', () => {
  beforeEach(async () => {
    await prisma.hookEvent.deleteMany({
      where: { projectId: 'test-token-project' },
    });
  });

  it('should accept and store token usage fields in POST /api/hooks/events', async () => {
    const eventWithTokens = {
      eventType: 'post_tool_use',
      agentName: 'murdock',
      toolName: 'Write',
      status: 'success',
      durationMs: 250,
      summary: 'Wrote test file with token tracking',
      timestamp: new Date().toISOString(),
      inputTokens: 1024,
      outputTokens: 512,
      cacheCreationTokens: 200,
      cacheReadTokens: 800,
      model: 'claude-sonnet-4-6',
    };

    const request = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-token-project',
      },
      body: JSON.stringify(eventWithTokens),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const dbEvent = await prisma.hookEvent.findFirst({
      where: { projectId: 'test-token-project' },
    });

    expect(dbEvent).not.toBeNull();
    expect(dbEvent?.inputTokens).toBe(1024);
    expect(dbEvent?.outputTokens).toBe(512);
    expect(dbEvent?.cacheCreationTokens).toBe(200);
    expect(dbEvent?.cacheReadTokens).toBe(800);
    expect(dbEvent?.model).toBe('claude-sonnet-4-6');
  });

  it('should store existing events without token fields with null token columns (backward compatibility)', async () => {
    const eventWithoutTokens = {
      eventType: 'pre_tool_use',
      agentName: 'ba',
      toolName: 'Edit',
      status: 'pending',
      summary: 'About to edit implementation',
      timestamp: new Date().toISOString(),
      // No token fields
    };

    const request = new NextRequest('http://localhost:3000/api/hooks/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'test-token-project',
      },
      body: JSON.stringify(eventWithoutTokens),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const dbEvent = await prisma.hookEvent.findFirst({
      where: { projectId: 'test-token-project' },
    });

    expect(dbEvent).not.toBeNull();
    // Token fields default to null for legacy events
    expect(dbEvent?.inputTokens).toBeNull();
    expect(dbEvent?.outputTokens).toBeNull();
    expect(dbEvent?.cacheCreationTokens).toBeNull();
    expect(dbEvent?.cacheReadTokens).toBeNull();
    expect(dbEvent?.model).toBeNull();
    // Core fields still work
    expect(dbEvent?.agentName).toBe('ba');
    expect(dbEvent?.eventType).toBe('pre_tool_use');
  });
});
