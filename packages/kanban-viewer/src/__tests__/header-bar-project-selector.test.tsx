import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeaderBar } from '../components/header-bar';

// Mock props factory
function createProps(overrides = {}): React.ComponentProps<typeof HeaderBar> {
  return {
    mission: {
      name: 'Test Mission',
      started_at: '2026-01-15T10:00:00Z',
      status: 'active' as const,
    },
    stats: {
      total_items: 10,
      completed: 5,
      in_progress: 2,
      blocked: 1,
    },
    wipCurrent: 2,
    wipLimit: 5,
    projects: [
      { id: 'kanban-viewer', name: 'Kanban Viewer', createdAt: new Date(), updatedAt: new Date() },
      { id: 'project-2', name: 'Project 2', createdAt: new Date(), updatedAt: new Date() },
    ],
    selectedProjectId: 'kanban-viewer',
    onProjectChange: vi.fn(),
    projectsLoading: false,
    ...overrides,
  };
}

describe('HeaderBar - Project Selector Display', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('project selector container', () => {
    it('should render project selector when projects list is not empty', () => {
      render(<HeaderBar {...createProps()} />);

      expect(screen.getByTestId('project-selector-container')).toBeInTheDocument();
    });

    it('should not render project selector container when projects list is empty', () => {
      render(<HeaderBar {...createProps({ projects: [] })} />);

      const projectContainer = screen.queryByTestId('project-selector-container');
      expect(projectContainer).not.toBeInTheDocument();
    });

    it('should be positioned on left side of header', () => {
      render(<HeaderBar {...createProps()} />);

      const header = screen.getByRole('banner');
      const projectContainer = screen.getByTestId('project-selector-container');

      // Project container should be the first child in the header flex container
      expect(header.firstElementChild).toBe(projectContainer);
    });
  });

  describe('project selector functionality', () => {
    it('should display a select dropdown with project options', () => {
      render(<HeaderBar {...createProps()} />);

      const select = screen.getByRole('combobox', { name: /select project/i });
      expect(select).toBeInTheDocument();
    });

    it('should display all projects as options', () => {
      render(<HeaderBar {...createProps()} />);

      expect(screen.getByRole('option', { name: 'Kanban Viewer' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Project 2' })).toBeInTheDocument();
    });

    it('should select the current project by default', () => {
      render(<HeaderBar {...createProps({ selectedProjectId: 'kanban-viewer' })} />);

      const select = screen.getByRole('combobox', { name: /select project/i }) as HTMLSelectElement;
      expect(select.value).toBe('kanban-viewer');
    });

    it('should call onProjectChange when a different project is selected', () => {
      const onProjectChange = vi.fn();
      render(<HeaderBar {...createProps({ onProjectChange })} />);

      const select = screen.getByRole('combobox', { name: /select project/i });
      fireEvent.change(select, { target: { value: 'project-2' } });

      expect(onProjectChange).toHaveBeenCalledWith('project-2');
    });

    it('should disable the selector when loading', () => {
      render(<HeaderBar {...createProps({ projectsLoading: true })} />);

      const select = screen.getByRole('combobox', { name: /select project/i });
      expect(select).toBeDisabled();
    });
  });

  describe('edge cases', () => {
    it('should handle single project', () => {
      render(<HeaderBar {...createProps({
        projects: [{ id: 'solo', name: 'Solo Project', createdAt: new Date(), updatedAt: new Date() }],
        selectedProjectId: 'solo'
      })} />);

      expect(screen.getByTestId('project-selector-container')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Solo Project' })).toBeInTheDocument();
    });

    it('should preserve project names with special characters', () => {
      render(<HeaderBar {...createProps({
        projects: [{ id: 'special', name: 'my_project-v2.0', createdAt: new Date(), updatedAt: new Date() }],
        selectedProjectId: 'special'
      })} />);

      expect(screen.getByRole('option', { name: 'my_project-v2.0' })).toBeInTheDocument();
    });

    it('should handle projects with long names', () => {
      render(<HeaderBar {...createProps({
        projects: [{
          id: 'long',
          name: 'Very Long Project Name That Should Display Properly',
          createdAt: new Date(),
          updatedAt: new Date()
        }],
        selectedProjectId: 'long'
      })} />);

      expect(screen.getByRole('option', { name: 'Very Long Project Name That Should Display Properly' })).toBeInTheDocument();
    });
  });
});
