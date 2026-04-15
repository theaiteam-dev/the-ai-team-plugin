/**
 * Validation utilities for the Kanban Viewer API layer.
 *
 * Provides validation for stage transitions, WIP limits, and
 * dependency cycles as specified in PRD 013-mcp-interface.md.
 */

import type { StageId } from '@/types/board';
import { isValidTransition as sharedIsValidTransition } from '@ai-team/shared';

/**
 * Check if a stage transition is valid according to the transition matrix.
 *
 * @param from - The current stage
 * @param to - The target stage
 * @returns true if the transition is allowed, false otherwise
 */
export function isValidTransition(from: StageId, to: StageId): boolean {
  // Self-transitions are never valid
  if (from === to) {
    return false;
  }

  return sharedIsValidTransition(from, to);
}

/**
 * Result of a WIP limit check.
 */
export interface WipCheckResult {
  /** Whether adding an item is allowed */
  allowed: boolean;
  /** Available capacity (null if unlimited) */
  available: number | null;
}

/**
 * Check if a stage can accept more items based on WIP limits.
 *
 * @param stageId - The stage to check
 * @param currentCount - Current number of items in the stage
 * @param limit - WIP limit for the stage (null means unlimited)
 * @returns WIP check result with allowed status and available capacity
 */
export function checkWipLimit(
  stageId: StageId,
  currentCount: number,
  limit: number | null
): WipCheckResult {
  // No limit means unlimited capacity
  if (limit === null) {
    return {
      allowed: true,
      available: null,
    };
  }

  // Check capacity
  const available = Math.max(0, limit - currentCount);
  const allowed = currentCount < limit;

  return {
    allowed,
    available,
  };
}

/**
 * Result of dependency validation.
 */
export interface DependencyValidationResult {
  /** Whether the dependencies are valid (no cycles) */
  valid: boolean;
  /** Cycle path if one was detected, null otherwise */
  cycle: string[] | null;
}

/**
 * Validate that adding dependencies to an item won't create a cycle.
 *
 * Uses depth-first search to detect cycles in the dependency graph.
 *
 * @param itemId - The item that would have dependencies added
 * @param dependsOnIds - The proposed dependency IDs
 * @param existingGraph - Current dependency graph (itemId -> array of dependencies)
 * @returns Validation result with cycle path if detected
 */
