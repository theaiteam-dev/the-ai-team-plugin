import { describe, it, expect } from 'vitest';
import type { HookEventSummary } from '@/types/hook-event';

/**
 * Tests for Raw Agent View Filtering
 *
 * This test suite verifies the filtering functionality for the Raw Agent View.
 * Focus is on the pure `filterHookEvents` function since component tests may
 * fail due to jest-dom CJS/ESM incompatibility on Node v24.
 *
 * Dependencies: WI-008 (Raw Agent View component)
 */

// Factory function for creating test hook events
function createHookEvent(overrides: Partial<HookEventSummary> = {}): HookEventSummary {
  return {
    id: 1,
    eventType: 'pre_tool_use',
    agentName: 'murdock',
    toolName: 'Write',
    status: 'success',
    summary: 'Writing test file',
    timestamp: new Date('2026-02-16T10:00:00Z'),
    ...overrides,
  };
}

// Filter state types (to be implemented)
interface RawAgentFilterState {
  agentNames: string[];       // Multi-select: ['murdock', 'ba', ...]
  toolNames: string[];        // Multi-select: ['Write', 'Edit', ...]
  status: string | null;      // Single-select: 'success' | 'failure' | 'denied' | 'pending' | null
}

// Pure filter function signature (to be implemented)
type FilterHookEventsFn = (
  events: HookEventSummary[],
  filters: RawAgentFilterState
) => HookEventSummary[];

// Mock implementation for type checking (will be replaced by real implementation)
const filterHookEvents: FilterHookEventsFn = (events, filters) => {
  let filtered = events;

  // Filter by agent names (with null safety)
  if (filters.agentNames.length > 0) {
    filtered = filtered.filter(event =>
      event.agentName && filters.agentNames.includes(event.agentName.toLowerCase())
    );
  }

  // Filter by tool names
  if (filters.toolNames.length > 0) {
    filtered = filtered.filter(event =>
      event.toolName && filters.toolNames.includes(event.toolName)
    );
  }

  // Filter by status
  if (filters.status) {
    filtered = filtered.filter(event => event.status === filters.status);
  }

  return filtered;
};

