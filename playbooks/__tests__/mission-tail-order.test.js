/**
 * Tests for mission-tail ordering consistency across every doc that states it
 * (WI-781).
 *
 * The new mission tail is: all items done -> Frankie -> Stockwell's Final
 * Mission Review -> post-checks -> Tawnia. This file asserts that order is
 * actually stated (not just that "Frankie" appears somewhere) in every file
 * that documents the tail: both orchestration playbooks, agents/hannibal.md,
 * commands/run.md, CLAUDE.md, README.md, and docs/ORCHESTRATION.md.
 *
 * Precedent for structurally parsing markdown/prose docs instead of grepping
 * sentences: commands/__tests__/resume-recovery.test.js already does this for
 * commands/resume.md against TRANSITION_MATRIX. This file follows the same
 * "extract stable structural anchors, assert relationships between them"
 * approach — never asserting on exact prose wording, only on the relative
 * order of short, stable tokens (agent proper nouns, section headings).
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
 * The full done -> Frankie -> Stockwell -> post-checks -> Tawnia chain is
 * checked where the file's structure actually supports it: the linear,
 * single-narrative files (CLAUDE.md, README.md, commands/run.md,
 * agents/hannibal.md) and the fenced pipeline-flow diagrams specifically.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
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

// =============================================================================
// Fenced pipeline-flow diagrams: CLAUDE.md, README.md, commands/run.md
// Order checked WITHIN the diagram block itself (self-contained, so "done"
// as a common English word can't false-match earlier prose).
// =============================================================================
describe('pipeline-flow diagrams state done -> Frankie -> Stockwell -> Post-Checks -> Tawnia', () => {
  it('CLAUDE.md Execution Phase diagram', () => {
    const content = read('CLAUDE.md');
    const diagram = extractCodeBlockAfter(content, /\*\*Execution Phase.*?:\*\*/);
    expect(diagram, 'expected a fenced code block after "**Execution Phase...**" in CLAUDE.md').not.toBeNull();
    const violations = checkAscendingOrder(diagram, [DONE, FRANKIE, STOCKWELL, POSTCHECKS, TAWNIA]);
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
    const violations = checkAscendingOrder(diagram, [DONE, FRANKIE, STOCKWELL, POSTCHECKS, TAWNIA]);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('commands/run.md Pipeline Flow diagram', () => {
    const content = read('commands/run.md');
    const diagram = extractCodeBlockAfter(content, /## Pipeline Flow.*?\n/);
    expect(diagram, 'expected a fenced code block after "## Pipeline Flow" in commands/run.md').not.toBeNull();
    const violations = checkAscendingOrder(diagram, [DONE, FRANKIE, STOCKWELL, POSTCHECKS, TAWNIA]);
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

// =============================================================================
// Numbered / linear stage-transition prose: README.md and commands/run.md
// each restate the tail as a flat, sequential list — global whole-file order
// is meaningful here (unlike the native playbook's reference catalog).
// =============================================================================
describe('numbered stage-transition lists state the same order', () => {
  it('README.md "Stage transitions" list', () => {
    const content = read('README.md');
    const section = extractSection(content, /\*\*Stage transitions:?\*\*/, /\n## /);
    expect(section, 'expected a "Stage transitions" list in README.md').not.toBeNull();
    const violations = checkAscendingOrder(section, [FRANKIE, STOCKWELL, POSTCHECKS, TAWNIA]);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('README.md no longer credits Lynch with the final review', () => {
    const content = read('README.md');
    expect(content).not.toMatch(/Lynch reviews entire codebase holistically/i);
    expect(content).not.toMatch(/Final Review\s*\n\s*│\s*\(Lynch/i);
  });

  it('commands/run.md "Stage transitions" numbered list', () => {
    const content = read('commands/run.md');
    const section = extractSection(content, /\*\*Stage transitions \(ALL REQUIRED\):\*\*/, /\n## /);
    expect(section, 'expected a "Stage transitions" list in commands/run.md').not.toBeNull();
    const violations = checkAscendingOrder(section, [FRANKIE, STOCKWELL, POSTCHECKS, TAWNIA]);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('commands/run.md no longer credits Lynch with the final review', () => {
    const content = read('commands/run.md');
    expect(content).not.toMatch(/Lynch reviews entire codebase holistically/i);
  });

  it('commands/run.md per-step instructions place Frankie between the last item reaching done and Final Mission Review (Behavior section)', () => {
    const content = read('commands/run.md');
    const section = extractSection(content, /## Behavior/, /\n(?=\d{2}\. )/); // through the numbered steps
    expect(section, 'expected a "## Behavior" section with numbered steps in commands/run.md').not.toBeNull();
    const violations = checkAscendingOrder(section, [FRANKIE, STOCKWELL, POSTCHECKS, TAWNIA]);
    expect(violations, violations.join('\n')).toEqual([]);
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

  it('no longer credits Lynch with the final mission review', () => {
    expect(content).not.toMatch(/dispatch Lynch for a final holistic review/i);
    expect(content).not.toMatch(/Lynch for a final holistic review/i);
  });

  it('the completion checklist includes Frankie as a required condition', () => {
    const section = extractSection(content, /## Completion\n/, /\n## /);
    expect(section, 'expected a "## Completion" section in agents/hannibal.md').not.toBeNull();
    expect(section).toMatch(/frankie/i);
  });

  it('the missionComplete/finalReviewReady trigger routes to Frankie, not straight to Stockwell', () => {
    // The trigger line lives just above "## Heartbeat health check" per the
    // current structure (`Check the board-move response for finalReviewReady...`).
    // Search the whole file for the trigger sentence itself rather than assuming
    // a fixed heading boundary, since Frankie's insertion may relocate it.
    expect(content).toMatch(/finalReviewReady/);
    const triggerMatch = content.match(/Check the board-move response[\s\S]{0,300}/i);
    expect(triggerMatch, 'expected to find the finalReviewReady trigger sentence').not.toBeNull();
    expect(triggerMatch[0]).toMatch(/frankie/i);
  });

  it('a Stockwell rejection is documented as restarting the tail at Frankie, not post-checks', () => {
    const section = extractSection(content, /\*\*If FINAL REJECTED:\*\*/, /\n## /);
    expect(section, 'expected a "**If FINAL REJECTED:**" block in agents/hannibal.md').not.toBeNull();
    expect(section).toMatch(/frankie/i);
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

  it('the MISSION_COMPLETE trigger routes to Frankie rather than jumping straight to Final Review', () => {
    const section = extractSection(content, /on MISSION_COMPLETE message from \{instanceName\} \(Amy\):/, /\n {4}on /);
    expect(section, 'expected the MISSION_COMPLETE handler block').not.toBeNull();
    expect(section).toMatch(/frankie/i);
  });

  it('the Phase 4 completion-detection fallback also routes to Frankie rather than straight to Stockwell', () => {
    const section = extractSection(content, /# PHASE 4: COMPLETION DETECTION \(FALLBACK\)/, /```/);
    expect(section, 'expected the Phase 4 completion-detection fallback block').not.toBeNull();
    expect(section).toMatch(/frankie/i);
  });

  it('states a Frankie failure halts the tail and is surfaced to the operator, not silently reopening done', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx).toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 3000);
    expect(nearby).toMatch(/frankie/i);
    expect(nearby).toMatch(/manual|operator/i);
    expect(nearby).toMatch(/terminal|does not (?:proceed|advance)|halts?/i);
  });

  it('states any rework returning items to done restarts the tail at Frankie and re-walks the FULL DoD', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx, 'expected a Frankie dispatch block').toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 3000);
    expect(nearby).toMatch(/full\s+(?:definition of done|dod)/i);
  });

  it('a Stockwell rejection restarts the tail at Frankie, not at post-checks', () => {
    // Frankie's own dispatch-block context (searched above) or the Stockwell
    // section itself must state this — check both windows.
    const stockwellSectionIdx = content.search(/^## Final Mission Review Dispatch/m);
    const frankieIdx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(stockwellSectionIdx, 'expected "## Final Mission Review Dispatch"').toBeGreaterThan(-1);
    expect(frankieIdx, 'expected a Frankie dispatch block').toBeGreaterThan(-1);
    const stockwellWindow = content.slice(stockwellSectionIdx, stockwellSectionIdx + 2000);
    const frankieWindow = content.slice(frankieIdx, frankieIdx + 3000);
    const statesRestart = /frankie/i.test(stockwellWindow) || /rejected[\s\S]{0,500}frankie/i.test(frankieWindow);
    expect(statesRestart, 'expected either the Stockwell dispatch section or the Frankie block to state a rejection restarts at Frankie').toBe(true);
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

  it('the stale "dispatch Lynch for Final Review" loop comment is gone', () => {
    expect(content).not.toMatch(/dispatch Lynch for Final Review/i);
  });

  it('the orchestration loop comment routes to Frankie when finalReviewReady, not straight to Lynch/Stockwell', () => {
    // Search near where the stale comment used to live: the main dispatch
    // loop, before "## Minimizing Per-Cycle Token Spend".
    const section = extractSection(content, /\*\*KEY BEHAVIORS:\*\*/, /## Minimizing Per-Cycle Token Spend/);
    expect(section, 'expected the loop KEY BEHAVIORS / trailing-comment region').not.toBeNull();
    expect(content).toMatch(/frankie/i);
  });

  it('states a Frankie failure halts the tail and is surfaced to the operator', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx, 'expected a Frankie dispatch block').toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 3000);
    expect(nearby).toMatch(/manual|operator/i);
    expect(nearby).toMatch(/terminal|does not (?:proceed|advance)|halts?/i);
  });

  it('states any rework returning items to done restarts the tail at Frankie and re-walks the FULL DoD', () => {
    const idx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(idx, 'expected a Frankie dispatch block').toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 3000);
    expect(nearby).toMatch(/full\s+(?:definition of done|dod)/i);
  });

  it('a Stockwell rejection restarts the tail at Frankie, not at post-checks', () => {
    const stockwellSectionIdx = content.search(/^## Final Mission Review Dispatch/m);
    const frankieIdx = content.search(/subagent_type:\s*"ai-team:frankie"/);
    expect(stockwellSectionIdx, 'expected "## Final Mission Review Dispatch"').toBeGreaterThan(-1);
    expect(frankieIdx, 'expected a Frankie dispatch block').toBeGreaterThan(-1);
    const stockwellWindow = content.slice(stockwellSectionIdx, stockwellSectionIdx + 2000);
    const frankieWindow = content.slice(frankieIdx, frankieIdx + 3000);
    const statesRestart = /frankie/i.test(stockwellWindow) || /rejected[\s\S]{0,500}frankie/i.test(frankieWindow);
    expect(statesRestart, 'expected either the Stockwell dispatch section or the Frankie block to state a rejection restarts at Frankie').toBe(true);
  });
});

// =============================================================================
// docs/ORCHESTRATION.md — no diagram; scattered prose statements. Existence +
// stale-reference removal only (no reliable single-anchor ordering to assert
// without dictating a placement the file's structure doesn't already imply).
// =============================================================================
describe('docs/ORCHESTRATION.md documents Frankie in the mission tail', () => {
  const content = read('docs/ORCHESTRATION.md');

  it('mentions Frankie', () => {
    expect(content).toMatch(/frankie/i);
  });

  it('no longer credits Lynch with the Final Mission Review approval', () => {
    expect(content).not.toMatch(/Lynch'?s Final Mission Review/i);
    expect(content).not.toMatch(/Run after Lynch'?s Final Mission Review approves/i);
  });

  it('dispatches Frankie before Stockwell in its dispatch-mode agent listing', () => {
    // "### Current Skill Wiring"-style dispatch listing:
    // "- Stockwell: `subagent_type: "ai-team:stockwell"` → Final Mission Review..."
    const stockwellLineIdx = content.search(/Stockwell:\s*`subagent_type:\s*"ai-team:stockwell"`/);
    expect(stockwellLineIdx, 'expected the Stockwell dispatch-mode listing line').toBeGreaterThan(-1);
    const frankieIdx = content.search(/frankie/i);
    expect(frankieIdx, 'expected "Frankie" to appear somewhere in the file').toBeGreaterThan(-1);
    expect(frankieIdx).toBeLessThan(stockwellLineIdx);
  });
});

// =============================================================================
// Cross-file: no board-stage / TRANSITION_MATRIX changes anywhere touched by
// this item (Frankie runs off the board, per the ADR — done stays terminal).
// =============================================================================
describe('Frankie requires no board stage or TRANSITION_MATRIX change', () => {
  it('none of the five touched docs reference a new board stage for Frankie', () => {
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
