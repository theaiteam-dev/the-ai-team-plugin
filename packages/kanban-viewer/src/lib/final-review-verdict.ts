/**
 * Removes fenced code blocks (``` / ~~~) from markdown.
 *
 * A final review routinely QUOTES the report format — agents/stockwell.md
 * ships both verdict templates inside fences — so a fenced
 * `VERDICT: FINAL APPROVED` example is documentation, not a verdict. Scanning
 * it would flip a genuine rejection to approved and, here, trigger an
 * irreversible staged->done promotion off a rejected review.
 *
 * An unterminated fence drops everything after it: text inside an unclosed
 * fence is unbounded quoted material, and losing a verdict line yields
 * 'unknown' (which never promotes), whereas honoring it could promote on the
 * wrong verdict.
 */
function stripFencedBlocks(text: string): string {
  const kept: string[] = [];
  let fenceChar: string | null = null;

  for (const line of text.split('\n')) {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceChar === null) {
      if (match) {
        fenceChar = match[1][0];
        continue;
      }
      kept.push(line);
    } else if (match && match[1][0] === fenceChar) {
      fenceChar = null;
    }
  }

  return kept.join('\n');
}

/**
 * Parses the FINAL APPROVED / FINAL REJECTED verdict out of a Stockwell
 * final mission review report.
 *
 * Mirrors scripts/hooks/lib/stop-gates.js's parseFinalReviewVerdict() rule
 * for rule so the promotion API and Hannibal's Stop-hook gates can never
 * disagree about the same report text:
 *   - Fenced code blocks are stripped BEFORE scanning: a quoted template or
 *     "format reference" is not a verdict.
 *   - An explicit "VERDICT: FINAL APPROVED" / "VERDICT: FINAL REJECTED"
 *     line takes priority, and the FIRST one wins. In the report template
 *     (agents/stockwell.md) the verdict line precedes the issue list, so a
 *     later "the previous review said VERDICT: FINAL APPROVED, but that was
 *     wrong" is commentary ABOUT a verdict, not the verdict — last-wins let
 *     exactly that prose promote a rejected mission. A re-review is a fresh
 *     POST that OVERWRITES mission.finalReview, so an appended second verdict
 *     is never the real one.
 *   - Otherwise, a bare "FINAL APPROVED" xor "FINAL REJECTED" mention
 *     decides it.
 *   - Both, neither, or an ambiguous mix is 'unknown' — never guess.
 *   - Non-string input (null, undefined, or any other type) is 'unknown'
 *     rather than throwing — matches stop-gates.js's own guard exactly, so
 *     a caller that hasn't validated its input first still fails open.
 *
 * scripts/hooks has no package.json and isn't part of this app's build
 * (it's excluded from this package's tsconfig), so a direct cross-package
 * import isn't wired up. Keep this mirror in sync with
 * scripts/hooks/lib/stop-gates.js — which carries the same pointer back to
 * this file — if the matching rules ever change there.
 */
export type FinalReviewVerdict = 'approved' | 'rejected' | 'unknown';

export function parseFinalReviewVerdict(review: unknown): FinalReviewVerdict {
  if (typeof review !== 'string') return 'unknown';

  const scanned = stripFencedBlocks(review);

  const verdictLines = scanned.match(/VERDICT:\s*FINAL\s+(?:APPROVED|REJECTED)/gi);
  if (verdictLines && verdictLines.length > 0) {
    return /REJECTED/i.test(verdictLines[0]) ? 'rejected' : 'approved';
  }

  const approved = /FINAL\s+APPROVED/i.test(scanned);
  const rejected = /FINAL\s+REJECTED/i.test(scanned);
  if (approved !== rejected) return approved ? 'approved' : 'rejected';
  return 'unknown';
}
