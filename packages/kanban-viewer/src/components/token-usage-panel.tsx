import * as React from "react";
import type { MissionTokenUsageData } from "@/types";
import { formatTokenCount, formatCostUsd } from "@/lib/format-tokens";

// Re-export so existing imports from this module continue to work.
export { formatTokenCount, formatCostUsd } from "@/lib/format-tokens";

// ============================================================================
// Component types
// ============================================================================

export interface TokenUsagePanelProps {
  agents: MissionTokenUsageData[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    estimatedCostUsd: number;
  };
}

type ViewMode = 'rollup' | 'per-model';

interface RollupEntry {
  agentName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
  distinctModels: string[];
}

interface ModelTotal {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

// ============================================================================
// Data derivation helpers
// ============================================================================

function buildRollup(agents: MissionTokenUsageData[]): RollupEntry[] {
  const map = new Map<string, RollupEntry>();
  for (const row of agents) {
    const existing = map.get(row.agentName);
    if (existing) {
      existing.inputTokens += row.inputTokens;
      existing.outputTokens += row.outputTokens;
      existing.cacheCreationTokens += row.cacheCreationTokens;
      existing.cacheReadTokens += row.cacheReadTokens;
      existing.estimatedCostUsd += row.estimatedCostUsd;
      if (!existing.distinctModels.includes(row.model)) {
        existing.distinctModels.push(row.model);
      }
    } else {
      map.set(row.agentName, {
        agentName: row.agentName,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheCreationTokens: row.cacheCreationTokens,
        cacheReadTokens: row.cacheReadTokens,
        estimatedCostUsd: row.estimatedCostUsd,
        distinctModels: [row.model],
      });
    }
  }
  return Array.from(map.values());
}

function buildModelTotals(agents: MissionTokenUsageData[]): ModelTotal[] {
  const map = new Map<string, ModelTotal>();
  for (const row of agents) {
    const existing = map.get(row.model);
    if (existing) {
      existing.inputTokens += row.inputTokens;
      existing.outputTokens += row.outputTokens;
      existing.cacheCreationTokens += row.cacheCreationTokens;
      existing.cacheReadTokens += row.cacheReadTokens;
      existing.estimatedCostUsd += row.estimatedCostUsd;
    } else {
      map.set(row.model, {
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheCreationTokens: row.cacheCreationTokens,
        cacheReadTokens: row.cacheReadTokens,
        estimatedCostUsd: row.estimatedCostUsd,
      });
    }
  }
  return Array.from(map.values());
}

// ============================================================================
// Sub-components
// ============================================================================

function EmptyState() {
  return (
    <div data-testid="token-usage-empty" className="text-center text-gray-400 py-8">
      No token data available
    </div>
  );
}

function CostBar({ widthPercent }: { widthPercent: number }) {
  return (
    <div className="w-full bg-gray-700 rounded-full h-1.5 mt-1">
      <div
        data-testid="token-usage-cost-bar"
        data-width={String(widthPercent)}
        className="bg-blue-500 h-1.5 rounded-full"
        style={{ width: `${widthPercent}%` }}
      />
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function TokenUsagePanel({ agents, totals }: TokenUsagePanelProps) {
  const [viewMode, setViewMode] = React.useState<ViewMode>('rollup');

  if (agents.length === 0) {
    return <EmptyState />;
  }

  const isPerModel = viewMode === 'per-model';
  const rollup = buildRollup(agents);
  const modelTotals = buildModelTotals(agents);

  const sortedRollup = [...rollup].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
  const maxRollupCost = sortedRollup[0]?.estimatedCostUsd ?? 0;

  const sortedPerModel = [...agents].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
  const maxPerModelCost = sortedPerModel[0]?.estimatedCostUsd ?? 0;

  function barWidthRollup(cost: number): number {
    if (maxRollupCost === 0) return 0;
    return Math.round((cost / maxRollupCost) * 100);
  }

  function barWidthPerModel(cost: number): number {
    if (maxPerModelCost === 0) return 0;
    return Math.round((cost / maxPerModelCost) * 100);
  }

  return (
    <div className="p-4">
      {/* Total cost summary */}
      <div className="mb-4">
        <span className="text-gray-400 text-sm mr-2">Total mission cost:</span>
        <span
          data-testid="token-usage-total-cost"
          className="text-white font-bold text-lg"
        >
          {formatCostUsd(totals.estimatedCostUsd)}
        </span>
      </div>

      {/* View toggle */}
      <div className="mb-4">
        <button
          data-testid="token-usage-view-toggle"
          aria-pressed={isPerModel ? 'true' : 'false'}
          aria-label={isPerModel ? 'Show per-agent rollup' : 'Show per-model breakdown'}
          onClick={() => setViewMode(isPerModel ? 'rollup' : 'per-model')}
          className="text-sm text-blue-400 hover:text-blue-300 border border-blue-400 rounded px-2 py-1"
        >
          {isPerModel ? 'Show per-agent rollup' : 'Show per-model breakdown'}
        </button>
      </div>

      {/* Breakdown table */}
      <table data-testid="token-usage-table" className="w-full text-white text-sm">
        <thead>
          <tr className="text-gray-400 border-b border-gray-700">
            <th className="text-left pb-2 pr-4">Agent</th>
            <th className="text-left pb-2 pr-4">Model</th>
            <th className="text-right pb-2 pr-4">Input</th>
            <th className="text-right pb-2 pr-4">Output</th>
            <th className="text-right pb-2 pr-4">Cache Write</th>
            <th className="text-right pb-2 pr-4">Cache Read</th>
            <th className="text-right pb-2">Cost</th>
          </tr>
        </thead>
        <tbody>
          {isPerModel ? (
            <>
              {sortedPerModel.map((agent, index) => (
                <tr key={`${agent.agentName}-${agent.model}-${index}`} data-testid="token-usage-agent-row">
                  <td className="py-2 pr-4 font-medium">{agent.agentName}</td>
                  <td className="py-2 pr-4 text-gray-400 text-sm">{agent.model}</td>
                  <td className="py-2 pr-4 text-right text-sm">{formatTokenCount(agent.inputTokens)}</td>
                  <td className="py-2 pr-4 text-right text-sm">{formatTokenCount(agent.outputTokens)}</td>
                  <td className="py-2 pr-4 text-right text-sm">{formatTokenCount(agent.cacheCreationTokens)}</td>
                  <td className="py-2 pr-4 text-right text-sm">{formatTokenCount(agent.cacheReadTokens)}</td>
                  <td className="py-2 min-w-[120px]">
                    <div className="text-right text-sm font-medium">{formatCostUsd(agent.estimatedCostUsd)}</div>
                    <CostBar widthPercent={barWidthPerModel(agent.estimatedCostUsd)} />
                  </td>
                </tr>
              ))}
              {modelTotals.map((mt) => (
                <tr key={`model-total-${mt.model}`} data-testid="token-usage-model-total-row">
                  <td className="py-2 pr-4 font-bold text-gray-300">Total</td>
                  <td className="py-2 pr-4 text-gray-300 font-bold text-sm">{mt.model}</td>
                  <td className="py-2 pr-4 text-right text-sm">{formatTokenCount(mt.inputTokens)}</td>
                  <td className="py-2 pr-4 text-right text-sm">{formatTokenCount(mt.outputTokens)}</td>
                  <td className="py-2 pr-4 text-right text-sm">{formatTokenCount(mt.cacheCreationTokens)}</td>
                  <td className="py-2 pr-4 text-right text-sm">{formatTokenCount(mt.cacheReadTokens)}</td>
                  <td className="py-2 min-w-[120px]">
                    <div className="text-right text-sm font-bold">{formatCostUsd(mt.estimatedCostUsd)}</div>
                  </td>
                </tr>
              ))}
            </>
          ) : (
            sortedRollup.map((entry, index) => (
              <tr key={`${entry.agentName}-${index}`} data-testid="token-usage-agent-row">
                <td className="py-2 pr-4 font-medium">
                  {entry.agentName}
                  {entry.distinctModels.length > 1 && (
                    <span
                      data-testid="token-usage-drift-badge"
                      aria-label={`spans ${entry.distinctModels.length} models`}
                      className="ml-2 text-xs text-yellow-400 border border-yellow-400 rounded px-1"
                    >
                      spans {entry.distinctModels.length} models
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 text-gray-400 text-sm">
                  {entry.distinctModels.length === 1 ? entry.distinctModels[0] : ''}
                </td>
                <td className="py-2 pr-4 text-right text-sm">{formatTokenCount(entry.inputTokens)}</td>
                <td className="py-2 pr-4 text-right text-sm">{formatTokenCount(entry.outputTokens)}</td>
                <td className="py-2 pr-4 text-right text-sm">{formatTokenCount(entry.cacheCreationTokens)}</td>
                <td className="py-2 pr-4 text-right text-sm">{formatTokenCount(entry.cacheReadTokens)}</td>
                <td className="py-2 min-w-[120px]">
                  <div className="text-right text-sm font-medium">{formatCostUsd(entry.estimatedCostUsd)}</div>
                  <CostBar widthPercent={barWidthRollup(entry.estimatedCostUsd)} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
