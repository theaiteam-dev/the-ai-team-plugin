/**
 * Tests for mission-tail ordering consistency across every doc that states it
 * (WI-781, re-keyed by WI-796).
 *
 * The mission tail as of WI-786..795 is: all items reach `staged` (the
 * per-item pipeline's real terminal stage) -> Frankie -> Stockwell's Final
 * Mission Review -> an APPROVED verdict promotes every staged item to `done`
 * via the API (WI-790) -> post-checks -> Tawnia. `done` is no longer the
 * per-item pipeline's terminal stage and is no longer the Frankie/Stockwell
 * dispatch trigger — it is now reached ONLY after the tail promotes staged
 * items, and sits between Stockwell's approval and post-checks in every
 * pipeline-flow diagram. A Frankie or Stockwell failure is no longer
 * documented as "a manual operator action outside the pipeline" (that framing
 * assumed `done` was terminal with no board-move path out of it) — it is now
 * a REAL backward move Hannibal executes via `ateam board-move moveItem`
 * (staged -> testing or implementing, per the earliest-flagged-stage rule),
 * which WI-794 made a first-class rejection-cap-counted transition. Once
 * those items are back in `staged`, the tail restarts at Frankie for a full
 * Definition of Done re-walk.
 *
 * This file asserts that order/content is actually stated (not just that
 * "Frankie" appears somewhere) in every file that documents the tail: both
 * orchestration playbooks, agents/hannibal.md, commands/run.md, CLAUDE.md,
 * README.md, and docs/ORCHESTRATION.md.
 *
 * Precedent for structurally parsing markdown/prose docs instead of grepping
 * sentences: commands/__tests__/resume-recovery.test.js already does this for
 * commands/resume.md against TRANSITION_MATRIX. This file follows the same
 * "extract stable structural anchors, assert relationships between them"
 * approach — never asserting on exact prose wording, only on the relative
 * order of short, stable tokens (agent proper nouns, section headings) and,
 * for the newly-rewritten failure/rejection passages, on the presence of a
 * small set of REQUIRED concepts (earliest-flagged-stage rule, a real
 * board-move, `staged` as the item's landing stage) rather than any single
 * exact phrasing — B.A. gets latitude in how those concepts are worded.
 *
 * IMPORTANT structural note: playbooks/orchestration-native.md organizes its
 * "Agent Dispatch Workflows" as a reference catalog (Murdock, B.A., Lynch,
 * Amy, Tawnia, Retro dispatch patterns, in that fixed catalog order) that is
 * physically separate from — and NOT in execution order with — the
 * "Final Mission Review Dispatch" section that appears later in the file.
 * A naive whole-file indexOf(Frankie) < indexOf(Stockwell) < indexOf(Tawnia)
 * chain would therefore be WRONG for that file: Tawnia's catalog entry can
 * legitimately sit before the Final Mission Review Dispatch section forever,
 * regardless of execution order. For both playbooks this file scopes its
 * order assertions to what's actually execution-order-meaningful: the
 * MISSION_COMPLETE trigger must route to Frankie (not straight to Stockwell),
 * and a Frankie dispatch block must exist and physically precede the Final
 * Mission Review Dispatch section (both live outside the reference catalog).
 * The full chain is checked where the file's structure actually supports it:
 * the linear, single-narrative files (CLAUDE.md, README.md, commands/run.md,
 * agents/hannibal.md) and the fenced pipeline-flow diagrams specifically.
 *
 * SCOPING DECISION (Murdock, WI-796): the fenced pipeline-flow diagrams
 * (self-contained, so ordering is unambiguous) pin the FULL new chain
 * including `done`'s new position (after Stockwell, before post-checks —
 * see AC4: promotion happens as part of persisting an APPROVED verdict, so
 * items are already `done` before post-checks/Tawnia run). The prose
 * "numbered stage-transition lists" (README.md, commands/run.md) only pin
 * that `staged` appears ahead of the Frankie/Stockwell/post-checks/Tawnia
 * sequence — NOT `done`'s exact position within that prose — because unlike
 * a diagram, a flowing paragraph restating rework/promotion can legitimately
 * mention "done" several times in non-execution-order places (e.g. "any
 * rework that returns items to staged" language sitting near an earlier
 * "promotes to done" mention). Pinning `done`'s exact position there would
 * be presumptuous of B.A.'s prose and brittle to reasonable rewordings.
 *
 * Two cross-file guards live at the bottom: a proximity-regex sweep that no
 * doc still credits Lynch with the final review (replacing brittle
 * exact-phrase negatives), and the ADR 0006 guard that commands/setup.md is
 * the ONLY markdown file carrying an ateam.config.json template block.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

/** Recursively collect .md files under a repo-relative directory. */
function collectMarkdownFiles(relDir) {
  const out = [];
  for (const entry of readdirSync(join(REPO_ROOT, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...collectMarkdownFiles(rel));
    } else if (entry.name.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}

/** Return the inner content of every fenced code block (``` ... ```). */
function extractFencedBlocks(content) {
  const blocks = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(content))) blocks.push(m[1]);
  return blocks;
}

