/**
 * System memory budget query for adaptive scaling.
 *
 * Computes the maximum number of agent instances the host can support
 * without OOM risk, using the formula:
 *   floor(freeMemMB * 0.8 / 400 / 4)
 *
 * Constants:
 *   0.8  — reserve 20% of free memory for OS/other processes
 *   400  — estimated MB per subagent instance
 *   4    — concurrent agent types in the pipeline (Murdock, B.A., Lynch, Amy)
 *
 * The result is always at least 1 — never block all work due to low memory.
 */
/**
 * Returns the maximum per-agent-type instance count the host memory supports.
 *
 * @param freeMemMB - Available memory in MB. Defaults to os.freemem() / 1024 / 1024.
 * @returns Maximum instances (>= 1)
 */
export declare function computeMemoryBudget(freeMemMB?: number): number;
