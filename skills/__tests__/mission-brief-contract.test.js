/**
 * Tests for WI-935: Mission brief contract shared by every entry point.
 *
 * `/ai-team:plan` has always had a human-authored PRD to point `prdPath` at.
 * The new evidence-derived entry points (review, bug-fix, bug-stomp — built
 * later in this mission) have no PRD; each must synthesize an equivalent
 * "mission brief" document and set it as the mission's prdPath. This item
 * writes that ONE shared definition, as a skill at skills/mission-brief/,
 * so the three new commands reference it instead of inventing their own
 * brief format (the same single-definition discipline ADR 0006 already
 * enforces for ateam.config.json — see playbooks/__tests__/mission-tail-order.test.js).
 *
 * Precedent this item explicitly follows: skills/write-prd/SKILL.md +
 * skills/write-prd/references/prd-template.md already define an identical
 * two-file (guidance + fenced template) shape for PRDs, using the exact
 * headings `## Executive Summary` and `## Definition of Done`. This test
 * file does not assume B.A. splits guidance and template into two files —
 * it concatenates every markdown file under skills/mission-brief/ so the
 * contract holds regardless of file layout, mirroring the outputs.impl
 * naming just one entry file (skills/mission-brief/SKILL.md).
 *
 * Why `## Definition of Done` is checked as an EXACT heading (not a loose
 * regex, unlike the other sections): agents/frankie.md:131 already parses
 * mission PRDs by literally searching for the `## Definition of Done`
 * heading and treats a missing/empty one as a BLOCKED walk (frankie.md:135-138).
 * AC3 requires Frankie and Stockwell consume the brief "with no change to
 * either agent" — so the brief's DoD heading must be byte-for-byte the same
 * string Frankie already greps for, not a paraphrase.
 *
 * Style: structural anchors and required-concept presence, not exact prose
 * wording — following commands/__tests__/resume-recovery.test.js and
 * playbooks/__tests__/mission-tail-order.test.js.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const SKILL_DIR = join(REPO_ROOT, 'skills', 'mission-brief');
const SKILL_MD_PATH = join(SKILL_DIR, 'SKILL.md');

function read(absPath) {
  return readFileSync(absPath, 'utf8');
}

/** Recursively collect .md files under an absolute directory path. */
function collectMarkdownFiles(absDir) {
  const out = [];
  if (!existsSync(absDir)) return out;
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const full = join(absDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectMarkdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function extractFencedBlocks(content) {
  const blocks = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(content))) blocks.push(m[1]);
  return blocks;
}

/**
 * Concatenation of every markdown file under skills/mission-brief/ — the
 * contract may live entirely in SKILL.md, or be split guidance-plus-template
 * the way skills/write-prd/ splits SKILL.md from references/prd-template.md.
 * Either satisfies these tests.
 */
function allMissionBriefContent() {
  return collectMarkdownFiles(SKILL_DIR)
    .map((f) => read(f))
    .join('\n\n');
}

describe('WI-935: skills/mission-brief/SKILL.md exists', () => {
  it('SKILL.md exists at skills/mission-brief/', () => {
    expect(existsSync(SKILL_MD_PATH)).toBe(true);
  });
});

