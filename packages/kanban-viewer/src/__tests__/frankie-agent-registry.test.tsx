import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  AgentStatusBar,
  AGENT_NAMES,
  AGENT_INITIALS,
  AGENT_COLORS,
} from '../components/agent-status-bar';
import { AgentBadge } from '../components/agent-badge';
import { RawAgentView } from '../components/raw-agent-view';
import { FilterBar } from '../components/filter-bar';
import { deriveAgentStatusesFromWorkItems } from '@/lib/agent-status-utils';
import type { AgentFilter, StatusFilter, TypeFilter, WorkItem } from '@/types';
import type { HookEventSummary } from '@/types/hook-event';

/**
 * Frankie (QA / Demo Man) is a first-class agent in the shared registry
 * (`packages/shared/src/agents.ts`) and claims work items via agentStart, so the
 * kanban viewer must render him everywhere the other agents are rendered rather
 * than falling through to the unknown-agent gray dot.
 */

function createHookEvent(overrides: Partial<HookEventSummary> = {}): HookEventSummary {
  return {
    id: 1,
    eventType: 'pre_tool_use',
    agentName: 'frankie',
    toolName: 'Bash',
    status: 'pending',
    summary: 'Driving the DoD walk',
    timestamp: new Date('2026-02-16T10:00:00Z'),
    ...overrides,
  };
}

function createFilterBarProps() {
  return {
    typeFilter: 'All Types' as TypeFilter,
    agentFilter: 'All Agents' as AgentFilter,
    statusFilter: 'All Status' as StatusFilter,
    searchQuery: '',
    onTypeFilterChange: vi.fn(),
    onAgentFilterChange: vi.fn(),
    onStatusFilterChange: vi.fn(),
    onSearchQueryChange: vi.fn(),
  };
}

describe('Frankie agent registry', () => {
  describe('agent status bar', () => {
    it('should include Frankie in AGENT_NAMES', () => {
      expect(AGENT_NAMES).toContain('Frankie');
      expect(AGENT_NAMES).toHaveLength(9);
    });

    it('should order Frankie after Lynch', () => {
      expect(AGENT_NAMES.indexOf('Frankie')).toBeGreaterThan(AGENT_NAMES.indexOf('Lynch'));
    });

    it('should give Frankie a distinct initial and a dedicated badge color', () => {
      expect(AGENT_INITIALS.Frankie).toBeTruthy();
      expect(AGENT_INITIALS.Frankie).not.toBe(AGENT_INITIALS.Face);

      expect(AGENT_COLORS.Frankie).toBeTruthy();
      // 'bg-gray-500' is the idle/unknown fallback — Frankie needs his own color.
      expect(AGENT_COLORS.Frankie).not.toBe('bg-gray-500');
    });

    it('should render a Frankie lane with his status', () => {
      render(<AgentStatusBar agents={{ Frankie: 'active' }} />);

      expect(screen.getByText('Frankie')).toBeInTheDocument();
      expect(screen.getByTestId('agent-badge-Frankie')).toHaveTextContent(
        AGENT_INITIALS.Frankie
      );
      expect(screen.getByTestId('agent-status-Frankie')).toHaveTextContent('ACTIVE');
    });
  });

  describe('agent badge', () => {
    it('should give Frankie a dedicated dot color instead of the unknown-agent fallback', () => {
      render(<AgentBadge agent="Frankie" />);

      expect(screen.getByTestId('agent-badge')).toHaveTextContent('Frankie');
      expect(screen.getByTestId('agent-dot').className).not.toContain('bg-gray-500');
    });
  });

  describe('raw agent view', () => {
    it('should render a Frankie swim lane with his display name', () => {
      render(<RawAgentView events={[createHookEvent()]} />);

      const lane = screen.getByTestId('swim-lane-frankie');
      expect(within(lane).getByText('Frankie')).toBeInTheDocument();
    });

    it('should place Frankie in canonical order, after amy and before stockwell', () => {
      const events: HookEventSummary[] = [
        createHookEvent({ id: 1, agentName: 'stockwell' }),
        createHookEvent({ id: 2, agentName: 'frankie' }),
        createHookEvent({ id: 3, agentName: 'amy' }),
      ];

      render(<RawAgentView events={events} />);

      const lanes = Array.from(document.querySelectorAll('[data-testid^="swim-lane-"]')).map(
        (el) => el.getAttribute('data-testid')
      );

      expect(lanes.indexOf('swim-lane-frankie')).toBeGreaterThan(
        lanes.indexOf('swim-lane-amy')
      );
      expect(lanes.indexOf('swim-lane-frankie')).toBeLessThan(
        lanes.indexOf('swim-lane-stockwell')
      );
    });
  });

  describe('filter bar', () => {
    it('should offer Frankie as an agent filter option', () => {
      render(<FilterBar {...createFilterBarProps()} />);

      fireEvent.click(screen.getByTestId('agent-filter-dropdown'));

      expect(screen.getByRole('option', { name: 'Frankie' })).toBeInTheDocument();
    });
  });

  describe('agent status derivation', () => {
    it('should treat Frankie as a valid assigned agent', () => {
      const item = {
        id: 'WI-001',
        title: 'Walk the DoD',
        type: 'feature',
        stage: 'review',
        assigned_agent: 'Frankie',
      } as unknown as WorkItem;

      expect(deriveAgentStatusesFromWorkItems([item])).toEqual({ Frankie: 'active' });
    });
  });
});
