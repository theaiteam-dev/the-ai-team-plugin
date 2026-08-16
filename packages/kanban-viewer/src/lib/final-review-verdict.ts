/**
 * Parses the FINAL APPROVED / FINAL REJECTED verdict out of a Stockwell
 * final mission review report.
 *
 * Mirrors scripts/hooks/lib/stop-gates.js's parseFinalReviewVerdict() rule
 * for rule so the promotion API and Hannibal's Stop-hook gates can never
 * disagree about the same report text:
 *   - An explicit "VERDICT: FINAL APPROVED" / "VERDICT: FINAL REJECTED"
 *     line takes priority; the last one wins if there are several.
 *   - Otherwise, a bare "FINAL APPROVED" xor "FINAL REJECTED" mention
 *     decides it.
 *   - Both, neither, or an ambiguous mix is 'unknown' — never guess.
 *   - Non-string input (null, undefined, or any other type) is 'unknown'
 *     rather than throwing — matches stop-gates.js's own guard exactly, so
 *     a caller that hasn't validated its input first still fails open.
 *
 * scripts/hooks has no package.json and isn't part of this app's build
 * (it's excluded from this package's tsconfig), so a direct cross-package
 * import isn't wired up. Keep this mirror in sync with stop-gates.js if the
 * matching rules ever change there.
 */
export type FinalReviewVerdict = 'approved' | 'rejected' | 'unknown';

export function parseFinalReviewVerdict(review: unknown): FinalReviewVerdict {
  if (typeof review !== 'string') return 'unknown';

  const verdictLines = review.match(/VERDICT:\s*FINAL\s+(?:APPROVED|REJECTED)/gi);
  if (verdictLines && verdictLines.length > 0) {
    return /REJECTED/i.test(verdictLines[verdictLines.length - 1]) ? 'rejected' : 'approved';
  }

  const approved = /FINAL\s+APPROVED/i.test(review);
  const rejected = /FINAL\s+REJECTED/i.test(review);
  if (approved !== rejected) return approved ? 'approved' : 'rejected';
  return 'unknown';
}
