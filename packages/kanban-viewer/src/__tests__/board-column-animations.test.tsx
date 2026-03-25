import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BoardColumn } from '../components/board-column';
import type { WorkItem, CardAnimationState, CardAnimationDirection } from '@/types';

// Factory for creating test work items
function createTestItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: '001',
    title: 'Test Work Item',
    type: 'feature',
    status: 'pending',
    rejection_count: 0,
    dependencies: [],
    outputs: {},
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    stage: 'briefings',
    content: 'Test content',
    ...overrides,
  };
}

function createTestItems(count: number): WorkItem[] {
  return Array.from({ length: count }, (_, i) =>
    createTestItem({
      id: String(i + 1).padStart(3, '0'),
      title: `Work Item ${i + 1}`,
    })
  );
}

describe('BoardColumn Animation Support', () => {
  describe('animatingItems prop', () => {
    it('should render cards with no animation when animatingItems is undefined', () => {
      const items = createTestItems(2);

      render(<BoardColumn stage="briefings" items={items} />);

      const cards = screen.getAllByTestId('work-item-card');
      cards.forEach((card) => {
        expect(card).toHaveClass('card-idle');
      });
    });
  });

  describe('onAnimationEnd callback', () => {
    it('should call onAnimationEnd with item id when animation completes', () => {
      const items = createTestItems(1);
      const animatingItems = new Map<
        string,
        { state: CardAnimationState; direction: CardAnimationDirection }
      >([['001', { state: 'entering', direction: 'left' }]]);
      const handleAnimationEnd = vi.fn();

      render(
        <BoardColumn
          stage="briefings"
          items={items}
          animatingItems={animatingItems}
          onAnimationEnd={handleAnimationEnd}
        />
      );

      const card = screen.getByTestId('work-item-card');
      fireEvent.animationEnd(card);

      expect(handleAnimationEnd).toHaveBeenCalledTimes(1);
      expect(handleAnimationEnd).toHaveBeenCalledWith('001');
    });

    it('should not throw when onAnimationEnd is undefined', () => {
      const items = createTestItems(1);
      const animatingItems = new Map<
        string,
        { state: CardAnimationState; direction: CardAnimationDirection }
      >([['001', { state: 'entering', direction: 'left' }]]);

      render(
        <BoardColumn
          stage="briefings"
          items={items}
          animatingItems={animatingItems}
        />
      );

      const card = screen.getByTestId('work-item-card');

      expect(() => {
        fireEvent.animationEnd(card);
      }).not.toThrow();
    });

    it('should call onAnimationEnd for correct item when multiple cards animate', () => {
      const items = createTestItems(3);
      const animatingItems = new Map<
        string,
        { state: CardAnimationState; direction: CardAnimationDirection }
      >([
        ['001', { state: 'entering', direction: 'left' }],
        ['002', { state: 'entering', direction: 'left' }],
        ['003', { state: 'entering', direction: 'left' }],
      ]);
      const handleAnimationEnd = vi.fn();

      render(
        <BoardColumn
          stage="briefings"
          items={items}
          animatingItems={animatingItems}
          onAnimationEnd={handleAnimationEnd}
        />
      );

      const cards = screen.getAllByTestId('work-item-card');
      fireEvent.animationEnd(cards[1]); // Middle card

      expect(handleAnimationEnd).toHaveBeenCalledTimes(1);
      expect(handleAnimationEnd).toHaveBeenCalledWith('002');
    });
  });

  describe('card container structure', () => {
    it('should have card-container testid for scrollable area', () => {
      const items = createTestItems(2);
      render(<BoardColumn stage="briefings" items={items} />);

      const container = screen.getByTestId('card-container');
      expect(container).toBeInTheDocument();
    });

    it('should maintain scroll area structure', () => {
      const items = createTestItems(2);
      render(<BoardColumn stage="briefings" items={items} />);

      const scrollArea = screen.getByTestId('column-scroll-area');
      expect(scrollArea).toBeInTheDocument();
    });
  });

  describe('preserves existing functionality', () => {
    it('should still display column header with stage name', () => {
      render(<BoardColumn stage="testing" items={[]} />);

      expect(screen.getByText('TESTING')).toBeInTheDocument();
    });

    it('should still show item count', () => {
      const items = createTestItems(5);
      render(<BoardColumn stage="briefings" items={items} />);

      // WIP display shows count/limit format (5/∞ for unlimited)
      expect(screen.getByTestId('wip-display').textContent).toMatch(/^5\//);
    });

    it('should still call onItemClick when card is clicked', () => {
      const items = createTestItems(1);
      const handleClick = vi.fn();

      render(
        <BoardColumn
          stage="briefings"
          items={items}
          onItemClick={handleClick}
        />
      );

      const card = screen.getByTestId('work-item-card');
      fireEvent.click(card);

      expect(handleClick).toHaveBeenCalledWith(items[0]);
    });

    it('should render all items correctly', () => {
      const items = createTestItems(3);
      render(<BoardColumn stage="briefings" items={items} />);

      expect(screen.getByText('Work Item 1')).toBeInTheDocument();
      expect(screen.getByText('Work Item 2')).toBeInTheDocument();
      expect(screen.getByText('Work Item 3')).toBeInTheDocument();
    });
  });

  describe('rapid updates handling', () => {
    it('should handle items being added during animation', () => {
      const items = createTestItems(2);

      const { rerender } = render(
        <BoardColumn stage="briefings" items={items} />
      );

      // Add a new item with animation
      const newItems = [...items, createTestItem({ id: '003', title: 'New Item' })];
      const animatingItems = new Map<
        string,
        { state: CardAnimationState; direction: CardAnimationDirection }
      >([['003', { state: 'entering', direction: 'left' }]]);

      rerender(
        <BoardColumn
          stage="briefings"
          items={newItems}
          animatingItems={animatingItems}
        />
      );

      expect(screen.getByText('New Item')).toBeInTheDocument();
    });

    it('should handle items being removed during animation', () => {
      const items = createTestItems(3);
      const animatingItems = new Map<
        string,
        { state: CardAnimationState; direction: CardAnimationDirection }
      >([['002', { state: 'exiting', direction: 'right' }]]);

      const { rerender } = render(
        <BoardColumn
          stage="briefings"
          items={items}
          animatingItems={animatingItems}
        />
      );

      // Remove the exiting item
      const remainingItems = items.filter((item) => item.id !== '002');

      rerender(
        <BoardColumn
          stage="briefings"
          items={remainingItems}
        />
      );

      expect(screen.queryByText('Work Item 2')).not.toBeInTheDocument();
      expect(screen.getByText('Work Item 1')).toBeInTheDocument();
      expect(screen.getByText('Work Item 3')).toBeInTheDocument();
    });
  });
});