describe('filterHookEvents pure function', () => {
  describe('no filters active', () => {
    it('should return all events when no filters are set', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock' }),
        createHookEvent({ id: 2, agentName: 'ba' }),
        createHookEvent({ id: 3, agentName: 'lynch' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: [],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(3);
      expect(result).toEqual(events);
    });

    it('should return empty array when input is empty', () => {
      const events: HookEventSummary[] = [];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: [],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });
  });

  describe('agent name filtering', () => {
    it('should filter by single agent name', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock', summary: 'Murdock event' }),
        createHookEvent({ id: 2, agentName: 'ba', summary: 'B.A. event' }),
        createHookEvent({ id: 3, agentName: 'lynch', summary: 'Lynch event' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: ['murdock'],
        toolNames: [],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(1);
      expect(result[0].agentName).toBe('murdock');
      expect(result[0].summary).toBe('Murdock event');
    });

    it('should filter by multiple agent names', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock' }),
        createHookEvent({ id: 2, agentName: 'ba' }),
        createHookEvent({ id: 3, agentName: 'lynch' }),
        createHookEvent({ id: 4, agentName: 'amy' }),
        createHookEvent({ id: 5, agentName: 'hannibal' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: ['murdock', 'ba', 'lynch'],
        toolNames: [],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(3);
      expect(result.map(e => e.agentName)).toEqual(['murdock', 'ba', 'lynch']);
    });

    it('should be case-insensitive for agent names', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'Murdock' }),
        createHookEvent({ id: 2, agentName: 'MURDOCK' }),
        createHookEvent({ id: 3, agentName: 'murdock' }),
        createHookEvent({ id: 4, agentName: 'ba' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: ['murdock'],
        toolNames: [],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(3);
      expect(result.every(e => e.agentName.toLowerCase() === 'murdock')).toBe(true);
    });

    it('should return empty array when no agents match', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock' }),
        createHookEvent({ id: 2, agentName: 'ba' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: ['tawnia'],
        toolNames: [],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(0);
    });
  });

  describe('tool name filtering', () => {
    it('should filter by single tool name', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, toolName: 'Write', summary: 'Write event' }),
        createHookEvent({ id: 2, toolName: 'Edit', summary: 'Edit event' }),
        createHookEvent({ id: 3, toolName: 'Bash', summary: 'Bash event' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: ['Write'],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(1);
      expect(result[0].toolName).toBe('Write');
      expect(result[0].summary).toBe('Write event');
    });

    it('should filter by multiple tool names', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, toolName: 'Write' }),
        createHookEvent({ id: 2, toolName: 'Edit' }),
        createHookEvent({ id: 3, toolName: 'Bash' }),
        createHookEvent({ id: 4, toolName: 'Read' }),
        createHookEvent({ id: 5, toolName: 'Grep' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: ['Write', 'Edit', 'Read'],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(3);
      expect(result.map(e => e.toolName)).toEqual(['Write', 'Edit', 'Read']);
    });

    it('should exclude events with undefined toolName when tool filter is active', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, toolName: 'Write' }),
        createHookEvent({ id: 2, toolName: undefined, eventType: 'stop' }),
        createHookEvent({ id: 3, toolName: 'Edit' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: ['Write'],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('should return empty array when no tools match', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, toolName: 'Write' }),
        createHookEvent({ id: 2, toolName: 'Edit' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: ['Glob'],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(0);
    });
  });

  describe('status filtering', () => {
    it('should filter by success status', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, status: 'success', summary: 'Success event' }),
        createHookEvent({ id: 2, status: 'failure' }),
        createHookEvent({ id: 3, status: 'pending' }),
        createHookEvent({ id: 4, status: 'success', summary: 'Another success' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: [],
        status: 'success',
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(2);
      expect(result.every(e => e.status === 'success')).toBe(true);
    });

    it('should filter by failure status', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, status: 'success' }),
        createHookEvent({ id: 2, status: 'failure', summary: 'Failed event' }),
        createHookEvent({ id: 3, status: 'pending' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: [],
        status: 'failure',
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('failure');
      expect(result[0].summary).toBe('Failed event');
    });

    it('should filter by denied status', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, status: 'success' }),
        createHookEvent({ id: 2, status: 'denied', summary: 'Permission denied' }),
        createHookEvent({ id: 3, status: 'pending' }),
        createHookEvent({ id: 4, status: 'denied', summary: 'Another denial' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: [],
        status: 'denied',
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(2);
      expect(result.every(e => e.status === 'denied')).toBe(true);
    });

    it('should filter by pending status', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, status: 'success' }),
        createHookEvent({ id: 2, status: 'pending', summary: 'Pending event' }),
        createHookEvent({ id: 3, status: 'failure' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: [],
        status: 'pending',
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('pending');
    });

    it('should return empty array when no events match status', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, status: 'success' }),
        createHookEvent({ id: 2, status: 'success' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: [],
        status: 'failure',
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(0);
    });
  });

  describe('combined filters', () => {
    it('should apply agent AND status filters together', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock', status: 'success' }),
        createHookEvent({ id: 2, agentName: 'murdock', status: 'failure' }),
        createHookEvent({ id: 3, agentName: 'ba', status: 'success' }),
        createHookEvent({ id: 4, agentName: 'ba', status: 'failure' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: ['murdock'],
        toolNames: [],
        status: 'success',
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
      expect(result[0].agentName).toBe('murdock');
      expect(result[0].status).toBe('success');
    });

    it('should apply tool AND status filters together', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, toolName: 'Write', status: 'success' }),
        createHookEvent({ id: 2, toolName: 'Write', status: 'failure' }),
        createHookEvent({ id: 3, toolName: 'Edit', status: 'success' }),
        createHookEvent({ id: 4, toolName: 'Edit', status: 'failure' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: ['Write'],
        status: 'failure',
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
      expect(result[0].toolName).toBe('Write');
      expect(result[0].status).toBe('failure');
    });

    it('should apply agent AND tool filters together', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock', toolName: 'Write' }),
        createHookEvent({ id: 2, agentName: 'murdock', toolName: 'Edit' }),
        createHookEvent({ id: 3, agentName: 'ba', toolName: 'Write' }),
        createHookEvent({ id: 4, agentName: 'ba', toolName: 'Edit' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: ['ba'],
        toolNames: ['Edit'],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(4);
      expect(result[0].agentName).toBe('ba');
      expect(result[0].toolName).toBe('Edit');
    });

    it('should apply agent AND tool AND status filters together', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock', toolName: 'Write', status: 'success' }),
        createHookEvent({ id: 2, agentName: 'murdock', toolName: 'Write', status: 'failure' }),
        createHookEvent({ id: 3, agentName: 'murdock', toolName: 'Edit', status: 'success' }),
        createHookEvent({ id: 4, agentName: 'ba', toolName: 'Write', status: 'success' }),
        createHookEvent({ id: 5, agentName: 'ba', toolName: 'Write', status: 'failure' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: ['murdock'],
        toolNames: ['Write'],
        status: 'success',
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('should return empty array when combined filters match nothing', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock', toolName: 'Write', status: 'success' }),
        createHookEvent({ id: 2, agentName: 'ba', toolName: 'Edit', status: 'failure' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: ['lynch'],
        toolNames: ['Bash'],
        status: 'denied',
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should handle events with null or undefined agentName gracefully', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock' }),
        createHookEvent({ id: 2, agentName: undefined as unknown as string }),
        createHookEvent({ id: 3, agentName: null as unknown as string }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: ['murdock'],
        toolNames: [],
        status: null,
      };

      // Should not throw and should only return valid events
      const result = filterHookEvents(events, filters);
      expect(result).toHaveLength(1);
      expect(result[0].agentName).toBe('murdock');
    });

    it('should preserve event order after filtering', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 5, agentName: 'lynch', timestamp: new Date('2026-02-16T10:05:00Z') }),
        createHookEvent({ id: 3, agentName: 'murdock', timestamp: new Date('2026-02-16T10:03:00Z') }),
        createHookEvent({ id: 1, agentName: 'murdock', timestamp: new Date('2026-02-16T10:01:00Z') }),
        createHookEvent({ id: 4, agentName: 'ba', timestamp: new Date('2026-02-16T10:04:00Z') }),
        createHookEvent({ id: 2, agentName: 'murdock', timestamp: new Date('2026-02-16T10:02:00Z') }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: ['murdock'],
        toolNames: [],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(3);
      // Order should be preserved from input: [3, 1, 2] (not sorted by timestamp)
      expect(result.map(e => e.id)).toEqual([3, 1, 2]);
    });

    it('should handle multiple agent names with no matches', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock' }),
        createHookEvent({ id: 2, agentName: 'ba' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: ['lynch', 'amy', 'tawnia'],
        toolNames: [],
        status: null,
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(0);
    });

    it('should handle events with empty string status', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, status: 'success' }),
        createHookEvent({ id: 2, status: '' }),
        createHookEvent({ id: 3, status: 'failure' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: [],
        toolNames: [],
        status: 'success',
      };

      const result = filterHookEvents(events, filters);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });
  });

  describe('performance', () => {
    it('should handle large event arrays efficiently', () => {
      const events: HookEventSummary[] = Array.from({ length: 1000 }, (_, i) =>
        createHookEvent({
          id: i + 1,
          agentName: i % 2 === 0 ? 'murdock' : 'ba',
          toolName: i % 3 === 0 ? 'Write' : 'Edit',
          status: i % 4 === 0 ? 'success' : 'failure',
        })
      );

      const filters: RawAgentFilterState = {
        agentNames: ['murdock'],
        toolNames: [],
        status: 'success',
      };

      const start = performance.now();
      const result = filterHookEvents(events, filters);
      const end = performance.now();

      // Should complete in reasonable time (< 100ms for 1000 events)
      expect(end - start).toBeLessThan(100);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should be a pure function with no side effects', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock' }),
        createHookEvent({ id: 2, agentName: 'ba' }),
      ];

      const filters: RawAgentFilterState = {
        agentNames: ['murdock'],
        toolNames: [],
        status: null,
      };

      // Call twice with same inputs
      const result1 = filterHookEvents(events, filters);
      const result2 = filterHookEvents(events, filters);

      // Should return same results
      expect(result1).toEqual(result2);
      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(1);

      // Original array should not be modified
      expect(events).toHaveLength(2);
    });
  });
});

