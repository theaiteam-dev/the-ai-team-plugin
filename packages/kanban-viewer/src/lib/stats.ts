import type { WorkItem, Stage } from '@/types';

/**
 * Stages that count as "backlog" (not yet started)
 */
const BACKLOG_STAGES: readonly Stage[] = ['briefings', 'ready'] as const;

/**
 * Stages that count as "in progress" (actively being worked on).
 *
 * WI-792 (Josh's refinement-gate decision): 'staged' counts as in-progress
 * here, not completed — an item sitting in staged is individually done but
 * still awaiting mission-tail verification (Frankie + Stockwell) before the
 * atomic promotion to 'done' seals it. Only 'done' is completion.
 */
const IN_PROGRESS_STAGES: readonly Stage[] = ['testing', 'implementing', 'review', 'probing', 'staged'] as const;

/**
 * Board statistics structure
 */
export interface BoardStats {
  total_items: number;
  completed: number;
  in_progress: number;
  blocked: number;
  backlog: number;
}

/**
 * WIP status for a stage
 */
export interface WipStatus {
  current: number;
  limit: number | undefined;
}

/**
 * Calculate board statistics from a list of work items
 * @param items - Array of work items on the board
 * @returns Board statistics with counts per category
 */
export function calculateBoardStats(items: WorkItem[]): BoardStats {
  const stats: BoardStats = {
    total_items: items.length,
    completed: 0,
    in_progress: 0,
    blocked: 0,
    backlog: 0,
  };

  for (const item of items) {
    if (item.stage === 'done') {
      stats.completed++;
    } else if (item.stage === 'blocked') {
      stats.blocked++;
    } else if (IN_PROGRESS_STAGES.includes(item.stage)) {
      stats.in_progress++;
    } else if (BACKLOG_STAGES.includes(item.stage)) {
      stats.backlog++;
    }
  }

  return stats;
}

/**
 * Get the WIP (Work In Progress) status for a specific stage
 * @param stage - The stage to check
 * @param items - Array of work items on the board
 * @param wipLimits - Record of stage names to their WIP limits
 * @returns Current count and limit for the stage
 */
export function getWipStatus(
  stage: Stage,
  items: WorkItem[],
  wipLimits: Record<string, number>
): WipStatus {
  const current = items.filter((item) => item.stage === stage).length;
  const limit = wipLimits[stage];

  return {
    current,
    limit,
  };
}

/**
 * Check if a stage is over its WIP limit
 * @param stage - The stage to check
 * @param items - Array of work items on the board
 * @param wipLimits - Record of stage names to their WIP limits
 * @returns true if the stage exceeds its WIP limit, false otherwise
 */
export function isOverWipLimit(
  stage: Stage,
  items: WorkItem[],
  wipLimits: Record<string, number>
): boolean {
  const limit = wipLimits[stage];

  // If no WIP limit defined for this stage, it cannot be over limit
  if (limit === undefined) {
    return false;
  }

  const current = items.filter((item) => item.stage === stage).length;

  return current > limit;
}

/**
 * Calculate progress percentage (completed / total * 100)
 * @param items - Array of work items on the board
 * @returns Percentage of items completed (0-100)
 */
export function calculateProgress(items: WorkItem[]): number {
  if (items.length === 0) {
    return 0;
  }

  const completed = items.filter((item) => item.stage === 'done').length;
  return (completed / items.length) * 100;
}
