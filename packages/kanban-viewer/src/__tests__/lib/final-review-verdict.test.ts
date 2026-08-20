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

  // -------------------------------------------------------------------------
  // Adversarial: a REJECTED review must never read as approved. Here that
  // matters even more than in the Stop gates — an 'approved' answer triggers
  // the irreversible bulk staged->done promotion. Every case below returned
  // 'approved' under the old "last VERDICT line wins, scan the raw text" rule.
  // Kept identical to scripts/hooks/__tests__/stop-gates.test.ts so the two
  // suites visibly assert the same contract side by side.
  // -------------------------------------------------------------------------
  it('a fenced format reference containing the APPROVED line does not flip a rejection', () => {
    expect(
      parseFinalReviewVerdict(
        '# Final Mission Review\n\nVERDICT: FINAL REJECTED\n\n' +
          'Format reference:\n\n```\nVERDICT: FINAL APPROVED\n```\n'
      )
    ).toBe('rejected');
  });

  it('a fenced template block quoting the whole approved report does not flip a rejection', () => {
    expect(
      parseFinalReviewVerdict(
        'VERDICT: FINAL REJECTED\n\n' +
          '## For next time, the approved template is:\n\n' +
          '```markdown\nFINAL MISSION REVIEW\n\n## Cross-Cutting Review\n\n' +
          'VERDICT: FINAL APPROVED\n\nThe A(i)-Team got away with it.\n```\n'
      )
    ).toBe('rejected');
  });

  it("prose ABOUT an earlier verdict does not outrank the report's own verdict line", () => {
    expect(
      parseFinalReviewVerdict(
        'VERDICT: FINAL REJECTED\n\nCritical Issues Found:\n\n' +
          '1. The previous review said VERDICT: FINAL APPROVED but that was wrong — ' +
          'WI-003 never shipped.\n'
      )
    ).toBe('rejected');
  });

  it('the FIRST VERDICT line wins, matching the report template where the verdict precedes the issue list', () => {
    // A re-review is a fresh POST that OVERWRITES mission.finalReview, so an
    // appended second verdict is commentary, never the real one.
    expect(
      parseFinalReviewVerdict(
        'VERDICT: FINAL REJECTED\n\n## Re-review after rework\n\nVERDICT: FINAL APPROVED\n'
      )
    ).toBe('rejected');
  });

  it('control: a plain rejected report is rejected, a plain approved report is approved', () => {
    expect(parseFinalReviewVerdict('FINAL MISSION REVIEW\n\nVERDICT: FINAL REJECTED\n')).toBe(
      'rejected'
    );
    expect(parseFinalReviewVerdict('FINAL MISSION REVIEW\n\nVERDICT: FINAL APPROVED\n')).toBe(
      'approved'
    );
  });

  it('a bare marker that appears ONLY inside a fence is not a verdict', () => {
    expect(parseFinalReviewVerdict('Report pending.\n\n```\nFINAL APPROVED\n```\n')).toBe(
      'unknown'
    );
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
