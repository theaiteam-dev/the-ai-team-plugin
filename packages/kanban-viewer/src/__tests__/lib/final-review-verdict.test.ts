import { describe, it, expect } from 'vitest';
import { parseFinalReviewVerdict } from '@/lib/final-review-verdict';

/**
 * Tests for src/lib/final-review-verdict.ts.
 *
 * WI-790 rework (Lynch rejection): this parser is documented as mirroring
 * scripts/hooks/lib/stop-gates.js's parseFinalReviewVerdict() "rule for
 * rule" so the promotion API and Hannibal's Stop-hook gates can never
 * disagree about the same report text — but the sibling's own test suite
 * (stop-gates.test.ts) had exercised branches this one never did: the bare
 * marker branch (no VERDICT: prefix), the multi-conflicting-VERDICT-lines
 * case, and non-string input. This parser gates an irreversible bulk
 * staged->done promotion across a whole project, so it gets the same
 * adversarial-input-matrix rigor as its sibling, not one representative
 * shape per AC.
 *
 * Fixtures mirror scripts/hooks/__tests__/stop-gates.test.ts's
 * parseFinalReviewVerdict describe block as closely as possible so the two
 * suites visibly assert the same contract side by side.
 */
describe('parseFinalReviewVerdict', () => {
  it('parses VERDICT: FINAL APPROVED', () => {
    expect(parseFinalReviewVerdict('# Final Mission Review\n\nVERDICT: FINAL APPROVED\n')).toBe(
      'approved'
    );
  });

  it('parses VERDICT: FINAL REJECTED', () => {
    expect(parseFinalReviewVerdict('# Final Mission Review\n\nVERDICT: FINAL REJECTED\n')).toBe(
      'rejected'
    );
  });

  it('honors a bare FINAL APPROVED marker without the VERDICT: prefix', () => {
    expect(parseFinalReviewVerdict('FINAL APPROVED — all requirements met')).toBe('approved');
  });

  it('honors a bare FINAL REJECTED marker without the VERDICT: prefix', () => {
    expect(parseFinalReviewVerdict('FINAL REJECTED — see WI-003, WI-007')).toBe('rejected');
  });

  it('returns unknown when both bare markers appear with no VERDICT line to disambiguate', () => {
    expect(parseFinalReviewVerdict('FINAL APPROVED? no — FINAL REJECTED? unclear')).toBe(
      'unknown'
    );
  });

  it('the last VERDICT line wins when a re-review appends below the original', () => {
    expect(
      parseFinalReviewVerdict(
        'VERDICT: FINAL REJECTED\n\n## Re-review after rework\n\nVERDICT: FINAL APPROVED\n'
      )
    ).toBe('approved');
  });

  it('a VERDICT line outranks a stray bare marker quoted elsewhere in the prose', () => {
    expect(
      parseFinalReviewVerdict(
        'The previous run ended FINAL REJECTED; all issues addressed.\n\nVERDICT: FINAL APPROVED\n'
      )
    ).toBe('approved');
  });

  it('returns unknown for review text with no recognizable marker (fail open — never a deadlock)', () => {
    expect(parseFinalReviewVerdict('# Final Mission Review\n\nAPPROVED')).toBe('unknown');
    expect(parseFinalReviewVerdict('Looks good to me.')).toBe('unknown');
  });

  // -------------------------------------------------------------------------
  // Non-string input — this is the regression test that would have caught
  // the missing `typeof review !== 'string'` guard Lynch's sibling-diff
  // found. Before the fix these throw a TypeError instead of returning
  // 'unknown'; the sibling in stop-gates.js has always guarded against this.
  // -------------------------------------------------------------------------
  it('returns unknown for null input rather than throwing', () => {
    expect(parseFinalReviewVerdict(null as unknown as string)).toBe('unknown');
  });

  it('returns unknown for undefined input rather than throwing', () => {
    expect(parseFinalReviewVerdict(undefined as unknown as string)).toBe('unknown');
  });

  it('returns unknown for non-string, non-nullish input (e.g. a number) rather than throwing', () => {
    expect(parseFinalReviewVerdict(42 as unknown as string)).toBe('unknown');
  });
});
