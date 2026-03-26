import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBoardEvents } from '@/hooks/use-board-events';
import type { UseBoardEventsOptions } from '@/hooks/use-board-events';
import type { BoardEvent } from '@/types';

/**
 * Tests for SSE token usage integration (WI-283).
 *
 * Covers:
 * 1. useBoardEvents onMissionTokenUsage callback fires with correct data
 * 2. Failure isolation: token aggregation errors do not block other SSE events
 */

// ---------------------------------------------------------------------------
// MockEventSource shared with other SSE tests
// ---------------------------------------------------------------------------
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.readyState = 2;
  }

  simulateOpen() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  simulateMessage(data: BoardEvent) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  simulateError() {
    this.onerror?.(new Event('error'));
  }
}

const originalEventSource = global.EventSource;
beforeEach(() => {
  MockEventSource.instances = [];
  (global as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;
  vi.useFakeTimers();
});

afterEach(() => {
  (global as unknown as { EventSource: typeof EventSource }).EventSource = originalEventSource;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. useBoardEvents: onMissionTokenUsage callback
// ---------------------------------------------------------------------------

describe('useBoardEvents onMissionTokenUsage callback', () => {
  it('should invoke onMissionTokenUsage with correct data shape when mission-token-usage event is received', () => {
    const onMissionTokenUsage = vi.fn();

    renderHook(() =>
      useBoardEvents({
        projectId: 'test-project',
        // Cast to any so tests compile before B.A. adds the option
        ...(({ onMissionTokenUsage } as unknown) as Partial<UseBoardEventsOptions>),
      } as UseBoardEventsOptions)
    );

    act(() => {
      MockEventSource.instances[0].simulateOpen();
    });

    const tokenUsagePayload = {
      missionId: 'M-20260227-001',
      agents: [
        {
          agentName: 'murdock',
          model: 'claude-sonnet-4-6',
          inputTokens: 1500,
          outputTokens: 300,
          cacheCreationTokens: 500,
          cacheReadTokens: 1000,
          estimatedCostUsd: 0.0042,
        },
        {
          agentName: 'hannibal',
          model: 'claude-opus-4-6',
          inputTokens: 5000,
          outputTokens: 1000,
          cacheCreationTokens: 2000,
          cacheReadTokens: 8000,
          estimatedCostUsd: 0.0825,
        },
      ],
      totals: {
        inputTokens: 6500,
        outputTokens: 1300,
        cacheCreationTokens: 2500,
        cacheReadTokens: 9000,
        estimatedCostUsd: 0.0867,
      },
    };

    const event = {
      type: 'mission-token-usage',
      timestamp: '2026-02-27T20:00:00Z',
      data: tokenUsagePayload,
    } as unknown as BoardEvent;

    act(() => {
      MockEventSource.instances[0].simulateMessage(event);
    });

    expect(onMissionTokenUsage).toHaveBeenCalledTimes(1);

    const received = onMissionTokenUsage.mock.calls[0][0];
    expect(received).toHaveProperty('missionId', 'M-20260227-001');
    expect(received.agents).toHaveLength(2);

    const murdockRow = received.agents.find((a: { agentName: string }) => a.agentName === 'murdock');
    expect(murdockRow).toBeDefined();
    expect(murdockRow.inputTokens).toBe(1500);
    expect(murdockRow.estimatedCostUsd).toBe(0.0042);

    expect(received.totals.inputTokens).toBe(6500);
    expect(received.totals.estimatedCostUsd).toBe(0.0867);
  });

  it('should not invoke onMissionTokenUsage when callback is not provided', () => {
    const onMissionCompleted = vi.fn();

    renderHook(() =>
      useBoardEvents({
        projectId: 'test-project',
        onMissionCompleted,
        // onMissionTokenUsage intentionally omitted
      })
    );

    act(() => {
      MockEventSource.instances[0].simulateOpen();
    });

    // Sending mission-token-usage without a handler must not throw
    const tokenEvent = {
      type: 'mission-token-usage',
      timestamp: '2026-02-27T20:00:00Z',
      data: { missionId: 'M-001', agents: [], totals: {} },
    } as unknown as BoardEvent;

    act(() => {
      MockEventSource.instances[0].simulateMessage(tokenEvent);
    });

    // onMissionCompleted should be unaffected
    expect(onMissionCompleted).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. SSE deduplication: emitted once per mission completion
// ---------------------------------------------------------------------------

describe('SSE mission-token-usage deduplication', () => {
  it('should emit mission-token-usage exactly once in the SSE event stream per mission', () => {
    const onMissionTokenUsage = vi.fn();

    renderHook(() =>
      useBoardEvents({
        projectId: 'test-project',
        ...(({ onMissionTokenUsage } as unknown) as Partial<UseBoardEventsOptions>),
      } as UseBoardEventsOptions)
    );

    act(() => {
      MockEventSource.instances[0].simulateOpen();
    });

    const tokenEvent = {
      type: 'mission-token-usage',
      timestamp: '2026-02-27T20:00:00Z',
      data: {
        missionId: 'M-20260227-001',
        agents: [{ agentName: 'ba', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0.0028 }],
        totals: { inputTokens: 1000, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0.0028 },
      },
    } as unknown as BoardEvent;

    // Emit once (as the SSE endpoint would do after detecting mission completion)
    act(() => {
      MockEventSource.instances[0].simulateMessage(tokenEvent);
    });

    // Callback is invoked once
    expect(onMissionTokenUsage).toHaveBeenCalledTimes(1);

    // No further mission-token-usage events arrive (endpoint deduplication)
    // — callback count stays at 1
    expect(onMissionTokenUsage).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Failure isolation: token aggregation errors must not block other events
// ---------------------------------------------------------------------------

describe('SSE failure isolation', () => {
  it('should continue delivering other SSE events even when token aggregation would fail', () => {
    const onMissionCompleted = vi.fn();
    const onMissionTokenUsage = vi.fn();

    renderHook(() =>
      useBoardEvents({
        projectId: 'test-project',
        onMissionCompleted,
        ...(({ onMissionTokenUsage } as unknown) as Partial<UseBoardEventsOptions>),
      } as UseBoardEventsOptions)
    );

    act(() => {
      MockEventSource.instances[0].simulateOpen();
    });

    // The mission-completed event arrives (token aggregation failed server-side,
    // so no mission-token-usage event is emitted)
    const missionCompletedEvent: BoardEvent = {
      type: 'mission-completed',
      timestamp: '2026-02-27T20:00:00Z',
      data: {
        completed_at: '2026-02-27T20:00:00Z',
        duration_ms: 3600000,
      },
    };

    act(() => {
      MockEventSource.instances[0].simulateMessage(missionCompletedEvent);
    });

    // mission-completed callback fires normally — token failure is isolated
    expect(onMissionCompleted).toHaveBeenCalledTimes(1);
    expect(onMissionCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ completed_at: '2026-02-27T20:00:00Z' })
    );

    // Token usage callback was NOT called (aggregation failed before emission)
    expect(onMissionTokenUsage).not.toHaveBeenCalled();
  });

  it('should deliver mission-token-usage independently of mission-completed ordering', () => {
    const onMissionCompleted = vi.fn();
    const onMissionTokenUsage = vi.fn();

    renderHook(() =>
      useBoardEvents({
        projectId: 'test-project',
        onMissionCompleted,
        ...(({ onMissionTokenUsage } as unknown) as Partial<UseBoardEventsOptions>),
      } as UseBoardEventsOptions)
    );

    act(() => {
      MockEventSource.instances[0].simulateOpen();
    });

    const tokenEvent = {
      type: 'mission-token-usage',
      timestamp: '2026-02-27T20:00:01Z',
      data: {
        missionId: 'M-20260227-001',
        agents: [{ agentName: 'lynch', model: 'claude-sonnet-4-6', inputTokens: 3000, outputTokens: 600, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0.0084 }],
        totals: { inputTokens: 3000, outputTokens: 600, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0.0084 },
      },
    } as unknown as BoardEvent;

    const completedEvent: BoardEvent = {
      type: 'mission-completed',
      timestamp: '2026-02-27T20:00:00Z',
      data: { completed_at: '2026-02-27T20:00:00Z', duration_ms: 7200000 },
    };

    // Token usage arrives first, completed second (ordering variation)
    act(() => {
      MockEventSource.instances[0].simulateMessage(tokenEvent);
    });
    act(() => {
      MockEventSource.instances[0].simulateMessage(completedEvent);
    });

    expect(onMissionTokenUsage).toHaveBeenCalledTimes(1);
    expect(onMissionCompleted).toHaveBeenCalledTimes(1);

    const tokenData = onMissionTokenUsage.mock.calls[0][0];
    expect(tokenData.agents[0].agentName).toBe('lynch');
    expect(tokenData.totals.estimatedCostUsd).toBe(0.0084);
  });
});
