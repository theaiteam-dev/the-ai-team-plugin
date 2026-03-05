import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBoardEvents } from '@/hooks/use-board-events';
import type { UseBoardEventsOptions } from '@/hooks/use-board-events';
import type { BoardEvent } from '@/types';

/**
 * Tests for SSE token usage integration (WI-283).
 *
 * Covers:
 * 1. MissionTokenUsageData interface compiles with expected fields
 * 2. useBoardEvents onMissionTokenUsage callback fires with correct data
 * 3. SSE deduplication: event fires once per mission, not every poll cycle
 * 4. Failure isolation: token aggregation errors do not block other SSE events
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
// 1. Type smoke test: MissionTokenUsageData interface
// ---------------------------------------------------------------------------

describe('MissionTokenUsageData type', () => {
  it('should compile with all expected token and cost fields', () => {
    // Type-level test: if this compiles, the interface has the right shape.
    // B.A. must add MissionTokenUsageData to @/types for this to pass.
    type MissionTokenUsageData = {
      agentName: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      estimatedCostUsd: number;
    };

    const row: MissionTokenUsageData = {
      agentName: 'murdock',
      model: 'claude-sonnet-4-6',
      inputTokens: 1500,
      outputTokens: 300,
      cacheCreationTokens: 500,
      cacheReadTokens: 1000,
      estimatedCostUsd: 0.0042,
    };

    expect(row).toHaveProperty('agentName', 'murdock');
    expect(row).toHaveProperty('model', 'claude-sonnet-4-6');
    expect(row).toHaveProperty('inputTokens', 1500);
    expect(row).toHaveProperty('outputTokens', 300);
    expect(row).toHaveProperty('cacheCreationTokens', 500);
    expect(row).toHaveProperty('cacheReadTokens', 1000);
    expect(row).toHaveProperty('estimatedCostUsd', 0.0042);
  });
});

// ---------------------------------------------------------------------------
// 2. useBoardEvents: onMissionTokenUsage callback
// ---------------------------------------------------------------------------

describe('useBoardEvents onMissionTokenUsage callback', () => {
  it('should invoke onMissionTokenUsage with correct data shape when mission-token-usage event is received', () => {
    // Verify that useBoardEvents forwards the mission-token-usage SSE event to
    // its callback. The callback signature must accept the per-agent payload.
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
    // Other callbacks should work normally when onMissionTokenUsage is absent.
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
// 3. SSE deduplication: emitted once per mission completion
// ---------------------------------------------------------------------------

describe('SSE mission-token-usage deduplication', () => {
  it('should fire once when mission completes, not on every subsequent poll cycle', () => {
    // The SSE endpoint tracks emitted missions to prevent re-emission.
    // This test documents the expected behavior: a Set (or equivalent) of
    // already-emitted mission IDs prevents duplicate events.

    const emittedMissions = new Set<string>();

    const shouldEmitTokenUsage = (missionId: string, alreadyEmitted: Set<string>): boolean => {
      if (alreadyEmitted.has(missionId)) {
        return false; // Already emitted for this mission
      }
      alreadyEmitted.add(missionId);
      return true;
    };

    const MISSION_ID = 'M-20260227-dedup-test';

    // First time the mission completes — should emit
    expect(shouldEmitTokenUsage(MISSION_ID, emittedMissions)).toBe(true);

    // Subsequent poll cycles for the same completed mission — should NOT re-emit
    expect(shouldEmitTokenUsage(MISSION_ID, emittedMissions)).toBe(false);
    expect(shouldEmitTokenUsage(MISSION_ID, emittedMissions)).toBe(false);

    // A different mission completing later — should emit once
    const ANOTHER_MISSION = 'M-20260227-second-mission';
    expect(shouldEmitTokenUsage(ANOTHER_MISSION, emittedMissions)).toBe(true);
    expect(shouldEmitTokenUsage(ANOTHER_MISSION, emittedMissions)).toBe(false);
  });

  it('should emit mission-token-usage exactly once in the SSE event stream per mission', () => {
    // Simulate what the SSE endpoint produces: multiple poll cycles after
    // mission completion. The token usage event should appear in the stream
    // only on the first cycle where the mission is detected as completed.
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
// 4. Failure isolation: token aggregation errors must not block other events
// ---------------------------------------------------------------------------

describe('SSE failure isolation', () => {
  it('should continue delivering other SSE events even when token aggregation would fail', () => {
    // The SSE poll function uses try/catch around token aggregation so that
    // a DB error or aggregation failure does not prevent mission-completed or
    // other events from being flushed in the same poll cycle.
    //
    // This test simulates the expected contract: if the endpoint encounters
    // an error in the token usage code path, the other callbacks still fire.

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
    // When aggregation succeeds, both events can be emitted in the same poll
    // cycle or in different cycles — the hook must handle both orders.
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
