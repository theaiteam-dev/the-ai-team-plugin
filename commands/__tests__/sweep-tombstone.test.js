/**
 * Tests for WI-944: Retire /ai-team:sweep to a tombstone and move every
 * pointer.
 *
 * `commands/sweep.md` becomes a one-release tombstone: it prints a pointer
 * to `/ai-team:review` (explaining review creates a mission instead of
 * autofixing) and stops — no review, no fixes, no commit, no forwarding
 * (per this item's context, Resolved Open Question 5: tombstone for one
 * release, no forwarding, then deleted in a following release — this item
 * does NOT delete the file). Four other documents currently still point an
 * operator/agent at sweep as a live command and must redirect to
 * `/ai-team:review` instead: `commands/run.md:477` (the end-of-mission
 * tip), `commands/tuning.md:44` (the empty-candidates message),
 * `skills/code-review/SKILL.md:3` (the description frontmatter), and
 * `agents/retro.md:77`. This is the COMPLETE list per this item's own
 * verified-by-grep context — the PRD names only the first two.
 *
 * SCOPING DECISION (AC2's repo-wide sweep): a plain repo-wide search for the
 * literal string "/ai-team:sweep" is too blunt. `commands/review.md` (WI-938)
 * and `commands/bug-stomp.md` (WI-940) — both already reviewed, tested, and
 * staged — legitimately mention "/ai-team:sweep" in COMPARATIVE/historical
 * framing describing their own design lineage ("The replacement front door
 * for `/ai-team:sweep`", "mirroring `/ai-team:sweep`", "the same mapping
 * `/ai-team:sweep`'s capture step uses", "the same rule the retro agent and
 * `/ai-team:sweep` use") — none of these RECOMMEND running sweep; they
 * explain what changed. This item's own context enumerates the COMPLETE
 * pointer list as exactly four files, and review.md/bug-stomp.md are not
 * among them — confirmed by grep before writing this file (`grep -rn
 * "ai-team:sweep" --include="*.md" agents commands docs playbooks skills
 * README.md CLAUDE.md`, which found sweep mentions in exactly six files:
 * the four real pointers, plus review.md and bug-stomp.md's comparative
 * mentions, plus sweep.md's own self-reference). So the sweep below excludes
 * sweep.md (self) and review.md/bug-stomp.md (comparative, out of this
 * item's declared scope, already-approved) by name, then asserts no OTHER
 * markdown file in the repo-wide set still mentions "/ai-team:sweep" at
 * all — with a positive control proving the exclusion list itself is still
 * accurate (sweep.md/review.md/bug-stomp.md really do still mention it).
 *
 * Convention: this repo tests command/agent markdown by parsing prose
 * invariants — see commands/__tests__/resume-recovery.test.js and
 * playbooks/__tests__/mission-tail-order.test.js for the precedent. AC2's
 * repo-wide sweep is added as a sibling suite in mission-tail-order.test.js
 * per this item's own dispatch instructions, reusing that file's
 * collectMarkdownFiles() helper and allMarkdownFiles() file set — NOT
 * looksLikeConfigTemplate() (an unrelated ateam.config.json-template
 * heuristic). This file carries the four-named-pointer check directly (each
 * needs its own file read regardless) plus AC1 (the tombstone body itself)
 * and AC3 (no duplicate learning-capture path).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

let sweepMd;
let runMd;
let tuningMd;
let skillMd;
let retroMd;

beforeAll(() => {
  sweepMd = read('commands/sweep.md');
  runMd = read('commands/run.md');
  tuningMd = read('commands/tuning.md');
  skillMd = read('skills/code-review/SKILL.md');
  retroMd = read('agents/retro.md');
});

// =============================================================================
// AC1: running sweep prints a pointer to /ai-team:review explaining review
// creates a mission instead of autofixing, and does nothing else — no
// review is run, no fixes are made, no commit is created.
// =============================================================================

describe('AC1: commands/sweep.md is a tombstone — points at /ai-team:review and does nothing else', () => {
  it('points at /ai-team:review', () => {
    expect(sweepMd).toMatch(/\/ai-team:review/);
  });

  it('explains review creates a mission instead of autofixing', () => {
    const idx = sweepMd.search(/\/ai-team:review/);
    expect(idx, 'expected a /ai-team:review mention').toBeGreaterThan(-1);
    const window = sweepMd.slice(idx, idx + 500);
    expect(window, 'expected the pointer to mention a mission').toMatch(/mission/i);
    expect(window, 'expected the pointer to contrast with autofixing').toMatch(/instead of|rather than/i);
    expect(window, 'expected the pointer to mention autofix/fixing').toMatch(/autofix|fix/i);
  });

  it('no longer runs a review (the ai-team:code-review skill dispatch is gone)', () => {
    expect(sweepMd).not.toMatch(/ai-team:code-review/);
  });

  it('no longer captures findings as RetroLearning rows (the "ateam learnings create" call is gone)', () => {
    expect(sweepMd).not.toMatch(/ateam learnings create/);
  });

  it('no longer autofixes (no subagent fan-out for fixes)', () => {
    expect(sweepMd).not.toMatch(/clean-code-architect/);
  });

  it('no longer creates a commit', () => {
    expect(sweepMd).not.toMatch(/one commit for the whole sweep|fix\(\{scope\}\)/);
    expect(sweepMd).not.toMatch(/git commit/);
  });

  it('does not forward to /ai-team:review by invoking it itself — it stops after printing the pointer (Resolved Open Question 5: no forwarding)', () => {
    expect(sweepMd).not.toMatch(/Agent\(|subagent_type:\s*"ai-team:review"/);
    expect(sweepMd).toMatch(/stop/i);
  });
});

// =============================================================================
// AC2 (the four named live pointers specifically; the repo-wide sweep lives
// as a sibling suite in playbooks/__tests__/mission-tail-order.test.js): no
// document still recommends sweep as a command to run.
// =============================================================================

describe('AC2: the four named live pointers redirect to /ai-team:review instead of /ai-team:sweep', () => {
  it('commands/run.md\'s end-of-mission tip no longer mentions /ai-team:sweep and points at /ai-team:review', () => {
    expect(runMd, 'commands/run.md still mentions /ai-team:sweep').not.toMatch(/\/ai-team:sweep/);
    expect(runMd, 'commands/run.md does not point at /ai-team:review').toMatch(/\/ai-team:review/);
  });

  it('commands/tuning.md\'s empty-candidates message no longer mentions /ai-team:sweep and points at /ai-team:review', () => {
    expect(tuningMd, 'commands/tuning.md still mentions /ai-team:sweep').not.toMatch(/\/ai-team:sweep/);
    expect(tuningMd, 'commands/tuning.md does not point at /ai-team:review').toMatch(/\/ai-team:review/);
  });

  it('skills/code-review/SKILL.md\'s description frontmatter no longer mentions /ai-team:sweep and points at /ai-team:review', () => {
    expect(skillMd, 'skills/code-review/SKILL.md still mentions /ai-team:sweep').not.toMatch(/\/ai-team:sweep/);
    expect(skillMd, 'skills/code-review/SKILL.md does not point at /ai-team:review').toMatch(/\/ai-team:review/);
  });

  it('agents/retro.md\'s reference no longer mentions /ai-team:sweep and points at /ai-team:review', () => {
    expect(retroMd, 'agents/retro.md still mentions /ai-team:sweep').not.toMatch(/\/ai-team:sweep/);
    expect(retroMd, 'agents/retro.md does not point at /ai-team:review').toMatch(/\/ai-team:review/);
  });
});

// =============================================================================
// AC3: the learning-capture behaviour sweep used to perform is gone rather
// than duplicated — a single finding cannot produce both a capture-time row
// (sweep's old Step 2) and a derived row (retro's WI-943 derivation).
// =============================================================================

describe('AC3: capture is retired, not duplicated — sweep no longer writes RetroLearning rows itself', () => {
  it('sweep.md no longer emits capture-time RetroLearning rows ("ateam learnings create" is gone)', () => {
    expect(sweepMd).not.toMatch(/ateam learnings create/);
  });

  it('sweep.md no longer documents the match-or-create fingerprint step for its own capture (that step lived with the retired Step 2)', () => {
    expect(sweepMd).not.toMatch(/ateam learnings fingerprints/);
  });

  it('retro.md (WI-943\'s item-derivation) is still in place as the sole learning-capture path — regression guard so a removed sweep capture step is never left with zero learning paths', () => {
    expect(retroMd).toMatch(/severity/i);
    expect(retroMd).toMatch(/attributedAgent|attributed-agent/i);
    expect(retroMd).toMatch(/fingerprint/i);
    expect(retroMd).toMatch(/--source-item-id/);
  });
});