/**
 * Given content and an ORDERED list of {name, pattern} milestones, returns a
 * list of human-readable violation strings: one for any milestone that is
 * missing entirely, and one for any pair that is out of order. Empty array
 * means every milestone was found and they appear in the declared order.
 */
function checkAscendingOrder(content, milestones) {
  const violations = [];
  const indices = milestones.map((m) => ({ name: m.name, index: content.search(m.pattern) }));

  for (const { name, index } of indices) {
    if (index === -1) {
      violations.push(`missing: expected to find "${name}"`);
    }
  }

  for (let i = 1; i < indices.length; i++) {
    const prev = indices[i - 1];
    const curr = indices[i];
    if (prev.index === -1 || curr.index === -1) continue; // already reported as missing
    if (curr.index <= prev.index) {
      violations.push(`out of order: "${prev.name}" (at ${prev.index}) must come before "${curr.name}" (at ${curr.index})`);
    }
  }

  return violations;
}

/** Extract the first fenced code block (``` ... ```) after a heading match. */
function extractCodeBlockAfter(content, headingPattern) {
  const headingMatch = content.match(headingPattern);
  if (!headingMatch) return null;
  const startSearchFrom = headingMatch.index + headingMatch[0].length;
  const rest = content.slice(startSearchFrom);
  const fenceMatch = rest.match(/```[a-z]*\n([\s\S]*?)```/);
  return fenceMatch ? fenceMatch[1] : null;
}

/** Extract the text between a heading and the next heading of the same or higher level. */
function extractSection(content, headingPattern, nextHeadingPattern) {
  const headingMatch = content.match(headingPattern);
  if (!headingMatch) return null;
  const start = headingMatch.index + headingMatch[0].length;
  const rest = content.slice(start);
  const endMatch = rest.match(nextHeadingPattern);
  return endMatch ? rest.slice(0, endMatch.index) : rest;
}

const STOCKWELL = { name: 'Stockwell', pattern: /stockwell/i };
const POSTCHECKS = { name: 'Post-Checks', pattern: /post-checks?/i };
const TAWNIA = { name: 'Tawnia', pattern: /tawnia/i };
const FRANKIE = { name: 'Frankie', pattern: /frankie/i };
const DONE = { name: 'done', pattern: /\bdone\b/i };
const PROBING = { name: 'Probing', pattern: /\bprobing\b/i };
const STAGED = { name: 'Staged', pattern: /\bstaged\b/i };

// Required-concept fragments for the rewritten Frankie-failure / FINAL
// REJECTED passages (AC2/AC3). Deliberately loose (concept, not exact
// phrase) per the file's own "stable anchors, not exact wording" rule.
const EARLIEST_FLAGGED_STAGE = /earliest[- ]flagged[- ]stage/i;
const REAL_BOARD_MOVE = /board-move|move (?:each|every|the) named item/i;
const STALE_MANUAL_ACTION_LANGUAGE = /manual operator action/i;

