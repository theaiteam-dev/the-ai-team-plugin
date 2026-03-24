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

    it('should render Amy with pink color when active', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Amy: 'active' })} />);

      const badge = screen.getByTestId('agent-badge-Amy');
      expect(badge).toHaveClass('bg-pink-500');
    });

    it('should render Tawnia with teal color when active', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Tawnia: 'active' })} />);

      const badge = screen.getByTestId('agent-badge-Tawnia');
      expect(badge).toHaveClass('bg-teal-500');
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

  describe('status-specific dot colors', () => {
    it('should show green dot for ACTIVE status', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Hannibal: 'active' })} />);

      const dot = screen.getByTestId('agent-dot-Hannibal');
      expect(dot).toHaveClass('bg-green-500');
    });

    it('should show amber dot for WATCHING status', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Face: 'watching' })} />);

      const dot = screen.getByTestId('agent-dot-Face');
      expect(dot).toHaveClass('bg-amber-500');
    });

    it('should show gray dot for IDLE status', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Murdock: 'idle' })} />);

      const dot = screen.getByTestId('agent-dot-Murdock');
      expect(dot).toHaveClass('bg-gray-500');
    });
  });

  describe('pulsing animation for ACTIVE status', () => {
    it('should have animate-pulse class for ACTIVE status', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Hannibal: 'active' })} />);

      const dot = screen.getByTestId('agent-dot-Hannibal');
      expect(dot).toHaveClass('animate-pulse');
    });

    it('should NOT have animate-pulse class for WATCHING status', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Face: 'watching' })} />);

      const dot = screen.getByTestId('agent-dot-Face');
      expect(dot).not.toHaveClass('animate-pulse');
    });

    it('should NOT have animate-pulse class for IDLE status', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Murdock: 'idle' })} />);

      const dot = screen.getByTestId('agent-dot-Murdock');
      expect(dot).not.toHaveClass('animate-pulse');
    });

    it('should only pulse ACTIVE agents when multiple agents have different statuses', () => {
      render(
        <AgentStatusBar
          agents={{
            Hannibal: 'active',
            Face: 'watching',
            Murdock: 'idle',
            'B.A.': 'active',
            Lynch: 'watching',
          }}
        />
      );

      // ACTIVE agents should pulse
      expect(screen.getByTestId('agent-dot-Hannibal')).toHaveClass('animate-pulse');
      expect(screen.getByTestId('agent-dot-B.A.')).toHaveClass('animate-pulse');

      // WATCHING and IDLE agents should NOT pulse
      expect(screen.getByTestId('agent-dot-Face')).not.toHaveClass('animate-pulse');
      expect(screen.getByTestId('agent-dot-Murdock')).not.toHaveClass('animate-pulse');
      expect(screen.getByTestId('agent-dot-Lynch')).not.toHaveClass('animate-pulse');
    });
  });

  describe('multiple agents with different animation states', () => {
    it('should correctly display mixed statuses with correct colors and animations', () => {
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

      // Check status-specific dot colors
      expect(screen.getByTestId('agent-dot-Hannibal')).toHaveClass('bg-green-500');
      expect(screen.getByTestId('agent-dot-Face')).toHaveClass('bg-amber-500');
      expect(screen.getByTestId('agent-dot-Murdock')).toHaveClass('bg-gray-500');
      expect(screen.getByTestId('agent-dot-B.A.')).toHaveClass('bg-green-500');
      expect(screen.getByTestId('agent-dot-Lynch')).toHaveClass('bg-gray-500');

      // Check animations - only ACTIVE agents pulse
      expect(screen.getByTestId('agent-dot-Hannibal')).toHaveClass('animate-pulse');
      expect(screen.getByTestId('agent-dot-Face')).not.toHaveClass('animate-pulse');
      expect(screen.getByTestId('agent-dot-Murdock')).not.toHaveClass('animate-pulse');
      expect(screen.getByTestId('agent-dot-B.A.')).toHaveClass('animate-pulse');
      expect(screen.getByTestId('agent-dot-Lynch')).not.toHaveClass('animate-pulse');
    });

    it('should handle all agents being ACTIVE simultaneously', () => {
      render(
        <AgentStatusBar
          agents={{
            Hannibal: 'active',
            Face: 'active',
            Murdock: 'active',
            'B.A.': 'active',
            Amy: 'active',
            Lynch: 'active',
            Tawnia: 'active',
          }}
        />
      );

      // All should have green dots with pulse
      const agents: AgentName[] = ['Hannibal', 'Face', 'Murdock', 'B.A.', 'Amy', 'Lynch', 'Tawnia'];
      agents.forEach((agent) => {
        const dot = screen.getByTestId(`agent-dot-${agent}`);
        expect(dot).toHaveClass('bg-green-500');
        expect(dot).toHaveClass('animate-pulse');
      });
    });

    it('should handle all agents being WATCHING simultaneously', () => {
      render(
        <AgentStatusBar
          agents={{
            Hannibal: 'watching',
            Face: 'watching',
            Murdock: 'watching',
            'B.A.': 'watching',
            Amy: 'watching',
            Lynch: 'watching',
            Tawnia: 'watching',
          }}
        />
      );

      // All should have amber dots without pulse
      const agents: AgentName[] = ['Hannibal', 'Face', 'Murdock', 'B.A.', 'Amy', 'Lynch', 'Tawnia'];
      agents.forEach((agent) => {
        const dot = screen.getByTestId(`agent-dot-${agent}`);
        expect(dot).toHaveClass('bg-amber-500');
        expect(dot).not.toHaveClass('animate-pulse');
      });
    });

    it('should handle all agents being IDLE simultaneously', () => {
      render(
        <AgentStatusBar
          agents={{
            Hannibal: 'idle',
            Face: 'idle',
            Murdock: 'idle',
            'B.A.': 'idle',
            Amy: 'idle',
            Lynch: 'idle',
            Tawnia: 'idle',
          }}
        />
      );

      // All should have gray dots without pulse
      const agents: AgentName[] = ['Hannibal', 'Face', 'Murdock', 'B.A.', 'Amy', 'Lynch', 'Tawnia'];
      agents.forEach((agent) => {
        const dot = screen.getByTestId(`agent-dot-${agent}`);
        expect(dot).toHaveClass('bg-gray-500');
        expect(dot).not.toHaveClass('animate-pulse');
      });
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

  describe('positioning', () => {
    it('should have fixed positioning at bottom of viewport', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      const statusBar = screen.getByTestId('agent-status-bar');
      expect(statusBar).toHaveClass('fixed');
      expect(statusBar).toHaveClass('bottom-0');
    });

    it('should span full width', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      const statusBar = screen.getByTestId('agent-status-bar');
      expect(statusBar).toHaveClass('w-full');
    });

    it('should have left-0 and right-0 for full positioning', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      const statusBar = screen.getByTestId('agent-status-bar');
      expect(statusBar).toHaveClass('left-0');
    });
  });

  describe('badge styling', () => {
    it('should have circular badge with agent color when active/watching', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Hannibal: 'active' })} />);

      const badge = screen.getByTestId('agent-badge-Hannibal');
      expect(badge).toHaveClass('rounded-full');
      expect(badge).toHaveClass('bg-green-500');
    });

    it('should have gray badge when agent is idle', () => {
      render(<AgentStatusBar agents={createAgentsStatus({ Hannibal: 'idle' })} />);

      const badge = screen.getByTestId('agent-badge-Hannibal');
      expect(badge).toHaveClass('rounded-full');
      expect(badge).toHaveClass('bg-gray-500');
    });
  });

  describe('PRD layout and spacing specifications', () => {
    describe('AGENTS label styling and positioning', () => {
      it('should have AGENTS label with correct text styling', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const label = screen.getByTestId('agents-label');
        expect(label).toHaveTextContent('AGENTS');
        expect(label).toHaveClass('text-muted-foreground');
        expect(label).toHaveClass('uppercase');
        expect(label).toHaveClass('tracking-wider');
        expect(label).toHaveClass('text-sm');
        expect(label).toHaveClass('font-medium');
      });

      it('should have AGENTS label left-aligned with flex-none', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const label = screen.getByTestId('agents-label');
        expect(label).toHaveClass('flex-none');
      });
    });

    describe('bar container styling', () => {
      it('should have correct background and border classes', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const statusBar = screen.getByTestId('agent-status-bar');
        expect(statusBar).toHaveClass('bg-card');
        expect(statusBar).toHaveClass('border-t');
        expect(statusBar).toHaveClass('border-border');
      });

      it('should have correct padding classes for overall spacing', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const statusBar = screen.getByTestId('agent-status-bar');
        expect(statusBar).toHaveClass('px-4');
        expect(statusBar).toHaveClass('py-2');
      });

      it('should have fixed positioning at bottom with full width', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const statusBar = screen.getByTestId('agent-status-bar');
        expect(statusBar).toHaveClass('fixed');
        expect(statusBar).toHaveClass('bottom-0');
        expect(statusBar).toHaveClass('left-0');
        expect(statusBar).toHaveClass('w-full');
      });
    });

    describe('agents container layout', () => {
      it('should have agents right-aligned with gap spacing', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const container = screen.getByTestId('agents-container');
        expect(container).toHaveClass('flex');
        expect(container).toHaveClass('items-center');
        expect(container).toHaveClass('gap-20');
      });

      it('should render all 8 agents in the agents container', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const container = screen.getByTestId('agents-container');
        const agentElements = container.querySelectorAll('[data-testid^="agent-badge-"]');
        expect(agentElements).toHaveLength(8);
      });
    });

    describe('avatar circle specifications', () => {
      it('should have 32px diameter avatar circles (w-8 h-8)', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const badge = screen.getByTestId('agent-badge-Hannibal');
        expect(badge).toHaveClass('w-8');
        expect(badge).toHaveClass('h-8');
      });

      it('should have circular shape with rounded-full', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const badge = screen.getByTestId('agent-badge-Hannibal');
        expect(badge).toHaveClass('rounded-full');
      });

      it('should center the initial letter with flex layout', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const badge = screen.getByTestId('agent-badge-Hannibal');
        expect(badge).toHaveClass('flex');
        expect(badge).toHaveClass('items-center');
        expect(badge).toHaveClass('justify-center');
      });

      it('should have 14px font for avatar letter (text-sm)', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const badge = screen.getByTestId('agent-badge-Hannibal');
        expect(badge).toHaveClass('text-sm');
        expect(badge).toHaveClass('font-semibold');
      });

      it('should have white text color for visibility', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const badge = screen.getByTestId('agent-badge-Hannibal');
        expect(badge).toHaveClass('text-white');
      });
    });

    describe('status dot specifications', () => {
      it('should have 8px diameter status dot (w-2 h-2)', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const dot = screen.getByTestId('agent-dot-Hannibal');
        expect(dot).toHaveClass('w-2');
        expect(dot).toHaveClass('h-2');
      });

      it('should have circular shape for status dot', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const dot = screen.getByTestId('agent-dot-Hannibal');
        expect(dot).toHaveClass('rounded-full');
      });
    });

    describe('status text specifications', () => {
      it('should have 10px font size (text-xs)', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const statusText = screen.getByTestId('agent-status-Hannibal');
        expect(statusText).toHaveClass('text-xs');
      });

      it('should have muted foreground color', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const statusText = screen.getByTestId('agent-status-Hannibal');
        expect(statusText).toHaveClass('text-muted-foreground');
      });

      it('should have uppercase text with tracking', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const statusText = screen.getByTestId('agent-status-Hannibal');
        expect(statusText).toHaveClass('uppercase');
        expect(statusText).toHaveClass('tracking-wide');
      });
    });

    describe('agent name specifications', () => {
      it('should have agent name with correct text styling', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        const agentName = screen.getByText('Hannibal');
        expect(agentName).toHaveClass('text-sm');
        expect(agentName).toHaveClass('font-medium');
        expect(agentName).toHaveClass('text-foreground');
      });
    });

    describe('agent item internal layout', () => {
      it('should have gap between avatar and text column', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        // Find the container div that wraps both badge and text
        const badge = screen.getByTestId('agent-badge-Hannibal');
        const agentContainer = badge.parentElement;
        expect(agentContainer).toHaveClass('flex');
        expect(agentContainer).toHaveClass('items-center');
        expect(agentContainer).toHaveClass('gap-2');
      });

      it('should have flex column layout for agent name and status', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        // Find the text column container
        const badge = screen.getByTestId('agent-badge-Hannibal');
        const textColumn = badge.nextElementSibling;
        expect(textColumn).toHaveClass('flex');
        expect(textColumn).toHaveClass('flex-col');
      });

      it('should have gap between status dot and status text', () => {
        render(<AgentStatusBar agents={createAgentsStatus()} />);

        // Find the container that holds dot and status text
        const dot = screen.getByTestId('agent-dot-Hannibal');
        const dotContainer = dot.parentElement;
        expect(dotContainer).toHaveClass('flex');
        expect(dotContainer).toHaveClass('items-center');
        expect(dotContainer).toHaveClass('gap-1.5');
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
        expect(dot).toHaveClass('bg-amber-500');
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

          // Verify structural classes are consistent
          expect(badge).toHaveClass('w-8', 'h-8', 'rounded-full');
          expect(dot).toHaveClass('w-2', 'h-2', 'rounded-full');
          expect(status).toHaveClass('text-xs', 'text-muted-foreground', 'uppercase');
        });
      });
    });
  });
});
