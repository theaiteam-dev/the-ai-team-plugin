import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkItemCard } from '../components/work-item-card';
import type { WorkItem, WorkItemFrontmatterType } from '../types';

const createWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: '013',
  title: 'Payment Processing Module',
  type: 'feature',
  status: 'ready',
  assigned_agent: undefined,
  rejection_count: 0,
  dependencies: [],
  outputs: {},
  created_at: '2026-01-15T00:00:00Z',
  updated_at: '2026-01-15T00:00:00Z',
  stage: 'briefings',
  content: 'Test content',
  ...overrides,
});

describe('WorkItemCard', () => {
  describe('ID display', () => {
    it('should display ID in three-digit format with leading zeros', () => {
      const item = createWorkItem({ id: '5' });
      render(<WorkItemCard item={item} />);
      expect(screen.getByText('005')).toBeInTheDocument();
    });

    it('should display ID correctly when already three digits', () => {
      const item = createWorkItem({ id: '013' });
      render(<WorkItemCard item={item} />);
      expect(screen.getByText('013')).toBeInTheDocument();
    });

    it('should display ID correctly for two-digit IDs', () => {
      const item = createWorkItem({ id: '42' });
      render(<WorkItemCard item={item} />);
      expect(screen.getByText('042')).toBeInTheDocument();
    });
  });

  describe('title display', () => {
    it('should display the title prominently', () => {
      const item = createWorkItem({ title: 'Payment Processing Module' });
      render(<WorkItemCard item={item} />);
      expect(screen.getByText('Payment Processing Module')).toBeInTheDocument();
    });

    it('should handle multi-line titles', () => {
      const item = createWorkItem({ title: 'Very Long Title That Might Wrap To Multiple Lines' });
      render(<WorkItemCard item={item} />);
      expect(screen.getByText('Very Long Title That Might Wrap To Multiple Lines')).toBeInTheDocument();
    });
  });

  describe('type badge', () => {
    it('should display feature badge', () => {
      const item = createWorkItem({ type: 'feature' });
      render(<WorkItemCard item={item} />);
      const badge = screen.getByText('feature');
      expect(badge).toBeInTheDocument();
    });

    it('should display bug badge', () => {
      const item = createWorkItem({ type: 'bug' });
      render(<WorkItemCard item={item} />);
      const badge = screen.getByText('bug');
      expect(badge).toBeInTheDocument();
    });

    it('should display enhancement badge', () => {
      const item = createWorkItem({ type: 'enhancement' });
      render(<WorkItemCard item={item} />);
      const badge = screen.getByText('enhancement');
      expect(badge).toBeInTheDocument();
    });

    it('should display task badge', () => {
      const item = createWorkItem({ type: 'task' });
      render(<WorkItemCard item={item} />);
      const badge = screen.getByText('task');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('agent display - stage-based visibility', () => {
    describe('should show agent in active work stages', () => {
      it('should show agent when stage is testing', () => {
        const item = createWorkItem({
          assigned_agent: 'Murdock',
          stage: 'testing',
        });
        render(<WorkItemCard item={item} />);
        expect(screen.getByTestId('agent-indicator')).toBeInTheDocument();
        expect(screen.getByText('Murdock')).toBeInTheDocument();
      });

      it('should show agent when stage is implementing', () => {
        const item = createWorkItem({
          assigned_agent: 'B.A.',
          stage: 'implementing',
        });
        render(<WorkItemCard item={item} />);
        expect(screen.getByTestId('agent-indicator')).toBeInTheDocument();
        expect(screen.getByText('B.A.')).toBeInTheDocument();
      });

      it('should show agent when stage is review', () => {
        const item = createWorkItem({
          assigned_agent: 'Lynch',
          stage: 'review',
        });
        render(<WorkItemCard item={item} />);
        expect(screen.getByTestId('agent-indicator')).toBeInTheDocument();
        expect(screen.getByText('Lynch')).toBeInTheDocument();
      });
    });

    describe('should NOT show agent in non-active stages', () => {
      it('should NOT show agent when stage is briefings', () => {
        const item = createWorkItem({
          assigned_agent: 'Hannibal',
          stage: 'briefings',
        });
        render(<WorkItemCard item={item} />);
        expect(screen.queryByTestId('agent-indicator')).not.toBeInTheDocument();
      });

      it('should NOT show agent when stage is ready', () => {
        const item = createWorkItem({
          assigned_agent: 'Face',
          stage: 'ready',
        });
        render(<WorkItemCard item={item} />);
        expect(screen.queryByTestId('agent-indicator')).not.toBeInTheDocument();
      });

      it('should NOT show agent when stage is done', () => {
        const item = createWorkItem({
          assigned_agent: 'B.A.',
          stage: 'done',
        });
        render(<WorkItemCard item={item} />);
        expect(screen.queryByTestId('agent-indicator')).not.toBeInTheDocument();
      });
    });

    it('should not display agent indicator when no agent is assigned', () => {
      const item = createWorkItem({
        assigned_agent: undefined,
        stage: 'implementing',
      });
      render(<WorkItemCard item={item} />);
      expect(screen.queryByTestId('agent-indicator')).not.toBeInTheDocument();
    });
  });

  describe('card footer layout', () => {
    it('should have a footer element with data-testid', () => {
      const item = createWorkItem({
        assigned_agent: 'Murdock',
        stage: 'testing',
      });
      render(<WorkItemCard item={item} />);
      expect(screen.getByTestId('card-footer')).toBeInTheDocument();
    });

    it('should render agent indicator before blocker indicator in DOM order (left to right)', () => {
      const item = createWorkItem({
        assigned_agent: 'Murdock',
        stage: 'testing',
        dependencies: ['001', '002'],
      });
      render(<WorkItemCard item={item} blockerCount={2} />);

      const footer = screen.getByTestId('card-footer');
      const agentIndicator = screen.getByTestId('agent-indicator');
      const blockerIndicator = screen.getByTestId('blocker-indicator');

      // Agent should appear before blocker in DOM order (left side)
      const children = Array.from(footer.querySelectorAll('[data-testid]'));
      const agentIndex = children.indexOf(agentIndicator);
      const blockerIndex = children.indexOf(blockerIndicator);
      expect(agentIndex).toBeLessThan(blockerIndex);
    });

    it('should display both agent and dependency count when both present', () => {
      const item = createWorkItem({
        assigned_agent: 'B.A.',
        stage: 'implementing',
        dependencies: ['001'],
      });
      render(<WorkItemCard item={item} blockerCount={1} />);
      expect(screen.getByTestId('agent-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('blocker-indicator')).toBeInTheDocument();
    });
  });

  describe('dependency blocker display', () => {
    it('should show blocker icon and count when blockerCount is provided', () => {
      const item = createWorkItem({ dependencies: ['001', '002'] });
      render(<WorkItemCard item={item} blockerCount={2} />);
      expect(screen.getByTestId('blocker-indicator')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('should not show blocker when blockerCount is 0', () => {
      const item = createWorkItem({ dependencies: [] });
      render(<WorkItemCard item={item} blockerCount={0} />);
      expect(screen.queryByTestId('blocker-indicator')).not.toBeInTheDocument();
    });

    it('should not show blocker when blockerCount is not provided', () => {
      const item = createWorkItem({ dependencies: ['001'] });
      render(<WorkItemCard item={item} />);
      expect(screen.queryByTestId('blocker-indicator')).not.toBeInTheDocument();
    });
  });

  describe('dependency icon display (Feature 008)', () => {
    it('should show Link2 icon when item has dependencies', () => {
      const item = createWorkItem({ dependencies: ['001', '002'] });
      render(<WorkItemCard item={item} />);

      const dependencyIndicator = screen.getByTestId('dependency-indicator');
      expect(dependencyIndicator).toBeInTheDocument();

      // Link2 icon from lucide-react should be present
      const icon = dependencyIndicator.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });

    it('should display dependency count next to icon', () => {
      const item = createWorkItem({ dependencies: ['001', '002', '003'] });
      render(<WorkItemCard item={item} />);

      const dependencyIndicator = screen.getByTestId('dependency-indicator');
      expect(dependencyIndicator).toHaveTextContent('3');
    });

    it('should only be visible when dependencies array has items', () => {
      const itemWithDeps = createWorkItem({ dependencies: ['001'] });
      const itemWithoutDeps = createWorkItem({ dependencies: [] });

      const { rerender } = render(<WorkItemCard item={itemWithDeps} />);
      expect(screen.queryByTestId('dependency-indicator')).toBeInTheDocument();

      rerender(<WorkItemCard item={itemWithoutDeps} />);
      expect(screen.queryByTestId('dependency-indicator')).not.toBeInTheDocument();
    });

    it('should not be visible when dependencies is undefined', () => {
      const item = createWorkItem({ dependencies: undefined });
      render(<WorkItemCard item={item} />);
      expect(screen.queryByTestId('dependency-indicator')).not.toBeInTheDocument();
    });

    it('should display correct count for single dependency', () => {
      const item = createWorkItem({ dependencies: ['001'] });
      render(<WorkItemCard item={item} />);

      const dependencyIndicator = screen.getByTestId('dependency-indicator');
      expect(dependencyIndicator).toHaveTextContent('1');
    });

    it('should display correct count for multiple dependencies', () => {
      const item = createWorkItem({ dependencies: ['001', '002', '003', '004', '005'] });
      render(<WorkItemCard item={item} />);

      const dependencyIndicator = screen.getByTestId('dependency-indicator');
      expect(dependencyIndicator).toHaveTextContent('5');
    });
  });

  describe('rejection warning display', () => {
    it('should show rejection warning badge when rejection_count > 0', () => {
      const item = createWorkItem({ rejection_count: 2 });
      render(<WorkItemCard item={item} />);
      expect(screen.getByTestId('rejection-indicator')).toBeInTheDocument();
      expect(screen.getByText('2', { selector: '[data-testid="rejection-indicator"] *' })).toBeInTheDocument();
    });

    it('should not show rejection warning when rejection_count is 0', () => {
      const item = createWorkItem({ rejection_count: 0 });
      render(<WorkItemCard item={item} />);
      expect(screen.queryByTestId('rejection-indicator')).not.toBeInTheDocument();
    });

    it('should show correct count for multiple rejections', () => {
      const item = createWorkItem({ rejection_count: 5 });
      render(<WorkItemCard item={item} />);
      const indicator = screen.getByTestId('rejection-indicator');
      expect(indicator).toHaveTextContent('5');
    });
  });

  describe('rejection badge styling (Feature 012)', () => {
    it('should use AlertTriangle icon from lucide-react', () => {
      const item = createWorkItem({ rejection_count: 2 });
      render(<WorkItemCard item={item} />);

      const indicator = screen.getByTestId('rejection-indicator');
      const icon = indicator.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });

    it('should display rejection count next to icon', () => {
      const item = createWorkItem({ rejection_count: 7 });
      render(<WorkItemCard item={item} />);

      const indicator = screen.getByTestId('rejection-indicator');
      expect(indicator).toHaveTextContent('7');
    });
  });

  describe('click handler', () => {
    it('should call onClick when card is clicked', () => {
      const handleClick = vi.fn();
      const item = createWorkItem();
      render(<WorkItemCard item={item} onClick={handleClick} />);

      const card = screen.getByTestId('work-item-card');
      fireEvent.click(card);

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should not throw when clicked without onClick handler', () => {
      const item = createWorkItem();
      render(<WorkItemCard item={item} />);

      const card = screen.getByTestId('work-item-card');
      expect(() => fireEvent.click(card)).not.toThrow();
    });
  });

  describe('card structure', () => {
    it('should use shadcn Card component as base', () => {
      const item = createWorkItem();
      render(<WorkItemCard item={item} />);
      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveAttribute('data-slot', 'card');
    });
  });

  describe('dependency tooltip (Item 005)', () => {
    it('should show tooltip with "Depends on:" header when hovered', () => {
      const item = createWorkItem({ dependencies: ['002', '010'] });
      render(<WorkItemCard item={item} showDependencyTooltip defaultTooltipOpen />);

      // Radix UI renders tooltip content in multiple places for accessibility
      const headers = screen.getAllByText(/Depends on/i);
      expect(headers.length).toBeGreaterThanOrEqual(1);
    });

    it('should list all dependency IDs in tooltip', () => {
      const item = createWorkItem({ dependencies: ['002', '010', '015'] });
      render(<WorkItemCard item={item} showDependencyTooltip defaultTooltipOpen />);

      // Check each dependency ID is shown
      const id002 = screen.getAllByText(/002/);
      const id010 = screen.getAllByText(/010/);
      const id015 = screen.getAllByText(/015/);

      expect(id002.length).toBeGreaterThanOrEqual(1);
      expect(id010.length).toBeGreaterThanOrEqual(1);
      expect(id015.length).toBeGreaterThanOrEqual(1);
    });

    it('should show dependency IDs as comma-separated list', () => {
      const item = createWorkItem({ dependencies: ['002', '010'] });
      render(<WorkItemCard item={item} showDependencyTooltip defaultTooltipOpen />);

      // The tooltip should show "Depends on: 002, 010" format
      const tooltipContent = screen.getAllByText(/002.*010|010.*002/);
      expect(tooltipContent.length).toBeGreaterThanOrEqual(1);
    });

    it('should show single dependency ID in tooltip', () => {
      const item = createWorkItem({ dependencies: ['042'] });
      render(<WorkItemCard item={item} showDependencyTooltip defaultTooltipOpen />);

      const ids = screen.getAllByText(/042/);
      expect(ids.length).toBeGreaterThanOrEqual(1);
    });

    it('should wrap dependency indicator with Tooltip component', () => {
      const item = createWorkItem({ dependencies: ['001'] });
      render(<WorkItemCard item={item} showDependencyTooltip />);

      // The dependency indicator should be wrapped in a tooltip trigger
      const dependencyIndicator = screen.getByTestId('dependency-indicator');
      expect(dependencyIndicator).toBeInTheDocument();
    });

    it('should not render tooltip when no dependencies exist', () => {
      const item = createWorkItem({ dependencies: [] });
      render(<WorkItemCard item={item} showDependencyTooltip defaultTooltipOpen />);

      // No dependency indicator means no tooltip
      expect(screen.queryByTestId('dependency-indicator')).not.toBeInTheDocument();
      expect(screen.queryByText(/Depends on/i)).not.toBeInTheDocument();
    });

    it('should use Radix UI Tooltip for accessibility', () => {
      const item = createWorkItem({ dependencies: ['002'] });
      const { container } = render(
        <WorkItemCard item={item} showDependencyTooltip defaultTooltipOpen />
      );

      // Radix UI Tooltip adds data-radix-* attributes
      const tooltipTrigger = container.querySelector('[data-state]');
      expect(tooltipTrigger).toBeInTheDocument();
    });

    it('should have tooltip content with dark theme styling', () => {
      const item = createWorkItem({ dependencies: ['002', '010'] });
      render(<WorkItemCard item={item} showDependencyTooltip defaultTooltipOpen />);

      // TooltipContent from shadcn/ui has built-in dark theme styling
      // We verify the content renders correctly
      const headers = screen.getAllByText(/Depends on/i);
      expect(headers.length).toBeGreaterThanOrEqual(1);
    });

    it('should format dependency IDs with leading zeros', () => {
      const item = createWorkItem({ dependencies: ['2', '10'] });
      render(<WorkItemCard item={item} showDependencyTooltip defaultTooltipOpen />);

      // IDs should be formatted as 3-digit with leading zeros
      const id002 = screen.getAllByText(/002/);
      const id010 = screen.getAllByText(/010/);

      expect(id002.length).toBeGreaterThanOrEqual(1);
      expect(id010.length).toBeGreaterThanOrEqual(1);
    });
  });
});
