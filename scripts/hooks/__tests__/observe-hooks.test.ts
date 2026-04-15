/**
 * Tests for observer hook scripts
 *
 * These hooks observe tool lifecycle events and POST them to the API.
 * They must be fast (<100ms) and always exit with code 0.
 *
 * buildObserverPayload(hookInput, agentNameArg?) takes stdin-style JSON keys:
 *   hook_event_name, tool_name, tool_input, agent_type, session_id
 *
 * sendObserverEvent(payload) reads ATEAM_API_URL and ATEAM_PROJECT_ID
 * from process.env directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildObserverPayload,
  sendObserverEvent,
} from '../lib/observer.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Type definitions for observer hook stdin input.
 * These match the JSON that Claude Code pipes to hooks on stdin.
 */
interface ObserverHookInput {
  tool_input?: Record<string, unknown>;
  tool_name?: string;
  agent_type?: string;
  hook_event_name?: string;
  session_id?: string;
}

interface HookEventPayload {
  eventType: string;
  agentName: string;
  toolName?: string;
  status: string;
  summary: string;
  correlationId: string;
  timestamp: string;
}

describe('Observer Hook - Payload Construction', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should generate a valid payload for pre_tool_use events', () => {
    const hookInput: ObserverHookInput = {
      tool_input: { command: 'npm test' },
      tool_name: 'Bash',
      hook_event_name: 'PreToolUse',
    };

    const payload = buildObserverPayload(hookInput, 'Murdock');

    expect(payload).not.toBeNull();
    expect(payload?.eventType).toBe('pre_tool_use');
    expect(payload?.agentName).toBe('Murdock');
    expect(payload?.toolName).toBe('Bash');
    expect(payload?.status).toBe('pending');
    expect(payload?.summary).toBe('Bash: npm test');
    expect(payload?.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(payload?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should generate a valid payload for post_tool_use events', () => {
    const hookInput: ObserverHookInput = {
      tool_input: { file_path: 'src/test.ts' },
      tool_name: 'Write',
      hook_event_name: 'PostToolUse',
    };

    const payload = buildObserverPayload(hookInput, 'B.A.');

    expect(payload).not.toBeNull();
    expect(payload?.eventType).toBe('post_tool_use');
    expect(payload?.agentName).toBe('B.A.');
    expect(payload?.toolName).toBe('Write');
    expect(payload?.status).toBe('success');
    expect(payload?.summary).toBe('Write: src/test.ts (completed)');
    expect(payload?.correlationId).toBeDefined();
  });

  it('should generate a valid payload for post_tool_use_failure events', () => {
    // PostToolUse with failure is not a distinct Claude hook event name;
    // the observer maps it based on tool_output or other signals.
    // For testing, we simulate a hook_event_name that maps to post_tool_use_failure.
    // Since the function maps based on hookEventName, and there is no
    // "PostToolUseFailure" in Claude hooks, this event type comes from
    // the else-if chain. Let's test with a lowercase direct name.
    const hookInput: ObserverHookInput = {
      tool_input: { command: 'npm test' },
      tool_name: 'Bash',
      hook_event_name: 'post_tool_use_failure',
    };

    const payload = buildObserverPayload(hookInput, 'Murdock');

    expect(payload).not.toBeNull();
    expect(payload?.agentName).toBe('Murdock');
    expect(payload?.status).toBe('failed');
    expect(payload?.summary).toContain('(failed)');
  });

  it('should generate a valid payload for subagent_start events', () => {
    const hookInput: ObserverHookInput = {
      hook_event_name: 'SubagentStart',
      agent_type: 'ai-team:lynch',
    };

    const payload = buildObserverPayload(hookInput);

    expect(payload).not.toBeNull();
    expect(payload?.eventType).toBe('subagent_start');
    expect(payload?.agentName).toBe('lynch');
    expect(payload?.status).toBe('started');
    expect(payload?.summary).toBe('lynch started');
  });

  it('should generate a valid payload for subagent_stop events', () => {
    const hookInput: ObserverHookInput = {
      hook_event_name: 'SubagentStop',
      agent_type: 'ai-team:amy',
    };

    const payload = buildObserverPayload(hookInput);

    expect(payload).not.toBeNull();
    expect(payload?.eventType).toBe('subagent_stop');
    expect(payload?.agentName).toBe('amy');
    expect(payload?.status).toBe('completed');
    expect(payload?.summary).toBe('amy completed');
  });

  it('should generate a valid payload for stop events', () => {
    const hookInput: ObserverHookInput = {
      hook_event_name: 'Stop',
    };

    // Hannibal is the default when no agent_type and no CLI arg
    const payload = buildObserverPayload(hookInput);

    expect(payload).not.toBeNull();
    expect(payload?.eventType).toBe('stop');
    expect(payload?.agentName).toBe('hannibal');
    expect(payload?.status).toBe('stopped');
    expect(payload?.summary).toBe('hannibal stopped');
  });

  it('should always generate a unique correlationId', () => {
    const hookInput: ObserverHookInput = {
      tool_name: 'Bash',
      hook_event_name: 'PreToolUse',
    };

    const payload1 = buildObserverPayload(hookInput, 'Murdock');
    const payload2 = buildObserverPayload(hookInput, 'Murdock');

    expect(payload1?.correlationId).toBeDefined();
    expect(payload2?.correlationId).toBeDefined();
    expect(payload1?.correlationId).not.toBe(payload2?.correlationId);
  });

  it('should return null when event type is missing', () => {
    const hookInput: ObserverHookInput = {
      tool_name: 'Bash',
    };

    const payload = buildObserverPayload(hookInput, 'Murdock');

    expect(payload).toBeNull();
  });

  it('should fallback to hannibal when agent name is missing', () => {
    // The function defaults to 'hannibal' when no agent name is provided
    // (no CLI arg, no agent_type in stdin, no session agent map match)
    const hookInput: ObserverHookInput = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    };

    const payload = buildObserverPayload(hookInput);

    expect(payload).not.toBeNull();
    expect(payload?.agentName).toBe('hannibal');
  });

  it('should resolve agent from teammate_name when no CLI arg or agent_type', () => {
    // Native teams mode: teammates send teammate_name in stdin, not agent_type
    const hookInput = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      teammate_name: 'murdock-1',
    };

    const payload = buildObserverPayload(hookInput);

    expect(payload).not.toBeNull();
    expect(payload?.agentName).toBe('murdock');
  });

  it('should resolve agent from teammate_name with ai-team: prefix', () => {
    const hookInput = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      teammate_name: 'ai-team:ba-2',
    };

    const payload = buildObserverPayload(hookInput);

    expect(payload).not.toBeNull();
    expect(payload?.agentName).toBe('ba');
  });

  it('should prefer CLI arg over teammate_name', () => {
    const hookInput = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      teammate_name: 'murdock-1',
    };

    const payload = buildObserverPayload(hookInput, 'face');

    expect(payload).not.toBeNull();
    expect(payload?.agentName).toBe('face');
  });

  it('should handle tool_input as object (not JSON string)', () => {
    // In the actual hook, tool_input comes as a parsed object from stdin,
    // not a JSON string
    const hookInput: ObserverHookInput = {
      tool_input: { command: 'npm test' },
      tool_name: 'Bash',
      hook_event_name: 'PreToolUse',
    };

    const payload = buildObserverPayload(hookInput, 'Murdock');

    expect(payload).not.toBeNull();
    expect(payload?.summary).toBe('Bash: npm test');
  });
});

