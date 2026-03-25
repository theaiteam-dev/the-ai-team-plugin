import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from '../components/filter-bar';
import type { TypeFilter, AgentFilter, StatusFilter } from '../types';

// Default props factory - all filters at default values
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
    onClearFilters: vi.fn(),
    ...overrides,
  };
}

describe('FilterBar - Active Filter Indicators', () => {
  describe('clear filters button visibility', () => {
    it('should not show clear filters button when all filters are at default', () => {
      render(<FilterBar {...createProps()} />);

      const clearButton = screen.queryByTestId('clear-filters-button');
      expect(clearButton).not.toBeInTheDocument();
    });

    it('should show clear filters button when type filter is non-default', () => {
      render(<FilterBar {...createProps({ typeFilter: 'feature' })} />);

      const clearButton = screen.getByTestId('clear-filters-button');
      expect(clearButton).toBeInTheDocument();
    });

    it('should show clear filters button when agent filter is non-default', () => {
      render(<FilterBar {...createProps({ agentFilter: 'Hannibal' })} />);

      const clearButton = screen.getByTestId('clear-filters-button');
      expect(clearButton).toBeInTheDocument();
    });

    it('should show clear filters button when status filter is non-default', () => {
      render(<FilterBar {...createProps({ statusFilter: 'Active' })} />);

      const clearButton = screen.getByTestId('clear-filters-button');
      expect(clearButton).toBeInTheDocument();
    });

    it('should show clear filters button when search has value', () => {
      render(<FilterBar {...createProps({ searchQuery: 'test' })} />);

      const clearButton = screen.getByTestId('clear-filters-button');
      expect(clearButton).toBeInTheDocument();
    });

    it('should show clear filters button when any combination of filters is active', () => {
      render(<FilterBar {...createProps({
        typeFilter: 'bug',
        searchQuery: 'search text',
      })} />);

      const clearButton = screen.getByTestId('clear-filters-button');
      expect(clearButton).toBeInTheDocument();
    });
  });

  describe('clear filters button styling', () => {
    it('should display "Clear filters" text', () => {
      render(<FilterBar {...createProps({ typeFilter: 'feature' })} />);

      expect(screen.getByText('Clear filters')).toBeInTheDocument();
    });
  });

  describe('clear filters functionality', () => {
    it('should call onClearFilters when clear button is clicked', () => {
      const onClearFilters = vi.fn();
      render(<FilterBar {...createProps({
        typeFilter: 'feature',
        onClearFilters,
      })} />);

      const clearButton = screen.getByTestId('clear-filters-button');
      fireEvent.click(clearButton);

      expect(onClearFilters).toHaveBeenCalled();
    });

    it('should reset all filters when clear is clicked (via callbacks)', () => {
      const onTypeFilterChange = vi.fn();
      const onAgentFilterChange = vi.fn();
      const onStatusFilterChange = vi.fn();
      const onSearchQueryChange = vi.fn();
      const onClearFilters = vi.fn();

      render(<FilterBar {...createProps({
        typeFilter: 'bug',
        agentFilter: 'Murdock',
        statusFilter: 'Blocked',
        searchQuery: 'test',
        onTypeFilterChange,
        onAgentFilterChange,
        onStatusFilterChange,
        onSearchQueryChange,
        onClearFilters,
      })} />);

      const clearButton = screen.getByTestId('clear-filters-button');
      fireEvent.click(clearButton);

      // Should call the clear filters handler
      expect(onClearFilters).toHaveBeenCalled();
    });
  });

  describe('clear filters button position', () => {
    it('should appear after the dropdowns in the filter bar', () => {
      render(<FilterBar {...createProps({ typeFilter: 'feature' })} />);

      const filterBar = screen.getByTestId('filter-bar');

      // Clear button should come after status dropdown
      const children = Array.from(filterBar.querySelectorAll('[data-testid]'));
      const statusIndex = children.findIndex(el => el.getAttribute('data-testid') === 'status-filter-dropdown');
      const clearIndex = children.findIndex(el => el.getAttribute('data-testid') === 'clear-filters-button');

      expect(clearIndex).toBeGreaterThan(statusIndex);
    });
  });

  describe('Unassigned agent filter', () => {
    it('should show clear button when Unassigned is selected', () => {
      render(<FilterBar {...createProps({ agentFilter: 'Unassigned' })} />);

      const clearButton = screen.getByTestId('clear-filters-button');
      expect(clearButton).toBeInTheDocument();
    });
  });
});
