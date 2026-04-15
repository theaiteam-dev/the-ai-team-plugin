import type { ScalingRationale } from './mission-scaling';

export type { ScalingRationale };

/**
 * Props for the ScalingRationaleModal component.
 */
export interface ScalingRationaleModalProps {
  /** Scaling rationale data from the mission record. If null/undefined, the button is hidden. */
  scalingRationale: ScalingRationale | null | undefined;
}
