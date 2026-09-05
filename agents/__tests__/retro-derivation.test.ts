/**
 * Tests for WI-943: Retro derives learnings from completed finding-derived
 * items.
 *
 * Extends the EXISTING agents/retro.md — specifically step 3 "Capture
 * Structured Learnings (Debrief)" (currently at ~lines 124-166), which
 * today captures learnings from ad-hoc candidates surfaced in step 2
 * (rejection patterns, Amy findings, Stockwell/PR issues, tool/skill gaps).
 * This item extends it to ALSO derive one learning per completed
 * finding-derived work item (an item carrying WI-936's severity/
 * attributedAgent/fingerprint fields), keyed by source item so a re-run
 * updates instead of duplicates.
 *
 * SCOPING (per this item's own context, C3): the testable surface here is
 * retro.md's PROSE CONTRACT — that derivation reads item learning fields,
 * keys by source item, reads rejectionCount/workLog for outcome, and names
 * the refuting work_log entry for a false-positive. The server-side
 * idempotency this depends on (POST /api/learnings keying on sourceItemId)
 * was delivered by WI-936 and is tested there, not here.
 *
 * This repo tests agent/command/playbook markdown by parsing prose
 * invariants — see playbooks/__tests__/mission-tail-order.test.js and
 * commands/__tests__/resume-recovery.test.js for the established
 * convention this file follows: extract stable structural anchors
 * (headings, required concepts, CLI flags) and assert their presence and
 * relationships, never pin exact sentence wording B.A. is free to phrase
 * differently. (agents/__tests__/frankie-agent.test.ts deliberately scoped
 * OUT prose testing for ITS narrow WI-778 frontmatter-only scope — that was
 * a specific decision for that item, not a repo-wide rule; this item's own
 * dispatch explicitly directs prose-parsing coverage here.)
 *
 * CANONICAL RULES THAT MUST NOT BE RESTATED (per this item's context):
 * match-or-create (retro.md:132-140) and earliest-flagged-stage attribution
 * (retro.md:142, canonical at skills/teams-messaging/SKILL.md:373) already
 * exist and must keep applying to item-derived learnings too — this file
 * checks they still apply/are referenced, not that they're rewritten.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function sectionAfter(content: string, headingPattern: RegExp, stopPattern: RegExp = /^#{1,3}\s/m): string {
  const startIdx = content.search(headingPattern);
  if (startIdx === -1) return '';
  const afterHeadingLineIdx = content.indexOf('\n', startIdx) + 1;
  const stopRelIdx = content.slice(afterHeadingLineIdx).search(stopPattern);
  return stopRelIdx === -1
    ? content.slice(startIdx)
    : content.slice(startIdx, afterHeadingLineIdx + stopRelIdx);
}

let retroMd: string;
let step3: string;

beforeAll(() => {
  retroMd = read('agents/retro.md');
  step3 = sectionAfter(retroMd, /^### 3\. Capture Structured Learnings/m);
});

describe('agents/retro.md — step 3 exists and is the derivation section', () => {
  it('step 3 "Capture Structured Learnings (Debrief)" exists', () => {
    expect(step3).not.toBe('');
  });
});

// =============================================================================
// AC1: exactly one learning per finding-derived item; none for items with
// no learning fields.
// =============================================================================

describe('AC1: derives one learning per finding-derived item, none for items without learning fields', () => {
  it('derives from work items carrying the learning fields (severity, attributedAgent, fingerprint)', () => {
    expect(step3).toMatch(/severity/i);
    expect(step3).toMatch(/attributedAgent|attributed-agent/i);
    expect(step3).toMatch(/fingerprint/i);
    expect(step3).toMatch(/work item|finding-derived item/i);
  });

  it('skips items that carry no learning fields (not every item produces a learning)', () => {
    // The "no learning fields -> no row" rule must be stated explicitly —
    // not just "match-or-create for candidates" (the pre-existing ad-hoc
    // language), which alone doesn't establish the ONE-learning-per-item
    // system this AC requires.
    expect(step3).toMatch(/missing any of the three fields|no learning fields|carries? none|carries? no (severity|learning)/i);
  });

  it('the skip rule covers all three fields, not just severity (WI-936: severity, attributedAgent, and fingerprint all required)', () => {
    // A prior wording named only "severity is null" as the skip condition,
    // so an item with a non-null severity but a null fingerprint matched
    // neither the "derive" branch nor the "skip" branch (the emit command
    // requires --fingerprint). Isolate the clause describing the skip
    // condition itself (not the earlier sentence that lists all three
    // fields as required for derivation) and confirm it doesn't single out
    // severity alone.
    const clauseMatch = step3.match(/An item[\s\S]*?is explicitly skipped/i);
    expect(clauseMatch).not.toBeNull();
    const clause = clauseMatch![0];
    expect(clause).not.toMatch(/\(severity is null\)/i);
    const namesAllThreeFields =
      /severity/i.test(clause) && /attributedAgent|attributed-agent/i.test(clause) && /fingerprint/i.test(clause);
    const referencesThreeFieldsGenerically = /missing any of the three fields/i.test(clause);
    expect(namesAllThreeFields || referencesThreeFieldsGenerically).toBe(true);
  });
});

// =============================================================================
// AC2: outcome data from the source item's rejectionCount and work log.
// =============================================================================

// =============================================================================
// PR #67 review: item derivation must be scoped to the DISPATCHED mission.
// `ateam items listItems --json` returns every unarchived item in the project,
// and a previous mission's completed items can remain unarchived when an entry
// point created the next mission without --force — so a project-wide fetch
// would derive an older mission's finding-derived items under the current
// missionId, and per-mission dedupe would store them as fresh rows.
// =============================================================================

describe('PR #67 review: item derivation is scoped to the dispatched mission', () => {
  function listItemsLinesIn(section: string): string[] {
    return section.split('\n').filter((line) => /ateam items listItems/.test(line));
  }

  it('step 1 fetches work items with --missionId, never a project-wide listItems', () => {
    const step1 = sectionAfter(retroMd, /^### 1\. Gather Mission Data/m, /^### /m);
    const lines = listItemsLinesIn(step1);
    expect(lines.length, 'expected step 1 to fetch work items via ateam items listItems').toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/--missionId\s+\S+/);
    }
  });

  it('step 1 includes archived items so a retrospective re-run after archival sees the same set', () => {
    const step1 = sectionAfter(retroMd, /^### 1\. Gather Mission Data/m, /^### /m);
    for (const line of listItemsLinesIn(step1)) {
      expect(line).toMatch(/--includeArchived/);
    }
  });

  it('no bare project-wide listItems invocation remains anywhere in retro.md', () => {
    const bare = listItemsLinesIn(retroMd).filter((line) => !/--missionId/.test(line));
    expect(bare).toEqual([]);
  });

  it('step 3 ties derivation to the dispatched mission\'s items (the mission-scoped fetch), not "every completed item"', () => {
    const idx = step3.search(/Deriving learnings from finding-derived work items/);
    expect(idx).toBeGreaterThan(-1);
    const window = step3.slice(idx, idx + 600);
    expect(window).toMatch(/dispatched mission|mission-scoped/i);
    expect(window).toMatch(/--missionId/);
  });
});

describe('AC2: derived learning carries outcome data from rejectionCount and work log', () => {
  it('reads rejectionCount from the source item', () => {
    expect(step3).toMatch(/rejectionCount/);
  });

  it('reads the work log for outcome data', () => {
    expect(step3).toMatch(/work ?log/i);
  });

  it('a bounced fix is distinguishable from one that landed first time', () => {
    const idx = step3.search(/rejectionCount/);
    expect(idx).toBeGreaterThan(-1);
    const window = step3.slice(idx, idx + 400);
    expect(window).toMatch(/bounce|first time|distinguish|outcome/i);
  });
});

// =============================================================================
// AC3: a second debrief run updates the existing learning per source item,
// never duplicates — keyed by --source-item-id (WI-936's server-side dedupe
// key, not restated here, just used).
// =============================================================================

describe('AC3: re-running the debrief updates existing learnings, never duplicates (keyed by source item)', () => {
  it('emits --source-item-id on the learnings create call for item-derived rows', () => {
    expect(step3).toMatch(/--source-item-id/);
  });

  it('states re-running updates rather than duplicates', () => {
    const idx = step3.search(/--source-item-id/);
    expect(idx).toBeGreaterThan(-1);
    const window = step3.slice(Math.max(0, idx - 300), idx + 300);
    expect(window).toMatch(/update|idempotent|re-?run|second (debrief|run)/i);
  });

  it('does not restate the server-side dedupe mechanism (WI-936 owns that, referenced not re-derived)', () => {
    // The dedupe key change (findFirst fast path + P2002 backstop keyed on
    // sourceItemId) is WI-936's implementation detail — retro.md should use
    // --source-item-id, not explain HOW the server dedupes with it.
    expect(step3).not.toMatch(/P2002/);
    expect(step3).not.toMatch(/findFirst/);
  });
});

// =============================================================================
// AC4: a fix agent's disproved finding gets an explicit false-positive
// outcome, naming the refuting work_log entry (agent + summary) — never
// silently dropped.
// =============================================================================

describe('AC4: a disproved finding records an explicit false-positive outcome naming the refuting entry', () => {
  it('states a disproved finding is recorded, never silently dropped', () => {
    expect(step3).toMatch(/false.positive/i);
    expect(step3).toMatch(/never|not (silently )?dropp?ed|silently/i);
  });

  it('names the refuting work_log entry — the agent and its summary', () => {
    const idx = step3.search(/false.positive/i);
    expect(idx).toBeGreaterThan(-1);
    const window = step3.slice(idx, idx + 500);
    expect(window).toMatch(/agent/i);
    expect(window).toMatch(/summary/i);
  });
});

// =============================================================================
// AC5: a fingerprint matching an already-open learning is a recurrence, not
// a new one — the EXISTING match-or-create rule (step 3a) must still apply
// to item-derived learnings, not be bypassed by the new item-keyed path.
// =============================================================================

describe('AC5: fingerprint recurrence still applies to item-derived learnings (existing match-or-create rule)', () => {
  it('the match-or-create rule (step 3a) is still present and unrestated elsewhere', () => {
    expect(retroMd).toMatch(/ateam learnings fingerprints/);
    expect(retroMd).toMatch(/match-or-create|match or create/i);
    // Canonical rule appears exactly once as instructional content — not
    // copy-pasted into a second location for the item-derivation path.
    const matches = [...retroMd.matchAll(/Match-or-create against existing fingerprints/gi)];
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  it('item-derived learnings still go through match-or-create (not bypassed by source-item keying)', () => {
    // The --source-item-id addition must not replace fingerprint matching —
    // both a source-item key AND a matched/minted fingerprint are emitted
    // together (see AC3's flag test + this file's existing --fingerprint
    // check on the emit-row template).
    expect(step3).toMatch(/--fingerprint/);
  });
});

// =============================================================================
// NFR-2 (AC6): a derived learning's detail carries no secrets and no raw
// diff, even when the source item's work log contains them.
// =============================================================================

describe('NFR-2: derived learning detail carries no secrets or raw diff content', () => {
  it('states detail must never contain secrets or raw diff content', () => {
    expect(retroMd).toMatch(/never.{0,80}(secret|credential|token)/is);
    expect(retroMd).toMatch(/raw diff|verbatim diff/i);
  });

  it('the constraint explicitly covers work-log-sourced content (not just the general rule)', () => {
    // AC6 specifically calls out "even when the source item's work log
    // contains them" — the constraint must be scoped to apply to
    // derivation-from-work-log, not just the pre-existing general
    // detail-writing guidance.
    const idx = retroMd.search(/never.{0,80}(secret|credential|token)/is);
    expect(idx).toBeGreaterThan(-1);
    const window = retroMd.slice(Math.max(0, idx - 300), idx + 300);
    expect(window).toMatch(/work ?log/i);
  });
});
