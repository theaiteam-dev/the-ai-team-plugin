import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { VALID_AGENTS, AGENT_DISPLAY_NAMES, type AgentId } from '@ai-team/shared';
import { AGENT_NAMES } from '../components/agent-status-bar';
import { AGENT_OPTIONS } from '../components/filter-bar';
import { RAW_AGENT_FILTER_AGENTS } from '../components/raw-agent-filters';
import { RawAgentView, RAW_AGENT_LANE_ORDER } from '../components/raw-agent-view';
import { AgentBadge } from '../components/agent-badge';
import type { AgentName } from '@/types';
import type { HookEventSummary } from '@/types/hook-event';

/**
 * Agent-list completeness guard.
 *
 * The viewer keeps several hardcoded agent lists (filter options, swim-lane
 * order, status-bar roster, badge colors). Historically a new agent added to
 * the canonical registry (`packages/shared/src/agents.ts`) could silently
 * fall out of one of these surfaces — Frankie missed the filter bar, Tawnia
 * missed the agent filter, Stockwell missed the raw-view filter. This suite
 * asserts every hardcoded list covers the shared registry, minus explicitly
 * allowlisted exclusions. Adding a registry agent without updating a surface
 * (or its exclusion list below) fails here instead of shipping a gap.
 *
 * Record<AgentName, …>-typed maps (AGENT_INITIALS, AGENT_COLORS) are already
 * compiler-enforced against the viewer's AgentName type, so this suite
 * focuses on plain arrays plus render-based checks for non-exported lists.
 */

/**
 * Agents deliberately absent from surfaces typed by the viewer's `AgentName`
 * union (src/types/agent.ts): agent-status-bar roster, filter-bar options,
 * agent-badge. Sosa is a planning-phase critic — she is never assigned to
 * board items, and the viewer's AgentName type does not include her. Widening
 * that type is a separate change; until then she is an explicit exclusion so
 * any OTHER registry agent missing from these surfaces still fails the test.
 */
const VIEWER_AGENT_NAME_EXCLUSIONS: readonly AgentId[] = ['sosa'];

const CANONICAL_AGENT_IDS = [...VALID_AGENTS];

function displayNamesExcept(exclusions: readonly AgentId[]): string[] {
  return CANONICAL_AGENT_IDS.filter((id) => !exclusions.includes(id)).map(
    (id) => AGENT_DISPLAY_NAMES[id]
  );
}

function createHookEvent(overrides: Partial<HookEventSummary> = {}): HookEventSummary {
  return {
    id: 1,
    eventType: 'pre_tool_use',
    agentName: 'frankie',
    toolName: 'Bash',
    status: 'pending',
    summary: 'tool call',
    timestamp: new Date('2026-02-16T10:00:00Z'),
    ...overrides,
  };
}

