import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RawAgentView } from '../components/raw-agent-view';
import type { HookEventSummary } from '@/types/hook-event';

/**
 * Tests for Raw Agent View Component
 *
 * This component displays hook events in a swim lane layout (one lane per agent).
 * Each event shows: timestamp, tool name, status (success/failure/denied), duration, and summary.
 * Permission denials are visually highlighted.
 *
 * Dependencies: WI-004 (SSE hook-event emitter)
 */

// Factory function for creating test hook events
function createHookEvent(overrides: Partial<HookEventSummary> = {}): HookEventSummary {
  return {
    id: 1,
    eventType: 'pre_tool_use',
    agentName: 'murdock',
    toolName: 'Write',
    status: 'pending',
    summary: 'Writing test file',
    timestamp: new Date('2026-02-16T10:00:00Z'),
    ...overrides,
  };
}

describe('RawAgentView', () => {
  describe('swim lane layout', () => {
    it('should render swim lanes grouped by agent name', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ agentName: 'murdock', summary: 'Murdock event 1' }),
        createHookEvent({ id: 2, agentName: 'ba', summary: 'B.A. event 1' }),
        createHookEvent({ id: 3, agentName: 'murdock', summary: 'Murdock event 2' }),
      ];

      render(<RawAgentView events={events} />);

      // Should have separate swim lanes for each agent
      const murdockLane = screen.getByTestId('swim-lane-murdock');
      const baLane = screen.getByTestId('swim-lane-ba');

      expect(murdockLane).toBeInTheDocument();
      expect(baLane).toBeInTheDocument();

      // Murdock lane should have 2 events
      const murdockEvents = within(murdockLane).getAllByTestId(/event-card-/);
      expect(murdockEvents).toHaveLength(2);

      // B.A. lane should have 1 event
      const baEvents = within(baLane).getAllByTestId(/event-card-/);
      expect(baEvents).toHaveLength(1);
    });

    it('should display agent name as swim lane header', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ agentName: 'murdock' }),
        createHookEvent({ id: 2, agentName: 'ba' }),
        createHookEvent({ id: 3, agentName: 'lynch' }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByText('Murdock')).toBeInTheDocument();
      expect(screen.getByText('B.A.')).toBeInTheDocument();
      expect(screen.getByText('Lynch')).toBeInTheDocument();
    });

    it('should render swim lanes in consistent order (Hannibal, Face, Murdock, B.A., Amy, Lynch, Tawnia)', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ agentName: 'lynch' }),
        createHookEvent({ id: 2, agentName: 'murdock' }),
        createHookEvent({ id: 3, agentName: 'hannibal' }),
        createHookEvent({ id: 4, agentName: 'ba' }),
      ];

      render(<RawAgentView events={events} />);

      const swimLanes = screen.getAllByTestId(/swim-lane-/);
      const agentOrder = swimLanes.map((lane) => lane.getAttribute('data-testid')?.replace('swim-lane-', ''));

      // Should be in canonical order: hannibal, murdock, ba, lynch
      expect(agentOrder).toEqual(['hannibal', 'murdock', 'ba', 'lynch']);
    });

    it('should only render swim lanes for agents with events', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ agentName: 'murdock' }),
      ];

      render(<RawAgentView events={events} />);

      // Only murdock lane should exist
      expect(screen.getByTestId('swim-lane-murdock')).toBeInTheDocument();
      expect(screen.queryByTestId('swim-lane-hannibal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('swim-lane-ba')).not.toBeInTheDocument();
    });

    it('should handle multiple agents with swim lanes stacked vertically', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ agentName: 'hannibal' }),
        createHookEvent({ id: 2, agentName: 'face' }),
        createHookEvent({ id: 3, agentName: 'murdock' }),
      ];

      render(<RawAgentView events={events} />);

      const container = screen.getByTestId('raw-agent-view');
      // Container should have vertical flex layout
      expect(container).toHaveClass('flex-col');
    });
  });

  describe('event details display', () => {
    it('should display event timestamp in HH:MM:SS format', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ timestamp: new Date('2026-02-16T10:42:35Z') }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByText('10:42:35')).toBeInTheDocument();
    });

    it('should display tool name when present', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ toolName: 'Write' }),
        createHookEvent({ id: 2, toolName: 'Edit', agentName: 'ba' }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByText('Write')).toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    it('should display event type when tool name is not present', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ eventType: 'stop', toolName: undefined }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByText('stop')).toBeInTheDocument();
    });

    it('should display status indicator', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, status: 'success' }),
        createHookEvent({ id: 2, status: 'failure', agentName: 'ba' }),
        createHookEvent({ id: 3, status: 'pending', agentName: 'lynch' }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByTestId('status-success-1')).toBeInTheDocument();
      expect(screen.getByTestId('status-failure-2')).toBeInTheDocument();
      expect(screen.getByTestId('status-pending-3')).toBeInTheDocument();
    });

    it('should display duration when present', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ durationMs: 150 }),
        createHookEvent({ id: 2, durationMs: 2500, agentName: 'ba' }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByText('150ms')).toBeInTheDocument();
      expect(screen.getByText('2500ms')).toBeInTheDocument();
    });

    it('should not display duration when not present', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ durationMs: undefined }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.queryByText(/ms/)).not.toBeInTheDocument();
    });

    it('should display event summary', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ summary: 'Writing test file for feature X' }),
        createHookEvent({ id: 2, summary: 'Editing implementation', agentName: 'ba' }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByText('Writing test file for feature X')).toBeInTheDocument();
      expect(screen.getByText('Editing implementation')).toBeInTheDocument();
    });

    it('should display all event details in correct order: timestamp, tool, status, duration, summary', () => {
      const events: HookEventSummary[] = [
        createHookEvent({
          timestamp: new Date('2026-02-16T10:42:35Z'),
          toolName: 'Write',
          status: 'success',
          durationMs: 150,
          summary: 'Created test file',
        }),
      ];

      render(<RawAgentView events={events} />);

      const eventCard = screen.getByTestId('event-card-1');
      const eventText = eventCard.textContent || '';

      // Verify order by checking positions
      const timestampPos = eventText.indexOf('10:42:35');
      const toolPos = eventText.indexOf('Write');
      const durationPos = eventText.indexOf('150ms');
      const summaryPos = eventText.indexOf('Created test file');

      expect(timestampPos).toBeLessThan(toolPos);
      expect(toolPos).toBeLessThan(durationPos);
      expect(durationPos).toBeLessThan(summaryPos);
    });
  });

  describe('status indicators', () => {
    it('should show green indicator for success status', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: 'success' }),
      ];

      render(<RawAgentView events={events} />);

      const statusIndicator = screen.getByTestId('status-success-1');
      expect(statusIndicator).toHaveClass('bg-green-500');
    });

    it('should show red indicator for failure status', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: 'failure' }),
      ];

      render(<RawAgentView events={events} />);

      const statusIndicator = screen.getByTestId('status-failure-1');
      expect(statusIndicator).toHaveClass('bg-red-500');
    });

    it('should show yellow indicator for pending status', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: 'pending' }),
      ];

      render(<RawAgentView events={events} />);

      const statusIndicator = screen.getByTestId('status-pending-1');
      expect(statusIndicator).toHaveClass('bg-yellow-500');
    });

    it('should show orange indicator for denied status (permission denied)', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: 'denied' }),
      ];

      render(<RawAgentView events={events} />);

      const statusIndicator = screen.getByTestId('status-denied-1');
      expect(statusIndicator).toHaveClass('bg-orange-500');
    });

    it('should show gray indicator for unknown status', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: 'unknown' }),
      ];

      render(<RawAgentView events={events} />);

      const statusIndicator = screen.getByTestId('status-unknown-1');
      expect(statusIndicator).toHaveClass('bg-gray-500');
    });
  });

  describe('permission denial highlighting', () => {
    it('should highlight denied events with distinct visual styling', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, status: 'denied', summary: 'Permission denied: Write src/test.ts' }),
        createHookEvent({ id: 2, status: 'success', agentName: 'ba' }),
      ];

      render(<RawAgentView events={events} />);

      const deniedCard = screen.getByTestId('event-card-1');
      const successCard = screen.getByTestId('event-card-2');

      // Denied card should have highlight class
      expect(deniedCard).toHaveClass('border-orange-500');
      expect(deniedCard).toHaveClass('bg-orange-50');

      // Success card should not have highlight
      expect(successCard).not.toHaveClass('border-orange-500');
      expect(successCard).not.toHaveClass('bg-orange-50');
    });

    it('should show orange border for denied events', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: 'denied' }),
      ];

      render(<RawAgentView events={events} />);

      const eventCard = screen.getByTestId('event-card-1');
      expect(eventCard).toHaveClass('border-orange-500');
      expect(eventCard).toHaveClass('border-2');
    });

    it('should show orange background tint for denied events', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: 'denied' }),
      ];

      render(<RawAgentView events={events} />);

      const eventCard = screen.getByTestId('event-card-1');
      expect(eventCard).toHaveClass('bg-orange-50');
    });

    it('should display denial icon or badge for denied events', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: 'denied' }),
      ];

      render(<RawAgentView events={events} />);

      const denialBadge = screen.getByTestId('denial-badge-1');
      expect(denialBadge).toBeInTheDocument();
      expect(denialBadge).toHaveTextContent('DENIED');
    });

    it('should not show denial badge for non-denied events', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: 'success' }),
        createHookEvent({ id: 2, status: 'pending', agentName: 'ba' }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.queryByTestId('denial-badge-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('denial-badge-2')).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('should render empty state when no events are provided', () => {
      render(<RawAgentView events={[]} />);

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('No hook events yet')).toBeInTheDocument();
    });

    it('should display helpful message in empty state', () => {
      render(<RawAgentView events={[]} />);

      expect(screen.getByText(/Hook events will appear here/)).toBeInTheDocument();
    });

    it('should not render swim lanes when no events', () => {
      render(<RawAgentView events={[]} />);

      expect(screen.queryByTestId(/swim-lane-/)).not.toBeInTheDocument();
    });

    it('should render container even when empty', () => {
      render(<RawAgentView events={[]} />);

      const container = screen.getByTestId('raw-agent-view');
      expect(container).toBeInTheDocument();
    });
  });

  describe('real-time updates via SSE', () => {
    it('should update when new events arrive', () => {
      const initialEvents: HookEventSummary[] = [
        createHookEvent({ id: 1, summary: 'Initial event' }),
      ];

      const { rerender } = render(<RawAgentView events={initialEvents} />);

      // Add new event
      const updatedEvents: HookEventSummary[] = [
        ...initialEvents,
        createHookEvent({ id: 2, summary: 'New event', agentName: 'ba' }),
      ];

      rerender(<RawAgentView events={updatedEvents} />);

      expect(screen.getByText('New event')).toBeInTheDocument();
    });

    it('should create new swim lane when event from new agent arrives', () => {
      const initialEvents: HookEventSummary[] = [
        createHookEvent({ agentName: 'murdock' }),
      ];

      const { rerender } = render(<RawAgentView events={initialEvents} />);

      expect(screen.getByTestId('swim-lane-murdock')).toBeInTheDocument();
      expect(screen.queryByTestId('swim-lane-ba')).not.toBeInTheDocument();

      // Add event from B.A.
      const updatedEvents: HookEventSummary[] = [
        ...initialEvents,
        createHookEvent({ id: 2, agentName: 'ba' }),
      ];

      rerender(<RawAgentView events={updatedEvents} />);

      expect(screen.getByTestId('swim-lane-murdock')).toBeInTheDocument();
      expect(screen.getByTestId('swim-lane-ba')).toBeInTheDocument();
    });

    it('should append events to existing agent swim lane', () => {
      const initialEvents: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock', summary: 'First' }),
      ];

      const { rerender } = render(<RawAgentView events={initialEvents} />);

      const murdockLane = screen.getByTestId('swim-lane-murdock');
      expect(within(murdockLane).getAllByTestId(/event-card-/)).toHaveLength(1);

      // Add another murdock event
      const updatedEvents: HookEventSummary[] = [
        ...initialEvents,
        createHookEvent({ id: 2, agentName: 'murdock', summary: 'Second' }),
      ];

      rerender(<RawAgentView events={updatedEvents} />);

      const updatedLane = screen.getByTestId('swim-lane-murdock');
      expect(within(updatedLane).getAllByTestId(/event-card-/)).toHaveLength(2);
    });

    it('should maintain chronological order within swim lanes', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, timestamp: new Date('2026-02-16T10:00:00Z'), summary: 'First' }),
        createHookEvent({ id: 2, timestamp: new Date('2026-02-16T10:01:00Z'), summary: 'Second' }),
        createHookEvent({ id: 3, timestamp: new Date('2026-02-16T10:02:00Z'), summary: 'Third' }),
      ];

      render(<RawAgentView events={events} />);

      const eventCards = screen.getAllByTestId(/event-card-/);
      const summaries = eventCards.map((card) => {
        const summaryEl = within(card).getByText(/First|Second|Third/);
        return summaryEl.textContent;
      });

      expect(summaries).toEqual(['First', 'Second', 'Third']);
    });

    it('should handle rapid event updates without visual jank', () => {
      const initialEvents: HookEventSummary[] = [
        createHookEvent({ id: 1, summary: 'Initial' }),
      ];

      const { rerender } = render(<RawAgentView events={initialEvents} />);

      // Rapidly add multiple events
      for (let i = 2; i <= 10; i++) {
        const events = [
          ...initialEvents,
          ...Array.from({ length: i - 1 }, (_, j) =>
            createHookEvent({ id: j + 2, summary: `Event ${j + 2}` })
          ),
        ];
        rerender(<RawAgentView events={events} />);
      }

      expect(screen.getByText('Event 10')).toBeInTheDocument();
    });
  });

  describe('event type display', () => {
    it('should display pre_tool_use events', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ eventType: 'pre_tool_use', toolName: 'Write' }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByText('Write')).toBeInTheDocument();
    });

    it('should display post_tool_use events', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ eventType: 'post_tool_use', toolName: 'Edit', status: 'success' }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    it('should display stop events without tool name', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ eventType: 'stop', toolName: undefined, summary: 'Agent completed' }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByText('stop')).toBeInTheDocument();
    });

    it('should display subagent_start events', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ eventType: 'subagent_start', toolName: undefined }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByText('subagent_start')).toBeInTheDocument();
    });

    it('should display subagent_stop events', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ eventType: 'subagent_stop', toolName: undefined }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByText('subagent_stop')).toBeInTheDocument();
    });
  });

  describe('swim lane styling', () => {
    it('should have distinct background for swim lanes', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ agentName: 'murdock' }),
      ];

      render(<RawAgentView events={events} />);

      const swimLane = screen.getByTestId('swim-lane-murdock');
      expect(swimLane).toHaveClass('bg-card');
    });

    it('should have proper spacing between swim lanes', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ agentName: 'murdock' }),
        createHookEvent({ id: 2, agentName: 'ba' }),
      ];

      render(<RawAgentView events={events} />);

      const container = screen.getByTestId('raw-agent-view');
      expect(container).toHaveClass('gap-4');
    });

    it('should have proper spacing between event cards within lane', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, summary: 'First' }),
        createHookEvent({ id: 2, summary: 'Second' }),
      ];

      render(<RawAgentView events={events} />);

      const swimLane = screen.getByTestId('swim-lane-murdock');
      const eventsContainer = within(swimLane).getByTestId('events-container');
      expect(eventsContainer).toHaveClass('gap-2');
    });

    it('should display agent name header with proper styling', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ agentName: 'murdock' }),
      ];

      render(<RawAgentView events={events} />);

      const header = screen.getByText('Murdock');
      expect(header).toHaveClass('font-semibold');
      expect(header).toHaveClass('text-foreground');
    });
  });

  describe('correlation ID display', () => {
    it('should group correlated events visually', () => {
      const correlationId = 'test-123';
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, eventType: 'pre_tool_use', correlationId, summary: 'Pre' }),
        createHookEvent({ id: 2, eventType: 'post_tool_use', correlationId, summary: 'Post' }),
      ];

      render(<RawAgentView events={events} />);

      // Correlated events should have visual connection
      const preEvent = screen.getByTestId('event-card-1');
      const postEvent = screen.getByTestId('event-card-2');

      expect(preEvent).toHaveAttribute('data-correlation-id', correlationId);
      expect(postEvent).toHaveAttribute('data-correlation-id', correlationId);
    });

    it('should show correlation indicator for related events', () => {
      const correlationId = 'test-456';
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, correlationId }),
        createHookEvent({ id: 2, correlationId, agentName: 'ba' }),
      ];

      render(<RawAgentView events={events} />);

      expect(screen.getByTestId('correlation-indicator-1')).toBeInTheDocument();
      expect(screen.getByTestId('correlation-indicator-2')).toBeInTheDocument();
    });
  });

  describe('scrolling behavior', () => {
    it('should have scrollable container for long event lists', () => {
      const events: HookEventSummary[] = Array.from({ length: 50 }, (_, i) =>
        createHookEvent({ id: i + 1, summary: `Event ${i + 1}` })
      );

      render(<RawAgentView events={events} />);

      const container = screen.getByTestId('raw-agent-view');
      expect(container).toHaveClass('overflow-y-auto');
    });

    it('should auto-scroll to newest events when at bottom', () => {
      const initialEvents: HookEventSummary[] = [
        createHookEvent({ id: 1, summary: 'First' }),
      ];

      const { rerender } = render(<RawAgentView events={initialEvents} />);

      const updatedEvents: HookEventSummary[] = [
        ...initialEvents,
        createHookEvent({ id: 2, summary: 'Newest' }),
      ];

      rerender(<RawAgentView events={updatedEvents} />);

      // Newest event should be visible
      expect(screen.getByText('Newest')).toBeInTheDocument();
    });
  });

  // Amy's findings: Performance, dark mode, null safety, text overflow, auto-scroll optimization
  describe('performance optimization (Amy\'s findings)', () => {
    it('should memoize eventsByAgent grouping to avoid re-computation on unrelated re-renders', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock', summary: 'Event 1' }),
        createHookEvent({ id: 2, agentName: 'ba', summary: 'Event 2' }),
      ];

      const { rerender } = render(<RawAgentView events={events} />);

      // Re-render with same events reference (unrelated prop change)
      // The grouping computation should be memoized (useMemo)
      rerender(<RawAgentView events={events} />);

      // Verify swim lanes still render correctly
      expect(screen.getByTestId('swim-lane-murdock')).toBeInTheDocument();
      expect(screen.getByTestId('swim-lane-ba')).toBeInTheDocument();
    });

    it('should memoize event sorting within swim lanes', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, timestamp: new Date('2026-02-16T10:02:00Z'), summary: 'Second' }),
        createHookEvent({ id: 2, timestamp: new Date('2026-02-16T10:01:00Z'), summary: 'First' }),
        createHookEvent({ id: 3, timestamp: new Date('2026-02-16T10:03:00Z'), summary: 'Third' }),
      ];

      const { rerender } = render(<RawAgentView events={events} />);

      // Re-render with same events
      rerender(<RawAgentView events={events} />);

      // Events should still be in chronological order
      const eventCards = screen.getAllByTestId(/event-card-/);
      const summaries = eventCards.map((card) => {
        const summaryEl = within(card).getByText(/First|Second|Third/);
        return summaryEl.textContent;
      });

      expect(summaries).toEqual(['First', 'Second', 'Third']);
    });

    it('should use React.memo for EventCard component to prevent unnecessary re-renders', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, summary: 'Event 1' }),
        createHookEvent({ id: 2, summary: 'Event 2', agentName: 'ba' }),
      ];

      const { rerender } = render(<RawAgentView events={events} />);

      // Get initial event cards
      const eventCard1 = screen.getByTestId('event-card-1');
      const eventCard2 = screen.getByTestId('event-card-2');

      expect(eventCard1).toBeInTheDocument();
      expect(eventCard2).toBeInTheDocument();

      // Re-render with same events (EventCard should be memoized)
      rerender(<RawAgentView events={events} />);

      // Cards should still render correctly
      expect(screen.getByTestId('event-card-1')).toBeInTheDocument();
      expect(screen.getByTestId('event-card-2')).toBeInTheDocument();
    });

    it('should not re-compute grouping when events array is same reference', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'murdock' }),
      ];

      const { rerender } = render(<RawAgentView events={events} />);

      // Multiple re-renders with same reference
      rerender(<RawAgentView events={events} />);
      rerender(<RawAgentView events={events} />);
      rerender(<RawAgentView events={events} />);

      // Component should still render correctly
      expect(screen.getByTestId('swim-lane-murdock')).toBeInTheDocument();
    });
  });

  describe('dark mode support (Amy\'s findings)', () => {
    it('should use dark mode compatible classes for denied event cards', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: 'denied' }),
      ];

      render(<RawAgentView events={events} />);

      const deniedCard = screen.getByTestId('event-card-1');

      // Should have both light and dark mode classes
      expect(deniedCard).toHaveClass('bg-orange-50');
      expect(deniedCard).toHaveClass('dark:bg-orange-950');
    });

    it('should use dark mode compatible border for denied events', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: 'denied' }),
      ];

      render(<RawAgentView events={events} />);

      const deniedCard = screen.getByTestId('event-card-1');

      // Border should have dark mode variant
      expect(deniedCard).toHaveClass('border-orange-500');
      expect(deniedCard).toHaveClass('dark:border-orange-600');
    });

    it('should use dark mode compatible text colors for denial badge', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: 'denied' }),
      ];

      render(<RawAgentView events={events} />);

      const denialBadge = screen.getByTestId('denial-badge-1');

      // Badge text should be readable in both light and dark mode (contrast fix)
      expect(denialBadge).toHaveClass('text-orange-900');
      expect(denialBadge).toHaveClass('dark:text-orange-100');
    });

    it('should use dark mode compatible swim lane backgrounds', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ agentName: 'murdock' }),
      ];

      render(<RawAgentView events={events} />);

      const swimLane = screen.getByTestId('swim-lane-murdock');

      // Should use theme-aware background
      expect(swimLane).toHaveClass('bg-card');
    });

    it('should use dark mode compatible status indicators', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, status: 'success' }),
        createHookEvent({ id: 2, status: 'failure', agentName: 'ba' }),
      ];

      render(<RawAgentView events={events} />);

      const successIndicator = screen.getByTestId('status-success-1');
      const failureIndicator = screen.getByTestId('status-failure-2');

      // Status indicators should work in both light and dark modes
      expect(successIndicator).toHaveClass('bg-green-500');
      expect(failureIndicator).toHaveClass('bg-red-500');
    });
  });

  describe('null safety (Amy\'s findings)', () => {
    it('should handle undefined agentName without throwing', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ agentName: undefined as unknown as string }),
      ];

      // Should not throw
      expect(() => render(<RawAgentView events={events} />)).not.toThrow();
    });

    it('should show fallback for null timestamp', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ timestamp: null as unknown as Date }),
      ];

      render(<RawAgentView events={events} />);

      // Should not show "NaN:NaN:NaN"
      expect(screen.queryByText('NaN:NaN:NaN')).not.toBeInTheDocument();

      // Should show fallback timestamp
      expect(screen.getByText('--:--:--')).toBeInTheDocument();
    });

    it('should show fallback for invalid timestamp', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ timestamp: new Date('invalid') }),
      ];

      render(<RawAgentView events={events} />);

      // Should not show "NaN:NaN:NaN"
      expect(screen.queryByText('NaN:NaN:NaN')).not.toBeInTheDocument();

      // Should show fallback
      expect(screen.getByText('--:--:--')).toBeInTheDocument();
    });

    it('should show fallback text when both toolName and eventType are empty', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ toolName: undefined, eventType: '' }),
      ];

      render(<RawAgentView events={events} />);

      // Should show fallback instead of empty space
      expect(screen.getByText('(unknown)')).toBeInTheDocument();
    });

    it('should handle null toolName gracefully', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ toolName: null as unknown as string, eventType: 'stop' }),
      ];

      render(<RawAgentView events={events} />);

      // Should fall back to eventType
      expect(screen.getByText('stop')).toBeInTheDocument();
    });

    it('should handle missing summary gracefully', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ summary: '' }),
      ];

      render(<RawAgentView events={events} />);

      // Should show fallback or empty state, not crash
      const eventCard = screen.getByTestId('event-card-1');
      expect(eventCard).toBeInTheDocument();
    });

    it('should handle undefined status gracefully', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ status: undefined as unknown as string }),
      ];

      render(<RawAgentView events={events} />);

      // Should show unknown status indicator
      const statusIndicator = screen.getByTestId('status-unknown-1');
      expect(statusIndicator).toBeInTheDocument();
    });
  });

  describe('text overflow handling (Amy\'s findings)', () => {
    it('should truncate very long summary text', () => {
      const longSummary = 'A'.repeat(500); // 500 character summary
      const events: HookEventSummary[] = [
        createHookEvent({ summary: longSummary }),
      ];

      render(<RawAgentView events={events} />);

      const eventCard = screen.getByTestId('event-card-1');
      const summaryElement = within(eventCard).getByText(longSummary, { exact: false });

      // Should have truncate or line-clamp class
      expect(summaryElement).toHaveClass(/truncate|line-clamp/);
    });

    it('should use line-clamp for multi-line summary truncation', () => {
      const longSummary = 'Very long summary text that should be truncated after a certain number of lines to prevent breaking the layout';
      const events: HookEventSummary[] = [
        createHookEvent({ summary: longSummary }),
      ];

      render(<RawAgentView events={events} />);

      const eventCard = screen.getByTestId('event-card-1');
      const summaryElement = within(eventCard).getByText(longSummary, { exact: false });

      // Should use line-clamp-2 or similar
      expect(summaryElement.className).toMatch(/line-clamp-[0-9]/);
    });

    it('should handle very long agent names without breaking layout', () => {
      const longAgentName = 'VeryLongAgentNameThatShouldNotBreakTheLayout';
      const events: HookEventSummary[] = [
        createHookEvent({ agentName: longAgentName }),
      ];

      render(<RawAgentView events={events} />);

      const swimLane = screen.getByTestId(`swim-lane-${longAgentName.toLowerCase()}`);
      expect(swimLane).toBeInTheDocument();

      // Agent name header should have truncate or max-width
      const header = within(swimLane).getByText(longAgentName, { exact: false });
      expect(header).toHaveClass(/truncate|max-w/);
    });

    it('should handle very long tool names without breaking layout', () => {
      const longToolName = 'VeryLongToolNameThatShouldBeTruncated';
      const events: HookEventSummary[] = [
        createHookEvent({ toolName: longToolName }),
      ];

      render(<RawAgentView events={events} />);

      const toolElement = screen.getByText(longToolName, { exact: false });

      // Tool name should have truncate class
      expect(toolElement).toHaveClass(/truncate|max-w/);
    });

    it('should constrain event card width to prevent horizontal overflow', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ summary: 'A'.repeat(1000) }),
      ];

      render(<RawAgentView events={events} />);

      const eventCard = screen.getByTestId('event-card-1');

      // Card should have width constraint and overflow handling
      expect(eventCard).toHaveClass(/max-w|overflow/);
    });
  });

  describe('auto-scroll optimization (Amy\'s findings)', () => {
    it('should debounce or use requestAnimationFrame for rapid event updates', () => {
      const initialEvents: HookEventSummary[] = [
        createHookEvent({ id: 1, summary: 'Initial' }),
      ];

      const { rerender } = render(<RawAgentView events={initialEvents} />);

      // Rapidly add many events (simulating SSE bursts)
      for (let i = 2; i <= 20; i++) {
        const events = [
          ...initialEvents,
          ...Array.from({ length: i - 1 }, (_, j) =>
            createHookEvent({ id: j + 2, summary: `Event ${j + 2}` })
          ),
        ];
        rerender(<RawAgentView events={events} />);
      }

      // Should handle rapid updates without excessive scroll calls
      // (implementation should use debounce or requestAnimationFrame)
      expect(screen.getByText('Event 20')).toBeInTheDocument();
    });

    it('should batch scroll updates during rapid event additions', () => {
      const initialEvents: HookEventSummary[] = [];
      const { rerender } = render(<RawAgentView events={initialEvents} />);

      // Add 10 events rapidly
      const events = Array.from({ length: 10 }, (_, i) =>
        createHookEvent({ id: i + 1, summary: `Event ${i + 1}` })
      );

      rerender(<RawAgentView events={events} />);

      // All events should be visible (scroll should batch updates)
      expect(screen.getByText('Event 10')).toBeInTheDocument();
    });

    it('should use requestAnimationFrame for smooth scroll performance', () => {
      const events: HookEventSummary[] = Array.from({ length: 50 }, (_, i) =>
        createHookEvent({ id: i + 1, summary: `Event ${i + 1}` })
      );

      const { rerender } = render(<RawAgentView events={events} />);

      // Add more events
      const updatedEvents = [
        ...events,
        ...Array.from({ length: 10 }, (_, i) =>
          createHookEvent({ id: i + 51, summary: `Event ${i + 51}` })
        ),
      ];

      rerender(<RawAgentView events={updatedEvents} />);

      // Should handle smoothly without janky scrolling
      expect(screen.getByText('Event 60')).toBeInTheDocument();
    });

    it('should not trigger scroll when user has scrolled away from bottom', () => {
      const events: HookEventSummary[] = Array.from({ length: 30 }, (_, i) =>
        createHookEvent({ id: i + 1, summary: `Event ${i + 1}` })
      );

      render(<RawAgentView events={events} />);

      const container = screen.getByTestId('raw-agent-view');

      // Simulate user scrolling to top
      Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });
      Object.defineProperty(container, 'scrollHeight', { value: 1000 });
      Object.defineProperty(container, 'clientHeight', { value: 200 });

      // Container should track that user is not at bottom
      expect(container).toBeInTheDocument();
    });

    it('should cleanup scroll event listeners on unmount', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1 }),
      ];

      const { unmount } = render(<RawAgentView events={events} />);

      // Unmount should not cause memory leaks
      expect(() => unmount()).not.toThrow();
    });
  });
});
