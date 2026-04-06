import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScalingRationaleModal } from '@/components/scaling-rationale-modal';
import type { ScalingRationale } from '@/types/scaling-modal';

const baseRationale: ScalingRationale = {
  instanceCount: 3,
  depGraphMaxPerStage: 5,
  memoryBudgetCeiling: 4,
  wipLimit: 3,
  bindingConstraint: 'memory',
  concurrencyOverride: null,
};

describe('ScalingRationaleModal', () => {
  describe('button visibility', () => {
    it('should show Scaling button when scalingRationale is provided', () => {
      render(<ScalingRationaleModal scalingRationale={baseRationale} />);

      expect(screen.getByRole('button', { name: /scaling/i })).toBeInTheDocument();
    });

    it('should hide button when scalingRationale is null', () => {
      render(<ScalingRationaleModal scalingRationale={null} />);

      expect(screen.queryByRole('button', { name: /scaling/i })).not.toBeInTheDocument();
    });

    it('should hide button when scalingRationale is undefined', () => {
      render(<ScalingRationaleModal scalingRationale={undefined} />);

      expect(screen.queryByRole('button', { name: /scaling/i })).not.toBeInTheDocument();
    });
  });

  describe('modal open/close behavior', () => {
    it('should not show dialog content before the button is clicked', () => {
      render(<ScalingRationaleModal scalingRationale={baseRationale} />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should open modal when Scaling button is clicked', () => {
      render(<ScalingRationaleModal scalingRationale={baseRationale} />);

      fireEvent.click(screen.getByRole('button', { name: /scaling/i }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should close modal when the close button is clicked', () => {
      render(<ScalingRationaleModal scalingRationale={baseRationale} />);

      fireEvent.click(screen.getByRole('button', { name: /scaling/i }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /close/i }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should close modal when Escape key is pressed', () => {
      render(<ScalingRationaleModal scalingRationale={baseRationale} />);

      fireEvent.click(screen.getByRole('button', { name: /scaling/i }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('modal content', () => {
    it('should display instance count', () => {
      render(<ScalingRationaleModal scalingRationale={baseRationale} />);
      fireEvent.click(screen.getByRole('button', { name: /scaling/i }));

      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('should display dep graph max per stage', () => {
      render(<ScalingRationaleModal scalingRationale={baseRationale} />);
      fireEvent.click(screen.getByRole('button', { name: /scaling/i }));

      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should display memory budget ceiling', () => {
      render(<ScalingRationaleModal scalingRationale={baseRationale} />);
      fireEvent.click(screen.getByRole('button', { name: /scaling/i }));

      expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('should display binding constraint', () => {
      render(<ScalingRationaleModal scalingRationale={baseRationale} />);
      fireEvent.click(screen.getByRole('button', { name: /scaling/i }));

      expect(screen.getByText('memory')).toBeInTheDocument();
    });

    it('should display concurrency override when set', () => {
      const rationaleWithOverride: ScalingRationale = {
        ...baseRationale,
        concurrencyOverride: 2,
      };
      render(<ScalingRationaleModal scalingRationale={rationaleWithOverride} />);
      fireEvent.click(screen.getByRole('button', { name: /scaling/i }));

      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('should indicate no override when concurrencyOverride is null', () => {
      render(<ScalingRationaleModal scalingRationale={baseRationale} />);
      fireEvent.click(screen.getByRole('button', { name: /scaling/i }));

      // Should display something indicating adaptive/none, e.g. "—" or "adaptive" or "none"
      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toMatch(/adaptive|none|—|-/i);
    });

    it('should use the ui/dialog Dialog component (data-slot attribute present)', () => {
      render(<ScalingRationaleModal scalingRationale={baseRationale} />);
      fireEvent.click(screen.getByRole('button', { name: /scaling/i }));

      expect(document.querySelector('[data-slot="dialog-content"]')).toBeInTheDocument();
    });
  });

  describe('binding constraint variations', () => {
    it('should show dep-graph as binding constraint', () => {
      const rationale: ScalingRationale = { ...baseRationale, bindingConstraint: 'dep-graph' };
      render(<ScalingRationaleModal scalingRationale={rationale} />);
      fireEvent.click(screen.getByRole('button', { name: /scaling/i }));

      expect(screen.getByText('dep-graph')).toBeInTheDocument();
    });

    it('should show wip as binding constraint', () => {
      const rationale: ScalingRationale = { ...baseRationale, bindingConstraint: 'wip' };
      render(<ScalingRationaleModal scalingRationale={rationale} />);
      fireEvent.click(screen.getByRole('button', { name: /scaling/i }));

      expect(screen.getByText('wip')).toBeInTheDocument();
    });
  });
});
