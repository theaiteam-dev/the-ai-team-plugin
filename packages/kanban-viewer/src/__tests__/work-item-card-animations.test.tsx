import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkItemCard } from '../components/work-item-card';
import type { WorkItem, CardAnimationState, CardAnimationDirection } from '@/types';

// Factory function for creating test work items
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

describe('WorkItemCard Animation Props', () => {
  describe('animationState prop', () => {
    it('should apply card-idle class when animationState is idle', () => {
      render(<WorkItemCard item={createTestItem()} animationState="idle" />);

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-idle');
    });

    it('should apply card-entering class when animationState is entering', () => {
      render(<WorkItemCard item={createTestItem()} animationState="entering" />);

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-entering');
    });

    it('should apply card-exiting class when animationState is exiting', () => {
      render(<WorkItemCard item={createTestItem()} animationState="exiting" />);

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-exiting');
    });

    it('should apply card-idle class when animationState is undefined', () => {
      render(<WorkItemCard item={createTestItem()} />);

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-idle');
    });
  });

  describe('animationDirection prop', () => {
    it('should apply card-entering-left class when entering from left', () => {
      render(
        <WorkItemCard
          item={createTestItem()}
          animationState="entering"
          animationDirection="left"
        />
      );

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-entering');
      expect(card).toHaveClass('card-entering-left');
    });

    it('should apply card-entering-right class when entering from right', () => {
      render(
        <WorkItemCard
          item={createTestItem()}
          animationState="entering"
          animationDirection="right"
        />
      );

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-entering');
      expect(card).toHaveClass('card-entering-right');
    });

    it('should apply card-exiting-left class when exiting to left', () => {
      render(
        <WorkItemCard
          item={createTestItem()}
          animationState="exiting"
          animationDirection="left"
        />
      );

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-exiting');
      expect(card).toHaveClass('card-exiting-left');
    });

    it('should apply card-exiting-right class when exiting to right', () => {
      render(
        <WorkItemCard
          item={createTestItem()}
          animationState="exiting"
          animationDirection="right"
        />
      );

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-exiting');
      expect(card).toHaveClass('card-exiting-right');
    });

    it('should not apply direction class when direction is none', () => {
      render(
        <WorkItemCard
          item={createTestItem()}
          animationState="entering"
          animationDirection="none"
        />
      );

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-entering');
      expect(card).not.toHaveClass('card-entering-left');
      expect(card).not.toHaveClass('card-entering-right');
    });

    it('should not apply direction class when animationState is idle', () => {
      render(
        <WorkItemCard
          item={createTestItem()}
          animationState="idle"
          animationDirection="left"
        />
      );

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-idle');
      expect(card).not.toHaveClass('card-entering-left');
      expect(card).not.toHaveClass('card-exiting-left');
    });
  });

  describe('onAnimationEnd callback', () => {
    it('should call onAnimationEnd when animation completes', () => {
      const handleAnimationEnd = vi.fn();

      render(
        <WorkItemCard
          item={createTestItem()}
          animationState="entering"
          onAnimationEnd={handleAnimationEnd}
        />
      );

      const card = screen.getByTestId('work-item-card');
      fireEvent.animationEnd(card);

      expect(handleAnimationEnd).toHaveBeenCalledTimes(1);
    });

    it('should not throw when onAnimationEnd is undefined', () => {
      render(<WorkItemCard item={createTestItem()} animationState="entering" />);

      const card = screen.getByTestId('work-item-card');

      expect(() => {
        fireEvent.animationEnd(card);
      }).not.toThrow();
    });
  });

  describe('renders correctly when animation props are undefined', () => {
    it('should render item title without animation props', () => {
      render(<WorkItemCard item={createTestItem({ title: 'My Feature' })} />);

      expect(screen.getByText('My Feature')).toBeInTheDocument();
    });

    it('should render with card-idle class by default', () => {
      render(<WorkItemCard item={createTestItem()} />);

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-idle');
    });

    it('should still support onClick when animation props are undefined', () => {
      const handleClick = vi.fn();
      render(<WorkItemCard item={createTestItem()} onClick={handleClick} />);

      const card = screen.getByTestId('work-item-card');
      fireEvent.click(card);

      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('combined animation state and direction', () => {
    const states: CardAnimationState[] = ['entering', 'exiting', 'idle'];
    const directions: CardAnimationDirection[] = ['left', 'right', 'none'];

    it.each(states)('should handle animationState=%s correctly', (state) => {
      render(<WorkItemCard item={createTestItem()} animationState={state} />);

      const card = screen.getByTestId('work-item-card');
      if (state === 'idle') {
        expect(card).toHaveClass('card-idle');
      } else {
        expect(card).toHaveClass(`card-${state}`);
      }
    });

    it.each(directions)(
      'should handle animationDirection=%s with entering state',
      (direction) => {
        render(
          <WorkItemCard
            item={createTestItem()}
            animationState="entering"
            animationDirection={direction}
          />
        );

        const card = screen.getByTestId('work-item-card');
        expect(card).toHaveClass('card-entering');
        if (direction !== 'none') {
          expect(card).toHaveClass(`card-entering-${direction}`);
        }
      }
    );
  });

  describe('class merging with other styles', () => {
    it('should maintain animation classes alongside base card styles', () => {
      render(<WorkItemCard item={createTestItem()} animationState="entering" />);

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-entering');
    });

    it('should include card-exiting when onClick is provided along with animation', () => {
      render(
        <WorkItemCard
          item={createTestItem()}
          animationState="exiting"
          onClick={() => {}}
        />
      );

      const card = screen.getByTestId('work-item-card');
      expect(card).toHaveClass('card-exiting');
    });
  });
});
