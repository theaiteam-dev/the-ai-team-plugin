import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BoardColumn } from '../components/board-column';
import type { WorkItem, Stage } from '../types';

const createWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: '001',
  title: 'Test Work Item',
  type: 'feature',
  status: 'ready',
  assigned_agent: undefined,
  rejection_count: 0,
  dependencies: [],
  outputs: {},
  created_at: '2026-01-15T00:00:00Z',
  updated_at: '2026-01-15T00:00:00Z',
  stage: 'testing',
  content: 'Test content',
  ...overrides,
});

describe('BoardColumn', () => {
  describe('column header layout', () => {
    it('should display column name on the left in uppercase', () => {
      render(<BoardColumn stage="testing" items={[]} />);
      const header = screen.getByTestId('column-header');
      const columnName = within(header).getByText('TESTING');
      expect(columnName).toBeInTheDocument();
    });

    it('should display item count on the right', () => {
      const items = [createWorkItem({ id: '001' }), createWorkItem({ id: '002' })];
      render(<BoardColumn stage="testing" items={items} />);
      const wipDisplay = screen.getByTestId('wip-display');
      // Count is displayed in format "{count}/{limit}" - verify count is 2
      expect(wipDisplay.textContent).toContain('2');
    });

    it('should show column name and count in a single row layout', () => {
      const items = [createWorkItem({ id: '001' }), createWorkItem({ id: '002' })];
      render(<BoardColumn stage="testing" items={items} />);

      const header = screen.getByTestId('column-header');
      // Header should contain both name and count in a flex row
      expect(within(header).getByText('TESTING')).toBeInTheDocument();
      // Count is displayed in wip-display with format "{count}/{limit}"
      expect(within(header).getByTestId('wip-display').textContent).toContain('2');
    });
  });

  describe('stage name display', () => {
    it('should display stage name capitalized', () => {
      render(<BoardColumn stage="testing" items={[]} />);
      expect(screen.getByText('TESTING')).toBeInTheDocument();
    });

    it('should capitalize multi-word stage names', () => {
      render(<BoardColumn stage="briefings" items={[]} />);
      expect(screen.getByText('BRIEFINGS')).toBeInTheDocument();
    });

    it('should capitalize "implementing" stage', () => {
      render(<BoardColumn stage="implementing" items={[]} />);
      expect(screen.getByText('IMPLEMENTING')).toBeInTheDocument();
    });

    it('should capitalize "review" stage', () => {
      render(<BoardColumn stage="review" items={[]} />);
      expect(screen.getByText('REVIEW')).toBeInTheDocument();
    });
  });

  describe('item count display', () => {
    it('should show correct item count for empty list', () => {
      render(<BoardColumn stage="testing" items={[]} />);
      // Count displays in format "{count}/{limit}" - verify count starts with 0
      expect(screen.getByTestId('wip-display').textContent).toMatch(/^0\//);
    });

    it('should show correct item count for single item', () => {
      const items = [createWorkItem({ id: '001' })];
      render(<BoardColumn stage="testing" items={items} />);
      // Count displays in format "{count}/{limit}" - verify count starts with 1
      expect(screen.getByTestId('wip-display').textContent).toMatch(/^1\//);
    });

    it('should show correct item count for multiple items', () => {
      const items = [
        createWorkItem({ id: '001' }),
        createWorkItem({ id: '002' }),
        createWorkItem({ id: '003' }),
      ];
      render(<BoardColumn stage="testing" items={items} />);
      // Count displays in format "{count}/{limit}" - verify count starts with 3
      expect(screen.getByTestId('wip-display').textContent).toMatch(/^3\//);
    });
  });

  describe('WIP display', () => {
    it('should NOT render old wip-indicator element', () => {
      const items = [createWorkItem({ id: '001' }), createWorkItem({ id: '002' })];
      render(<BoardColumn stage="testing" items={items} />);

      expect(screen.queryByTestId('wip-indicator')).not.toBeInTheDocument();
    });

    it('should NOT render old wip-indicator even when wipLimit prop is passed', () => {
      const items = [createWorkItem({ id: '001' })];
      render(<BoardColumn stage="testing" items={items} wipLimit={5} />);

      expect(screen.queryByTestId('wip-indicator')).not.toBeInTheDocument();
    });

    it('should NOT display any "WIP:" text label in the column header', () => {
      const items = [createWorkItem({ id: '001' }), createWorkItem({ id: '002' })];
      render(<BoardColumn stage="testing" items={items} wipLimit={3} />);

      const header = screen.getByTestId('column-header');
      expect(header.textContent).not.toContain('WIP:');
    });

    it('should display slash notation (count/limit) for WIP in header', () => {
      const items = [
        createWorkItem({ id: '001' }),
        createWorkItem({ id: '002' }),
        createWorkItem({ id: '003' }),
      ];
      render(<BoardColumn stage="testing" items={items} wipLimit={5} />);

      const wipDisplay = screen.getByTestId('wip-display');
      // Should contain "3/5" WIP notation
      expect(wipDisplay).toHaveTextContent('3/5');
    });

    it('should show column name and count/limit in header', () => {
      const items = [createWorkItem({ id: '001' }), createWorkItem({ id: '002' })];
      render(<BoardColumn stage="implementing" items={items} wipLimit={3} />);

      const header = screen.getByTestId('column-header');
      const headerText = header.textContent || '';
      expect(headerText).toContain('IMPLEMENTING');
      // Now displays count/limit format
      expect(headerText).toContain('2/3');
    });
  });

  describe('WorkItemCard rendering', () => {
    it('should render a WorkItemCard for each item', () => {
      const items = [
        createWorkItem({ id: '001', title: 'First Item' }),
        createWorkItem({ id: '002', title: 'Second Item' }),
      ];
      render(<BoardColumn stage="testing" items={items} />);

      const cards = screen.getAllByTestId('work-item-card');
      expect(cards).toHaveLength(2);
    });

    it('should display item titles in cards', () => {
      const items = [
        createWorkItem({ id: '001', title: 'First Item' }),
        createWorkItem({ id: '002', title: 'Second Item' }),
      ];
      render(<BoardColumn stage="testing" items={items} />);

      expect(screen.getByText('First Item')).toBeInTheDocument();
      expect(screen.getByText('Second Item')).toBeInTheDocument();
    });

    it('should render no cards when items array is empty', () => {
      render(<BoardColumn stage="testing" items={[]} />);
      expect(screen.queryByTestId('work-item-card')).not.toBeInTheDocument();
    });
  });

  describe('click handler', () => {
    it('should call onItemClick when card is clicked', () => {
      const handleItemClick = vi.fn();
      const item = createWorkItem({ id: '001', title: 'Clickable Item' });
      render(<BoardColumn stage="testing" items={[item]} onItemClick={handleItemClick} />);

      const card = screen.getByTestId('work-item-card');
      fireEvent.click(card);

      expect(handleItemClick).toHaveBeenCalledTimes(1);
      expect(handleItemClick).toHaveBeenCalledWith(item);
    });

    it('should call onItemClick with correct item when multiple cards exist', () => {
      const handleItemClick = vi.fn();
      const items = [
        createWorkItem({ id: '001', title: 'First Item' }),
        createWorkItem({ id: '002', title: 'Second Item' }),
      ];
      render(<BoardColumn stage="testing" items={items} onItemClick={handleItemClick} />);

      const cards = screen.getAllByTestId('work-item-card');
      fireEvent.click(cards[1]);

      expect(handleItemClick).toHaveBeenCalledWith(items[1]);
    });

    it('should not throw when clicked without onItemClick handler', () => {
      const item = createWorkItem({ id: '001' });
      render(<BoardColumn stage="testing" items={[item]} />);

      const card = screen.getByTestId('work-item-card');
      expect(() => fireEvent.click(card)).not.toThrow();
    });
  });

  describe('scrollable container', () => {
    it('should have a scrollable container for items', () => {
      const items = [createWorkItem({ id: '001' })];
      render(<BoardColumn stage="testing" items={items} />);

      const scrollArea = screen.getByTestId('column-scroll-area');
      expect(scrollArea).toBeInTheDocument();
      expect(scrollArea).toHaveAttribute('data-slot', 'scroll-area');
    });

    it('should render cards inside the scroll area', () => {
      const items = [
        createWorkItem({ id: '001', title: 'First Item' }),
        createWorkItem({ id: '002', title: 'Second Item' }),
      ];
      render(<BoardColumn stage="testing" items={items} />);

      const scrollArea = screen.getByTestId('column-scroll-area');
      const cards = within(scrollArea).getAllByTestId('work-item-card');
      expect(cards).toHaveLength(2);
    });
  });

  describe('column structure', () => {
    it('should have proper column container with testid', () => {
      render(<BoardColumn stage="testing" items={[]} />);
      expect(screen.getByTestId('board-column')).toBeInTheDocument();
    });

    it('should have header section with testid', () => {
      render(<BoardColumn stage="testing" items={[]} />);
      expect(screen.getByTestId('column-header')).toBeInTheDocument();
    });

    it('should render header above scroll area', () => {
      const items = [createWorkItem({ id: '001' })];
      render(<BoardColumn stage="testing" items={items} />);

      const column = screen.getByTestId('board-column');
      const header = screen.getByTestId('column-header');
      const scrollArea = screen.getByTestId('column-scroll-area');

      // Header should come before scroll area in DOM
      const children = Array.from(column.children);
      const headerIndex = children.indexOf(header);
      const scrollIndex = children.indexOf(scrollArea);

      expect(headerIndex).toBeLessThan(scrollIndex);
    });
  });

  describe('empty state', () => {
    it('should handle empty items array gracefully', () => {
      render(<BoardColumn stage="done" items={[]} />);

      expect(screen.getByText('DONE')).toBeInTheDocument();
      // WIP display shows count/limit format
      expect(screen.getByTestId('wip-display').textContent).toMatch(/^0\//);
      expect(screen.queryByTestId('work-item-card')).not.toBeInTheDocument();
    });
  });

  describe('column header styling (Feature 006)', () => {
    it('should have column name in ALL CAPS', () => {
      render(<BoardColumn stage="testing" items={[]} />);
      const header = screen.getByTestId('column-header');
      const columnName = within(header).getByText('TESTING');

      // Text should be uppercase
      expect(columnName.textContent).toBe('TESTING');
    });

    it('should have column name without muted or gray color', () => {
      render(<BoardColumn stage="testing" items={[]} />);
      const header = screen.getByTestId('column-header');
      const columnName = within(header).getByText('TESTING');

      // White text color (should not have text-muted or other color classes)
      // The component should rely on default foreground color which is white
      const classStr = columnName.className;
      expect(classStr).not.toContain('text-muted');
      expect(classStr).not.toContain('text-gray');
    });
  });

  describe('probing column styling consistency', () => {
    it('should not apply special purple background to probing column', () => {
      render(<BoardColumn stage="probing" items={[]} />);
      const column = screen.getByTestId('board-column');

      // Should not have purple background color
      expect(column.className).not.toContain('bg-[#2d2438]');
    });

    it('should not apply purple text color to probing column header', () => {
      render(<BoardColumn stage="probing" items={[]} />);
      const header = screen.getByTestId('column-header');
      const columnName = within(header).getByText('PROBING');

      // Should not have purple text color
      expect(columnName.className).not.toContain('text-[#8b5cf6]');
    });

    it('should display PROBING stage name in uppercase like other columns', () => {
      render(<BoardColumn stage="probing" items={[]} />);
      expect(screen.getByText('PROBING')).toBeInTheDocument();
    });

    it('should render probing column with same structure as other columns', () => {
      render(<BoardColumn stage="probing" items={[]} />);

      // Should have all standard elements
      expect(screen.getByTestId('board-column')).toBeInTheDocument();
      expect(screen.getByTestId('column-header')).toBeInTheDocument();
      expect(screen.getByTestId('column-scroll-area')).toBeInTheDocument();
      expect(screen.getByTestId('wip-display')).toBeInTheDocument();
    });
  });
});
