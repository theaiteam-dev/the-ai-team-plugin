import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MissionTokenUsageData } from '@/types';
import {
  TokenUsagePanel,
  formatTokenCount,
  formatCostUsd,
} from '../components/token-usage-panel';

// Factory: build a single agent token usage entry
function createAgentUsage(overrides: Partial<MissionTokenUsageData> = {}): MissionTokenUsageData {
  return {
    agentName: 'Murdock',
    model: 'claude-sonnet-4-6',
    inputTokens: 10000,
    outputTokens: 2000,
    cacheCreationTokens: 500,
    cacheReadTokens: 300,
    estimatedCostUsd: 0.15,
    ...overrides,
  };
}

// Factory: build the full agents + totals payload
function createTokenUsageProps(
  agents: MissionTokenUsageData[] = [createAgentUsage()],
) {
  const totals = {
    inputTokens: agents.reduce((s, a) => s + a.inputTokens, 0),
    outputTokens: agents.reduce((s, a) => s + a.outputTokens, 0),
    cacheCreationTokens: agents.reduce((s, a) => s + a.cacheCreationTokens, 0),
    cacheReadTokens: agents.reduce((s, a) => s + a.cacheReadTokens, 0),
    estimatedCostUsd: agents.reduce((s, a) => s + a.estimatedCostUsd, 0),
  };
  return { agents, totals };
}

// ============================================================================
// 1. Renders total cost and agent table sorted by cost descending
// ============================================================================

describe('TokenUsagePanel', () => {
  describe('renders total cost and agent breakdown table', () => {
    it('should display the total mission cost prominently', () => {
      const props = createTokenUsageProps([
        createAgentUsage({ agentName: 'B.A.', estimatedCostUsd: 1.23 }),
        createAgentUsage({ agentName: 'Murdock', estimatedCostUsd: 1.24 }),
      ]);
      render(<TokenUsagePanel {...props} />);

      // Total = 1.23 + 1.24 = 2.47
      expect(screen.getByTestId('token-usage-total-cost')).toHaveTextContent('$2.47');
    });

    it('should render a row for each agent in the breakdown table', () => {
      const props = createTokenUsageProps([
        createAgentUsage({ agentName: 'Hannibal', estimatedCostUsd: 0.50 }),
        createAgentUsage({ agentName: 'Face', estimatedCostUsd: 0.30 }),
        createAgentUsage({ agentName: 'Murdock', estimatedCostUsd: 0.20 }),
      ]);
      render(<TokenUsagePanel {...props} />);

      expect(screen.getByText('Hannibal')).toBeInTheDocument();
      expect(screen.getByText('Face')).toBeInTheDocument();
      expect(screen.getByText('Murdock')).toBeInTheDocument();
    });

    it('should sort agent rows by cost descending', () => {
      const props = createTokenUsageProps([
        createAgentUsage({ agentName: 'Cheap', estimatedCostUsd: 0.10 }),
        createAgentUsage({ agentName: 'Expensive', estimatedCostUsd: 5.00 }),
        createAgentUsage({ agentName: 'Mid', estimatedCostUsd: 1.50 }),
      ]);
      render(<TokenUsagePanel {...props} />);

      const rows = screen.getAllByTestId('token-usage-agent-row');
      expect(rows[0]).toHaveTextContent('Expensive');
      expect(rows[1]).toHaveTextContent('Mid');
      expect(rows[2]).toHaveTextContent('Cheap');
    });
  });

  // ============================================================================
  // 2. Empty state
  // ============================================================================

  describe('empty state', () => {
    it('should show "No token data available" when agents array is empty', () => {
      const props = createTokenUsageProps([]);
      render(<TokenUsagePanel {...props} />);

      expect(screen.getByTestId('token-usage-empty')).toBeInTheDocument();
      expect(screen.getByTestId('token-usage-empty')).toHaveTextContent(/No token data available/i);
    });

    it('should not render the breakdown table when agents array is empty', () => {
      const props = createTokenUsageProps([]);
      render(<TokenUsagePanel {...props} />);

      expect(screen.queryByTestId('token-usage-table')).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // 3. formatTokenCount utility
  // ============================================================================

  describe('formatTokenCount', () => {
    it('should return "0" for zero tokens', () => {
      expect(formatTokenCount(0)).toBe('0');
    });

    it('should return the raw number as string for values below 1000', () => {
      expect(formatTokenCount(999)).toBe('999');
    });

    it('should format 1000 as "1.0K"', () => {
      expect(formatTokenCount(1000)).toBe('1.0K');
    });

    it('should format 45230 as "45.2K"', () => {
      expect(formatTokenCount(45230)).toBe('45.2K');
    });

    it('should format 1200000 as "1.2M"', () => {
      expect(formatTokenCount(1200000)).toBe('1.2M');
    });
  });

  // ============================================================================
  // 4. formatCostUsd utility — costs display with 2 decimal places
  // ============================================================================

  describe('formatCostUsd', () => {
    it('should format a cost to exactly 2 decimal places', () => {
      expect(formatCostUsd(2.47)).toBe('$2.47');
    });

    it('should pad a whole dollar value to 2 decimal places', () => {
      expect(formatCostUsd(3)).toBe('$3.00');
    });

    it('should format zero cost as "$0.00"', () => {
      expect(formatCostUsd(0)).toBe('$0.00');
    });

    it('should display agent cost values with 2 decimal places in the table', () => {
      const props = createTokenUsageProps([
        createAgentUsage({ agentName: 'Murdock', estimatedCostUsd: 0.5 }),
      ]);
      render(<TokenUsagePanel {...props} />);

      // The cell should display "$0.50" not "$0.5"
      const row = screen.getByTestId('token-usage-agent-row');
      expect(row).toHaveTextContent('$0.50');
    });
  });

  // ============================================================================
  // 5. Proportional bars render with widths relative to the highest-cost agent
  // ============================================================================

  describe('proportional cost bars', () => {
    it('should render a proportional bar for each agent', () => {
      const props = createTokenUsageProps([
        createAgentUsage({ agentName: 'A', estimatedCostUsd: 1.00 }),
        createAgentUsage({ agentName: 'B', estimatedCostUsd: 0.50 }),
      ]);
      render(<TokenUsagePanel {...props} />);

      const bars = screen.getAllByTestId('token-usage-cost-bar');
      expect(bars).toHaveLength(2);
    });

    it('should give the highest-cost agent a bar width of 100%', () => {
      const props = createTokenUsageProps([
        createAgentUsage({ agentName: 'Top', estimatedCostUsd: 4.00 }),
        createAgentUsage({ agentName: 'Low', estimatedCostUsd: 1.00 }),
      ]);
      render(<TokenUsagePanel {...props} />);

      // Rows sorted descending — first bar is the most expensive agent
      const bars = screen.getAllByTestId('token-usage-cost-bar');
      expect(bars[0]).toHaveAttribute('data-width', '100');
    });

    it('should give a half-cost agent a bar width of 50%', () => {
      const props = createTokenUsageProps([
        createAgentUsage({ agentName: 'Top', estimatedCostUsd: 4.00 }),
        createAgentUsage({ agentName: 'Half', estimatedCostUsd: 2.00 }),
      ]);
      render(<TokenUsagePanel {...props} />);

      const bars = screen.getAllByTestId('token-usage-cost-bar');
      expect(bars[1]).toHaveAttribute('data-width', '50');
    });
  });
});
