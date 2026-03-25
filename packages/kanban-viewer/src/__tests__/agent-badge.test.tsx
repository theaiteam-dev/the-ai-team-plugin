import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentBadge } from '../components/agent-badge';
import type { AgentName } from '../types';

describe('AgentBadge', () => {
  describe('conditional rendering', () => {
    it('should return null when agent is undefined', () => {
      const { container } = render(<AgentBadge agent={undefined} />);
      expect(container.firstChild).toBeNull();
    });

    it('should return null when agent is empty string', () => {
      const { container } = render(<AgentBadge agent={'' as AgentName} />);
      expect(container.firstChild).toBeNull();
    });

    it('should render when agent is provided', () => {
      render(<AgentBadge agent="Hannibal" />);
      expect(screen.getByTestId('agent-badge')).toBeInTheDocument();
    });
  });

  describe('agent name display', () => {
    it('should display Hannibal name', () => {
      render(<AgentBadge agent="Hannibal" />);
      expect(screen.getByText('Hannibal')).toBeInTheDocument();
    });

    it('should display Face name', () => {
      render(<AgentBadge agent="Face" />);
      expect(screen.getByText('Face')).toBeInTheDocument();
    });

    it('should display Murdock name', () => {
      render(<AgentBadge agent="Murdock" />);
      expect(screen.getByText('Murdock')).toBeInTheDocument();
    });

    it('should display B.A. name', () => {
      render(<AgentBadge agent="B.A." />);
      expect(screen.getByText('B.A.')).toBeInTheDocument();
    });

    it('should display Lynch name', () => {
      render(<AgentBadge agent="Lynch" />);
      expect(screen.getByText('Lynch')).toBeInTheDocument();
    });
  });
});
