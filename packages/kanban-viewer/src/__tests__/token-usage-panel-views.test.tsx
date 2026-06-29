import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import type { MissionTokenUsageData } from '@/types';
import { TokenUsagePanel } from '../components/token-usage-panel';

/**
 * Tests for the TokenUsagePanel per-agent rollup + per-model views (WI-174).
 *
 * After WI-173, `agents` arrives as per-(agent,model) rows (one row per
 * baseAgent+model). This panel derives two views over that data:
 *
 *  - Per-agent ROLLUP (default): one row per base agent, tokens and cost summed
 *    across that agent's models. An agent spanning >1 model shows a model-drift
 *    badge; a single-model agent shows none. The rollup must NOT double-count a
 *    drifting agent — its rollup cost equals the sum of its per-model rows.
 *
 *  - Per-MODEL view (toggled): one row per (agent, model) PLUS a mission-wide
 *    total row per model.
 *
 * The mission total cost is identical in both views and equals the sum of every
 * per-(agent,model) row.
 *
 * a11y contract pinned for this item (AC allows aria-pressed OR role=tab; we pin
 * a single toggle <button> with aria-pressed):
 *  - The view toggle is a native <button> (keyboard-focusable + Enter/Space
 *    activatable by the platform) whose accessible name describes the target
 *    view it switches TO ("Show per-model breakdown" / "Show per-agent rollup").
 *  - aria-pressed exposes the current state (false in rollup, true in per-model).
 *  - The drift badge has a textual accessible name ("spans N models"), not color
 *    alone — asserted via toHaveAccessibleName.
 *
 * data-testid hooks the impl must keep:
 *  - token-usage-total-cost      (existing) mission total cost
 *  - token-usage-agent-row       (existing) one per visible agent/(agent,model) row
 *  - token-usage-view-toggle     (new)      the view switch control
 *  - token-usage-drift-badge     (new)      drift indicator inside a rollup row
 *  - token-usage-model-total-row (new)      per-model mission-wide total row
 */

const OPUS = 'claude-opus-4-6';
const SONNET = 'claude-sonnet-4-6';

function agentUsage(overrides: Partial<MissionTokenUsageData> = {}): MissionTokenUsageData {
  return {
    agentName: 'murdock',
    model: SONNET,
    inputTokens: 1000,
    outputTokens: 200,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    estimatedCostUsd: 0.5,
    ...overrides,
  };
}

function propsFor(agents: MissionTokenUsageData[]) {
  const totals = {
    inputTokens: agents.reduce((s, a) => s + a.inputTokens, 0),
    outputTokens: agents.reduce((s, a) => s + a.outputTokens, 0),
    cacheCreationTokens: agents.reduce((s, a) => s + a.cacheCreationTokens, 0),
    cacheReadTokens: agents.reduce((s, a) => s + a.cacheReadTokens, 0),
    estimatedCostUsd: agents.reduce((s, a) => s + a.estimatedCostUsd, 0),
  };
  return { agents, totals };
}

/**
 * Canonical fixture: hannibal drifts across opus + sonnet; murdock is single-model.
 *
 *   hannibal/opus    : in 5000  out 1000  cacheRead 8000  cost $2.00
 *   hannibal/sonnet  : in 1000  out  200  cacheRead 2000  cost $0.50
 *   murdock /sonnet  : in 4000  out  900  cacheRead 5000  cost $1.00
 *
 *   rollup hannibal  : in 6000  out 1200  cacheRead 10000 cost $2.50  (drift, 2 models)
 *   rollup murdock   : in 4000  out  900  cacheRead 5000  cost $1.00  (single model)
 *   per-model opus   : in 5000  out 1000  cacheRead 8000  cost $2.00
 *   per-model sonnet : in 5000  out 1100  cacheRead 7000  cost $1.50
 *   mission total                                          cost $3.50
 */
