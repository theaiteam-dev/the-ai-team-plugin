import type { ScalingRationale } from '@ai-team/shared';

export type { ScalingRationale };

/**
 * Request body for PATCH /api/missions/:id — update scaling rationale.
 */
export interface UpdateMissionScalingRequest {
  scalingRationale: ScalingRationale;
}
