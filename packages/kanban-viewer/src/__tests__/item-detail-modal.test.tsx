import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ItemDetailModal } from '../components/item-detail-modal';
import type { WorkItem } from '../types';

const createWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: '007',
  title: 'Auth Service Implementation',
  type: 'feature',
  status: 'implementing',
  assigned_agent: 'B.A.',
  rejection_count: 0,
  dependencies: ['001', '003'],
  outputs: {
    impl: 'src/services/auth.ts',
    test: 'src/__tests__/auth.test.ts',
    types: 'src/types/auth.ts',
  },
  created_at: '2026-01-15T10:30:00Z',
  updated_at: '2026-01-15T14:20:00Z',
  stage: 'implementing',
  content: '# Implementation Notes\n\nFull markdown content here...',
  ...overrides,
});

describe('ItemDetailModal', () => {
  describe('open/close behavior', () => {
    it('should render modal content when isOpen is true', () => {
      const item = createWorkItem();
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText('Auth Service Implementation')).toBeInTheDocument();
    });

    it('should not render modal content when isOpen is false', () => {
      const item = createWorkItem();
      render(<ItemDetailModal isOpen={false} onClose={() => {}} item={item} />);

      expect(screen.queryByText('Auth Service Implementation')).not.toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', () => {
      const handleClose = vi.fn();
      const item = createWorkItem();
      render(<ItemDetailModal isOpen={true} onClose={handleClose} item={item} />);

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when Escape key is pressed', () => {
      const handleClose = vi.fn();
      const item = createWorkItem();
      render(<ItemDetailModal isOpen={true} onClose={handleClose} item={item} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('should handle null item gracefully', () => {
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={null} />);

      // Should render without crashing, but with no item content
      expect(screen.queryByText('Auth Service Implementation')).not.toBeInTheDocument();
    });
  });

  describe('item metadata display', () => {
    it('should display item ID formatted with leading zeros', () => {
      const item = createWorkItem({ id: '7' });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText(/007/)).toBeInTheDocument();
    });

    it('should display item title', () => {
      const item = createWorkItem({ title: 'Auth Service Implementation' });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText('Auth Service Implementation')).toBeInTheDocument();
    });

    it('should display item type', () => {
      const item = createWorkItem({ type: 'feature' });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText('feature')).toBeInTheDocument();
    });

    it('should display item status', () => {
      const item = createWorkItem({ status: 'implementing' });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText(/implementing/i)).toBeInTheDocument();
    });

    it('should display assigned agent when present', () => {
      const item = createWorkItem({ assigned_agent: 'B.A.' });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText(/B\.A\./)).toBeInTheDocument();
    });

    it('should display created_at timestamp', () => {
      const item = createWorkItem({ created_at: '2026-01-15T10:30:00Z', updated_at: '2026-01-16T10:30:00Z' });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // Should show created date
      expect(screen.getByText('2026-01-15')).toBeInTheDocument();
    });

    it('should display updated_at timestamp', () => {
      const item = createWorkItem({ updated_at: '2026-01-15T14:20:00Z' });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // Should show updated timestamp somewhere
      const container = screen.getByTestId('item-detail-modal');
      expect(container.textContent).toContain('2026-01-15');
    });
  });

  describe('dependencies display', () => {
    it('should display dependencies list when present', () => {
      const item = createWorkItem({ dependencies: ['001', '003'] });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText(/001/)).toBeInTheDocument();
      expect(screen.getByText(/003/)).toBeInTheDocument();
    });

    it('should handle empty dependencies array', () => {
      const item = createWorkItem({ dependencies: [] });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // Should render without crashing
      expect(screen.getByText('Auth Service Implementation')).toBeInTheDocument();
    });

    it('should display dependencies section label', () => {
      const item = createWorkItem({ dependencies: ['001'] });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText(/dependencies/i)).toBeInTheDocument();
    });
  });

  describe('outputs display', () => {
    it('should display implementation output path when present', () => {
      const item = createWorkItem({ outputs: { impl: 'src/services/auth.ts' } });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText(/src\/services\/auth\.ts/)).toBeInTheDocument();
    });

    it('should display test output path when present', () => {
      const item = createWorkItem({ outputs: { test: 'src/__tests__/auth.test.ts' } });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText(/src\/__tests__\/auth\.test\.ts/)).toBeInTheDocument();
    });

    it('should display types output path when present', () => {
      const item = createWorkItem({ outputs: { types: 'src/types/auth.ts' } });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText(/src\/types\/auth\.ts/)).toBeInTheDocument();
    });

    it('should handle empty outputs object', () => {
      const item = createWorkItem({ outputs: {} });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // Should render without crashing
      expect(screen.getByText('Auth Service Implementation')).toBeInTheDocument();
    });

    it('should display outputs section label when outputs exist', () => {
      const item = createWorkItem({ outputs: { impl: 'src/file.ts' } });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText(/outputs/i)).toBeInTheDocument();
    });
  });

  describe('markdown content display', () => {
    it('should render markdown content', () => {
      const item = createWorkItem({ content: '# Implementation Notes\n\nSome details here.' });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // Markdown should be rendered - check for heading
      expect(screen.getByText('Implementation Notes')).toBeInTheDocument();
    });

    it('should handle empty content', () => {
      const item = createWorkItem({ content: '' });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // Should render without crashing
      expect(screen.getByText('Auth Service Implementation')).toBeInTheDocument();
    });

    it('should render paragraphs in markdown content', () => {
      const item = createWorkItem({ content: 'First paragraph\n\nSecond paragraph' });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText('First paragraph')).toBeInTheDocument();
      expect(screen.getByText('Second paragraph')).toBeInTheDocument();
    });

    it('should render code blocks in markdown', () => {
      const item = createWorkItem({ content: '```\nconst x = 1;\n```' });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText(/const x = 1/)).toBeInTheDocument();
    });

    it('should render lists in markdown', () => {
      const item = createWorkItem({ content: '- Item 1\n- Item 2' });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText('Item 1')).toBeInTheDocument();
      expect(screen.getByText('Item 2')).toBeInTheDocument();
    });
  });

  describe('dialog structure', () => {
    it('should use shadcn Dialog component', () => {
      const item = createWorkItem();
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // Check for dialog content slot attribute from shadcn dialog
      const dialogContent = document.querySelector('[data-slot="dialog-content"]');
      expect(dialogContent).toBeInTheDocument();
    });

    it('should have backdrop overlay', () => {
      const item = createWorkItem();
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      const overlay = document.querySelector('[data-slot="dialog-overlay"]');
      expect(overlay).toBeInTheDocument();
    });

    it('should have testid for modal container', () => {
      const item = createWorkItem();
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByTestId('item-detail-modal')).toBeInTheDocument();
    });
  });

  describe('rejection count display', () => {
    it('should display rejection count when greater than 0', () => {
      const item = createWorkItem({ rejection_count: 2, dependencies: [] });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // Look for rejection indicator with warning icon
      const container = screen.getByTestId('item-detail-modal');
      const rejectionText = container.querySelector('.text-amber-500');
      expect(rejectionText).toBeInTheDocument();
      expect(rejectionText?.textContent).toContain('2');
    });

    it('should not prominently display rejection when count is 0', () => {
      const item = createWorkItem({ rejection_count: 0 });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // Should render normally without rejection warning
      expect(screen.getByText('Auth Service Implementation')).toBeInTheDocument();
      // No amber warning text for rejection
      const container = screen.getByTestId('item-detail-modal');
      const rejectionWarning = container.querySelector('.text-amber-500');
      expect(rejectionWarning).not.toBeInTheDocument();
    });
  });

  describe('work history section', () => {
    it('should display Work History section when work_logs has entries', () => {
      const item = createWorkItem({
        work_logs: [
          {
            id: 1,
            agent: 'B.A.',
            action: 'started',
            summary: 'Beginning implementation',
            timestamp: new Date('2026-01-15T10:00:00Z'),
          },
        ],
      });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText('Work History')).toBeInTheDocument();
    });

    it('should hide Work History section when work_logs is empty', () => {
      const item = createWorkItem({ work_logs: [] });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.queryByText('Work History')).not.toBeInTheDocument();
    });

    it('should hide Work History section when work_logs is undefined', () => {
      const item = createWorkItem({ work_logs: undefined });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.queryByText('Work History')).not.toBeInTheDocument();
    });

    it('should render work log entry with agent name', () => {
      const item = createWorkItem({
        work_logs: [
          {
            id: 1,
            agent: 'B.A.',
            action: 'started',
            summary: 'Beginning implementation',
            timestamp: new Date('2026-01-15T10:00:00Z'),
          },
        ],
      });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText('B.A.')).toBeInTheDocument();
    });

    it('should render work log entry with action type', () => {
      const item = createWorkItem({
        work_logs: [
          {
            id: 1,
            agent: 'Murdock',
            action: 'completed',
            summary: 'Finished testing',
            timestamp: new Date('2026-01-15T10:00:00Z'),
          },
        ],
      });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    it('should render work log entry with summary', () => {
      const item = createWorkItem({
        work_logs: [
          {
            id: 1,
            agent: 'Face',
            action: 'note',
            summary: 'This is a detailed summary about the work',
            timestamp: new Date('2026-01-15T10:00:00Z'),
          },
        ],
      });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText('This is a detailed summary about the work')).toBeInTheDocument();
    });

    it('should render work log entry with formatted timestamp', () => {
      const item = createWorkItem({
        work_logs: [
          {
            id: 1,
            agent: 'Hannibal',
            action: 'started',
            summary: 'Planning phase',
            timestamp: new Date('2026-01-15T14:30:00Z'),
          },
        ],
      });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // The timestamp should be formatted and visible
      const container = screen.getByTestId('item-detail-modal');
      expect(container.textContent).toMatch(/Jan/i);
    });

    it('should render all action types with correct labels', () => {
      const item = createWorkItem({
        work_logs: [
          {
            id: 1,
            agent: 'B.A.',
            action: 'started',
            summary: 'Started work',
            timestamp: new Date('2026-01-15T10:00:00Z'),
          },
          {
            id: 2,
            agent: 'Face',
            action: 'completed',
            summary: 'Completed work',
            timestamp: new Date('2026-01-15T11:00:00Z'),
          },
          {
            id: 3,
            agent: 'Murdock',
            action: 'rejected',
            summary: 'Found issues',
            timestamp: new Date('2026-01-15T12:00:00Z'),
          },
          {
            id: 4,
            agent: 'Amy',
            action: 'note',
            summary: 'Additional notes',
            timestamp: new Date('2026-01-15T13:00:00Z'),
          },
        ],
      });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText('Started')).toBeInTheDocument();
      expect(screen.getByText('Completed')).toBeInTheDocument();
      expect(screen.getByText('Rejected')).toBeInTheDocument();
      expect(screen.getByText('Note')).toBeInTheDocument();
    });

    it('should render multiple work log entries in order', () => {
      const item = createWorkItem({
        work_logs: [
          {
            id: 1,
            agent: 'B.A.',
            action: 'started',
            summary: 'First entry',
            timestamp: new Date('2026-01-15T10:00:00Z'),
          },
          {
            id: 2,
            agent: 'Murdock',
            action: 'note',
            summary: 'Second entry',
            timestamp: new Date('2026-01-15T11:00:00Z'),
          },
          {
            id: 3,
            agent: 'Face',
            action: 'completed',
            summary: 'Third entry',
            timestamp: new Date('2026-01-15T12:00:00Z'),
          },
        ],
      });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText('First entry')).toBeInTheDocument();
      expect(screen.getByText('Second entry')).toBeInTheDocument();
      expect(screen.getByText('Third entry')).toBeInTheDocument();
    });

    it('should display work logs from different agents', () => {
      const item = createWorkItem({
        work_logs: [
          {
            id: 1,
            agent: 'Hannibal',
            action: 'started',
            summary: 'Hannibal started',
            timestamp: new Date('2026-01-15T10:00:00Z'),
          },
          {
            id: 2,
            agent: 'Face',
            action: 'note',
            summary: 'Face added note',
            timestamp: new Date('2026-01-15T11:00:00Z'),
          },
          {
            id: 3,
            agent: 'Murdock',
            action: 'completed',
            summary: 'Murdock completed',
            timestamp: new Date('2026-01-15T12:00:00Z'),
          },
        ],
      });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      expect(screen.getByText('Hannibal')).toBeInTheDocument();
      expect(screen.getByText('Face')).toBeInTheDocument();
      expect(screen.getByText('Murdock')).toBeInTheDocument();
    });

    it('should handle work log with empty summary', () => {
      const item = createWorkItem({
        work_logs: [
          {
            id: 1,
            agent: 'B.A.',
            action: 'started',
            summary: '',
            timestamp: new Date('2026-01-15T10:00:00Z'),
          },
        ],
      });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // Should still render the entry with agent and action
      expect(screen.getByText('B.A.')).toBeInTheDocument();
      expect(screen.getByText('Started')).toBeInTheDocument();
    });

    it('should display work history along with other sections', () => {
      const item = createWorkItem({
        dependencies: ['001', '002'],
        outputs: {
          impl: 'src/feature.ts',
          test: 'src/__tests__/feature.test.ts',
        },
        work_logs: [
          {
            id: 1,
            agent: 'B.A.',
            action: 'completed',
            summary: 'Implementation finished',
            timestamp: new Date('2026-01-15T10:00:00Z'),
          },
        ],
        content: '# Feature Notes\n\nSome content here',
      });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // All sections should be visible
      expect(screen.getByText(/dependencies/i)).toBeInTheDocument();
      expect(screen.getByText(/outputs/i)).toBeInTheDocument();
      expect(screen.getByText('Work History')).toBeInTheDocument();
      expect(screen.getByText('Feature Notes')).toBeInTheDocument();
    });

    it('should handle string timestamps', () => {
      const item = createWorkItem({
        work_logs: [
          {
            id: 1,
            agent: 'B.A.',
            action: 'started',
            summary: 'Work started',
            timestamp: '2026-01-15T10:00:00Z' as unknown as Date,
          },
        ],
      });
      render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);

      // Should still render without crashing
      expect(screen.getByText('B.A.')).toBeInTheDocument();
      expect(screen.getByText('Work started')).toBeInTheDocument();
    });
  });
});
