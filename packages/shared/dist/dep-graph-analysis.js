/**
 * Dependency graph analysis for adaptive scaling.
 *
 * Computes the maximum number of items that could occupy any single pipeline
 * stage simultaneously — the "independent set" width of the dep graph.
 * Used by the adaptive scaling calculator to determine how many parallel
 * agent instances are actually useful.
 */
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
export function computeDepGraphMaxPerStage(items) {
    if (items.length === 0)
        return 0;
    const waveOf = new Map();
    const idToItem = new Map(items.map((i) => [i.id, i]));
    const unresolved = new Set(items.map((i) => i.id));
    while (unresolved.size > 0) {
        let progress = false;
        for (const id of unresolved) {
            const item = idToItem.get(id);
            if (!item.dependencies.every((dep) => waveOf.has(dep)))
                continue;
            const maxDepWave = item.dependencies.length === 0
                ? -1
                : Math.max(...item.dependencies.map((dep) => waveOf.get(dep)));
            waveOf.set(id, maxDepWave + 1);
            unresolved.delete(id);
            progress = true;
        }
        if (!progress)
            break; // guard against cycles or missing dep references
    }
    const waveCounts = new Map();
    for (const wave of waveOf.values()) {
        waveCounts.set(wave, (waveCounts.get(wave) ?? 0) + 1);
    }
    return Math.max(...waveCounts.values());
}
