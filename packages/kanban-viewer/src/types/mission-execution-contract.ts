/**
 * Execution contract for a mission: the resolved testing level, review
 * tier, and quality-profile name a mission was created — or later
 * stamped — with.
 *
 * Persisted as a nullable JSON string on Mission.executionContract,
 * following the exact additive shape Mission.scalingRationale already
 * uses (see mission-scaling.ts). Enum vocabularies are reused verbatim
 * from scripts/hooks/lib/qa-contract.js's TESTING_LEVEL_VALUES /
 * REVIEW_TIER_VALUES (PRD FR-8/FR-9) — do not rename or diverge from
 * those value strings.
 */

export const TESTING_LEVEL_VALUES = ['smoke', 'critical-path', 'full-dod'] as const;
export type TestingLevel = (typeof TESTING_LEVEL_VALUES)[number];

export const REVIEW_TIER_VALUES = ['hands-on', 'evidence-only', 'auto'] as const;
export type ReviewTier = (typeof REVIEW_TIER_VALUES)[number];

/**
 * A mission's resolved execution contract. `profile` is the free-form
 * quality-profile name it was resolved from (e.g. 'quick' | 'normal' |
 * 'deep') — unlike testing_level and review_tier, it is not enum-validated.
 */
export interface ExecutionContract {
  testing_level: TestingLevel;
  review_tier: ReviewTier;
  profile: string;
}
