import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrecheckFailureBanner } from '../components/PrecheckFailureBanner';
import type { Mission, MissionPrecheckOutput } from '../types/mission';

/**
 * Tests for PrecheckFailureBanner component (WI-455, updated WI-458)
 *
 * The banner renders between ConnectionStatusIndicator and DashboardNav
 * when mission.state === 'precheck_failure'. Data comes from the /api/board
 * endpoint where precheckBlockers and precheckOutput are ALREADY PARSED
 * into typed objects — NOT raw JSON strings.
 *
 * The component must use these values directly without calling JSON.parse().
 */

// Factory for a mission object matching the actual Mission type from types/mission.ts
// precheckBlockers is string[] | null (NOT a JSON string)
// precheckOutput is MissionPrecheckOutput | null (NOT a JSON string)
function createMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'M-20260122-001',
    name: 'Test Mission',
    state: 'precheck_failure',
    prdPath: '/prd/test.md',
    startedAt: new Date('2026-01-22T10:00:00Z'),
    completedAt: null,
    archivedAt: null,
    precheckBlockers: ['lint: 3 errors in src/foo.ts', 'test suite failing'],
    precheckOutput: {
      lint: { stdout: 'error: bad code at line 10', stderr: '', timedOut: false },
    } satisfies MissionPrecheckOutput,
    ...overrides,
  };
}

// ============ Conditional Rendering ============

