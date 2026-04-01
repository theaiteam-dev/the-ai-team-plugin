/**
 * Input types for the adaptive scaling calculator.
 */

export interface AdaptiveScalingInput {
  /** Maximum items per stage from the dependency graph. */
  depGraphMax: number;
  /** Memory budget ceiling (max instances memory can support). */
  memoryCeiling: number;
  /** Optional manual --concurrency override. */
  concurrencyOverride?: number;
}

/** The constraint that determined the final instance count. */
export type BindingConstraint = 'dep_graph' | 'memory' | 'override';