describe('agent-list completeness against the shared registry', () => {
  it('allowlisted exclusions must themselves be registry agents', () => {
    // Guards the guard: a typo'd or removed exclusion id should fail loudly.
    for (const id of VIEWER_AGENT_NAME_EXCLUSIONS) {
      expect(CANONICAL_AGENT_IDS).toContain(id);
    }
  });

  describe('agent-status-bar AGENT_NAMES', () => {
    it('covers every registry agent except allowlisted exclusions', () => {
      const expected = displayNamesExcept(VIEWER_AGENT_NAME_EXCLUSIONS);

      expect([...AGENT_NAMES].sort()).toEqual([...expected].sort());
    });
  });

  describe('filter-bar AGENT_OPTIONS', () => {
    it('covers every registry agent except allowlisted exclusions', () => {
      for (const name of displayNamesExcept(VIEWER_AGENT_NAME_EXCLUSIONS)) {
        expect(AGENT_OPTIONS).toContain(name);
      }
    });

    it('keeps the pseudo-options alongside the roster', () => {
      expect(AGENT_OPTIONS[0]).toBe('All Agents');
      expect(AGENT_OPTIONS[AGENT_OPTIONS.length - 1]).toBe('Unassigned');
    });
  });

  describe('raw-agent-filters RAW_AGENT_FILTER_AGENTS', () => {
    it('covers the full registry with no exclusions', () => {
      // Hook events are emitted by every agent (including planning agents),
      // so the raw-view filter deliberately excludes nobody.
      expect([...RAW_AGENT_FILTER_AGENTS].sort()).toEqual(
        [...CANONICAL_AGENT_IDS].sort()
      );
    });
  });

  describe('raw-agent-view RAW_AGENT_LANE_ORDER and display names', () => {
    // Hook events are emitted by every agent (including planning agents), so
    // the swim-lane order deliberately excludes nobody. Lane labels come from
    // the shared AGENT_DISPLAY_NAMES, so there is no local map to drift.
    it('covers the full registry with no exclusions', () => {
      expect([...RAW_AGENT_LANE_ORDER].sort()).toEqual(
        [...CANONICAL_AGENT_IDS].sort()
      );
    });

    it('matches the raw-view filter list, so every filterable agent has a lane', () => {
      expect([...RAW_AGENT_LANE_ORDER].sort()).toEqual(
        [...RAW_AGENT_FILTER_AGENTS].sort()
      );
    });

    // Feed events in reverse lane order: anything missing from
    // RAW_AGENT_LANE_ORDER falls through to the unmatched-agent fallback,
    // which appends in event-insertion order and trips the assertions below.
    const events = [...RAW_AGENT_LANE_ORDER]
      .reverse()
      .map((agentId, index) => createHookEvent({ id: index + 1, agentName: agentId }));

    it('renders a swim lane for every registry agent', () => {
      render(<RawAgentView events={events} />);

      for (const id of CANONICAL_AGENT_IDS) {
        expect(screen.getByTestId(`swim-lane-${id}`)).toBeInTheDocument();
      }
    });

    it('shows the canonical display name for every registry agent', () => {
      render(<RawAgentView events={events} />);

      for (const id of CANONICAL_AGENT_IDS) {
        const lane = screen.getByTestId(`swim-lane-${id}`);
        // A raw lowercase header means the agent fell through to the
        // unknown-agent fallback — add them to RAW_AGENT_LANE_ORDER.
        expect(within(lane).getByText(AGENT_DISPLAY_NAMES[id])).toBeInTheDocument();
      }
    });

    it('lanes every registry agent in canonical order', () => {
      render(<RawAgentView events={events} />);

      const lanes = Array.from(
        document.querySelectorAll('[data-testid^="swim-lane-"]')
      ).map((el) => el.getAttribute('data-testid'));

      expect(lanes).toEqual(
        RAW_AGENT_LANE_ORDER.map((id) => `swim-lane-${id}`)
      );
    });

    it('appends unknown agents after the canonical lanes', () => {
      render(
        <RawAgentView
          events={[
            createHookEvent({ id: 100, agentName: 'ghost-agent' }),
            createHookEvent({ id: 101, agentName: 'hannibal' }),
          ]}
        />
      );

      const lanes = Array.from(
        document.querySelectorAll('[data-testid^="swim-lane-"]')
      ).map((el) => el.getAttribute('data-testid'));

      expect(lanes).toEqual(['swim-lane-hannibal', 'swim-lane-ghost-agent']);
    });
  });

  describe('agent-badge color map', () => {
    it('gives every non-excluded registry agent a dedicated color, not the unknown fallback', () => {
      for (const name of displayNamesExcept(VIEWER_AGENT_NAME_EXCLUSIONS)) {
        const { unmount } = render(<AgentBadge agent={name as AgentName} />);

        expect(
          screen.getByTestId('agent-dot').className,
          `AgentBadge color for ${name}`
        ).not.toContain('bg-gray-500');

        unmount();
      }
    });
  });
});
