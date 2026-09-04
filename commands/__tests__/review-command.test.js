/**
 * Tests for WI-938: /ai-team:review turns branch review findings into a
 * mission.
 *
 * The replacement front door for /ai-team:sweep. Runs the ai-team:code-review
 * skill against the current branch, turns each Must Fix / Should Fix finding
 * into a typed work item stamped with severity/attributedAgent/fingerprint
 * (WI-936's contract), writes a mission brief (WI-935's skill) and creates a
 * mission — then STOPS, leaving execution to /ai-team:run. Unlike sweep it
 * never fixes or commits anything itself.
 *
 * This repo tests command markdown by parsing prose invariants — see
 * commands/__tests__/resume-recovery.test.js and
 * playbooks/__tests__/mission-tail-order.test.js for the convention: extract
 * stable structural anchors and assert their presence/relationships, never
 * pin exact sentence wording B.A. is free to phrase differently.
 *
 * WI-939 LESSON (Lynch's rejection there — explicitly flagged for this item
 * too): resolving a quality profile in PROSE is not the same as wiring it
 * into the actual `ateam missions createMission` invocation. This file
 * asserts the invocation LINE itself carries --testing-level/--review-tier/
 * --profile, mirroring the fix that landed on WI-939's test suite — not just
 * that the resolver is mentioned somewhere in the file.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const REVIEW_MD_PATH = join(REPO_ROOT, 'commands', 'review.md');

/**
 * Slices `content` from the first line matching `headingPattern` to the
 * next line matching `stopPattern` (default: any `##`-level heading), or to
 * the end of the document if none follows.
 */
function sectionAfter(content, headingPattern, stopPattern = /^##\s/m) {
  const startIdx = content.search(headingPattern);
  if (startIdx === -1) return '';
  const afterHeadingLineIdx = content.indexOf('\n', startIdx) + 1;
  const stopRelIdx = content.slice(afterHeadingLineIdx).search(stopPattern);
  return stopRelIdx === -1
    ? content.slice(startIdx)
    : content.slice(startIdx, afterHeadingLineIdx + stopRelIdx);
}

