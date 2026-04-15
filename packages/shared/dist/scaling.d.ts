/**
 * Scaling rationale types for multi-instance pipeline agents.
 *
 * ScalingRationale is persisted as JSON in the Mission table and rendered
 * in the Kanban UI scaling modal. InstanceIdentifier captures a resolved
 * agent name together with its instance number (e.g. murdock-1).
 */
import type { BindingConstraint } from './adaptive-scaling-types.js';
export interface ScalingRationale {
    /** Number of parallel instances to run for this agent type. */
    instanceCount: number;
    /** Maximum items per stage derived from the dependency graph. */
    depGraphMaxPerStage: number;
    /** WIP ceiling imposed by available memory. */
    memoryBudgetCeiling: number;
    /** Per-stage WIP limit from the board configuration. */
    wipLimit: number;
    /** Which constraint is the binding factor (e.g. 'memory', 'dep_graph', 'wip'). */
    bindingConstraint: BindingConstraint;
    /** Manual --concurrency override, or null when adaptive scaling applies. */
    concurrencyOverride: number | null;
}
export interface InstanceIdentifier {
    /** Base agent type (e.g. 'murdock', 'ba'). */
    agentType: string;
    /** Numeric suffix assigned to this instance (e.g. 1 for murdock-1). */
    instanceNumber: number;
}