// =============================================================================
// Fenced pipeline-flow diagrams: CLAUDE.md, README.md, commands/run.md
// Order checked WITHIN the diagram block itself (self-contained, so "done"
// as a common English word can't false-match earlier prose). Full chain
// including `done`'s new position AFTER Stockwell (promotion) and BEFORE
// post-checks — see file header "SCOPING DECISION" for why only the
// self-contained diagrams pin `done`'s exact position.
// =============================================================================
describe('pipeline-flow diagrams state probing -> staged -> Frankie -> Stockwell -> done -> Post-Checks -> Tawnia', () => {
  it('CLAUDE.md Execution Phase diagram', () => {
    const content = read('CLAUDE.md');
    const diagram = extractCodeBlockAfter(content, /\*\*Execution Phase.*?:\*\*/);
    expect(diagram, 'expected a fenced code block after "**Execution Phase...**" in CLAUDE.md').not.toBeNull();
    const violations = checkAscendingOrder(diagram, [PROBING, STAGED, FRANKIE, STOCKWELL, DONE, POSTCHECKS, TAWNIA]);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('README.md Execution Phase diagram', () => {
    const content = read('README.md');
    // NOTE: anchored on "Each feature flows through stages sequentially:",
    // not the "### Execution Phase" heading itself — an earlier ```bash
    // concurrency-override example sits between the heading and the actual
    // pipeline diagram, and would be the first fenced block matched otherwise.
    const diagram = extractCodeBlockAfter(content, /Each feature flows through stages sequentially:\n/);
    expect(diagram, 'expected a fenced code block after "Each feature flows through stages sequentially:" in README.md').not.toBeNull();
    const violations = checkAscendingOrder(diagram, [PROBING, STAGED, FRANKIE, STOCKWELL, DONE, POSTCHECKS, TAWNIA]);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('commands/run.md Pipeline Flow diagram', () => {
    const content = read('commands/run.md');
    const diagram = extractCodeBlockAfter(content, /## Pipeline Flow.*?\n/);
    expect(diagram, 'expected a fenced code block after "## Pipeline Flow" in commands/run.md').not.toBeNull();
    const violations = checkAscendingOrder(diagram, [PROBING, STAGED, FRANKIE, STOCKWELL, DONE, POSTCHECKS, TAWNIA]);
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

// =============================================================================
// Numbered / linear stage-transition prose: README.md and commands/run.md
// each restate the tail as a flat, sequential list — global whole-file order
// is meaningful here (unlike the native playbook's reference catalog). Only
// `staged` is added to the milestone chain here, not `done` — see file
// header "SCOPING DECISION".
// =============================================================================
describe('numbered stage-transition lists state the same order', () => {
  it('README.md "Stage transitions" list', () => {
    const content = read('README.md');
    const section = extractSection(content, /\*\*Stage transitions:?\*\*/, /\n## /);
    expect(section, 'expected a "Stage transitions" list in README.md').not.toBeNull();
    const violations = checkAscendingOrder(section, [STAGED, FRANKIE, STOCKWELL, POSTCHECKS, TAWNIA]);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('commands/run.md "Stage transitions" numbered list', () => {
    const content = read('commands/run.md');
    const section = extractSection(content, /\*\*Stage transitions \(ALL REQUIRED\):\*\*/, /\n## /);
    expect(section, 'expected a "Stage transitions" list in commands/run.md').not.toBeNull();
    const violations = checkAscendingOrder(section, [STAGED, FRANKIE, STOCKWELL, POSTCHECKS, TAWNIA]);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('commands/run.md per-step instructions place staged/Frankie between the last item reaching staged and Final Mission Review (Behavior section)', () => {
    const content = read('commands/run.md');
    const section = extractSection(content, /## Behavior/, /\n(?=\d{2}\. )/); // through the numbered steps
    expect(section, 'expected a "## Behavior" section with numbered steps in commands/run.md').not.toBeNull();
    const violations = checkAscendingOrder(section, [STAGED, FRANKIE, STOCKWELL, POSTCHECKS, TAWNIA]);
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

// =============================================================================
// README.md carries a SECOND, separate "Final Mission Review" narrative
// under "## Key Features" (~line 380), distinct from the "Pipeline Flow"
// diagram section (~line 296) already pinned above. Lynch's WI-796 rework
// rejection: this section was missed by every prior assertion and still
// stated the old all-done trigger + "manual, not an automated bounce"
// framing, directly contradicting the correctly-rewritten diagram section
// 40 lines earlier in the SAME file.
// =============================================================================
describe('README.md "Key Features > Final Mission Review" narrative states the same staged-trigger, automated-move model', () => {
  it('states the tail triggers on staged and rework is an automated move, not the old manual-reopen framing', () => {
    const content = read('README.md');
    const section = extractSection(content, /### Final Mission Review\n/, /\n### /);
    expect(section, 'expected a "### Final Mission Review" section under "## Key Features" in README.md').not.toBeNull();
    expect(section).toMatch(/\bstaged\b/i);
    // The exact stale phrasing Lynch found: contradicts WI-794's real,
    // rejection-cap-counted automated move.
    expect(section).not.toMatch(/manual,?\s+not an automated bounce/i);
    // "once they're back in `done`" (should now read `staged`).
    expect(section).not.toMatch(/back in `?done`?/i);
  });
});

// =============================================================================
// CLAUDE.md — Work Item Format stage enum (AC7 second half).
// =============================================================================
describe('CLAUDE.md documents the full stage enum', () => {
  it('the Work Item Format stage enum comment includes staged', () => {
    const content = read('CLAUDE.md');
    const enumLine = content.match(/^stage:\s*"briefings".*$/m);
    expect(enumLine, 'expected the stage enum comment line in CLAUDE.md\'s Work Item Format').not.toBeNull();
    expect(enumLine[0]).toMatch(/\bstaged\b/);
  });
});

// =============================================================================
// agents/hannibal.md — linear narrative sections, own dedicated headings
// =============================================================================
describe('agents/hannibal.md states the tail order and required conditions', () => {
  const content = read('agents/hannibal.md');

  it('Frankie -> Final Mission Review -> Post-Mission Checks -> Documentation Phase, in that order', () => {
    const milestones = [
      FRANKIE,
      { name: 'Final Mission Review section', pattern: /## Final Mission Review\b/i },
      { name: 'Post-Mission Checks section', pattern: /## Post-Mission Checks/i },
      { name: 'Documentation Phase section', pattern: /## Documentation Phase/i },
    ];
    const violations = checkAscendingOrder(content, milestones);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('the completion checklist includes Frankie as a required condition', () => {
    const section = extractSection(content, /## Completion\n/, /\n## /);
    expect(section, 'expected a "## Completion" section in agents/hannibal.md').not.toBeNull();
    expect(section).toMatch(/frankie/i);
  });

  it('the missionComplete trigger (Amy\'s agentStop response) routes to Frankie, not straight to Stockwell', () => {
    // WI-796 3rd rework (Amy's sweep / B.A. FIX request, ba-2): the original
    // anchor here ("Check the board-move response for finalReviewReady...")
    // described a mechanism that never existed — `finalReviewReady` is only
    // ever a LOCAL VARIABLE inside both playbooks' orchestration-loop
    // pseudocode (native.md, legacy.md), never a real API response field on
    // board-move or agentStop, and Hannibal never manually board-moves an
    // item to its terminal stage after Amy verifies it — Amy's own
    // `agentStop --advance` already does that. Amy independently found this
    // and B.A. correctly rewrote the passage to describe the real
    // mechanism (Amy's agentStop response carries `missionComplete: true`;
    // she sends MISSION_COMPLETE accordingly). `finalReviewReady` no longer
    // needs to appear in hannibal.md — it remains valid, unaffected
    // playbook-internal pseudocode in both orchestration playbooks, which
    // this test does not touch. Re-anchored on the real trigger field.
    const triggerMatch = content.match(/missionComplete:\s*true[\s\S]{0,600}/i);
    expect(triggerMatch, 'expected to find the missionComplete:true trigger sentence').not.toBeNull();
    expect(triggerMatch[0]).toMatch(/frankie/i);
  });

  // AC1: the Frankie dispatch trigger fires on all-staged, not all-done —
  // this is the explicit "trigger the tail" condition Hannibal evaluates,
  // separate from the abstract finalReviewReady flag checked above.
  it('the "Check if Final Review Needed" condition checks staged items, not exclusively done (the per-item pipeline now ends at staged)', () => {
    const section = extractSection(content, /### Check if Final Review Needed/, /\n### /);
    expect(section, 'expected a "### Check if Final Review Needed" section in agents/hannibal.md').not.toBeNull();
    expect(section).toMatch(/phases\.staged/);
  });

  // AC1 (no-drivable-surface skip still applies at the re-keyed trigger).
  it('the no-drivable-surface skip still applies at the Frankie dispatch trigger', () => {
    const section = extractSection(content, /### Dispatch Frankie's Mission-Tail Walk/, /\n### /);
    expect(section, 'expected the "### Dispatch Frankie\'s Mission-Tail Walk" section').not.toBeNull();
    expect(section).toMatch(/no drivable surface/i);
    expect(section).toMatch(/skip/i);
  });

  // AC6: dependency waves wait for staged (or later), not done.
  it('the dependency-wave rule states waves wait for staged (or later), not exclusively done', () => {
    const section = extractSection(content, /### Dependency Waves \(CORRECT - respect these\)/, /\n### /);
    expect(section, 'expected the "### Dependency Waves (CORRECT - respect these)" section').not.toBeNull();
    expect(section).toMatch(/\bstaged\b/i);
  });

  // AC2: the Frankie-failure passage no longer frames reopening as a manual
  // operator action — it instructs a real board-move using the
  // earliest-flagged-stage rule.
  it('a Frankie failure instructs Hannibal to move named items out of staged using the earliest-flagged-stage rule, not a manual reopen', () => {
    const section = extractSection(content, /### Dispatch Frankie's Mission-Tail Walk/, /\n### /);
    expect(section, 'expected the "### Dispatch Frankie\'s Mission-Tail Walk" section').not.toBeNull();
    const failureBlock = section.match(/\*\*On failure\*\*[\s\S]{0,1200}/i);
    expect(failureBlock, 'expected an "**On failure**" passage').not.toBeNull();
    expect(failureBlock[0]).toMatch(EARLIEST_FLAGGED_STAGE);
    expect(failureBlock[0]).toMatch(REAL_BOARD_MOVE);
    expect(failureBlock[0]).toMatch(/\bstaged\b/i);
    expect(failureBlock[0]).not.toMatch(STALE_MANUAL_ACTION_LANGUAGE);
  });

  it('rework that returns items to staged restarts the tail at Frankie for a full DoD re-walk', () => {
    const section = extractSection(content, /### Dispatch Frankie's Mission-Tail Walk/, /\n### /);
    expect(section, 'expected the "### Dispatch Frankie\'s Mission-Tail Walk" section').not.toBeNull();
    const reworkBlock = section.match(/\*\*After ANY rework\*\*[\s\S]{0,600}/i);
    expect(reworkBlock, 'expected an "**After ANY rework**" passage').not.toBeNull();
    expect(reworkBlock[0]).toMatch(/\bstaged\b/i);
    expect(reworkBlock[0]).toMatch(/restarts?\s+at\s+frankie/i);
    expect(reworkBlock[0]).toMatch(/full\s+(?:definition of done|dod)/i);
  });

  // AC3: FINAL REJECTED rewritten the same way; still restarts at Frankie,
  // not post-checks.
  it('a Stockwell rejection instructs Hannibal to move named items out of staged using the earliest-flagged-stage rule, and restarts the tail at Frankie, not post-checks', () => {
    const section = extractSection(content, /\*\*If FINAL REJECTED:\*\*/, /\n## /);
    expect(section, 'expected a "**If FINAL REJECTED:**" block in agents/hannibal.md').not.toBeNull();
    expect(section).toMatch(EARLIEST_FLAGGED_STAGE);
    expect(section).toMatch(REAL_BOARD_MOVE);
    expect(section).toMatch(/\bstaged\b/i);
    expect(section).not.toMatch(STALE_MANUAL_ACTION_LANGUAGE);
    // Anchor on the restart language itself, not any incidental Frankie mention.
    expect(section).toMatch(/restarts?\s+at\s+frankie/i);
    expect(section).not.toMatch(/restarts?\s+at\s+post-checks/i);
  });

  // AC4: promotion step documented (API-driven, WI-790) with a Hannibal
  // batch board-move named explicitly as the fallback.
  it('an approved final review is documented as promoting staged items to done via the API, with a Hannibal batch board-move named as the fallback', () => {
    const section = extractSection(content, /### Handle Final Review Result/, /\n## /);
    expect(section, 'expected a "### Handle Final Review Result" section in agents/hannibal.md').not.toBeNull();
    expect(section).toMatch(/promot(?:es?|ion|ing)/i);
    expect(section).toMatch(/\bstaged\b/i);
    expect(section).toMatch(/\bdone\b/i);
    expect(section).toMatch(/board-move/i);
    expect(section).toMatch(/fallback/i);
  });

  // AC4 (second half) + AC5: post-checks/Tawnia run only after promotion,
  // and post-check failures are documented as mission-level — Hannibal
  // handles them without demoting items or restarting the tail.
  it('post-checks are documented as running only after every item is in done (post-promotion)', () => {
    const section = extractSection(content, /## Post-Mission Checks/, /\n## /);
    expect(section, 'expected a "## Post-Mission Checks" section').not.toBeNull();
    expect(section).toMatch(/\bdone\b/i);
  });

  it('post-check failures are documented as mission-level: Hannibal handles them without demoting items, restarting the tail, or failing the mission', () => {
    const section = extractSection(content, /## Post-Mission Checks/, /\n## /);
    expect(section, 'expected a "## Post-Mission Checks" section').not.toBeNull();
    const failureBlock = section.match(/\*\*If post-checks fail:\*\*[\s\S]{0,600}/i);
    expect(failureBlock, 'expected an "**If post-checks fail:**" passage').not.toBeNull();
    expect(failureBlock[0]).not.toMatch(/demote|return-to|restarts?\s+the\s+(?:mission\s+)?tail|reopen|fail(?:s|ed)?\s+the\s+mission/i);
    expect(failureBlock[0]).toMatch(/mission[- ]level|does not (?:restart|reopen|demote)/i);
  });
});

// =============================================================================
// playbooks/orchestration-native.md — scoped to what's execution-order-
// meaningful (see file header comment on why whole-file ordering is unsafe
// here: Tawnia's dispatch-workflow catalog entry legitimately precedes the
// Final Mission Review Dispatch section regardless of runtime order).
// =============================================================================
describe('playbooks/orchestration-native.md wires Frankie into the mission tail', () => {
  const content = read('playbooks/orchestration-native.md');

  it('carries a Frankie dispatch block naming subagent_type "ai-team:frankie"', () => {
    expect(content).toMatch(/subagent_type:\s*"ai-team:frankie"/);
  });

  it('the Frankie dispatch block passes the mission PRD path and mission identifier', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx).toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 1500);
    expect(nearby).toMatch(/prdPath/);
    expect(nearby).toMatch(/mission/i);
  });

  it('spawns Frankie as a fresh agent (not a pooled/reused instance)', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx, 'expected a Frankie dispatch block').toBeGreaterThan(-1);
    const nearby = content.slice(Math.max(0, idx - 500), idx + 500);
    expect(nearby).toMatch(/not pre-warmed|fresh agent|Always spawn a new/i);
  });

  it('the Frankie dispatch block physically precedes "## Final Mission Review Dispatch"', () => {
    const frankieIdx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    const stockwellSectionIdx = content.search(/^## Final Mission Review Dispatch/m);
    expect(frankieIdx).toBeGreaterThan(-1);
    expect(stockwellSectionIdx).toBeGreaterThan(-1);
    expect(frankieIdx).toBeLessThan(stockwellSectionIdx);
  });

  // AC1: dispatch trigger fires on all-staged, not all-done.
  it('dispatches Frankie once all items reach staged, not exclusively done (the per-item pipeline now ends at staged)', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx).toBeGreaterThan(-1);
    const before = content.slice(Math.max(0, idx - 800), idx);
    expect(before).toMatch(/\bstaged\b/i);
  });

  it('the no-drivable-surface skip still applies at the Frankie dispatch trigger', () => {
    expect(content).toMatch(/no drivable surface/i);
    expect(content).toMatch(/SKIP Frankie entirely/i);
  });

  it('the MISSION_COMPLETE trigger routes to Frankie rather than jumping straight to Final Review, reflecting the all-staged (not all-done) completion signal', () => {
    const section = extractSection(content, /on MISSION_COMPLETE message from \{instanceName\} \(Amy\):/, /\n {4}on /);
    expect(section, 'expected the MISSION_COMPLETE handler block').not.toBeNull();
    expect(section).toMatch(/frankie/i);
    expect(section).toMatch(/\bstaged\b/i);
  });

  it('the Phase 4 completion-detection fallback also routes to Frankie rather than straight to Stockwell, and checks staged (not exclusively done) for the per-item completion signal', () => {
    const section = extractSection(content, /# PHASE 4: COMPLETION DETECTION \(FALLBACK\)/, /```/);
    expect(section, 'expected the Phase 4 completion-detection fallback block').not.toBeNull();
    expect(section).toMatch(/frankie/i);
    expect(section).toMatch(/\bstaged\b/i);
  });

  // AC2: rewritten failure passage — real board-move, earliest-flagged-stage,
  // no more "manual operator action" framing.
  it('a Frankie failure instructs Hannibal to move named items out of staged using the earliest-flagged-stage rule, not a manual reopen', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx).toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 3000);
    const failureBlock = nearby.match(/\*\*On failure\*\*[\s\S]{0,1200}/i);
    expect(failureBlock, 'expected an "**On failure**" passage near the Frankie dispatch block').not.toBeNull();
    expect(failureBlock[0]).toMatch(EARLIEST_FLAGGED_STAGE);
    expect(failureBlock[0]).toMatch(REAL_BOARD_MOVE);
    expect(failureBlock[0]).toMatch(/\bstaged\b/i);
    expect(failureBlock[0]).not.toMatch(STALE_MANUAL_ACTION_LANGUAGE);
  });

  it('states any rework returning items to staged restarts the tail at Frankie and re-walks the FULL DoD', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx, 'expected a Frankie dispatch block').toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 3000);
    expect(nearby).toMatch(/full\s+(?:definition of done|dod)/i);
    const reworkBlock = nearby.match(/\*\*Any rework\*\*[\s\S]{0,600}/i);
    expect(reworkBlock, 'expected an "**Any rework**" passage').not.toBeNull();
    expect(reworkBlock[0]).toMatch(/\bstaged\b/i);
  });

  // AC3: FINAL REJECTED rewritten the same way; still restarts at Frankie,
  // not post-checks.
  it('a Stockwell rejection instructs Hannibal to move named items out of staged using the earliest-flagged-stage rule, and restarts the tail at Frankie, not post-checks', () => {
    const rejected = content.match(/\*\*If Stockwell rejects \(FINAL REJECTED\):\*\*[\s\S]{0,1500}/);
    expect(rejected, 'expected an "**If Stockwell rejects (FINAL REJECTED):**" block').not.toBeNull();
    expect(rejected[0]).toMatch(EARLIEST_FLAGGED_STAGE);
    expect(rejected[0]).toMatch(REAL_BOARD_MOVE);
    expect(rejected[0]).toMatch(/\bstaged\b/i);
    expect(rejected[0]).not.toMatch(STALE_MANUAL_ACTION_LANGUAGE);
    expect(rejected[0]).toMatch(/restarts?\s+(?:the mission tail\s+)?at\s+frankie/i);
    expect(rejected[0]).toMatch(/not at post-checks/i);
  });
});

// =============================================================================
// playbooks/orchestration-legacy.md — same scoping rationale as native.
// =============================================================================
describe('playbooks/orchestration-legacy.md wires Frankie into the mission tail', () => {
  const content = read('playbooks/orchestration-legacy.md');

  it('carries a Frankie dispatch block naming subagent_type "ai-team:frankie"', () => {
    expect(content).toMatch(/subagent_type:\s*"ai-team:frankie"/);
  });

  it('the Frankie dispatch block passes the mission PRD path and mission identifier', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx).toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 1500);
    expect(nearby).toMatch(/prdPath/);
    expect(nearby).toMatch(/mission/i);
  });

  it('the Frankie dispatch block physically precedes "## Final Mission Review Dispatch"', () => {
    const frankieIdx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    const stockwellSectionIdx = content.search(/^## Final Mission Review Dispatch/m);
    expect(frankieIdx).toBeGreaterThan(-1);
    expect(stockwellSectionIdx).toBeGreaterThan(-1);
    expect(frankieIdx).toBeLessThan(stockwellSectionIdx);
  });

  it('the orchestration loop comment routes to Frankie when finalReviewReady, not straight to Stockwell', () => {
    // Anchor on the finalReviewReady routing comment inside the dispatch loop
    // itself (a naive whole-file /frankie/i here would be vacuously true).
    const trigger = content.match(/finalReviewReady[^\n]*(?:\n[^\n]*){0,3}/);
    expect(trigger, 'expected a finalReviewReady routing comment in the dispatch loop').not.toBeNull();
    expect(trigger[0]).toMatch(/frankie/i);
    expect(trigger[0]).toMatch(/never skip straight to Stockwell/i);
  });

  // AC1: dispatch trigger fires on all-staged, not all-done.
  it('dispatches Frankie once all items reach staged, not exclusively done (the per-item pipeline now ends at staged)', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx).toBeGreaterThan(-1);
    const before = content.slice(Math.max(0, idx - 800), idx);
    expect(before).toMatch(/\bstaged\b/i);
  });

  it('the no-drivable-surface skip still applies at the Frankie dispatch trigger', () => {
    expect(content).toMatch(/no drivable surface/i);
    expect(content).toMatch(/SKIP Frankie entirely/i);
  });

  // AC2: rewritten failure passage — real board-move, earliest-flagged-stage,
  // no more "manual operator action" framing.
  it('a Frankie failure instructs Hannibal to move named items out of staged using the earliest-flagged-stage rule, not a manual reopen', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx, 'expected a Frankie dispatch block').toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 3000);
    const failureBlock = nearby.match(/\*\*On failure\*\*[\s\S]{0,1200}/i);
    expect(failureBlock, 'expected an "**On failure**" passage near the Frankie dispatch block').not.toBeNull();
    expect(failureBlock[0]).toMatch(EARLIEST_FLAGGED_STAGE);
    expect(failureBlock[0]).toMatch(REAL_BOARD_MOVE);
    expect(failureBlock[0]).toMatch(/\bstaged\b/i);
    expect(failureBlock[0]).not.toMatch(STALE_MANUAL_ACTION_LANGUAGE);
  });

  it('states any rework returning items to staged restarts the tail at Frankie and re-walks the FULL DoD', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx, 'expected a Frankie dispatch block').toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 3000);
    expect(nearby).toMatch(/full\s+(?:definition of done|dod)/i);
    const reworkBlock = nearby.match(/\*\*Any rework\*\*[\s\S]{0,600}/i);
    expect(reworkBlock, 'expected an "**Any rework**" passage').not.toBeNull();
    expect(reworkBlock[0]).toMatch(/\bstaged\b/i);
  });

  // AC3: FINAL REJECTED (legacy heading: "**If REJECTED:**") rewritten the
  // same way; still restarts at Frankie, not post-checks.
  it('a Stockwell rejection instructs Hannibal to move named items out of staged using the earliest-flagged-stage rule, and restarts the tail at Frankie, not post-checks', () => {
    const rejected = content.match(/\*\*If REJECTED:\*\*[\s\S]{0,1500}/);
    expect(rejected, 'expected an "**If REJECTED:**" block').not.toBeNull();
    expect(rejected[0]).toMatch(EARLIEST_FLAGGED_STAGE);
    expect(rejected[0]).toMatch(REAL_BOARD_MOVE);
    expect(rejected[0]).toMatch(/\bstaged\b/i);
    expect(rejected[0]).not.toMatch(STALE_MANUAL_ACTION_LANGUAGE);
    expect(rejected[0]).toMatch(/restarts?\s+(?:the mission tail\s+)?at\s+frankie/i);
    expect(rejected[0]).toMatch(/not at post-checks/i);
  });
});

// =============================================================================
// docs/ORCHESTRATION.md — no diagram; scattered prose statements. Existence +
// stale-reference removal only (no reliable single-anchor ordering to assert
// without dictating a placement the file's structure doesn't already imply).
// Not touched by WI-796's ACs beyond staying internally consistent, so this
// describe block is unchanged from WI-781.
// =============================================================================
describe('docs/ORCHESTRATION.md documents Frankie in the mission tail', () => {
  const content = read('docs/ORCHESTRATION.md');

  it('mentions Frankie', () => {
    expect(content).toMatch(/frankie/i);
  });

  it('dispatches Frankie before Stockwell in its dispatch-mode agent listing', () => {
    // Inspect the actual dispatch-mode listing lines:
    // "- Frankie: `subagent_type: "ai-team:frankie"` → mission-tail QA walk..."
    // "- Stockwell: `subagent_type: "ai-team:stockwell"` → Final Mission Review..."
    const frankieLine = content.match(/^- Frankie:\s*`subagent_type:\s*"ai-team:frankie"`.*$/m);
    const stockwellLine = content.match(/^- Stockwell:\s*`subagent_type:\s*"ai-team:stockwell"`.*$/m);
    expect(frankieLine, 'expected the Frankie dispatch-mode listing line').not.toBeNull();
    expect(stockwellLine, 'expected the Stockwell dispatch-mode listing line').not.toBeNull();
    expect(frankieLine.index).toBeLessThan(stockwellLine.index);
    // The lines themselves must state the ordering, not merely appear in order.
    expect(frankieLine[0]).toMatch(/before Stockwell/i);
    expect(stockwellLine[0]).toMatch(/after Frankie'?s walk/i);
  });

  // Lynch's WI-796 rework rejection: the item's own context named these
  // exact lines (186, 225, 226) as needing attention, but the two tests
  // above only pin the narrow "before Stockwell"/"after Frankie's walk"
  // substrings — not the surrounding stale done/manual-reopen content that
  // survived right next to them.
  it('the Frankie-evidence paragraph states his walk runs once items reach staged, not exclusively done', () => {
    const idx = content.search(/Frankie's evidence, by contrast, is filesystem-based/i);
    expect(idx, 'expected the Frankie-evidence paragraph').toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 400);
    expect(nearby).toMatch(/\bstaged\b/i);
  });

  it('the Mission Completion dispatch-mode listing states the automated staged-rework model, not manual reopening', () => {
    const idx = content.search(/\*\*Mission Completion \(MANDATORY\):\*\*/);
    expect(idx, 'expected the "**Mission Completion (MANDATORY):**" listing').toBeGreaterThan(-1);
    const listing = content.slice(idx, idx + 900);
    expect(listing).toMatch(/\bstaged\b/i);
    expect(listing).not.toMatch(/manual reopening/i);
    expect(listing).not.toMatch(/back in `?done`?/i);
  });
});

// =============================================================================
// Cross-file: no board-stage / TRANSITION_MATRIX changes for FRANKIE HIMSELF
// anywhere touched by this item (Frankie runs off the board, per the ADR —
// he requires no dedicated stage of his own). RETITLED for WI-796 (AC8): the
// original title ("Frankie requires no board stage or TRANSITION_MATRIX
// change") predates WI-786/787, which DID add a real `staged` board stage
// with real TRANSITION_MATRIX entries — so the old title read as though
// staged-stage work contradicted this guard, when in fact this guard only
// ever concerned a stage literally named "frankie", which still does not
// and must not exist. The functional assertion is unchanged and still valid.
// =============================================================================
describe('Frankie himself is not assigned a board stage (staged is a real, separate board stage the tail already uses)', () => {
  it('none of the four touched docs reference a board stage literally named "frankie"', () => {
    const files = [
      'playbooks/orchestration-native.md',
      'playbooks/orchestration-legacy.md',
      'agents/hannibal.md',
      'commands/run.md',
    ];
    for (const file of files) {
      const content = read(file);
      expect(content, `${file} should not describe a new board stage for Frankie`).not.toMatch(
        /toStage\s+"?frankie"?|stage:\s*"?frankie"?/i
      );
    }
  });
});

// =============================================================================
// Cross-file: no doc still credits Lynch with the final review. A proximity
// regex ("Lynch" within the same sentence as final-review language) replaces
// the earlier exact-phrase negatives, which only caught the specific wordings
// they were written against and let reworded stale credits through.
// =============================================================================
describe('no doc still credits Lynch with the final review', () => {
  const STALE_LYNCH_FINAL_REVIEW_CREDIT =
    /Lynch[^.\n]{0,60}(final\s+(mission\s+)?review|FINAL APPROVED|FINAL MISSION REVIEW)/i;

  const files = [
    'commands/run.md',
    'agents/hannibal.md',
    'README.md',
    'docs/ORCHESTRATION.md',
    'playbooks/orchestration-native.md',
    'playbooks/orchestration-legacy.md',
    'CLAUDE.md',
  ];

  for (const file of files) {
    it(`${file} does not mention Lynch near final-review language`, () => {
      const content = read(file);
      const match = content.match(STALE_LYNCH_FINAL_REVIEW_CREDIT);
      expect(
        match,
        `${file} still credits Lynch with the final review near: "${match?.[0]}" — the Final Mission Review belongs to Stockwell (Lynch is per-feature review only)`
      ).toBeNull();
    });
  }
});

// =============================================================================
// ADR 0006: exactly ONE canonical ateam.config.json template, in
// commands/setup.md. Every other markdown file must point there instead of
// carrying its own fenced-JSON copy — divergent copies are exactly how the
// config fields drifted before (the ADR's own trigger condition).
// =============================================================================
describe('ADR 0006: single canonical ateam.config.json template', () => {
  const CANONICAL_FILE = 'commands/setup.md';
  const CONFIG_KEYS = [
    'devServer',
    'checks',
    'projectName',
    'wipLimits',
    'pricing',
    'surfaces',
    'ateamCliVersion',
    'testing_level',
    'evidence',
    'review_tier',
  ];

  /**
   * A fenced block "looks like" an ateam.config.json template when it carries
   * a quoted "devServer" key (the field every historical divergent copy
   * restated), or a quoted "checks" key alongside at least one other known
   * config key (so a generic, unrelated "checks" object alone can't trip it).
   */
  function looksLikeConfigTemplate(block) {
    const keysPresent = CONFIG_KEYS.filter((key) => new RegExp(`"${key}"\\s*:`).test(block));
    if (keysPresent.includes('devServer')) return true;
    return keysPresent.includes('checks') && keysPresent.length >= 2;
  }

  function allMarkdownFiles() {
    return [
      ...['agents', 'commands', 'docs', 'playbooks', 'skills'].flatMap(collectMarkdownFiles),
      'README.md',
      'CLAUDE.md',
    ];
  }

  it(`no markdown file outside ${CANONICAL_FILE} carries an ateam.config.json-shaped fenced block`, () => {
    const offenders = [];
    for (const file of allMarkdownFiles()) {
      if (file === CANONICAL_FILE) continue;
      for (const block of extractFencedBlocks(read(file))) {
        if (looksLikeConfigTemplate(block)) {
          offenders.push(file);
          break;
        }
      }
    }
    expect(
      offenders,
      `these files carry their own ateam.config.json template copy — replace each with a pointer to ${CANONICAL_FILE} (see adr/0006-ateam-config-schema-deferred.md): ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it(`${CANONICAL_FILE} still carries the canonical template (heuristic stays live)`, () => {
    // Positive control: if setup.md's template moves or the heuristic rots,
    // this fails instead of the sweep above passing vacuously.
    const blocks = extractFencedBlocks(read(CANONICAL_FILE));
    expect(blocks.some(looksLikeConfigTemplate)).toBe(true);
  });
});
