/**
 * Integration Tests for Mission Completion Flow (Item 008)
 *
 * Tests the mission completion flow components working together:
 * - Agent Status Bar (7 agents including Tawnia)
 * - Header Bar (phase indicators for completion states)
 * - Mission Completion Panel (three-phase pipeline)
 * - Live Feed Panel (COMMITTED message highlighting)
 * - Activity Log (COMMITTED highlightType parsing)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AgentStatusBar, AGENT_NAMES } from '../components/agent-status-bar';
import { HeaderBar } from '../components/header-bar';
import { MissionCompletionPanel } from '../components/mission-completion-panel';
import { LiveFeedPanel } from '../components/live-feed-panel';
import { parseLogEntry, parseLogFile } from '../lib/activity-log';
import type {
  AgentName,
  AgentStatus,
  Mission,
  FinalReviewStatus,
  PostChecksStatus,
  DocumentationStatus,
  CheckResult,
  BoardMetadata,
  LogEntry,
} from '@/types';

// ============================================================================
// Factory Functions
// ============================================================================

type AgentsStatusMap = Partial<Record<AgentName, AgentStatus>>;

function createAgentsStatus(overrides: AgentsStatusMap = {}): AgentsStatusMap {
  return {
    Hannibal: 'idle',
    Face: 'idle',
    Murdock: 'idle',
    'B.A.': 'idle',
    Amy: 'idle',
    Lynch: 'idle',
    Tawnia: 'idle',
    ...overrides,
  };
}

function createMission(overrides: Partial<Mission> = {}): Mission {
  return {
    name: 'Test Mission',
    status: 'active',
    started_at: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

function createHeaderProps(overrides = {}): React.ComponentProps<typeof HeaderBar> {
  return {
    mission: createMission(),
    stats: {
      total_items: 26,
      completed: 12,
      in_progress: 4,
      blocked: 2,
    },
    wipCurrent: 4,
    wipLimit: 5,
    projects: [{ id: 'kanban-viewer', name: 'Kanban Viewer', createdAt: new Date(), updatedAt: new Date() }],
    selectedProjectId: 'kanban-viewer',
    onProjectChange: vi.fn(),
    projectsLoading: false,
    ...overrides,
  };
}

function createFinalReviewStatus(overrides: Partial<FinalReviewStatus> = {}): FinalReviewStatus {
  return {
    started_at: '2026-01-15T14:20:00Z',
    passed: false,
    agent: 'Lynch',
    rejections: 0,
    ...overrides,
  };
}

function createCheckResult(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    status: 'pending',
    ...overrides,
  };
}

function createPostChecksStatus(overrides: Partial<PostChecksStatus> = {}): PostChecksStatus {
  return {
    started_at: '2026-01-15T14:25:05Z',
    passed: false,
    results: {
      lint: createCheckResult(),
      typecheck: createCheckResult(),
      test: createCheckResult(),
      build: createCheckResult(),
    },
    ...overrides,
  };
}

function createDocumentationStatus(overrides: Partial<DocumentationStatus> = {}): DocumentationStatus {
  return {
    started_at: '2026-01-15T14:26:47Z',
    completed: false,
    agent: 'Tawnia',
    files_modified: [],
    ...overrides,
  };
}

function createLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2026-01-15T10:42:15Z',
    agent: 'B.A.',
    message: 'Implementing feature',
    ...overrides,
  };
}

function createBoardMetadata(overrides: Partial<BoardMetadata> = {}): BoardMetadata {
  return {
    mission: createMission(),
    wip_limits: { implementing: 3 },
    phases: {},
    assignments: {},
    agents: {},
    stats: {
      total_items: 10,
      completed: 5,
      in_progress: 3,
      blocked: 1,
      backlog: 1,
    },
    last_updated: '2026-01-15T14:30:00Z',
    ...overrides,
  };
}

// ============================================================================
// Agent Status Bar Integration Tests
// ============================================================================

describe('Mission Completion Integration: Agent Status Bar', () => {
  describe('all 7 agents display', () => {
    it('should render all 7 agents including Tawnia', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      expect(screen.getByText('Hannibal')).toBeInTheDocument();
      expect(screen.getByText('Face')).toBeInTheDocument();
      expect(screen.getByText('Murdock')).toBeInTheDocument();
      expect(screen.getByText('B.A.')).toBeInTheDocument();
      expect(screen.getByText('Amy')).toBeInTheDocument();
      expect(screen.getByText('Lynch')).toBeInTheDocument();
      expect(screen.getByText('Tawnia')).toBeInTheDocument();
    });

    it('should have 8 agents in AGENT_NAMES constant', () => {
      expect(AGENT_NAMES).toHaveLength(8);
      expect(AGENT_NAMES).toContain('Tawnia');
      expect(AGENT_NAMES).toContain('Stockwell');
    });

    it('should display all agents in correct order', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      const container = screen.getByTestId('agents-container');
      const badges = container.querySelectorAll('[data-testid^="agent-badge-"]');

      expect(badges).toHaveLength(8);
      expect(badges[0]).toHaveAttribute('data-testid', 'agent-badge-Hannibal');
      expect(badges[5]).toHaveAttribute('data-testid', 'agent-badge-Lynch');
      expect(badges[6]).toHaveAttribute('data-testid', 'agent-badge-Tawnia');
      expect(badges[7]).toHaveAttribute('data-testid', 'agent-badge-Stockwell');
    });

    it('should show correct initials for all agents', () => {
      render(<AgentStatusBar agents={createAgentsStatus()} />);

      expect(screen.getByTestId('agent-badge-Hannibal')).toHaveTextContent('H');
      expect(screen.getByTestId('agent-badge-Face')).toHaveTextContent('F');
      expect(screen.getByTestId('agent-badge-Murdock')).toHaveTextContent('M');
      expect(screen.getByTestId('agent-badge-B.A.')).toHaveTextContent('B');
      expect(screen.getByTestId('agent-badge-Amy')).toHaveTextContent('A');
      expect(screen.getByTestId('agent-badge-Lynch')).toHaveTextContent('L');
      expect(screen.getByTestId('agent-badge-Tawnia')).toHaveTextContent('T');
    });
  });

  describe('completion flow agent states', () => {
    it('should show Lynch active during final_review phase', () => {
      render(
        <AgentStatusBar
          agents={createAgentsStatus({
            Lynch: 'active',
            Tawnia: 'idle',
          })}
        />
      );

      expect(screen.getByTestId('agent-status-Lynch')).toHaveTextContent('ACTIVE');
    });

    it('should show Tawnia active during documentation phase', () => {
      render(
        <AgentStatusBar
          agents={createAgentsStatus({
            Lynch: 'idle',
            Tawnia: 'active',
          })}
        />
      );

      expect(screen.getByTestId('agent-status-Tawnia')).toHaveTextContent('ACTIVE');
    });
  });
});

// ============================================================================
// Header Bar Phase Indicators Tests
// ============================================================================

describe('Mission Completion Integration: Header Bar Phase Indicators', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:23:51Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('completion phase indicators', () => {
    it('should display FINAL REVIEW text for final_review status', () => {
      render(
        <HeaderBar
          {...createHeaderProps({
            mission: createMission({ status: 'final_review' }),
          })}
        />
      );

      expect(screen.getByText(/FINAL REVIEW/i)).toBeInTheDocument();
    });

    it('should display POST-CHECKS text for post_checks status', () => {
      render(
        <HeaderBar
          {...createHeaderProps({
            mission: createMission({ status: 'post_checks' }),
          })}
        />
      );

      expect(screen.getByText(/POST-CHECKS/i)).toBeInTheDocument();
    });

    it('should display DOCUMENTATION text for documentation status', () => {
      render(
        <HeaderBar
          {...createHeaderProps({
            mission: createMission({ status: 'documentation' }),
          })}
        />
      );

      expect(screen.getByText(/DOCUMENTATION/i)).toBeInTheDocument();
    });

    it('should display MISSION COMPLETE text for complete status', () => {
      render(
        <HeaderBar
          {...createHeaderProps({
            mission: createMission({ status: 'complete' }),
          })}
        />
      );

      expect(screen.getByText(/MISSION COMPLETE/i)).toBeInTheDocument();
    });
  });

  describe('timer behavior during completion', () => {
    it('should stop timer when mission is complete', () => {
      render(
        <HeaderBar
          {...createHeaderProps({
            mission: createMission({
              status: 'complete',
              completed_at: '2026-01-15T10:20:00Z',
            }),
          })}
        />
      );

      const timerDisplay = screen.getByTestId('timer-display');
      const initialTime = timerDisplay.textContent;

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // Timer should not advance after completion
      expect(timerDisplay.textContent).toBe(initialTime);
    });

    it('should show checkmark icon when mission is complete', () => {
      render(
        <HeaderBar
          {...createHeaderProps({
            mission: createMission({
              status: 'complete',
              completed_at: '2026-01-15T10:20:00Z',
            }),
          })}
        />
      );

      expect(screen.getByTestId('timer-complete-icon')).toBeInTheDocument();
    });

    it('should use duration_ms for final time display', () => {
      render(
        <HeaderBar
          {...createHeaderProps({
            mission: createMission({
              status: 'complete',
              started_at: '2026-01-15T10:00:00Z',
              completed_at: '2026-01-15T10:30:00Z',
              duration_ms: 1800000, // 30 minutes
            }),
          })}
        />
      );

      expect(screen.getByText('00:30:00')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Mission Completion Panel Tests
// ============================================================================

describe('Mission Completion Integration: Completion Panel', () => {
  describe('three-phase pipeline', () => {
    it('should render all three phases in correct order', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'final_review' })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      const phases = screen.getAllByTestId(/^phase-/);
      expect(phases).toHaveLength(3);
      expect(phases[0]).toHaveAttribute('data-testid', 'phase-final-review');
      expect(phases[1]).toHaveAttribute('data-testid', 'phase-post-checks');
      expect(phases[2]).toHaveAttribute('data-testid', 'phase-documentation');
    });

    it('should display pipeline connectors between phases', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'final_review' })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      const connectors = screen.getAllByTestId('pipeline-connector');
      expect(connectors).toHaveLength(2);
    });

    it('should show Final Review phase with Lynch as reviewer', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'final_review' })}
          finalReview={createFinalReviewStatus({ agent: 'Lynch' })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByTestId('agent-indicator-Lynch')).toBeInTheDocument();
      expect(screen.getByText(/Lynch/)).toBeInTheDocument();
    });

    it('should show Documentation phase with Tawnia as documenter', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'documentation' })}
          documentation={createDocumentationStatus({ agent: 'Tawnia' })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByTestId('agent-indicator-Tawnia')).toBeInTheDocument();
      expect(screen.getByText(/Tawnia/)).toBeInTheDocument();
    });
  });

  describe('phase status transitions', () => {
    it('should show pending -> active -> complete flow for Final Review', () => {
      const { rerender } = render(
        <MissionCompletionPanel
          mission={createMission({ status: 'final_review' })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      // Initially pending (no finalReview data)
      expect(screen.getByTestId('phase-final-review')).toHaveAttribute('data-status', 'pending');

      // Rerender with active review
      rerender(
        <MissionCompletionPanel
          mission={createMission({ status: 'final_review' })}
          finalReview={createFinalReviewStatus({ passed: false })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );
      expect(screen.getByTestId('phase-final-review')).toHaveAttribute('data-status', 'active');

      // Rerender with complete review
      rerender(
        <MissionCompletionPanel
          mission={createMission({ status: 'post_checks' })}
          finalReview={createFinalReviewStatus({
            passed: true,
            completed_at: '2026-01-15T14:25:03Z',
            verdict: 'APPROVED',
          })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );
      expect(screen.getByTestId('phase-final-review')).toHaveAttribute('data-status', 'complete');
    });

    it('should display APPROVED verdict when review passes', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'post_checks' })}
          finalReview={createFinalReviewStatus({
            passed: true,
            verdict: 'APPROVED',
          })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByText(/APPROVED/)).toBeInTheDocument();
    });

    it('should display REJECTED verdict when review fails', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'final_review' })}
          finalReview={createFinalReviewStatus({
            passed: false,
            verdict: 'REJECTED',
            rejections: 3,
            completed_at: '2026-01-15T14:25:03Z',
          })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByText(/REJECTED/)).toBeInTheDocument();
      expect(screen.getByTestId('rejection-count')).toHaveTextContent('3');
    });
  });

  describe('post-checks display', () => {
    it('should display all four checks (lint, typecheck, test, build)', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'post_checks' })}
          postChecks={createPostChecksStatus()}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByTestId('check-lint')).toBeInTheDocument();
      expect(screen.getByTestId('check-typecheck')).toBeInTheDocument();
      expect(screen.getByTestId('check-test')).toBeInTheDocument();
      expect(screen.getByTestId('check-build')).toBeInTheDocument();
    });

    it('should show correct icons for check states', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'post_checks' })}
          postChecks={createPostChecksStatus({
            results: {
              lint: createCheckResult({ status: 'passed' }),
              typecheck: createCheckResult({ status: 'running' }),
              test: createCheckResult({ status: 'failed' }),
              build: createCheckResult({ status: 'pending' }),
            },
          })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByTestId('check-lint').querySelector('[data-icon="check"]')).toBeInTheDocument();
      expect(screen.getByTestId('check-typecheck').querySelector('[data-icon="running"]')).toBeInTheDocument();
      expect(screen.getByTestId('check-test').querySelector('[data-icon="x"]')).toBeInTheDocument();
      expect(screen.getByTestId('check-build').querySelector('[data-icon="pending"]')).toBeInTheDocument();
    });

    it('should show failure card when checks fail', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'post_checks' })}
          postChecks={createPostChecksStatus({
            passed: false,
            completed_at: '2026-01-15T14:26:45Z',
            results: {
              lint: createCheckResult({ status: 'passed' }),
              typecheck: createCheckResult({ status: 'passed' }),
              test: createCheckResult({ status: 'failed' }),
              build: createCheckResult({ status: 'pending' }),
            },
          })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByTestId('failure-card')).toBeInTheDocument();
      expect(screen.getByTestId('failure-card')).toHaveTextContent(/test/i);
    });
  });

  describe('documentation phase', () => {
    it('should show COMMITTED status when documentation is complete', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'complete' })}
          documentation={createDocumentationStatus({
            completed: true,
            commit: 'a1b2c3d',
          })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByText(/COMMITTED/)).toBeInTheDocument();
    });

    it('should display list of modified files', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'complete' })}
          documentation={createDocumentationStatus({
            completed: true,
            files_modified: ['CHANGELOG.md', 'README.md'],
          })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByText('CHANGELOG.md')).toBeInTheDocument();
      expect(screen.getByText('README.md')).toBeInTheDocument();
    });

    it('should display commit hash in completion summary', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'complete' })}
          documentation={createDocumentationStatus({
            completed: true,
            commit: 'a1b2c3d',
          })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      const summaryCard = screen.getByTestId('completion-summary-card');
      expect(summaryCard).toHaveTextContent('a1b2c3d');
    });
  });

  describe('completion summary card', () => {
    it('should display MISSION COMPLETE when mission status is complete', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'complete' })}
          finalReview={createFinalReviewStatus({ passed: true })}
          postChecks={createPostChecksStatus({
            passed: true,
            results: {
              lint: createCheckResult({ status: 'passed' }),
              typecheck: createCheckResult({ status: 'passed' }),
              test: createCheckResult({ status: 'passed' }),
              build: createCheckResult({ status: 'passed' }),
            },
          })}
          documentation={createDocumentationStatus({
            completed: true,
            commit: 'abc123',
            summary: 'Updated docs',
          })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByTestId('completion-summary-card')).toBeInTheDocument();
      expect(screen.getByText(/MISSION COMPLETE/)).toBeInTheDocument();
    });

    it('should display checkmark icon in completion summary', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'complete' })}
          documentation={createDocumentationStatus({ completed: true })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      const summaryCard = screen.getByTestId('completion-summary-card');
      expect(summaryCard.querySelector('[data-icon="check-circle"]')).toBeInTheDocument();
    });
  });

  describe('tab integration', () => {
    it('should only show panel when completion tab is active', () => {
      const { rerender } = render(
        <MissionCompletionPanel
          mission={createMission({ status: 'final_review' })}
          activeTab="live-feed"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.queryByTestId('mission-completion-panel')).not.toBeInTheDocument();

      rerender(
        <MissionCompletionPanel
          mission={createMission({ status: 'final_review' })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByTestId('mission-completion-panel')).toBeInTheDocument();
    });

    it('should render Completion tab when in completion phase', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'final_review' })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByRole('tab', { name: /Completion/i })).toBeInTheDocument();
    });

    it('should not render Completion tab when mission is active', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'active' })}
          activeTab="live-feed"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.queryByRole('tab', { name: /Completion/i })).not.toBeInTheDocument();
    });
  });
});

// ============================================================================
// Live Feed Panel COMMITTED Highlighting Tests
// ============================================================================

describe('Mission Completion Integration: Activity Log COMMITTED Highlights', () => {
  describe('activity log parser', () => {
    it('should parse COMMITTED entries with highlightType', () => {
      const line = '2026-01-15T10:45:00Z [Tawnia] COMMITTED abc123f - feat: add user authentication';
      const result = parseLogEntry(line);

      expect(result).not.toBeNull();
      expect(result?.agent).toBe('Tawnia');
      expect(result?.highlightType).toBe('committed');
      expect(result?.message).toBe('COMMITTED abc123f - feat: add user authentication');
    });

    it('should parse APPROVED entries with highlightType', () => {
      const line = '2026-01-15T10:30:00Z [Lynch] APPROVED: All items passed review';
      const result = parseLogEntry(line);

      expect(result).not.toBeNull();
      expect(result?.highlightType).toBe('approved');
    });

    it('should parse REJECTED entries with highlightType', () => {
      const line = '2026-01-15T10:35:00Z [Lynch] REJECTED: Item 005 failed tests';
      const result = parseLogEntry(line);

      expect(result).not.toBeNull();
      expect(result?.highlightType).toBe('rejected');
    });

    it('should parse ALERT entries with highlightType', () => {
      const line = '2026-01-15T10:40:00Z [Hannibal] ALERT: Build pipeline failing';
      const result = parseLogEntry(line);

      expect(result).not.toBeNull();
      expect(result?.highlightType).toBe('alert');
    });

    it('should parse file with multiple highlight types', () => {
      const content = `2026-01-15T10:30:00Z [Lynch] APPROVED: Item passed
2026-01-15T10:35:00Z [Lynch] REJECTED: Item failed
2026-01-15T10:40:00Z [Hannibal] ALERT: Issue detected
2026-01-15T10:45:00Z [Tawnia] COMMITTED abc123 - fix: issue`;

      const entries = parseLogFile(content);

      expect(entries).toHaveLength(4);
      expect(entries[0].highlightType).toBe('approved');
      expect(entries[1].highlightType).toBe('rejected');
      expect(entries[2].highlightType).toBe('alert');
      expect(entries[3].highlightType).toBe('committed');
    });
  });
});

// ============================================================================
// Graceful Degradation Tests
// ============================================================================

describe('Mission Completion Integration: Graceful Degradation', () => {
  describe('missing completion fields in board.json', () => {
    it('should handle board metadata without finalReview field', () => {
      const board = createBoardMetadata({
        mission: createMission({ status: 'final_review' }),
        finalReview: undefined,
      });

      expect(() =>
        render(
          <MissionCompletionPanel
            mission={board.mission}
            finalReview={board.finalReview}
            activeTab="completion"
            onTabChange={vi.fn()}
          />
        )
      ).not.toThrow();

      expect(screen.getByTestId('phase-final-review')).toHaveAttribute('data-status', 'pending');
    });

    it('should handle board metadata without postChecks field', () => {
      const board = createBoardMetadata({
        mission: createMission({ status: 'post_checks' }),
        postChecks: undefined,
      });

      expect(() =>
        render(
          <MissionCompletionPanel
            mission={board.mission}
            postChecks={board.postChecks}
            activeTab="completion"
            onTabChange={vi.fn()}
          />
        )
      ).not.toThrow();

      expect(screen.getByTestId('phase-post-checks')).toHaveAttribute('data-status', 'pending');
    });

    it('should handle board metadata without documentation field', () => {
      const board = createBoardMetadata({
        mission: createMission({ status: 'documentation' }),
        documentation: undefined,
      });

      expect(() =>
        render(
          <MissionCompletionPanel
            mission={board.mission}
            documentation={board.documentation}
            activeTab="completion"
            onTabChange={vi.fn()}
          />
        )
      ).not.toThrow();

      expect(screen.getByTestId('phase-documentation')).toHaveAttribute('data-status', 'pending');
    });

    it('should handle all completion fields missing', () => {
      const board = createBoardMetadata({
        mission: createMission({ status: 'final_review' }),
        finalReview: undefined,
        postChecks: undefined,
        documentation: undefined,
      });

      expect(() =>
        render(
          <MissionCompletionPanel
            mission={board.mission}
            finalReview={board.finalReview}
            postChecks={board.postChecks}
            documentation={board.documentation}
            activeTab="completion"
            onTabChange={vi.fn()}
          />
        )
      ).not.toThrow();

      expect(screen.getByTestId('phase-final-review')).toHaveAttribute('data-status', 'pending');
      expect(screen.getByTestId('phase-post-checks')).toHaveAttribute('data-status', 'pending');
      expect(screen.getByTestId('phase-documentation')).toHaveAttribute('data-status', 'pending');
    });
  });

  describe('empty agent status handling', () => {
    it('should handle empty agents object', () => {
      expect(() => render(<AgentStatusBar agents={{}} />)).not.toThrow();

      // All agents should default to idle
      expect(screen.getByTestId('agent-status-Tawnia')).toHaveTextContent('IDLE');
      expect(screen.getByTestId('agent-status-Lynch')).toHaveTextContent('IDLE');
    });

    it('should handle undefined agents prop', () => {
      // @ts-expect-error - testing runtime behavior with undefined
      expect(() => render(<AgentStatusBar agents={undefined} />)).not.toThrow();

      // All agents should still be rendered
      expect(screen.getByText('Tawnia')).toBeInTheDocument();
    });
  });

  describe('partial data handling', () => {
    it('should handle documentation with missing optional fields', () => {
      const documentation = createDocumentationStatus({
        completed: true,
        files_modified: [],
        commit: undefined,
        summary: undefined,
      });

      expect(() =>
        render(
          <MissionCompletionPanel
            mission={createMission({ status: 'complete' })}
            documentation={documentation}
            activeTab="completion"
            onTabChange={vi.fn()}
          />
        )
      ).not.toThrow();

      expect(screen.getByText(/COMMITTED/)).toBeInTheDocument();
    });

    it('should handle postChecks with partial results', () => {
      render(
        <MissionCompletionPanel
          mission={createMission({ status: 'post_checks' })}
          postChecks={createPostChecksStatus({
            results: {
              lint: createCheckResult({ status: 'passed' }),
              typecheck: createCheckResult({ status: 'pending' }),
              test: createCheckResult({ status: 'pending' }),
              build: createCheckResult({ status: 'pending' }),
            },
          })}
          activeTab="completion"
          onTabChange={vi.fn()}
        />
      );

      expect(screen.getByTestId('check-lint')).toHaveAttribute('data-status', 'passed');
      expect(screen.getByTestId('check-typecheck')).toHaveAttribute('data-status', 'pending');
    });
  });
});
