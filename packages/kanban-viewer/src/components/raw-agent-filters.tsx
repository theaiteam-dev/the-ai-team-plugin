"use client";

import * as React from "react";
import { useState } from "react";
import { AGENT_DISPLAY_NAMES, type AgentId } from "@ai-team/shared";
import { cn } from "@/lib/utils";
import type { HookEventSummary } from "@/types/hook-event";

/**
 * Agent ids offered by the raw-view agent filter, in pipeline order
 * (planning → execution → mission tail per ADR 0004: Frankie → Stockwell →
 * Tawnia). Typed against the shared registry so an id typo fails to compile;
 * the agent-list-completeness test asserts every registry agent appears here.
 * Labels come from the shared AGENT_DISPLAY_NAMES.
 */
export const RAW_AGENT_FILTER_AGENTS: readonly AgentId[] = [
  "hannibal",
  "face",
  "sosa",
  "murdock",
  "ba",
  "amy",
  "lynch",
  "frankie",
  "stockwell",
  "tawnia",
];

/**
 * Filter state interface for Raw Agent View
 */
export interface RawAgentFilterState {
  agentNames: string[];       // Multi-select agent filter
  toolNames: string[];        // Multi-select tool filter
  status: string | null;      // Single-select status filter
}

/**
 * Pure function to filter hook events based on filter state.
 * Filters are applied with AND logic.
 */
export function filterHookEvents(
  events: HookEventSummary[],
  filters: RawAgentFilterState
): HookEventSummary[] {
  let filtered = events;

  // Filter by agent names (case-insensitive, null-safe)
  if (filters.agentNames.length > 0) {
    filtered = filtered.filter((event) =>
      event.agentName && filters.agentNames.includes(event.agentName.toLowerCase())
    );
  }

  // Filter by tool names (null-safe)
  if (filters.toolNames.length > 0) {
    filtered = filtered.filter((event) =>
      event.toolName && filters.toolNames.includes(event.toolName)
    );
  }

  // Filter by status
  if (filters.status) {
    filtered = filtered.filter((event) => event.status === filters.status);
  }

  return filtered;
}

/**
 * Hook for managing filter state
 */
export function useRawAgentFilters() {
  const [filters, setFilters] = useState<RawAgentFilterState>({
    agentNames: [],
    toolNames: [],
    status: null,
  });

  const toggleAgent = (name: string) => {
    setFilters((prev) => ({
      ...prev,
      agentNames: prev.agentNames.includes(name)
        ? prev.agentNames.filter((a) => a !== name)
        : [...prev.agentNames, name],
    }));
  };

  const toggleTool = (name: string) => {
    setFilters((prev) => ({
      ...prev,
      toolNames: prev.toolNames.includes(name)
        ? prev.toolNames.filter((t) => t !== name)
        : [...prev.toolNames, name],
    }));
  };

  const setStatus = (status: string | null) => {
    setFilters((prev) => ({
      ...prev,
      status,
    }));
  };

  const reset = () => {
    setFilters({
      agentNames: [],
      toolNames: [],
      status: null,
    });
  };

  return {
    filters,
    toggleAgent,
    toggleTool,
    setStatus,
    reset,
  };
}

/**
 * Filter controls component for Raw Agent View
 */
export interface RawAgentFiltersProps {
  filters: RawAgentFilterState;
  onToggleAgent: (name: string) => void;
  onToggleTool: (name: string) => void;
  onSetStatus: (status: string | null) => void;
  onReset: () => void;
}

export function RawAgentFilters({
  filters,
  onToggleAgent,
  onToggleTool,
  onSetStatus,
  onReset,
}: RawAgentFiltersProps) {
  // Agent names in canonical order (see RAW_AGENT_FILTER_AGENTS above)
  const agents = RAW_AGENT_FILTER_AGENTS;
  const agentDisplayNames = AGENT_DISPLAY_NAMES;

  // Common tool types
  const tools = ["Write", "Edit", "Read", "Bash", "Grep", "Glob"];

  // Status options
  const statuses = [
    { value: null, label: "All" },
    { value: "success", label: "Success" },
    { value: "failure", label: "Failure" },
    { value: "denied", label: "Denied" },
    { value: "pending", label: "Pending" },
  ];

  const hasActiveFilters =
    filters.agentNames.length > 0 ||
    filters.toolNames.length > 0 ||
    filters.status !== null;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      {/* Header with reset button */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">Filters</h3>
        {hasActiveFilters && (
          <button
            onClick={onReset}
            className="rounded px-3 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Reset
          </button>
        )}
      </div>

      {/* Agent filter */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Agents</label>
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => (
            <label
              key={agent}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm transition-colors",
                filters.agentNames.includes(agent)
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              <input
                type="checkbox"
                checked={filters.agentNames.includes(agent)}
                onChange={() => onToggleAgent(agent)}
                className="sr-only"
              />
              {agentDisplayNames[agent]}
            </label>
          ))}
        </div>
      </div>

      {/* Tool filter */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Tools</label>
        <div className="flex flex-wrap gap-2">
          {tools.map((tool) => (
            <label
              key={tool}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm transition-colors",
                filters.toolNames.includes(tool)
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              <input
                type="checkbox"
                checked={filters.toolNames.includes(tool)}
                onChange={() => onToggleTool(tool)}
                className="sr-only"
              />
              {tool}
            </label>
          ))}
        </div>
      </div>

      {/* Status filter */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Status</label>
        <div className="flex flex-wrap gap-2">
          {statuses.map(({ value, label }) => (
            <label
              key={label}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm transition-colors",
                filters.status === value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              <input
                type="radio"
                name="status"
                checked={filters.status === value}
                onChange={() => onSetStatus(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