function driftFixture() {
  return propsFor([
    agentUsage({ agentName: 'hannibal', model: OPUS, inputTokens: 5000, outputTokens: 1000, cacheCreationTokens: 2000, cacheReadTokens: 8000, estimatedCostUsd: 2.0 }),
    agentUsage({ agentName: 'hannibal', model: SONNET, inputTokens: 1000, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 2000, estimatedCostUsd: 0.5 }),
    agentUsage({ agentName: 'murdock', model: SONNET, inputTokens: 4000, outputTokens: 900, cacheCreationTokens: 0, cacheReadTokens: 5000, estimatedCostUsd: 1.0 }),
  ]);
}

/** Find a rendered row (by testid) whose text content matches all needles. */
function findRow(testid: string, ...needles: string[]): HTMLElement {
  const rows = screen.getAllByTestId(testid);
  const match = rows.find((r) => needles.every((n) => r.textContent?.includes(n)));
  if (!match) {
    throw new Error(`No "${testid}" row containing all of: ${needles.join(', ')}`);
  }
  return match;
}

function getToggle(): HTMLElement {
  return screen.getByTestId('token-usage-view-toggle');
}

describe('TokenUsagePanel - per-agent rollup (default view)', () => {
  it('shows one row per base agent with tokens and cost summed across that agent\'s models', () => {
    render(<TokenUsagePanel {...driftFixture()} />);

    // Two base agents in the rollup, not three per-(agent,model) rows.
    expect(screen.getAllByTestId('token-usage-agent-row')).toHaveLength(2);

    const hannibal = findRow('token-usage-agent-row', 'hannibal');
    // Summed across opus + sonnet: in 6000, out 1200, cacheRead 10000, cost $2.50
    expect(hannibal).toHaveTextContent('6.0K');   // input 5000 + 1000
    expect(hannibal).toHaveTextContent('1.2K');   // output 1000 + 200
    expect(hannibal).toHaveTextContent('10.0K');  // cacheRead 8000 + 2000
    expect(hannibal).toHaveTextContent('$2.50');  // cost 2.00 + 0.50

    const murdock = findRow('token-usage-agent-row', 'murdock');
    expect(murdock).toHaveTextContent('4.0K');
    expect(murdock).toHaveTextContent('$1.00');
  });

  it('does not double-count a drifting agent: rollup cost equals the sum of its per-model costs', () => {
    render(<TokenUsagePanel {...driftFixture()} />);

    const hannibal = findRow('token-usage-agent-row', 'hannibal');
    // 2.00 (opus) + 0.50 (sonnet) = 2.50 — NOT 4.50 (would be a double-count)
    expect(hannibal).toHaveTextContent('$2.50');
    expect(hannibal).not.toHaveTextContent('$4.50');

    // Mission total equals the sum of all per-(agent,model) rows.
    expect(screen.getByTestId('token-usage-total-cost')).toHaveTextContent('$3.50');
  });
});

describe('TokenUsagePanel - model-drift badge', () => {
  it('renders an accessible drift badge for an agent spanning >1 model', () => {
    render(<TokenUsagePanel {...driftFixture()} />);

    const hannibal = findRow('token-usage-agent-row', 'hannibal');
    const badge = within(hannibal).getByTestId('token-usage-drift-badge');
    // Accessible name conveys drift textually (not color alone).
    expect(badge).toHaveAccessibleName(/spans 2 models/i);
  });

  it('renders NO drift badge for a single-model agent', () => {
    render(<TokenUsagePanel {...driftFixture()} />);

    const murdock = findRow('token-usage-agent-row', 'murdock');
    expect(within(murdock).queryByTestId('token-usage-drift-badge')).not.toBeInTheDocument();
  });
});