describe('Observer Hook - API Communication', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...origEnv };
  });

  it('should POST to the correct API endpoint with correct headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    process.env.ATEAM_API_URL = 'http://localhost:3000';
    process.env.ATEAM_PROJECT_ID = 'test-project';

    const hookInput: ObserverHookInput = {
      tool_name: 'Bash',
      hook_event_name: 'PreToolUse',
    };

    const payload = buildObserverPayload(hookInput, 'Murdock');
    expect(payload).not.toBeNull();

    const success = await sendObserverEvent(payload!);

    expect(success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/hooks/events',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project',
        },
        body: expect.stringContaining('"eventType":"pre_tool_use"'),
      })
    );
  });

  it('should use default API URL when not provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    delete process.env.ATEAM_API_URL;
    process.env.ATEAM_PROJECT_ID = 'test-project';

    const hookInput: ObserverHookInput = {
      tool_name: 'Bash',
      hook_event_name: 'PreToolUse',
    };

    const payload = buildObserverPayload(hookInput, 'Murdock');
    await sendObserverEvent(payload!);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/hooks/events',
      expect.any(Object)
    );
  });

  it('should use default project ID when not provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    process.env.ATEAM_API_URL = 'http://localhost:3000';
    delete process.env.ATEAM_PROJECT_ID;

    const hookInput: ObserverHookInput = {
      tool_name: 'Bash',
      hook_event_name: 'PreToolUse',
    };

    const payload = buildObserverPayload(hookInput, 'Murdock');
    await sendObserverEvent(payload!);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Project-ID': 'default',
        }),
      })
    );
  });

  it('should handle trailing slash in ATEAM_API_URL without creating double slashes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    process.env.ATEAM_API_URL = 'http://localhost:3000/';
    process.env.ATEAM_PROJECT_ID = 'test-project';

    const hookInput: ObserverHookInput = {
      tool_name: 'Bash',
      hook_event_name: 'PreToolUse',
    };

    const payload = buildObserverPayload(hookInput, 'Murdock');
    expect(payload).not.toBeNull();

    const success = await sendObserverEvent(payload!);

    expect(success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/hooks/events', // Should have single slash, not double
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project',
        },
      })
    );
  });

  it('should handle API errors gracefully and return false', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const hookInput: ObserverHookInput = {
      tool_name: 'Bash',
      hook_event_name: 'PreToolUse',
    };

    const payload = buildObserverPayload(hookInput, 'Murdock');
    const success = await sendObserverEvent(payload!);

    expect(success).toBe(false);
  });

  it('should handle network errors gracefully and return false', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const hookInput: ObserverHookInput = {
      tool_name: 'Bash',
      hook_event_name: 'PreToolUse',
    };

    const payload = buildObserverPayload(hookInput, 'Murdock');
    const success = await sendObserverEvent(payload!);

    expect(success).toBe(false);
  });
});

