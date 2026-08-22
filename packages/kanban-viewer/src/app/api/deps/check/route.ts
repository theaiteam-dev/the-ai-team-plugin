/**
 * API Route Handler for GET /api/deps/check
 *
 * Validates the dependency graph and returns:
 * - valid: true if no cycles exist
 * - cycles: arrays of item IDs forming circular dependencies
 * - readyItems: item IDs where all dependencies satisfy isDependencySatisfied
 *   ('staged' or 'done' — see WI-788)
 * - blockedItems: item IDs waiting on incomplete dependencies
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createServerError } from '@/lib/errors';
import { getAndValidateProjectId } from '@/lib/project-utils';
import type { DepsCheckResponse } from '@/types/api';
import { isDependencySatisfied } from '@ai-team/shared';
import type { StageId } from '@/types/board';

/**
 * Item structure from database query with dependencies included.
 */
interface ItemWithDeps {
  id: string;
  stageId: string;
  archivedAt: Date | null;
  dependsOn: Array<{ dependsOnId: string }>;
}

/**
 * Detect cycles in the dependency graph using DFS.
 * Returns all cycles found as arrays of item IDs.
 */
function detectCycles(items: ItemWithDeps[]): string[][] {
  const cycles: string[][] = [];
  const itemMap = new Map<string, ItemWithDeps>();

  // Build item lookup map
  for (const item of items) {
    itemMap.set(item.id, item);
  }

  // Track visited state: 0 = unvisited, 1 = in current path, 2 = fully processed
  const visited = new Map<string, number>();
  const path: string[] = [];

  function dfs(itemId: string): void {
    const state = visited.get(itemId);

    // If already fully processed, skip
    if (state === 2) {
      return;
    }

    // If in current path, we found a cycle
    if (state === 1) {
      const cycleStart = path.indexOf(itemId);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart);
        cycle.push(itemId); // Close the cycle
        cycles.push(cycle);
      }
      return;
    }

    // Mark as in current path
    visited.set(itemId, 1);
    path.push(itemId);

    // Visit dependencies
    const item = itemMap.get(itemId);
    if (item) {
      for (const dep of item.dependsOn) {
        dfs(dep.dependsOnId);
      }
    }

    // Mark as fully processed and remove from path
    path.pop();
    visited.set(itemId, 2);
  }

  // Run DFS from each unvisited node
  for (const item of items) {
    if (!visited.has(item.id)) {
      dfs(item.id);
    }
  }

  return cycles;
}

/**
 * Identify items that are ready (all dependencies satisfy
 * isDependencySatisfied — 'staged' or 'done') and items that are blocked
 * (have dependencies that don't).
 */
function categorizeItems(items: ItemWithDeps[]): {
  readyItems: string[];
  blockedItems: string[];
} {
  const readyItems: string[] = [];
  const blockedItems: string[] = [];

  // Build map of item stages for quick lookup
  const stageMap = new Map<string, string>();
  for (const item of items) {
    stageMap.set(item.id, item.stageId);
  }

  for (const item of items) {
    // Skip items that are themselves already complete (staged or done) —
    // they have nothing left to wait on and aren't "ready to start".
    if (isDependencySatisfied(item.stageId as StageId)) {
      continue;
    }

    // Check if item has dependencies
    if (item.dependsOn.length === 0) {
      // No dependencies means ready
      readyItems.push(item.id);
    } else {
      // Check if all dependencies are satisfied (staged or done)
      const allDepsSatisfied = item.dependsOn.every((dep) => {
        const depStage = stageMap.get(dep.dependsOnId);
        // depStage is undefined when the dependency wasn't found in this
        // project's item set; isDependencySatisfied(undefined) is false
        // (Array.includes never matches undefined against StageId values),
        // so an unresolved dependency correctly stays unsatisfied.
        return isDependencySatisfied(depStage as StageId);
      });

      if (allDepsSatisfied) {
        readyItems.push(item.id);
      } else {
        blockedItems.push(item.id);
      }
    }
  }

  return { readyItems, blockedItems };
}

/**
 * GET /api/deps/check
 *
 * Check the dependency graph for cycles and identify
 * ready/blocked items based on dependency completion.
 *
 * Query parameters:
 * - projectId (string, required): Filter items by project ID
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      return NextResponse.json(
        { success: false, error: { code: projectValidation.error.code, message: 'X-Project-ID header is required' } },
        { status: 400 }
      );
    }
    const projectId = projectValidation.projectId;

    // Single query to get all non-archived items for the project with their dependencies
    const items = await prisma.item.findMany({
      where: {
        archivedAt: null,
        projectId,
      },
      include: {
        dependsOn: true,
      },
    });

    // Detect cycles in the dependency graph
    const cycles = detectCycles(items);
    const valid = cycles.length === 0;

    // Categorize items as ready or blocked
    const { readyItems, blockedItems } = categorizeItems(items);

    const response: DepsCheckResponse = {
      success: true,
      data: {
        valid,
        cycles,
        readyItems,
        blockedItems,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('GET /api/deps/check error:', error);
    const apiError = createServerError('Internal server error');
    return NextResponse.json(apiError.toResponse(), { status: 500 });
  }
}
