/**
 * parseFinalReviewVerdict — the ONE verdict rule.
 *
 * The verdict is the report's LAST non-empty line and nothing else. These
 * tests pin the exact tolerated decorations, and reproduce the two failures
 * that killed the previous prose-scanning rule:
 *
 *   1. FIRST-line-wins flipped from the other end — a "Context: the earlier
 *      pass issued VERDICT: FINAL APPROVED" preamble in front of a genuine
 *      VERDICT: FINAL REJECTED parsed as approved, which would have run the
 *      irreversible staged -> done promotion on a rejected mission.
 *   2. stripFencedBlocks mishandled CommonMark fence nesting — a 4-backtick
 *      block quoting a 3-backtick example closed on the inner fence, leaking
 *      the quoted verdict back into the scanned text.
 */

import { describe, it, expect } from 'vitest';
import { parseFinalReviewVerdict } from '../final-review-verdict.js';

describe('parseFinalReviewVerdict — the last-line trailer', () => {
  it('reads a plain approved trailer', () => {
    expect(parseFinalReviewVerdict('# Final Mission Review\n\nVERDICT: FINAL APPROVED')).toBe(
      'approved'
    );
  });

  it('reads a plain rejected trailer', () => {
    expect(parseFinalReviewVerdict('# Final Mission Review\n\nVERDICT: FINAL REJECTED')).toBe(
      'rejected'
    );
  });

  it('ignores trailing blank lines and trailing whitespace', () => {
    expect(parseFinalReviewVerdict('body\n\nVERDICT: FINAL APPROVED\n\n   \n\t\n')).toBe('approved');
  });

  it('tolerates leading whitespace on the trailer line', () => {
    expect(parseFinalReviewVerdict('body\n   VERDICT: FINAL REJECTED   ')).toBe('rejected');
  });

  it('tolerates CRLF line endings', () => {
    expect(parseFinalReviewVerdict('# Review\r\n\r\nVERDICT: FINAL APPROVED\r\n')).toBe('approved');
  });

  it('tolerates a matched markdown-bold wrapper', () => {
    expect(parseFinalReviewVerdict('body\n\n**VERDICT: FINAL APPROVED**')).toBe('approved');
    expect(parseFinalReviewVerdict('body\n\n**VERDICT: FINAL REJECTED**')).toBe('rejected');
  });

  it('tolerates extra spacing inside the trailer', () => {
    expect(parseFinalReviewVerdict('body\n\nVERDICT:   FINAL   APPROVED')).toBe('approved');
    expect(parseFinalReviewVerdict('body\n\nVERDICT:FINAL REJECTED')).toBe('rejected');
  });
});

describe('parseFinalReviewVerdict — the author repros that killed prose scanning', () => {
  it("REPRO 1: a 'the earlier pass issued VERDICT: FINAL APPROVED' preamble does NOT flip a rejection", () => {
    const report =
      'Context: the earlier pass issued VERDICT: FINAL APPROVED, which was premature.\n\nVERDICT: FINAL REJECTED';
    expect(
      parseFinalReviewVerdict(report),
      'first-line-wins parsed this as approved and would have promoted a rejected mission'
    ).toBe('rejected');
  });

  it('REPRO 2: a 4-backtick block quoting a 3-backtick example cannot flip the verdict — no fence logic exists', () => {
    const report = [
      '# Final Mission Review',
      '',
      '````markdown',
      'Format reference:',
      '```',
      'VERDICT: FINAL APPROVED',
      '```',
      '````',
      '',
      'VERDICT: FINAL REJECTED',
    ].join('\n');
    expect(parseFinalReviewVerdict(report)).toBe('rejected');
  });

  it('REPRO 2 (mirror): the same nesting cannot flip an approval into a rejection either', () => {
    const report = [
      '````markdown',
      '```',
      'VERDICT: FINAL REJECTED',
      '```',
      '````',
      '',
      'VERDICT: FINAL APPROVED',
    ].join('\n');
    expect(parseFinalReviewVerdict(report)).toBe('approved');
  });

  it('a fenced template that is the last thing in the report is NOT a verdict (the fence line is the last non-empty line)', () => {
    const report = '# Review\n\nVERDICT: FINAL REJECTED\n\n```\nVERDICT: FINAL APPROVED\n```';
    expect(parseFinalReviewVerdict(report)).toBe('unknown');
  });
});

describe('parseFinalReviewVerdict — verdicts quoted in prose obey the last line', () => {
  it('a verdict named mid-report is commentary; the trailer decides', () => {
    const report =
      'The previous review said VERDICT: FINAL REJECTED.\nThe issues are now fixed.\n\nVERDICT: FINAL APPROVED';
    expect(parseFinalReviewVerdict(report)).toBe('approved');
  });

  it('a mid-report verdict with NO trailer is unknown — no prose scavenging at all', () => {
    const report = 'VERDICT: FINAL APPROVED\n\nDetails:\n- WI-001 looks fine\n';
    expect(parseFinalReviewVerdict(report)).toBe('unknown');
  });

  it('the pre-existing report template shape (verdict then issue list) is now unknown — the trailer must be moved to the end', () => {
    const report = '# Final Mission Review\n\nVERDICT: FINAL REJECTED\n\n- WI-003: broken';
    expect(parseFinalReviewVerdict(report)).toBe('unknown');
  });
});

describe('parseFinalReviewVerdict — everything else is unknown (fail closed)', () => {
  it('returns unknown when the report has no marker at all', () => {
    expect(parseFinalReviewVerdict('# Final Mission Review\n\nEverything looks reasonable.')).toBe(
      'unknown'
    );
  });

  it('returns unknown for a bare FINAL APPROVED / FINAL REJECTED marker without the VERDICT: prefix', () => {
    expect(parseFinalReviewVerdict('# Review\n\nFINAL APPROVED')).toBe('unknown');
    expect(parseFinalReviewVerdict('# Review\n\nFINAL REJECTED')).toBe('unknown');
  });

  it('returns unknown for a decorated trailer outside the pinned tolerances', () => {
    expect(parseFinalReviewVerdict('body\n\n> VERDICT: FINAL APPROVED')).toBe('unknown');
    expect(parseFinalReviewVerdict('body\n\n- VERDICT: FINAL APPROVED')).toBe('unknown');
    expect(parseFinalReviewVerdict('body\n\n## VERDICT: FINAL APPROVED')).toBe('unknown');
    expect(parseFinalReviewVerdict('body\n\nVERDICT: FINAL APPROVED.')).toBe('unknown');
    expect(parseFinalReviewVerdict('body\n\n**VERDICT: FINAL APPROVED')).toBe('unknown');
    expect(parseFinalReviewVerdict('body\n\nverdict: final approved')).toBe('unknown');
    expect(parseFinalReviewVerdict('body\n\nVERDICT: FINAL APPROVED (with caveats)')).toBe(
      'unknown'
    );
  });

  it('returns unknown for an empty or whitespace-only report', () => {
    expect(parseFinalReviewVerdict('')).toBe('unknown');
    expect(parseFinalReviewVerdict('   \n\n\t\n')).toBe('unknown');
  });

  it('returns unknown for non-string input rather than throwing', () => {
    expect(parseFinalReviewVerdict(null)).toBe('unknown');
    expect(parseFinalReviewVerdict(undefined)).toBe('unknown');
    expect(parseFinalReviewVerdict(42)).toBe('unknown');
    expect(parseFinalReviewVerdict({ verdict: 'VERDICT: FINAL APPROVED' })).toBe('unknown');
  });
});