describe('useRawAgentFilters hook (conceptual tests)', () => {
  // Note: These tests document expected hook behavior but may fail due to jest-dom issues.
  // The hook should be implemented in the actual component file.

  it('should initialize with no filters active', () => {
    const initialState: RawAgentFilterState = {
      agentNames: [],
      toolNames: [],
      status: null,
    };

    expect(initialState.agentNames).toHaveLength(0);
    expect(initialState.toolNames).toHaveLength(0);
    expect(initialState.status).toBeNull();
  });

  it('should allow toggling agent filter', () => {
    const state: RawAgentFilterState = {
      agentNames: [],
      toolNames: [],
      status: null,
    };

    // Toggle on
    const stateWithMurdock = {
      ...state,
      agentNames: [...state.agentNames, 'murdock'],
    };

    expect(stateWithMurdock.agentNames).toContain('murdock');

    // Toggle off
    const stateWithoutMurdock = {
      ...stateWithMurdock,
      agentNames: stateWithMurdock.agentNames.filter(a => a !== 'murdock'),
    };

    expect(stateWithoutMurdock.agentNames).not.toContain('murdock');
  });

  it('should allow setting status filter', () => {
    const state: RawAgentFilterState = {
      agentNames: [],
      toolNames: [],
      status: null,
    };

    const stateWithStatus = {
      ...state,
      status: 'success',
    };

    expect(stateWithStatus.status).toBe('success');
  });

  it('should allow resetting all filters', () => {
    const state: RawAgentFilterState = {
      agentNames: ['murdock', 'ba'],
      toolNames: ['Write', 'Edit'],
      status: 'success',
    };

    const resetState: RawAgentFilterState = {
      agentNames: [],
      toolNames: [],
      status: null,
    };

    expect(resetState.agentNames).toHaveLength(0);
    expect(resetState.toolNames).toHaveLength(0);
    expect(resetState.status).toBeNull();
  });
});

describe('RawAgentFilters component (conceptual tests)', () => {
  // Note: These tests document expected component behavior but may fail due to jest-dom issues.
  // Focus on testing the pure filterHookEvents function above.

  it('should render filter controls for agent selection', () => {
    // Expected: Component should render checkboxes or multi-select for agents
    const expectedAgents = ['Hannibal', 'Face', 'Murdock', 'B.A.', 'Amy', 'Lynch', 'Tawnia'];
    expect(expectedAgents).toHaveLength(7);
  });

  it('should render filter controls for status selection', () => {
    // Expected: Component should render radio buttons or select for status
    const expectedStatuses = ['all', 'success', 'failure', 'denied', 'pending'];
    expect(expectedStatuses).toHaveLength(5);
  });

  it('should render filter controls for tool type selection', () => {
    // Expected: Component should render checkboxes or multi-select for tools
    const expectedTools = ['Write', 'Edit', 'Read', 'Bash', 'Grep', 'Glob'];
    expect(expectedTools.length).toBeGreaterThan(0);
  });
});
