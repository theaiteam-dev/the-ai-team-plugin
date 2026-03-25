import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DependencyIndicator } from '../components/dependency-indicator';

describe('DependencyIndicator', () => {
  describe('conditional rendering', () => {
    it('should return null when blockerIds is empty', () => {
      const { container } = render(<DependencyIndicator blockerIds={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it('should return null when blockerIds is undefined', () => {
      // @ts-expect-error - testing runtime behavior with undefined
      const { container } = render(<DependencyIndicator blockerIds={undefined} />);
      expect(container.firstChild).toBeNull();
    });

    it('should render when blockerIds has items', () => {
      render(<DependencyIndicator blockerIds={['009']} />);
      expect(screen.getByTestId('dependency-indicator')).toBeInTheDocument();
    });
  });

  describe('icon and count display', () => {
    it('should display the chain link icon', () => {
      render(<DependencyIndicator blockerIds={['009']} />);
      const indicator = screen.getByTestId('dependency-indicator');
      // Icon should be present as an SVG
      expect(indicator.querySelector('svg')).toBeInTheDocument();
    });

    it('should display correct count for single blocker', () => {
      render(<DependencyIndicator blockerIds={['009']} />);
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('should display correct count for multiple blockers', () => {
      render(<DependencyIndicator blockerIds={['009', '012', '015']} />);
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('should display count of 2 for two blockers', () => {
      render(<DependencyIndicator blockerIds={['009', '012']} />);
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('tooltip content', () => {
    // Note: Radix UI renders tooltip content twice (visual + accessibility)
    // so we use getAllBy* variants and check length >= 1
    it('should show "Blocked by:" header in tooltip', () => {
      render(<DependencyIndicator blockerIds={['009']} defaultOpen />);
      const headers = screen.getAllByText('Blocked by:');
      expect(headers.length).toBeGreaterThanOrEqual(1);
    });

    it('should list all blocker IDs in tooltip', () => {
      render(<DependencyIndicator blockerIds={['009', '012']} defaultOpen />);
      const id009 = screen.getAllByText(/009/);
      const id012 = screen.getAllByText(/012/);
      expect(id009.length).toBeGreaterThanOrEqual(1);
      expect(id012.length).toBeGreaterThanOrEqual(1);
    });

    it('should show single blocker ID in tooltip', () => {
      render(<DependencyIndicator blockerIds={['042']} defaultOpen />);
      const ids = screen.getAllByText(/042/);
      expect(ids.length).toBeGreaterThanOrEqual(1);
    });
  });
});
