import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ResponsiveBoard, ALL_STAGES, STAGE_LABELS } from '../components/responsive-board';
import type { WorkItem, Stage } from '../types';

// Factory function for creating test work items
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

// Factory function for creating empty items by stage
const createEmptyItemsByStage = (): Record<Stage, WorkItem[]> => ({
  briefings: [],
  ready: [],
  testing: [],
  implementing: [],
  review: [],
  probing: [],
  staged: [],
  done: [],
  blocked: [],
});

// Factory function for items by stage with some items
const createItemsByStage = (): Record<Stage, WorkItem[]> => ({
  briefings: [createWorkItem({ id: '001', title: 'Brief Item', stage: 'briefings' })],
  ready: [
    createWorkItem({ id: '002', title: 'Ready Item 1', stage: 'ready' }),
    createWorkItem({ id: '003', title: 'Ready Item 2', stage: 'ready' }),
  ],
  testing: [createWorkItem({ id: '004', title: 'Testing Item', stage: 'testing' })],
  implementing: [],
  review: [createWorkItem({ id: '005', title: 'Review Item', stage: 'review' })],
  probing: [],
  staged: [],
  done: [],
  blocked: [],
});

describe('ResponsiveBoard', () => {
  describe('component structure', () => {
    it('should render with data-testid responsive-board', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
        />
      );
      expect(screen.getByTestId('responsive-board')).toBeInTheDocument();
    });

    it('should render all stages as columns on desktop view', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
        />
      );

      const desktopBoard = screen.getByTestId('desktop-board');
      expect(desktopBoard).toBeInTheDocument();

      // All 9 stages should be present (including probing and staged)
      const columns = within(desktopBoard).getAllByTestId('board-column');
      expect(columns).toHaveLength(9);
    });

    it('renders a Staged column positioned between Probing and Done (WI-792)', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
        />
      );

      const desktopBoard = screen.getByTestId('desktop-board');
      const columns = within(desktopBoard).getAllByTestId('board-column');
      const columnLabels = columns.map((c) => c.textContent ?? '');

      const probingIdx = columnLabels.findIndex((t) => /probing/i.test(t));
      const stagedIdx = columnLabels.findIndex((t) => /staged/i.test(t));
      const doneIdx = columnLabels.findIndex((t) => /^done|\bdone\b/i.test(t));

      expect(stagedIdx).toBeGreaterThan(-1);
      expect(stagedIdx).toBe(probingIdx + 1);
      expect(doneIdx).toBe(stagedIdx + 1);
    });
  });

  describe('mobile stage tabs', () => {
    it('should render mobile stage tabs', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
        />
      );

      expect(screen.getByTestId('mobile-stage-tabs')).toBeInTheDocument();
    });

    it('should render a tab for each stage', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
        />
      );

      ALL_STAGES.forEach((stage) => {
        expect(screen.getByTestId(`stage-tab-${stage}`)).toBeInTheDocument();
      });
    });

    it('should display stage labels correctly', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
        />
      );

      expect(screen.getByText('Briefings')).toBeInTheDocument();
      expect(screen.getByText('Testing')).toBeInTheDocument();
      expect(screen.getByText('Implementing')).toBeInTheDocument();
    });

    it('should show item count in tabs', () => {
      const itemsByStage = createItemsByStage();
      render(
        <ResponsiveBoard
          itemsByStage={itemsByStage}
          wipLimits={{}}
        />
      );

      // Ready has 2 items
      const readyTab = screen.getByTestId('stage-tab-ready');
      expect(readyTab).toHaveTextContent('(2)');

      // Testing has 1 item
      const testingTab = screen.getByTestId('stage-tab-testing');
      expect(testingTab).toHaveTextContent('(1)');
    });

    it('should switch stage content when tab is activated', () => {
      const itemsByStage = createItemsByStage();
      render(
        <ResponsiveBoard
          itemsByStage={itemsByStage}
          wipLimits={{}}
        />
      );

      // Use keyboard interaction for Radix tabs in jsdom
      const testingTab = screen.getByTestId('stage-tab-testing');
      testingTab.focus();
      fireEvent.keyDown(testingTab, { key: 'Enter' });

      // Testing content should be visible
      const testingContent = screen.getByTestId('stage-content-testing');
      expect(testingContent).toHaveAttribute('data-state', 'active');
    });

    // WI-792: mobile stage tabs — Staged tab must be reachable and operable
    // the same way every other tab already is (focusable in column order,
    // Enter/Space activates it), and must expose its selected state to
    // assistive technology.
    it('the Staged tab is focusable and Enter activates it, selecting the Staged column (WI-792)', () => {
      const itemsByStage = createItemsByStage();
      render(
        <ResponsiveBoard
          itemsByStage={itemsByStage}
          wipLimits={{}}
        />
      );

      const stagedTab = screen.getByTestId('stage-tab-staged');
      stagedTab.focus();
      expect(document.activeElement).toBe(stagedTab);

      fireEvent.keyDown(stagedTab, { key: 'Enter' });

      const stagedContent = screen.getByTestId('stage-content-staged');
      expect(stagedContent).toHaveAttribute('data-state', 'active');
    });

    it('the Staged tab is activated by Space as well as Enter (WI-792)', () => {
      const itemsByStage = createItemsByStage();
      render(
        <ResponsiveBoard
          itemsByStage={itemsByStage}
          wipLimits={{}}
        />
      );

      const stagedTab = screen.getByTestId('stage-tab-staged');
      stagedTab.focus();
      fireEvent.keyDown(stagedTab, { key: ' ' });

      const stagedContent = screen.getByTestId('stage-content-staged');
      expect(stagedContent).toHaveAttribute('data-state', 'active');
    });

    it('the Staged tab exposes its selected state to assistive technology via aria-selected (WI-792)', () => {
      const itemsByStage = createItemsByStage();
      render(
        <ResponsiveBoard
          itemsByStage={itemsByStage}
          wipLimits={{}}
        />
      );

      const stagedTab = screen.getByTestId('stage-tab-staged');

      // Not yet selected by default (briefings is the default active tab).
      expect(stagedTab).toHaveAttribute('aria-selected', 'false');

      stagedTab.focus();
      fireEvent.keyDown(stagedTab, { key: 'Enter' });

      expect(stagedTab).toHaveAttribute('aria-selected', 'true');
    });

    it('tabs remain reachable in column order (staged sits between probing and done)', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
        />
      );

      const tabsContainer = screen.getByTestId('mobile-stage-tabs');
      const tabs = within(tabsContainer).getAllByRole('tab');
      const tabTestIds = tabs.map((t) => t.getAttribute('data-testid'));

      const probingIdx = tabTestIds.indexOf('stage-tab-probing');
      const stagedIdx = tabTestIds.indexOf('stage-tab-staged');
      const doneIdx = tabTestIds.indexOf('stage-tab-done');

      expect(stagedIdx).toBe(probingIdx + 1);
      expect(doneIdx).toBe(stagedIdx + 1);
    });
  });

  describe('panel toggle button', () => {
    it('should render panel toggle button when onPanelToggle is provided', () => {
      const onPanelToggle = vi.fn();
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
          onPanelToggle={onPanelToggle}
        />
      );

      expect(screen.getByTestId('panel-toggle-button')).toBeInTheDocument();
    });

    it('should not render panel toggle button when onPanelToggle is not provided', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
        />
      );

      expect(screen.queryByTestId('panel-toggle-button')).not.toBeInTheDocument();
    });

    it('should call onPanelToggle when button is clicked', () => {
      const onPanelToggle = vi.fn();
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
          onPanelToggle={onPanelToggle}
        />
      );

      const toggleButton = screen.getByTestId('panel-toggle-button');
      fireEvent.click(toggleButton);

      expect(onPanelToggle).toHaveBeenCalledTimes(1);
    });

    it('should have accessible label for open panel state', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
          isPanelOpen={true}
          onPanelToggle={vi.fn()}
        />
      );

      const toggleButton = screen.getByTestId('panel-toggle-button');
      expect(toggleButton).toHaveAttribute('aria-label', 'Close panel');
    });

    it('should have accessible label for closed panel state', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
          isPanelOpen={false}
          onPanelToggle={vi.fn()}
        />
      );

      const toggleButton = screen.getByTestId('panel-toggle-button');
      expect(toggleButton).toHaveAttribute('aria-label', 'Open panel');
    });
  });

  describe('side panel', () => {
    it('should render side panel container when sidePanel prop is provided', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
          sidePanel={<div data-testid="test-panel">Panel Content</div>}
        />
      );

      expect(screen.getByTestId('side-panel-container')).toBeInTheDocument();
      expect(screen.getByTestId('test-panel')).toBeInTheDocument();
    });

    it('should not render side panel container when sidePanel prop is not provided', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
        />
      );

      expect(screen.queryByTestId('side-panel-container')).not.toBeInTheDocument();
    });

    it('should render side panel content', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createEmptyItemsByStage()}
          wipLimits={{}}
          sidePanel={<div>My Panel Content</div>}
        />
      );

      expect(screen.getByText('My Panel Content')).toBeInTheDocument();
    });
  });

  describe('work items display', () => {
    it('should display work items in the correct stage columns', () => {
      const itemsByStage = createItemsByStage();
      render(
        <ResponsiveBoard
          itemsByStage={itemsByStage}
          wipLimits={{}}
        />
      );

      // ResponsiveBoard deliberately renders BOTH the mobile and the desktop
      // subtree (only CSS hides one — see the comment in the component), so
      // an unscoped getByText is ambiguous for any item the mobile view also
      // shows. Scope each assertion to the subtree it is really about.
      const desktopBoard = screen.getByTestId('desktop-board');
      expect(within(desktopBoard).getByText('Brief Item')).toBeInTheDocument();
      expect(within(desktopBoard).getByText('Ready Item 1')).toBeInTheDocument();
      expect(within(desktopBoard).getByText('Testing Item')).toBeInTheDocument();

      // Mobile view renders only the ACTIVE tab's content (briefings by
      // default), which is the only place the duplicate copy exists.
      const mobileBriefings = screen.getByTestId('stage-content-briefings');
      expect(within(mobileBriefings).getByText('Brief Item')).toBeInTheDocument();
    });

    it('should call onItemClick when an item is clicked', () => {
      const onItemClick = vi.fn();
      const itemsByStage = createItemsByStage();
      render(
        <ResponsiveBoard
          itemsByStage={itemsByStage}
          wipLimits={{}}
          onItemClick={onItemClick}
        />
      );

      // Every card exists twice (mobile + desktop subtree), so pick the copy
      // explicitly instead of relying on DOM order of getAllByTestId.
      const desktopCards = within(screen.getByTestId('desktop-board')).getAllByTestId(
        'work-item-card'
      );
      fireEvent.click(desktopCards[0]);
      expect(onItemClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: '001', title: 'Brief Item' })
      );

      // The mobile copy of the same card is wired to the same callback.
      onItemClick.mockClear();
      const mobileCard = within(screen.getByTestId('stage-content-briefings')).getByTestId(
        'work-item-card'
      );
      fireEvent.click(mobileCard);
      expect(onItemClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: '001', title: 'Brief Item' })
      );
    });
  });

  describe('WIP limits', () => {
    it('should pass WIP limits to columns without rendering WIP indicators', () => {
      render(
        <ResponsiveBoard
          itemsByStage={createItemsByStage()}
          wipLimits={{ testing: 2, implementing: 3, review: 2 }}
        />
      );

      // WIP indicators should NOT be present (removed per PRD)
      const wipIndicators = screen.queryAllByTestId('wip-indicator');
      expect(wipIndicators.length).toBe(0);
    });
  });

  describe('constants exports', () => {
    it('should export ALL_STAGES with 9 stages, staged positioned between probing and done', () => {
      expect(ALL_STAGES).toHaveLength(9);
      expect(ALL_STAGES).toContain('briefings');
      expect(ALL_STAGES).toContain('probing');
      expect(ALL_STAGES).toContain('staged');
      expect(ALL_STAGES).toContain('done');
      expect(ALL_STAGES).toContain('blocked');

      const probingIdx = ALL_STAGES.indexOf('probing');
      const stagedIdx = ALL_STAGES.indexOf('staged');
      const doneIdx = ALL_STAGES.indexOf('done');
      expect(stagedIdx).toBe(probingIdx + 1);
      expect(doneIdx).toBe(stagedIdx + 1);
    });

    it('should export STAGE_LABELS with correct labels', () => {
      expect(STAGE_LABELS.briefings).toBe('Briefings');
      expect(STAGE_LABELS.implementing).toBe('Implementing');
      expect(STAGE_LABELS.blocked).toBe('Blocked');
      expect(STAGE_LABELS.staged).toBe('Staged');
    });
  });
});