describe('PrecheckFailureBanner conditional rendering', () => {
  it('should NOT render when mission state is running', () => {
    const { container } = render(
      <PrecheckFailureBanner mission={createMission({ state: 'running' })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('should NOT render when mission state is initializing', () => {
    const { container } = render(
      <PrecheckFailureBanner mission={createMission({ state: 'initializing' })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('should NOT render when mission state is completed', () => {
    const { container } = render(
      <PrecheckFailureBanner mission={createMission({ state: 'completed' })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('should NOT render when mission state is postchecking', () => {
    const { container } = render(
      <PrecheckFailureBanner mission={createMission({ state: 'postchecking' })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('should NOT render when mission is null', () => {
    const { container } = render(
      <PrecheckFailureBanner mission={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('should render when mission state is precheck_failure', () => {
    render(<PrecheckFailureBanner mission={createMission()} />);
    expect(screen.getByTestId('precheck-failure-banner')).toBeInTheDocument();
  });
});

// ============ Amber Styling ============

describe('PrecheckFailureBanner amber styling', () => {
  it('should have amber left border styling', () => {
    render(<PrecheckFailureBanner mission={createMission()} />);
    const banner = screen.getByTestId('precheck-failure-banner');
    expect(banner).toHaveClass('border-l-4');
    expect(banner).toHaveClass('border-amber-500');
  });
});

// ============ Label ============

describe('PrecheckFailureBanner label text', () => {
  it('should show PRECHECK FAILED label', () => {
    render(<PrecheckFailureBanner mission={createMission()} />);
    expect(screen.getByText(/PRECHECK FAILED/i)).toBeInTheDocument();
  });

  it('should show RECOVERABLE label', () => {
    render(<PrecheckFailureBanner mission={createMission()} />);
    expect(screen.getByText(/RECOVERABLE/i)).toBeInTheDocument();
  });
});

// ============ Blockers List ============

describe('PrecheckFailureBanner blocker list', () => {
  it('should display blockers from pre-parsed array', () => {
    // precheckBlockers is already string[] — no JSON.parse needed
    render(<PrecheckFailureBanner mission={createMission()} />);
    expect(screen.getByText('lint: 3 errors in src/foo.ts')).toBeInTheDocument();
    expect(screen.getByText('test suite failing')).toBeInTheDocument();
  });

  it('should display multiple blockers', () => {
    const mission = createMission({
      precheckBlockers: [
        'blocker one',
        'blocker two',
        'blocker three',
      ],
    });
    render(<PrecheckFailureBanner mission={mission} />);
    expect(screen.getByText('blocker one')).toBeInTheDocument();
    expect(screen.getByText('blocker two')).toBeInTheDocument();
    expect(screen.getByText('blocker three')).toBeInTheDocument();
  });

  it('should handle null precheckBlockers gracefully (empty array fallback)', () => {
    const mission = createMission({ precheckBlockers: null });
    render(<PrecheckFailureBanner mission={mission} />);
    // Banner should still render, just no blocker items
    expect(screen.getByTestId('precheck-failure-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('precheck-blocker-item')).not.toBeInTheDocument();
  });

  it('should handle empty blockers array', () => {
    const mission = createMission({ precheckBlockers: [] });
    render(<PrecheckFailureBanner mission={mission} />);
    expect(screen.getByTestId('precheck-failure-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('precheck-blocker-item')).not.toBeInTheDocument();
  });

  it('should render blocker items with test ids', () => {
    render(<PrecheckFailureBanner mission={createMission()} />);
    const blockerItems = screen.getAllByTestId('precheck-blocker-item');
    expect(blockerItems).toHaveLength(2);
  });
});

// ============ Raw Output ============

describe('PrecheckFailureBanner raw output', () => {
  it('should show expandable raw output section', () => {
    render(<PrecheckFailureBanner mission={createMission()} />);
    expect(screen.getByTestId('precheck-raw-output')).toBeInTheDocument();
  });

  it('should display content from pre-parsed precheckOutput object', () => {
    // precheckOutput is already MissionPrecheckOutput — no JSON.parse needed
    render(<PrecheckFailureBanner mission={createMission()} />);
    const rawOutput = screen.getByTestId('precheck-raw-output');
    expect(rawOutput.textContent).toContain('error: bad code at line 10');
  });

  it('should display tests output when provided', () => {
    const mission = createMission({
      precheckOutput: {
        lint: { stdout: 'lint passed', stderr: '', timedOut: false },
        tests: { stdout: 'FAIL src/foo.test.ts\n  expected true to be false', stderr: '', timedOut: false },
      },
    });
    render(<PrecheckFailureBanner mission={mission} />);
    const rawOutput = screen.getByTestId('precheck-raw-output');
    expect(rawOutput.textContent).toContain('FAIL src/foo.test.ts');
  });

  it('should handle null precheckOutput gracefully', () => {
    const mission = createMission({ precheckOutput: null });
    render(<PrecheckFailureBanner mission={mission} />);
    // Banner still renders without crashing
    expect(screen.getByTestId('precheck-failure-banner')).toBeInTheDocument();
  });

  it('should show fallback text when precheckOutput is an empty object {}', () => {
    const mission = createMission({ precheckOutput: {} });
    render(<PrecheckFailureBanner mission={mission} />);
    const rawOutput = screen.getByTestId('precheck-raw-output');
    expect(rawOutput.textContent).toContain('(no output captured)');
  });

  it('should separate stdout and stderr with a newline when both are non-empty', () => {
    const mission = createMission({
      precheckOutput: {
        lint: { stdout: 'stdout content', stderr: 'stderr content', timedOut: false },
      },
    });
    render(<PrecheckFailureBanner mission={mission} />);
    const rawOutput = screen.getByTestId('precheck-raw-output');
    // Both should be present, and stdout should NOT run directly into stderr
    expect(rawOutput.textContent).toContain('stdout content');
    expect(rawOutput.textContent).toContain('stderr content');
    // The newline separator means they are not directly concatenated
    expect(rawOutput.textContent).not.toContain('stdout contentstderr content');
  });
});

// ============ Retry Instructions ============

describe('PrecheckFailureBanner retry instructions', () => {
  it('should show Re-run instructional text', () => {
    render(<PrecheckFailureBanner mission={createMission()} />);
    expect(screen.getByText(/Re-run \/ai-team:run to retry/i)).toBeInTheDocument();
  });

  it('should NOT have a button that makes a POST call (instructions only)', () => {
    render(<PrecheckFailureBanner mission={createMission()} />);
    // The retry text is instructional, not an interactive POST button
    const retryText = screen.getByTestId('precheck-retry-instruction');
    expect(retryText).toBeInTheDocument();
    // Should be a non-interactive element (not a <button>)
    expect(retryText.tagName).not.toBe('BUTTON');
  });
});
