import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from '../components/filter-bar';
import type { TypeFilter, AgentFilter, StatusFilter } from '../types';

// Default props factory
function createProps(overrides: Partial<React.ComponentProps<typeof FilterBar>> = {}) {
  return {
    typeFilter: 'All Types' as TypeFilter,
    agentFilter: 'All Agents' as AgentFilter,
    statusFilter: 'All Status' as StatusFilter,
    searchQuery: '',
    onTypeFilterChange: vi.fn(),
    onAgentFilterChange: vi.fn(),
    onStatusFilterChange: vi.fn(),
    onSearchQueryChange: vi.fn(),
    ...overrides,
  };
}

describe('FilterBar', () => {
  describe('rendering', () => {
    it('should render the filter bar container', () => {
      render(<FilterBar {...createProps()} />);

      const filterBar = screen.getByTestId('filter-bar');
      expect(filterBar).toBeInTheDocument();
    });

    it('should display "Filter by:" label', () => {
      render(<FilterBar {...createProps()} />);

      expect(screen.getByText('Filter by:')).toBeInTheDocument();
    });
  });

  describe('Type dropdown', () => {
    it('should render type dropdown with current value', () => {
      render(<FilterBar {...createProps({ typeFilter: 'All Types' })} />);

      const typeDropdown = screen.getByTestId('type-filter-dropdown');
      expect(typeDropdown).toBeInTheDocument();
      expect(typeDropdown).toHaveTextContent('All Types');
    });

    it('should display all type filter options', () => {
      render(<FilterBar {...createProps()} />);

      const typeDropdown = screen.getByTestId('type-filter-dropdown');
      fireEvent.click(typeDropdown);

      const expectedOptions = [
        'All Types',
        'implementation',
        'test',
        'interface',
        'integration',
        'feature',
        'bug',
        'enhancement',
      ];

      expectedOptions.forEach((option) => {
        expect(screen.getByRole('option', { name: option })).toBeInTheDocument();
      });
    });

    it('should call onTypeFilterChange when option selected', () => {
      const onTypeFilterChange = vi.fn();
      render(<FilterBar {...createProps({ onTypeFilterChange })} />);

      const typeDropdown = screen.getByTestId('type-filter-dropdown');
      fireEvent.click(typeDropdown);

      const bugOption = screen.getByRole('option', { name: 'bug' });
      fireEvent.click(bugOption);

      expect(onTypeFilterChange).toHaveBeenCalledWith('bug');
    });

    it('should show selected type filter value', () => {
      render(<FilterBar {...createProps({ typeFilter: 'feature' })} />);

      const typeDropdown = screen.getByTestId('type-filter-dropdown');
      expect(typeDropdown).toHaveTextContent('feature');
    });
  });

  describe('Agent dropdown', () => {
    it('should render agent dropdown with current value', () => {
      render(<FilterBar {...createProps({ agentFilter: 'All Agents' })} />);

      const agentDropdown = screen.getByTestId('agent-filter-dropdown');
      expect(agentDropdown).toBeInTheDocument();
      expect(agentDropdown).toHaveTextContent('All Agents');
    });

    it('should display all agent filter options', () => {
      render(<FilterBar {...createProps()} />);

      const agentDropdown = screen.getByTestId('agent-filter-dropdown');
      fireEvent.click(agentDropdown);

      const expectedOptions = [
        'All Agents',
        'Hannibal',
        'Face',
        'Murdock',
        'B.A.',
        'Amy',
        'Lynch',
        'Unassigned',
      ];

      expectedOptions.forEach((option) => {
        expect(screen.getByRole('option', { name: option })).toBeInTheDocument();
      });
    });

    it('should call onAgentFilterChange when option selected', () => {
      const onAgentFilterChange = vi.fn();
      render(<FilterBar {...createProps({ onAgentFilterChange })} />);

      const agentDropdown = screen.getByTestId('agent-filter-dropdown');
      fireEvent.click(agentDropdown);

      const murdockOption = screen.getByRole('option', { name: 'Murdock' });
      fireEvent.click(murdockOption);

      expect(onAgentFilterChange).toHaveBeenCalledWith('Murdock');
    });

    it('should show selected agent filter value', () => {
      render(<FilterBar {...createProps({ agentFilter: 'B.A.' })} />);

      const agentDropdown = screen.getByTestId('agent-filter-dropdown');
      expect(agentDropdown).toHaveTextContent('B.A.');
    });

    it('should include Unassigned option', () => {
      render(<FilterBar {...createProps()} />);

      const agentDropdown = screen.getByTestId('agent-filter-dropdown');
      fireEvent.click(agentDropdown);

      expect(screen.getByRole('option', { name: 'Unassigned' })).toBeInTheDocument();
    });
  });

  describe('Status dropdown', () => {
    it('should render status dropdown with current value', () => {
      render(<FilterBar {...createProps({ statusFilter: 'All Status' })} />);

      const statusDropdown = screen.getByTestId('status-filter-dropdown');
      expect(statusDropdown).toBeInTheDocument();
      expect(statusDropdown).toHaveTextContent('All Status');
    });

    it('should display all status filter options', () => {
      render(<FilterBar {...createProps()} />);

      const statusDropdown = screen.getByTestId('status-filter-dropdown');
      fireEvent.click(statusDropdown);

      const expectedOptions = [
        'All Status',
        'Active',
        'Blocked',
        'Has Rejections',
        'Has Dependencies',
        'Completed',
      ];

      expectedOptions.forEach((option) => {
        expect(screen.getByRole('option', { name: option })).toBeInTheDocument();
      });
    });

    it('should call onStatusFilterChange when option selected', () => {
      const onStatusFilterChange = vi.fn();
      render(<FilterBar {...createProps({ onStatusFilterChange })} />);

      const statusDropdown = screen.getByTestId('status-filter-dropdown');
      fireEvent.click(statusDropdown);

      const blockedOption = screen.getByRole('option', { name: 'Blocked' });
      fireEvent.click(blockedOption);

      expect(onStatusFilterChange).toHaveBeenCalledWith('Blocked');
    });

    it('should show selected status filter value', () => {
      render(<FilterBar {...createProps({ statusFilter: 'Active' })} />);

      const statusDropdown = screen.getByTestId('status-filter-dropdown');
      expect(statusDropdown).toHaveTextContent('Active');
    });
  });

  describe('selected option styling', () => {
    it('should show checkmark on selected option', () => {
      render(<FilterBar {...createProps({ typeFilter: 'feature' })} />);

      const typeDropdown = screen.getByTestId('type-filter-dropdown');
      fireEvent.click(typeDropdown);

      const featureOption = screen.getByRole('option', { name: 'feature' });
      const checkIcon = featureOption.querySelector('[data-testid="check-icon"]');
      expect(checkIcon).toBeInTheDocument();
    });
  });

  describe('dropdown icons', () => {
    it('should render ChevronDown icon in dropdowns', () => {
      render(<FilterBar {...createProps()} />);

      const typeDropdown = screen.getByTestId('type-filter-dropdown');
      const chevronIcon = typeDropdown.querySelector('[data-testid="chevron-down-icon"]');
      expect(chevronIcon).toBeInTheDocument();
    });
  });

  describe('three dropdowns requirement', () => {
    it('should render exactly three filter dropdowns', () => {
      render(<FilterBar {...createProps()} />);

      expect(screen.getByTestId('type-filter-dropdown')).toBeInTheDocument();
      expect(screen.getByTestId('agent-filter-dropdown')).toBeInTheDocument();
      expect(screen.getByTestId('status-filter-dropdown')).toBeInTheDocument();
    });

    it('should render dropdowns in correct order: Type, Agent, Status', () => {
      render(<FilterBar {...createProps()} />);

      const filterBar = screen.getByTestId('filter-bar');
      const dropdowns = filterBar.querySelectorAll('[data-testid$="-filter-dropdown"]');

      expect(dropdowns[0]).toHaveAttribute('data-testid', 'type-filter-dropdown');
      expect(dropdowns[1]).toHaveAttribute('data-testid', 'agent-filter-dropdown');
      expect(dropdowns[2]).toHaveAttribute('data-testid', 'status-filter-dropdown');
    });
  });
});
