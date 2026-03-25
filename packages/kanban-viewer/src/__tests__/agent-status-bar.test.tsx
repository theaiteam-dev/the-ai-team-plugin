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
    Tawnia: 'idle',
    ...overrides,
  };
}

describe('AgentStatusBar', () => {
  describe('agent rendering', () => {
    it('should render all 7 agents', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      expect(screen.getByText('Hannibal')).toBeInTheDocument();
      expect(screen.getByText('Face')).toBeInTheDocument();
      expect(screen.getByText('Murdock')).toBeInTheDocument();
      expect(screen.getByText('B.A.')).toBeInTheDocument();
      expect(screen.getByText('Amy')).toBeInTheDocument();
      expect(screen.getByText('Lynch')).toBeInTheDocument();
      expect(screen.getByText('Tawnia')).toBeInTheDocument();
    });

    it('should display initial letter in circle badge for each agent', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      // Check for initial badges
      expect(screen.getByTestId('agent-badge-Hannibal')).toHaveTextContent('H');
      expect(screen.getByTestId('agent-badge-Face')).toHaveTextContent('F');
      expect(screen.getByTestId('agent-badge-Murdock')).toHaveTextContent('M');
      expect(screen.getByTestId('agent-badge-B.A.')).toHaveTextContent('B');
      expect(screen.getByTestId('agent-badge-Amy')).toHaveTextContent('A');
      expect(screen.getByTestId('agent-badge-Lynch')).toHaveTextContent('L');
      expect(screen.getByTestId('agent-badge-Tawnia')).toHaveTextContent('T');
    });

    it('should display Amy positioned after B.A. and before Lynch', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      // Get all agent names in order
      const agentNames = screen.getAllByText(/^(Hannibal|Face|Murdock|B\.A\.|Amy|Lynch|Tawnia)$/);
      const nameTexts = agentNames.map(el => el.textContent);

      // Find positions
      const baIndex = nameTexts.indexOf('B.A.');
      const amyIndex = nameTexts.indexOf('Amy');
      const lynchIndex = nameTexts.indexOf('Lynch');

      expect(amyIndex).toBeGreaterThan(baIndex);
      expect(amyIndex).toBeLessThan(lynchIndex);
    });

    it('should display Tawnia positioned last (after Lynch)', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      // Get all agent names in order
      const agentNames = screen.getAllByText(/^(Hannibal|Face|Murdock|B\.A\.|Amy|Lynch|Tawnia)$/);
      const nameTexts = agentNames.map(el => el.textContent);

      // Find positions
      const lynchIndex = nameTexts.indexOf('Lynch');
      const tawniaIndex = nameTexts.indexOf('Tawnia');

      expect(tawniaIndex).toBeGreaterThan(lynchIndex);
      expect(tawniaIndex).toBe(nameTexts.length - 1); // Should be last
    });
  });

  describe('status text display', () => {
    it('should show WATCHING status text for watching agents', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Hannibal: 'watching' })} />);

      const statusText = screen.getByTestId('agent-status-Hannibal');
      expect(statusText).toHaveTextContent('WATCHING');
    });

    it('should show ACTIVE status text for active agents', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Face: 'active' })} />);

      const statusText = screen.getByTestId('agent-status-Face');
      expect(statusText).toHaveTextContent('ACTIVE');
    });

    it('should show IDLE status text for idle agents', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Murdock: 'idle' })} />);

      const statusText = screen.getByTestId('agent-status-Murdock');
      expect(statusText).toHaveTextContent('IDLE');
    });
  });

  describe('multiple agents with different statuses', () => {
    it('should correctly display mixed statuses', () => {
      render(
        <AgentStatusBar
          agents={{
            Hannibal: 'active',
            Face: 'watching',
            Murdock: 'idle',
            'B.A.': 'active',
            Lynch: 'idle',
          }}
        />
      );

      // Check status texts
      expect(screen.getByTestId('agent-status-Hannibal')).toHaveTextContent('ACTIVE');
      expect(screen.getByTestId('agent-status-Face')).toHaveTextContent('WATCHING');
      expect(screen.getByTestId('agent-status-Murdock')).toHaveTextContent('IDLE');
      expect(screen.getByTestId('agent-status-B.A.')).toHaveTextContent('ACTIVE');
      expect(screen.getByTestId('agent-status-Lynch')).toHaveTextContent('IDLE');
    });
  });

  describe('missing agent data', () => {
    it('should handle empty agents object gracefully', () => {
      render(<AgentStatusBar agents={{}} />);

      // Should still render all agents with default idle status
      expect(screen.getByText('Hannibal')).toBeInTheDocument();
      expect(screen.getByTestId('agent-status-Hannibal')).toHaveTextContent('IDLE');
    });

    it('should handle partial agents object gracefully', () => {
      render(<AgentStatusBar agents={{ Hannibal: 'active' }} />);

      // Provided agent shows correct status
      expect(screen.getByTestId('agent-status-Hannibal')).toHaveTextContent('ACTIVE');
      // Missing agents default to idle
      expect(screen.getByTestId('agent-status-Face')).toHaveTextContent('IDLE');
    });

    it('should handle undefined agents prop', () => {
      // @ts-expect-error - testing runtime behavior with undefined
      render(<AgentStatusBar agents={undefined} />);

      // Should render all agents with default idle status
      expect(screen.getByText('Hannibal')).toBeInTheDocument();
    });
  });

  describe('agents container', () => {
    it('should render all 8 agents in the agents container', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      const container = screen.getByTestId('agents-container');
      const agentElements = container.querySelectorAll('[data-testid^="agent-badge-"]');
      expect(agentElements).toHaveLength(8);
    });
  });

  describe('complete layout integration', () => {
    it('should render complete layout with all elements in correct hierarchy', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Hannibal: 'watching' })} />);

      // Verify main container exists
      const statusBar = screen.getByTestId('agent-status-bar');
      expect(statusBar).toBeInTheDocument();

      // Verify label exists and is positioned first
      const label = screen.getByTestId('agents-label');
      expect(label).toBeInTheDocument();

      // Verify agents container exists
      const container = screen.getByTestId('agents-container');
      expect(container).toBeInTheDocument();

      // Verify all agent components are rendered
      const badge = screen.getByTestId('agent-badge-Hannibal');
      const dot = screen.getByTestId('agent-dot-Hannibal');
      const status = screen.getByTestId('agent-status-Hannibal');
      const name = screen.getByText('Hannibal');

      expect(badge).toBeInTheDocument();
      expect(dot).toBeInTheDocument();
      expect(status).toBeInTheDocument();
      expect(name).toBeInTheDocument();

      // Verify status displays correctly
      expect(status).toHaveTextContent('WATCHING');
    });

    it('should maintain layout consistency with multiple agent states', () => {
      render(
        <AgentStatusBar
          agents={{
            Hannibal: 'watching',
            Face: 'idle',
            Murdock: 'active',
            'B.A.': 'active',
            Amy: 'idle',
            Lynch: 'watching',
            Tawnia: 'idle',
          }}
        />
      );

      // Verify all agents are rendered with correct structure
      const agents: AgentName[] = ['Hannibal', 'Face', 'Murdock', 'B.A.', 'Amy', 'Lynch', 'Tawnia'];
      agents.forEach((agent) => {
        const badge = screen.getByTestId(`agent-badge-${agent}`);
        const dot = screen.getByTestId(`agent-dot-${agent}`);
        const status = screen.getByTestId(`agent-status-${agent}`);

        expect(badge).toBeInTheDocument();
        expect(dot).toBeInTheDocument();
        expect(status).toBeInTheDocument();
      });
    });
  });
});