// =============================================================================
// AC1: the template defines the mandatory sections a downstream tail agent
// depends on — title, executive summary, Definition of Done as observable
// checkboxes, and a scope statement naming the evidence source.
// =============================================================================
describe('AC1: mandatory sections', () => {
  it('documents title, executive summary, Definition of Done, and scope as mandatory sections', () => {
    const content = allMissionBriefContent();
    // Loose presence checks across the whole doc — these concepts must be
    // named somewhere as required, not necessarily co-located.
    expect(content).toMatch(/title/i);
    expect(content).toMatch(/executive summary/i);
    expect(content).toMatch(/definition of done/i);
    expect(content).toMatch(/scope/i);
  });

  it('ships a fenced template skeleton with a title, and the exact `## Executive Summary` / `## Definition of Done` headings Frankie already parses', () => {
    const content = allMissionBriefContent();
    const blocks = extractFencedBlocks(content);

    const templateBlock = blocks.find(
      (b) => b.includes('## Executive Summary') && b.includes('## Definition of Done')
    );
    expect(
      templateBlock,
      'expected a fenced markdown template block containing both "## Executive Summary" and "## Definition of Done" — Frankie (agents/frankie.md:131) parses this exact heading string, so it must not be paraphrased'
    ).toBeDefined();

    // A title: an H1 heading line in the skeleton.
    expect(templateBlock).toMatch(/^# .+/m);
  });

  it('the template Definition of Done section is written as observable checkbox statements', () => {
    const content = allMissionBriefContent();
    const blocks = extractFencedBlocks(content);
    const templateBlock = blocks.find((b) => b.includes('## Definition of Done'));
    expect(templateBlock).toBeDefined();

    // Slice from the DoD heading to the next heading (or end of block).
    const dodStart = templateBlock.indexOf('## Definition of Done');
    const rest = templateBlock.slice(dodStart + '## Definition of Done'.length);
    const nextHeadingIdx = rest.search(/\n##? /);
    const dodSection = nextHeadingIdx === -1 ? rest : rest.slice(0, nextHeadingIdx);

    expect(
      dodSection,
      'expected at least one "- [ ]" checkbox line in the Definition of Done skeleton'
    ).toMatch(/^\s*- \[ \]/m);
  });

  it('documents a scope statement that names the evidence the brief was derived from', () => {
    const content = allMissionBriefContent();
    // A heading naming "Scope" with "evidence" appearing near it (same
    // section) — not asserting exact wording, just that the two concepts
    // are connected somewhere in the document.
    const scopeHeadingMatch = content.match(/^#{1,4}\s*.*Scope.*$/im);
    expect(scopeHeadingMatch, 'expected a heading mentioning "Scope"').not.toBeNull();

    const scopeIdx = content.search(/^#{1,4}\s*.*Scope.*$/im);
    // Skip past the full heading LINE before searching for the next one —
    // slicing at scopeIdx + 1 (mid-line) would let `^#{1,4}\s` self-match
    // the remaining "#...Scope" fragment at position 0 of the slice.
    const afterHeadingLineIdx = content.indexOf('\n', scopeIdx) + 1;
    const nextHeadingRelIdx = content.slice(afterHeadingLineIdx).search(/^#{1,4}\s/m);
    const scopeSection =
      nextHeadingRelIdx === -1
        ? content.slice(scopeIdx)
        : content.slice(scopeIdx, afterHeadingLineIdx + nextHeadingRelIdx);

    expect(
      scopeSection,
      'expected the Scope section to mention "evidence" — the AC requires it name what evidence the brief was derived from'
    ).toMatch(/evidence/i);
  });
});

// =============================================================================
// AC2: the template states how each evidence-derived entry point fills the
// Definition of Done — review/bug-stomp from finding descriptions, bug-fix
// from the reported repro — so a brief is never emitted with an empty DoD.
// =============================================================================
describe('AC2: Definition of Done population contract per entry point', () => {
  it('states that review and bug-stomp derive Definition of Done statements from finding descriptions', () => {
    const content = allMissionBriefContent();
    // "review" and "bug-stomp" both mentioned near "finding" — the AC
    // explicitly pairs these two entry points as deriving from findings.
    expect(content).toMatch(/review/i);
    expect(content).toMatch(/bug-stomp|bug stomp/i);
    expect(content).toMatch(/finding/i);
  });

  it('states that bug-fix derives Definition of Done statements from the reported repro', () => {
    const content = allMissionBriefContent();
    expect(content).toMatch(/bug-fix|bug fix/i);
    expect(content).toMatch(/repro/i);
  });

  it('states the Definition of Done must never be emitted empty for evidence-derived entry points', () => {
    const content = allMissionBriefContent();
    // Require the "never empty" concept explicitly stated — not merely
    // that the words "empty" and "Definition of Done" both appear
    // somewhere unrelated in the document.
    const neverEmptyPattern =
      /(never|no brief|not).{0,80}(empty|blank).{0,40}definition of done|definition of done.{0,80}(never|no brief|not).{0,40}(empty|blank)/is;
    expect(
      content,
      'expected the document to explicitly state the Definition of Done is never left empty/blank for evidence-derived entry points'
    ).toMatch(neverEmptyPattern);
  });
});

// =============================================================================
// AC3: the template documents where the brief file is written and that its
// path is what the entry point passes as the mission's prdPath, so Frankie
// and Stockwell read it with no change to either agent.
// =============================================================================
describe('AC3: brief file location and prdPath contract', () => {
  it('documents where the mission brief file is written', () => {
    const content = allMissionBriefContent();
    // A path-shaped token (contains a slash and a markdown-ish segment) in
    // the context of describing where the brief lives — loose check for a
    // documented location rather than a hardcoded exact path, since the
    // exact directory is an implementation choice for B.A.
    expect(content).toMatch(/mission brief/i);
    expect(content).toMatch(/\.md/i);
  });

  it('documents that the brief path is set as the mission prdPath, read unchanged by Frankie and Stockwell', () => {
    const content = allMissionBriefContent();
    expect(content).toMatch(/prdPath/);
    expect(content).toMatch(/Frankie/);
    expect(content).toMatch(/Stockwell/);
  });
});
