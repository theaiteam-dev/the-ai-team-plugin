/**
 * Validation for the mission execution contract (testing_level, review_tier,
 * profile). Shared by POST /api/missions (create-time) and
 * PATCH /api/missions/:missionId (stamp-time) so both entry points reject
 * out-of-range values identically — see the defensive-coding "guard
 * consistency across sibling operations" rule.
 */

import { createValidationError, type ApiError } from '@/lib/errors';
import { TESTING_LEVEL_VALUES, REVIEW_TIER_VALUES } from '@/types/mission-execution-contract';

function isValidTestingLevel(value: unknown): boolean {
  return typeof value === 'string' && (TESTING_LEVEL_VALUES as readonly string[]).includes(value);
}

function isValidReviewTier(value: unknown): boolean {
  return typeof value === 'string' && (REVIEW_TIER_VALUES as readonly string[]).includes(value);
}

/**
 * Validates an incoming (untrusted, JSON-parsed) executionContract payload
 * against the documented enum vocabularies.
 *
 * `null`/`undefined` is valid — an execution contract is optional on both
 * create and stamp. `profile` is intentionally not validated (free-form).
 *
 * Returns an ApiError describing the first violation, or null when the
 * contract is absent or valid. Callers MUST check this before touching
 * prisma.mission.create/update.
 */
export function validateExecutionContract(contract: unknown): ApiError | null {
  if (contract === null || contract === undefined) {
    return null;
  }

  if (typeof contract !== 'object' || Array.isArray(contract)) {
    return createValidationError('executionContract must be an object');
  }

  const candidate = contract as Record<string, unknown>;

  if (!isValidTestingLevel(candidate.testing_level)) {
    return createValidationError(
      `executionContract.testing_level must be one of: ${TESTING_LEVEL_VALUES.join(', ')}`
    );
  }

  if (!isValidReviewTier(candidate.review_tier)) {
    return createValidationError(
      `executionContract.review_tier must be one of: ${REVIEW_TIER_VALUES.join(', ')}`
    );
  }

  return null;
}
