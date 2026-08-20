/**
 * The Final Mission Review verdict — parsed from ONE designated place.
 *
 * THE RULE (and the whole rule): the verdict is the report's LAST non-empty
 * line, and nothing else. Trailing blank lines and trailing whitespace are
 * ignored; the surviving line must be exactly the verdict trailer, optionally
 * wrapped in markdown bold. Anything else — a verdict line buried in the
 * middle, a verdict quoted in prose, a fenced template, no marker at all — is
 * 'unknown'.
 *
 * WHY A TRAILER AND NOT A SCAN
 * ----------------------------
 * Every previous rule scanned the prose for a marker and then tried to pick
 * the "real" one. Both directions of that pick are wrong on a real report:
 *
 *   - LAST-wins is flipped by an appended "the previous review said VERDICT:
 *     FINAL APPROVED, but that was wrong" note after a genuine rejection.
 *   - FIRST-wins is flipped from the other end:
 *
 *         Context: the earlier pass issued VERDICT: FINAL APPROVED, which was
 *         premature.
 *
 *         VERDICT: FINAL REJECTED
 *
 *     which parses as approved and would run the irreversible staged -> done
 *     promotion (WI-790) on a REJECTED mission.
 *
 * Stripping fenced blocks first did not save it either: markdown fences nest
 * by length (CommonMark §4.5), so a 4-backtick block quoting a 3-backtick
 * example closes on the inner fence and leaks the quoted verdict back into the
 * scanned text. There is no fence-stripper simple enough to be trustworthy
 * here, so there is no fence-stripper at all — fences are irrelevant when only
 * the final line is ever read.
 *
 * FAIL CLOSED, NOT OPEN
 * ---------------------
 * 'unknown' is not "assume complete". It is "the report does not state a
 * verdict". Every consumer must treat it as such:
 *
 *   - packages/kanban-viewer .../final-review/route.ts persists the review and
 *     promotes NOTHING.
 *   - The Stop gates (scripts/hooks/lib/stop-gates.js) BLOCK, naming the
 *     trailer requirement so the operator can re-POST the report with the
 *     verdict as its final line. That is always satisfiable, so it is a
 *     recoverable block, not a deadlock.
 *
 * ONE COPY
 * --------
 * This module is the single implementation. The kanban-viewer API imports it
 * from `@ai-team/shared`; the Stop hooks import the built
 * `packages/shared/dist/final-review-verdict.js` directly (both are ESM, and
 * `dist/` is committed). There is no mirrored second copy to drift.
 */
export type FinalReviewVerdict = 'approved' | 'rejected' | 'unknown';
/**
 * Tolerated decorations on the final line — deliberately a short, pinned list
 * (see the shared package's final-review-verdict tests):
 *
 *   1. leading/trailing whitespace on the line itself;
 *   2. trailing blank lines and trailing whitespace at the end of the report;
 *   3. CRLF line endings;
 *   4. a matched markdown-bold wrapper: `**VERDICT: FINAL APPROVED**`.
 *
 * Everything else is 'unknown' — including a blockquote (`> VERDICT: ...`), a
 * list bullet (`- VERDICT: ...`), a trailing period, a heading marker, an
 * unmatched `**`, or lowercase keywords.
 */
export declare function parseFinalReviewVerdict(review: unknown): FinalReviewVerdict;
