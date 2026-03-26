import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentStatusBar } from '../components/agent-status-bar';
import type { AgentName, AgentStatus } from '@/types';

// Type for agents prop
type AgentsStatusMap = Partial<Record<AgentName, AgentStatus>>;

// Factory for default agents status
function createAgentsStatus(overrides: AgentsStatusMap = {}): AgentsStatusMap {
  return {
    Hannibal: 'idle',
    Face: 'idle',
    Murdock: 'idle',
    'B.A.': 'idle',
    Amy: 'idle',
    Lynch: 'idle',
    ...overrides,
  };
}

describe('AgentStatusBar AGENTS label', () => {
  describe('label presence', () => {
    it('should render AGENTS label in the status bar', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      const label = screen.getByTestId('agents-label');
      expect(label).toBeInTheDocument();
      expect(label).toHaveTextContent('AGENTS');
    });
  });

  describe('label positioning', () => {
    it('should be positioned on the left side of the status bar', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      const statusBar = screen.getByTestId('agent-status-bar');
      const label = screen.getByTestId('agents-label');

      // Label should be a child of the status bar
      expect(statusBar).toContainElement(label);

      // The label should appear before the first agent in DOM order
      // const firstAgent = screen.getByText('Hannibal');
      const labelIndex = Array.from(statusBar.querySelectorAll('[data-testid]')).findIndex(
        (el) => el.getAttribute('data-testid') === 'agents-label'
      );
      const agentIndex = Array.from(statusBar.querySelectorAll('[data-testid]')).findIndex(
        (el) => el.getAttribute('data-testid') === 'agent-badge-Hannibal'
      );

      expect(labelIndex).toBeLessThan(agentIndex);
    });
  });

  describe('agents still render correctly', () => {
    it('should still render all 6 agents with label present', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      // Label is present
      expect(screen.getByTestId('agents-label')).toBeInTheDocument();

      // All agents still render
      expect(screen.getByText('Hannibal')).toBeInTheDocument();
      expect(screen.getByText('Face')).toBeInTheDocument();
      expect(screen.getByText('Murdock')).toBeInTheDocument();
      expect(screen.getByText('B.A.')).toBeInTheDocument();
      expect(screen.getByText('Amy')).toBeInTheDocument();
      expect(screen.getByText('Lynch')).toBeInTheDocument();
    });

    it('should still show correct agent statuses with label present', () => {
      render(
        <AgentStatusBar
          agents={{
            Hannibal: 'active',
            Face: 'watching',
            Murdock: 'idle',
            'B.A.': 'active',
            Amy: 'idle',
            Lynch: 'watching',
          }}
        />
      );

      // Label is present
      expect(screen.getByTestId('agents-label')).toBeInTheDocument();

      // Agent statuses are correct
      expect(screen.getByTestId('agent-status-Hannibal')).toHaveTextContent('ACTIVE');
      expect(screen.getByTestId('agent-status-Face')).toHaveTextContent('WATCHING');
      expect(screen.getByTestId('agent-status-Murdock')).toHaveTextContent('IDLE');
      expect(screen.getByTestId('agent-status-B.A.')).toHaveTextContent('ACTIVE');
      expect(screen.getByTestId('agent-status-Amy')).toHaveTextContent('IDLE');
      expect(screen.getByTestId('agent-status-Lynch')).toHaveTextContent('WATCHING');
    });
  });
});