describe('Observer Hook - Payload Format', () => {
  it('should match the API expected schema', () => {
    const hookInput: ObserverHookInput = {
      tool_input: { command: 'npm test' },
      tool_name: 'Bash',
      hook_event_name: 'PreToolUse',
    };

    const payload = buildObserverPayload(hookInput, 'Murdock');

    expect(payload).not.toBeNull();

    // Validate required fields from API schema
    expect(payload).toHaveProperty('eventType');
    expect(payload).toHaveProperty('agentName');
    expect(payload).toHaveProperty('status');
    expect(payload).toHaveProperty('summary');
    expect(payload).toHaveProperty('timestamp');
    expect(payload).toHaveProperty('correlationId');

    // Validate field types
    expect(typeof payload?.eventType).toBe('string');
    expect(typeof payload?.agentName).toBe('string');
    expect(typeof payload?.status).toBe('string');
    expect(typeof payload?.summary).toBe('string');
    expect(typeof payload?.timestamp).toBe('string');
    expect(typeof payload?.correlationId).toBe('string');

    // Optional field
    if (payload?.toolName) {
      expect(typeof payload.toolName).toBe('string');
    }
  });

  it('should generate timestamps in ISO 8601 format', () => {
    const hookInput: ObserverHookInput = {
      hook_event_name: 'PreToolUse',
    };

    const payload = buildObserverPayload(hookInput, 'Murdock');

    expect(payload?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // Validate it can be parsed as a Date
    const date = new Date(payload!.timestamp);
    expect(date.getTime()).not.toBeNaN();
  });
});
