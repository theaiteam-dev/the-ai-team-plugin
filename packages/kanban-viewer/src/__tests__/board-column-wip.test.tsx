import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BoardColumn } from '../components/board-column';
import type { WorkItem } from '../types';

// Helper to create mock work items
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

// Helper to create multiple items
const createItems = (count: number): WorkItem[] =>
  Array.from({ length: count }, (_, i) =>
    createWorkItem({ id: `00${i + 1}`, title: `Item ${i + 1}` })
  );

describe('BoardColumn WIP Limit Display', () => {
  describe('Part 1: WIP Display Format', () => {
    it('should display item count and limit in format "{count}/{limit}"', () => {
      const items = createItems(3);
      render(<BoardColumn stage="testing" items={items} wipLimit={5} />);

      const wipDisplay = screen.getByTestId('wip-display');
      expect(wipDisplay).toHaveTextContent('3/5');
    });

    it('should display infinity symbol when wipLimit is null', () => {
      const items = createItems(2);
      render(<BoardColumn stage="testing" items={items} wipLimit={null} />);

      const wipDisplay = screen.getByTestId('wip-display');
      expect(wipDisplay).toHaveTextContent('2/\u221E');
    });

    it('should display infinity symbol when wipLimit is undefined', () => {
      const items = createItems(2);
      render(<BoardColumn stage="testing" items={items} />);

      const wipDisplay = screen.getByTestId('wip-display');
      expect(wipDisplay).toHaveTextContent('2/\u221E');
    });

    it('should display zero count correctly with limit', () => {
      render(<BoardColumn stage="testing" items={[]} wipLimit={3} />);

      const wipDisplay = screen.getByTestId('wip-display');
      expect(wipDisplay).toHaveTextContent('0/3');
    });

    it('should display zero count correctly with unlimited', () => {
      render(<BoardColumn stage="testing" items={[]} />);

      const wipDisplay = screen.getByTestId('wip-display');
      expect(wipDisplay).toHaveTextContent('0/\u221E');
    });

    it('should update count display when items change', () => {
      const { rerender } = render(
        <BoardColumn stage="testing" items={createItems(2)} wipLimit={5} />
      );

      expect(screen.getByTestId('wip-display')).toHaveTextContent('2/5');

      rerender(<BoardColumn stage="testing" items={createItems(4)} wipLimit={5} />);

      expect(screen.getByTestId('wip-display')).toHaveTextContent('4/5');
    });
  });

  describe('Part 3: Inline WIP Limit Editor', () => {
    describe('Edit mode entry', () => {
      it('should enter edit mode when clicking on the limit number', () => {
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={vi.fn()}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        expect(screen.getByTestId('wip-limit-input')).toBeInTheDocument();
      });

      it('should show number input with current limit value when entering edit mode', () => {
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={vi.fn()}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input') as HTMLInputElement;
        expect(input.value).toBe('5');
      });

      it('should focus the input when entering edit mode', () => {
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={vi.fn()}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        expect(document.activeElement).toBe(input);
      });

      it('should show empty input when limit is unlimited (null)', () => {
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={null}
            onWipLimitChange={vi.fn()}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input') as HTMLInputElement;
        expect(input.value).toBe('');
      });

      it('should not enter edit mode if onWipLimitChange is not provided', () => {
        render(<BoardColumn stage="testing" items={createItems(3)} wipLimit={5} />);

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        expect(screen.queryByTestId('wip-limit-input')).not.toBeInTheDocument();
      });
    });

    describe('Saving with Enter key', () => {
      it('should save new limit when pressing Enter', () => {
        const onWipLimitChange = vi.fn();
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={onWipLimitChange}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        fireEvent.change(input, { target: { value: '10' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onWipLimitChange).toHaveBeenCalledWith('testing', 10);
      });

      it('should exit edit mode after pressing Enter', () => {
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={vi.fn()}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        fireEvent.change(input, { target: { value: '10' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(screen.queryByTestId('wip-limit-input')).not.toBeInTheDocument();
      });
    });

    describe('Canceling with Escape key', () => {
      it('should cancel edit and not call callback when pressing Escape', () => {
        const onWipLimitChange = vi.fn();
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={onWipLimitChange}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        fireEvent.change(input, { target: { value: '10' } });
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(onWipLimitChange).not.toHaveBeenCalled();
      });

      it('should exit edit mode after pressing Escape', () => {
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={vi.fn()}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        fireEvent.keyDown(screen.getByTestId('wip-limit-input'), { key: 'Escape' });

        expect(screen.queryByTestId('wip-limit-input')).not.toBeInTheDocument();
      });

      it('should restore original display after cancel', () => {
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={vi.fn()}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        fireEvent.change(input, { target: { value: '999' } });
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(screen.getByTestId('wip-display')).toHaveTextContent('3/5');
      });
    });

    describe('Saving on blur', () => {
      it('should save when input loses focus (blur)', () => {
        const onWipLimitChange = vi.fn();
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={onWipLimitChange}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        fireEvent.change(input, { target: { value: '8' } });
        fireEvent.blur(input);

        expect(onWipLimitChange).toHaveBeenCalledWith('testing', 8);
      });

      it('should exit edit mode on blur', () => {
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={vi.fn()}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        fireEvent.blur(input);

        expect(screen.queryByTestId('wip-limit-input')).not.toBeInTheDocument();
      });
    });

    describe('Setting to unlimited', () => {
      it('should set limit to null when input is empty', () => {
        const onWipLimitChange = vi.fn();
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={onWipLimitChange}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onWipLimitChange).toHaveBeenCalledWith('testing', null);
      });

      it('should set limit to null when input is "0"', () => {
        const onWipLimitChange = vi.fn();
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={onWipLimitChange}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        fireEvent.change(input, { target: { value: '0' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onWipLimitChange).toHaveBeenCalledWith('testing', null);
      });

      it('should display infinity after setting to unlimited', () => {
        const onWipLimitChange = vi.fn();
        const { rerender } = render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={onWipLimitChange}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        // Simulate parent component updating the prop
        rerender(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={null}
            onWipLimitChange={onWipLimitChange}
          />
        );

        expect(screen.getByTestId('wip-display')).toHaveTextContent('3/\u221E');
      });
    });

    describe('Callback with correct stageId', () => {
      it('should call onWipLimitChange with correct stageId', () => {
        const onWipLimitChange = vi.fn();
        render(
          <BoardColumn
            stage="implementing"
            items={createItems(2)}
            wipLimit={3}
            onWipLimitChange={onWipLimitChange}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        fireEvent.change(input, { target: { value: '7' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onWipLimitChange).toHaveBeenCalledWith('implementing', 7);
      });

      it('should pass different stageId for different columns', () => {
        const onWipLimitChange = vi.fn();

        const { unmount } = render(
          <BoardColumn
            stage="review"
            items={createItems(1)}
            wipLimit={2}
            onWipLimitChange={onWipLimitChange}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        fireEvent.change(input, { target: { value: '4' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onWipLimitChange).toHaveBeenCalledWith('review', 4);

        unmount();
      });
    });

    describe('Input validation', () => {
      it('should only accept numeric input', () => {
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={vi.fn()}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input') as HTMLInputElement;
        expect(input).toHaveAttribute('type', 'number');
      });

      it('should have minimum value of 0', () => {
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={vi.fn()}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        const input = screen.getByTestId('wip-limit-input');
        expect(input).toHaveAttribute('min', '0');
      });
    });

    describe('Edit mode styling', () => {
      it('should render input inline with count display', () => {
        render(
          <BoardColumn
            stage="testing"
            items={createItems(3)}
            wipLimit={5}
            onWipLimitChange={vi.fn()}
          />
        );

        const limitDisplay = screen.getByTestId('wip-limit-value');
        fireEvent.click(limitDisplay);

        // The wip-display container should contain the input
        const wipDisplay = screen.getByTestId('wip-display');
        const input = within(wipDisplay).getByTestId('wip-limit-input');
        expect(input).toBeInTheDocument();
      });
    });
  });

  describe('Integration: Display and Edit together', () => {
    it('should show correct format and allow editing', () => {
      const onWipLimitChange = vi.fn();
      const { rerender } = render(
        <BoardColumn
          stage="testing"
          items={createItems(4)}
          wipLimit={5}
          onWipLimitChange={onWipLimitChange}
        />
      );

      // Check initial display format
      expect(screen.getByTestId('wip-display')).toHaveTextContent('4/5');

      // Enter edit mode
      const limitDisplay = screen.getByTestId('wip-limit-value');
      fireEvent.click(limitDisplay);

      // Edit the value
      const input = screen.getByTestId('wip-limit-input');
      fireEvent.change(input, { target: { value: '4' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // Verify callback was called
      expect(onWipLimitChange).toHaveBeenCalledWith('testing', 4);

      // Simulate parent updating props after save
      rerender(
        <BoardColumn
          stage="testing"
          items={createItems(4)}
          wipLimit={4}
          onWipLimitChange={onWipLimitChange}
        />
      );

      // Now at limit
      expect(screen.getByTestId('wip-display')).toHaveTextContent('4/4');
    });

    it('should handle changing from limited to unlimited and back', () => {
      const onWipLimitChange = vi.fn();
      const { rerender } = render(
        <BoardColumn
          stage="testing"
          items={createItems(3)}
          wipLimit={5}
          onWipLimitChange={onWipLimitChange}
        />
      );

      // Set to unlimited
      const limitDisplay = screen.getByTestId('wip-limit-value');
      fireEvent.click(limitDisplay);

      const input = screen.getByTestId('wip-limit-input');
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onWipLimitChange).toHaveBeenCalledWith('testing', null);

      // Simulate update
      rerender(
        <BoardColumn
          stage="testing"
          items={createItems(3)}
          wipLimit={null}
          onWipLimitChange={onWipLimitChange}
        />
      );

      expect(screen.getByTestId('wip-display')).toHaveTextContent('3/\u221E');

      // Set back to limited
      const limitDisplayUnlimited = screen.getByTestId('wip-limit-value');
      fireEvent.click(limitDisplayUnlimited);

      const inputNew = screen.getByTestId('wip-limit-input');
      fireEvent.change(inputNew, { target: { value: '2' } });
      fireEvent.keyDown(inputNew, { key: 'Enter' });

      expect(onWipLimitChange).toHaveBeenCalledWith('testing', 2);

      // Simulate update - now over limit
      rerender(
        <BoardColumn
          stage="testing"
          items={createItems(3)}
          wipLimit={2}
          onWipLimitChange={onWipLimitChange}
        />
      );

      expect(screen.getByTestId('wip-display')).toHaveTextContent('3/2');
    });
  });
});
