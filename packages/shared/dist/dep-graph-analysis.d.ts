/**
 * Dependency graph analysis for adaptive scaling.
 *
 * Computes the maximum number of items that could occupy any single pipeline
 * stage simultaneously — the "independent set" width of the dep graph.
 * Used by the adaptive scaling calculator to determine how many parallel
 * agent instances are actually useful.
 */
export interface DepGraphItem {
    id: string;
    dependencies: string[];
}
/**
 * Walks the dependency graph by topological wave and returns the maximum
 * wave width — i.e. the most items that could be in-flight at the same stage.
 *
 * Wave 0: items with no dependencies (can all run immediately).
 * Wave N: items whose all dependencies belong to waves < N.
 *
 * @param items - Work items with their dependency arrays
 * @returns Maximum number of items in any single wave
 */
export declare function computeDepGraphMaxPerStage(items: DepGraphItem[]): number;