export function validateDependencies(
  itemId: string,
  dependsOnIds: string[],
  existingGraph: Record<string, string[]>
): DependencyValidationResult {
  // No dependencies means no cycle possible
  if (dependsOnIds.length === 0) {
    return { valid: true, cycle: null };
  }

  // Check for direct self-reference
  if (dependsOnIds.includes(itemId)) {
    return { valid: false, cycle: [itemId, itemId] };
  }

  // Build a temporary graph with the proposed dependencies
  const graph = new Map<string, string[]>();

  // Copy existing graph
  for (const [id, deps] of Object.entries(existingGraph)) {
    graph.set(id, [...deps]);
  }

  // Add the proposed dependencies
  graph.set(itemId, dependsOnIds);

  // DFS to detect cycles starting from each dependency
  // We need to check if any dependency eventually leads back to itemId
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function detectCycle(nodeId: string): string[] | null {
    if (recursionStack.has(nodeId)) {
      // Found a cycle - build the cycle path
      const cycleStartIndex = path.indexOf(nodeId);
      return [...path.slice(cycleStartIndex), nodeId];
    }

    if (visited.has(nodeId)) {
      return null;
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const dependencies = graph.get(nodeId) ?? [];
    for (const depId of dependencies) {
      const cycle = detectCycle(depId);
      if (cycle) {
        return cycle;
      }
    }

    path.pop();
    recursionStack.delete(nodeId);
    return null;
  }

  // Start DFS from the item being modified
  const cycle = detectCycle(itemId);

  if (cycle) {
    return { valid: false, cycle };
  }

  return { valid: true, cycle: null };
}

/**
 * Minimal item representation for output collision validation.
 */
export interface OutputCollisionItem {
  id: string;
  outputs: {
    impl?: string;
    test?: string;
    types?: string;
  };
  dependencies: string[];
}

/**
 * A detected output file collision between items.
 */
export interface OutputCollision {
  /** The file path that has a collision */
  file: string;
  /** Item IDs that share this output path without a dependency relationship */
  items: string[];
}

/**
 * Result of output collision validation.
 */
export interface OutputCollisionResult {
  /** Whether all items have valid (non-colliding) outputs */
  valid: boolean;
  /** List of detected collisions */
  collisions: OutputCollision[];
}

/**
 * Check if two items have a dependency relationship (direct or transitive).
 *
 * Returns true if either item depends on the other (directly or transitively).
 *
 * @param itemA - First item ID
 * @param itemB - Second item ID
 * @param dependencyGraph - Map of item ID to its dependencies
 * @returns true if a dependency relationship exists
 */
function hasDependencyRelationship(
  itemA: string,
  itemB: string,
  dependencyGraph: Map<string, string[]>
): boolean {
  // Check if itemA transitively depends on itemB
  const visited = new Set<string>();

  function canReach(from: string, target: string): boolean {
    if (from === target) return true;
    if (visited.has(from)) return false;
    visited.add(from);

    const dependencies = dependencyGraph.get(from) ?? [];
    for (const dep of dependencies) {
      if (canReach(dep, target)) return true;
    }
    return false;
  }

  // Check both directions: A depends on B, or B depends on A
  if (canReach(itemA, itemB)) return true;

  visited.clear();
  return canReach(itemB, itemA);
}

/**
 * Validate that items with the same output file path have a dependency relationship.
 *
 * Two items can share the same output file only if one depends on the other
 * (directly or transitively). This prevents parallel execution from causing
 * write conflicts to the same file.
 *
 * @param items - Array of items with their outputs and dependencies
 * @returns Validation result with any detected collisions
 */
export function validateOutputCollisions(
  items: OutputCollisionItem[]
): OutputCollisionResult {
  if (items.length === 0) {
    return { valid: true, collisions: [] };
  }

  // Build dependency graph for efficient lookup
  const dependencyGraph = new Map<string, string[]>();
  for (const item of items) {
    dependencyGraph.set(item.id, item.dependencies);
  }

  // Group items by output file path
  const outputToItems = new Map<string, string[]>();

  for (const item of items) {
    const outputPaths = [
      item.outputs.impl,
      item.outputs.test,
      item.outputs.types,
    ].filter((path): path is string => path !== undefined && path !== null && path !== '');

    for (const path of outputPaths) {
      const existing = outputToItems.get(path) ?? [];
      existing.push(item.id);
      outputToItems.set(path, existing);
    }
  }

  // Find collisions: items sharing an output without dependency relationship
  const collisions: OutputCollision[] = [];

  for (const [file, itemIds] of outputToItems) {
    if (itemIds.length < 2) continue;

    // Check if all pairs have a dependency relationship
    const conflictingItems: string[] = [];

    for (let i = 0; i < itemIds.length; i++) {
      for (let j = i + 1; j < itemIds.length; j++) {
        const itemA = itemIds[i];
        const itemB = itemIds[j];

        if (!hasDependencyRelationship(itemA, itemB, dependencyGraph)) {
          // Found a pair without dependency - add both to conflicts
          if (!conflictingItems.includes(itemA)) {
            conflictingItems.push(itemA);
          }
          if (!conflictingItems.includes(itemB)) {
            conflictingItems.push(itemB);
          }
        }
      }
    }

    if (conflictingItems.length > 0) {
      collisions.push({ file, items: conflictingItems });
    }
  }

  return {
    valid: collisions.length === 0,
    collisions,
  };
}