/** Frontmatter block content, or null if none. */
function frontmatterOf(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

// Defaults to '' (not undefined) when the file doesn't exist yet, so every
// content-dependent test fails with a clean assertion message instead of a
// TypeError — the dedicated existence test still fails loudly first.
let content = '';

beforeAll(() => {
  if (existsSync(REVIEW_MD_PATH)) {
    content = readFileSync(REVIEW_MD_PATH, 'utf8');
  }
});

describe('commands/review.md exists', () => {
  it('exists at commands/review.md', () => {
    expect(existsSync(REVIEW_MD_PATH)).toBe(true);
  });
});

// =============================================================================
// Frontmatter and structure — mirrors commands/sweep.md's skeleton.
// =============================================================================

describe('frontmatter and structure (mirrors commands/sweep.md)', () => {
  it('frontmatter declares only model: sonnet — no description/argument-hint/allowed-tools keys', () => {
    const frontmatter = frontmatterOf(content);
    expect(frontmatter, 'expected a --- frontmatter block').not.toBeNull();
    expect(frontmatter).toMatch(/^model:\s*sonnet\s*$/m);
    expect(frontmatter).not.toMatch(/^description:/m);
    expect(frontmatter).not.toMatch(/^argument-hint:/m);
    expect(frontmatter).not.toMatch(/^allowed-tools:/m);
  });

  it('opens with the # /ai-team:review heading', () => {
    expect(content).toMatch(/^# \/ai-team:review/m);
  });

  it('has ## Usage and ## Arguments sections', () => {
    expect(content).toMatch(/^## Usage/m);
    expect(content).toMatch(/^## Arguments/m);
  });

  it('has a ## Pre-Flight: Environment Check section that checks ATEAM_PROJECT_ID', () => {
    const preflight = sectionAfter(content, /^## Pre-Flight/m);
    expect(preflight).toMatch(/ATEAM_PROJECT_ID/);
  });

  it('has at least one numbered ## Step heading', () => {
    expect(content).toMatch(/^## Step \d+:/m);
  });
});

// =============================================================================
// AC1: Must Fix / Should Fix findings each become a work item carrying
// severity, attributedAgent, and fingerprint.
// =============================================================================

describe('AC1: Must Fix / Should Fix findings become items stamped with severity, attributedAgent, fingerprint', () => {
  it('invokes the ai-team:code-review skill', () => {
    expect(content).toMatch(/ai-team:code-review/);
  });

  it('creates work items typed as the finding type (bug)', () => {
    expect(content).toMatch(/--type\s+["']?bug\b/i);
  });

  it('ports the sweep severity table: Must Fix maps to critical/high, Should Fix maps to medium', () => {
    expect(content).toMatch(/critical/i);
    expect(content).toMatch(/\bhigh\b/i);
    expect(content).toMatch(/medium/i);
    expect(content).toMatch(/must fix/i);
    expect(content).toMatch(/should fix/i);
  });

  it('items are stamped with --severity, --attributedAgent, and --fingerprint', () => {
    expect(content).toMatch(/--severity/);
    expect(content).toMatch(/--attributedAgent|--attributed-agent/);
    expect(content).toMatch(/--fingerprint/);
  });

  it('attributes the agent via the earliest-flagged-stage rule, referenced not restated', () => {
    expect(content).toMatch(/earliest-flagged-stage/i);
    // Restating the classification table means naming multiple stage-agent
    // pairs together (murdock+testing, ba+implementing, etc.) — a single
    // agent name appearing elsewhere (e.g. in an unrelated example) is not
    // restatement by itself. Two or more pairs together would be.
    const pairs = [
      /murdock[^.\n]{0,20}testing|testing[^.\n]{0,20}murdock/i,
      /\bba\b[^.\n]{0,20}implement|implement[^.\n]{0,20}\bba\b/i,
      /lynch[^.\n]{0,20}review|review[^.\n]{0,20}lynch/i,
    ];
    const restatedPairCount = pairs.filter((p) => p.test(content)).length;
    expect(restatedPairCount, 'review.md restates the earliest-flagged-stage classification table instead of referencing it').toBeLessThan(2);
  });

  it('finds fingerprints via match-or-create against ateam learnings fingerprints', () => {
    expect(content).toMatch(/ateam learnings fingerprints/);
    expect(content).toMatch(/match-or-create|match or create/i);
  });
});

// =============================================================================
// AC2: Consider findings are reported, never captured as items.
// =============================================================================

describe('AC2: Consider-severity findings produce no work items', () => {
  it('mentions Consider-severity findings', () => {
    expect(content).toMatch(/consider/i);
  });

  it('states Consider findings are reported only, never captured/create no items', () => {
    // Checks EVERY "consider" mention, not just the first — a document
    // naturally mentions "Consider" earlier in passing (e.g. "severity
    // triage: Must Fix / Should Fix / Consider") before the specific
    // severity-table row that actually states the no-items rule. An earlier
    // version of this test only checked the first occurrence and would have
    // false-failed against exactly that realistic, correct structure
    // (caught via synthetic-sample validation before trusting RED).
    const mentions = [...content.matchAll(/consider/gi)];
    expect(mentions.length).toBeGreaterThan(0);
    const hasNoItemsRule = mentions.some((m) => {
      const window = content.slice(m.index, m.index + 300);
      return /not captured|no (work )?item|report(ed)? only|never/i.test(window);
    });
    expect(hasNoItemsRule, 'expected at least one "Consider" mention followed by the no-items rule').toBe(true);
  });
});

// =============================================================================
// AC3: zero findings is a clean, complete result — no mission.
// =============================================================================

describe('AC3: zero findings reports a clean result and creates no mission', () => {
  it('states a clean/zero-findings result is valid and complete', () => {
    expect(content).toMatch(/zero findings|no findings|clean/i);
  });

  it('creates no mission on a clean result', () => {
    const idx = content.search(/zero findings|no findings|clean (sweep|review|result)/i);
    expect(idx).toBeGreaterThan(-1);
    const window = content.slice(Math.max(0, idx - 50), idx + 300);
    expect(window).toMatch(/no mission|creates? no mission/i);
  });
});

// =============================================================================
// AC4: mission brief prdPath with DoD derived from findings.
// =============================================================================

describe('AC4: mission brief prdPath with a findings-derived Definition of Done', () => {
  it('sets prdPath to a mission brief file when creating the mission', () => {
    expect(content).toMatch(/prdPath/);
    expect(content).toMatch(/mission brief|mission-brief/i);
  });

  it('references the mission-brief skill/contract rather than inventing a format', () => {
    expect(content).toMatch(/mission-brief/i);
  });

  it('states the Definition of Done is derived from the findings', () => {
    const idx = content.search(/definition of done/i);
    expect(idx).toBeGreaterThan(-1);
    const window = content.slice(Math.max(0, idx - 50), idx + 300);
    expect(window).toMatch(/finding/i);
  });
});

// =============================================================================
// AC5: full existing item contract on every created item.
// =============================================================================

describe('AC5: created work items carry the full existing item contract', () => {
  it('item-creation guidance includes every field of the existing contract', () => {
    for (const flag of ['--type', '--description', '--objective', '--acceptance', '--context']) {
      expect(content, `expected ${flag} in an item-creation example`).toContain(flag);
    }
    expect(content).toMatch(/--outputs\.(test|impl|types)/);
  });

  it('states the contract is the same one /ai-team:run already executes', () => {
    expect(content).toMatch(/\/ai-team:run/);
  });

  it('creates items one at a time via ateam items createItem, not batched', () => {
    expect(content).toMatch(/ateam items createItem/);
    expect(content).toMatch(/one at a time|sequentially|not batch/i);
  });

  it('--dependencies (if used) is documented as repeatable, not comma-split', () => {
    // Only a meaningful check if the file actually documents --dependencies;
    // otherwise this AC is satisfied by omission (items may have none).
    if (/--dependencies/.test(content)) {
      const idx = content.search(/--dependencies/);
      const window = content.slice(idx, idx + 300);
      expect(window).toMatch(/repeatable|not[^.\n]{0,20}comma/i);
    }
  });
});

// =============================================================================
// AC6: an already-active mission is reported and refused, never a second one.
// =============================================================================

describe('AC6: an already-active mission is reported and refused, never a second one created', () => {
  it('checks for an active/current mission before creating one', () => {
    expect(content).toMatch(/missions-current|getCurrentMission|current mission/i);
  });

  it('reports the current mission and stops when one is active', () => {
    const idx = content.search(/current mission/i);
    expect(idx).toBeGreaterThan(-1);
    const window = content.slice(Math.max(0, idx - 50), idx + 400);
    expect(window).toMatch(/stop|refuse|already active|no second/i);
  });

  it('does NOT use --force on the actual createMission invocation (unlike /ai-team:plan)', () => {
    const invocationLines = content.split('\n').filter((line) => /ateam missions createMission/.test(line));
    expect(invocationLines.length, 'expected at least one createMission invocation line').toBeGreaterThan(0);
    for (const line of invocationLines) {
      expect(line, `createMission invocation must not pass --force: "${line}"`).not.toMatch(/--force/);
    }
  });
});

// =============================================================================
// AC7: a dirty-tree/no-diff scope-rule failure reports why and creates no
// mission (the code-review skill's own scope detection).
// =============================================================================

describe('AC7: a code-review scope-rule failure reports why and creates no mission', () => {
  it('references the code-review skill scope detection (dirty tree / no diff)', () => {
    expect(content).toMatch(/scope/i);
  });

  it('a scope-rule failure is reported and creates no mission', () => {
    const idx = content.search(/scope/i);
    expect(idx).toBeGreaterThan(-1);
    const window = content.slice(idx, idx + 400);
    expect(window).toMatch(/no mission|stop|report/i);
  });
});

// =============================================================================
// WI-939 lesson: the resolved quality profile must be wired into the ACTUAL
// createMission invocation, not just resolved in prose.
// =============================================================================

describe('quality profile is wired into the actual createMission call (WI-939 lesson)', () => {
  it("defaults to the 'normal' profile (per FR-7's entry-point defaults for review)", () => {
    expect(content).toMatch(/\bnormal\b/);
  });

  it('is overridable via --quality or -q', () => {
    expect(content).toMatch(/--quality|-q\b/);
  });

  it('does not restate the normal profile bundle (critical-path + hands-on) inline', () => {
    const hasCriticalPath = /critical-path/i.test(content);
    const hasHandsOn = /hands-on/i.test(content);
    expect(hasCriticalPath && hasHandsOn, 'review.md restates the normal bundle instead of referencing the resolver').toBe(false);
  });

  it('references the resolver rather than re-deriving profile meaning', () => {
    expect(content).toMatch(/qa-contract|resolveQualityProfile|resolver/i);
  });

  it('the actual createMission invocation passes the resolved contract via --testing-level, --review-tier, and --profile', () => {
    // Mirrors the fix that landed on WI-939 after Lynch's rejection there —
    // scoped to the invocation LINE itself, not prose anywhere in the file.
    const invocationLines = content.split('\n').filter((line) => /ateam missions createMission/.test(line));
    expect(invocationLines.length, 'expected at least one createMission invocation line').toBeGreaterThan(0);
    const hasContractFlags = invocationLines.some(
      (line) => /--testing-level/.test(line) && /--review-tier/.test(line) && /--profile\b/.test(line)
    );
    expect(
      hasContractFlags,
      `expected a createMission invocation line carrying --testing-level, --review-tier, and --profile together; invocation lines found: ${JSON.stringify(invocationLines)}`
    ).toBe(true);
  });
});

// =============================================================================
// Does NOT port sweep's Autofix step — this command creates a mission and
// stops, it never fixes or commits anything itself.
// =============================================================================

describe('never fixes or commits — creates a mission and stops (unlike sweep)', () => {
  it('does not autofix or commit findings itself', () => {
    expect(content).not.toMatch(/autofix/i);
    expect(content).not.toMatch(/one commit for the whole/i);
  });

  it('states execution is left to /ai-team:run', () => {
    expect(content).toMatch(/\/ai-team:run/);
  });
});