describe('TokenUsagePanel - per-model view (after toggle)', () => {
  it('shows one row per (agent, model) plus a mission-wide total row per model', () => {
    render(<TokenUsagePanel {...driftFixture()} />);

    fireEvent.click(getToggle());

    // Three per-(agent,model) rows.
    expect(screen.getAllByTestId('token-usage-agent-row')).toHaveLength(3);

    // Each per-(agent,model) row shows that message-group's own unsummed values.
    const hannibalOpus = findRow('token-usage-agent-row', 'hannibal', OPUS);
    expect(hannibalOpus).toHaveTextContent('5.0K');  // input 5000
    expect(hannibalOpus).toHaveTextContent('$2.00');

    const hannibalSonnet = findRow('token-usage-agent-row', 'hannibal', SONNET);
    expect(hannibalSonnet).toHaveTextContent('$0.50');

    const murdockSonnet = findRow('token-usage-agent-row', 'murdock', SONNET);
    expect(murdockSonnet).toHaveTextContent('$1.00');

    // One mission-wide total row per distinct model (opus, sonnet).
    expect(screen.getAllByTestId('token-usage-model-total-row')).toHaveLength(2);

    const opusTotal = findRow('token-usage-model-total-row', OPUS);
    expect(opusTotal).toHaveTextContent('$2.00');  // only hannibal/opus
    expect(opusTotal).toHaveTextContent('5.0K');   // input 5000

    const sonnetTotal = findRow('token-usage-model-total-row', SONNET);
    expect(sonnetTotal).toHaveTextContent('$1.50'); // 0.50 + 1.00
    expect(sonnetTotal).toHaveTextContent('1.1K');  // output 200 + 900
    expect(sonnetTotal).toHaveTextContent('7.0K');  // cacheRead 2000 + 5000
  });

  it('keeps the mission total cost identical to the rollup view', () => {
    render(<TokenUsagePanel {...driftFixture()} />);

    const before = screen.getByTestId('token-usage-total-cost').textContent;
    expect(before).toContain('$3.50');

    fireEvent.click(getToggle());

    const after = screen.getByTestId('token-usage-total-cost').textContent;
    expect(after).toBe(before);
  });
});

describe('TokenUsagePanel - view toggle accessibility', () => {
  it('is a native button, keyboard-focusable, whose accessible name describes the target view', () => {
    render(<TokenUsagePanel {...driftFixture()} />);

    // Queried by role+name: proves it is a button exposing the target-view name.
    const toggle = screen.getByRole('button', { name: /show per-model breakdown/i });
    // Native <button> ⇒ Enter/Space activation is provided by the platform.
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).not.toBeDisabled();

    // Reachable/operable by keyboard: it can hold focus (Tab target).
    toggle.focus();
    expect(toggle).toHaveFocus();
  });

  it('exposes the current view state via aria-pressed and flips it on activation', () => {
    render(<TokenUsagePanel {...driftFixture()} />);

    const toggle = getToggle();
    // Rollup is the default view.
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAccessibleName(/show per-model breakdown/i);

    fireEvent.click(toggle);

    // Now in per-model view: state + label both reflect the switch.
    expect(getToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(getToggle()).toHaveAccessibleName(/show per-agent rollup/i);
  });

  it('toggles back to the rollup view on a second activation', () => {
    render(<TokenUsagePanel {...driftFixture()} />);

    fireEvent.click(getToggle()); // → per-model
    expect(screen.getAllByTestId('token-usage-agent-row')).toHaveLength(3);

    fireEvent.click(getToggle()); // → rollup
    expect(screen.getAllByTestId('token-usage-agent-row')).toHaveLength(2);
    expect(getToggle()).toHaveAttribute('aria-pressed', 'false');
    // Drift badge is back in the consolidated hannibal row.
    const hannibal = findRow('token-usage-agent-row', 'hannibal');
    expect(within(hannibal).getByTestId('token-usage-drift-badge')).toHaveAccessibleName(/spans 2 models/i);
  });
});

describe('TokenUsagePanel - empty state', () => {
  it('renders the empty state and no view toggle when agents is empty (no toggle errors)', () => {
    render(<TokenUsagePanel {...propsFor([])} />);

    expect(screen.getByTestId('token-usage-empty')).toHaveTextContent(/no token data available/i);
    // No view toggle to operate, and querying for it does not throw.
    expect(screen.queryByTestId('token-usage-view-toggle')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /per-model|per-agent/i })).not.toBeInTheDocument();
  });
});
