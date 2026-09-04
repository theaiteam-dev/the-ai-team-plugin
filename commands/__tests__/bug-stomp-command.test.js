/**
 * Tests for WI-940: /ai-team:bug-stomp hunts a branch and files what it
 * finds.
 *
 * Sibling to WI-938 (/ai-team:review): investigates the current branch for
 * defects (the way Amy probes — agents/amy.md, skills/perspective-test/) and
 * files each CONFIRMED defect (never a mere suspicion) as a bug-type work
 * item with a repro description, under a mission brief inventorying the
 * hunt. Default scope follows the ai-team:code-review skill's rules
 * (uncommitted work when dirty, else diff against base); `--paths
 * <glob...>` narrows, `--all` widens to the whole codebase. Default quality
 * profile is 'normal'. Like the other entry points, it creates a mission and
 * stops — fixes run through the normal pipeline.
 *
 * This repo tests command markdown by parsing prose invariants — see
 * commands/__tests__/resume-recovery.test.js and
 * playbooks/__tests__/mission-tail-order.test.js for the convention: extract
 * stable structural anchors and assert their presence/relationships, never
 * pin exact sentence wording B.A. is free to phrase differently.
 *
 * WI-939 LESSON (repeated on WI-938, explicitly flagged for this item too):
 * resolving a quality profile in PROSE is not the same as wiring it into the
 * actual `ateam missions createMission` invocation. This file asserts the
 * invocation LINE itself carries --testing-level/--review-tier/--profile.
 *
 * QUALITY PROCESS NOTE: every AC-critical regex below was validated against
 * synthetic sample content via a standalone Node script BEFORE this file
 * was trusted (no repo files touched — the lesson from WI-941's boundary
 * incident and WI-938's proximity-check bug). See this session's WI-938 test
 * file for the sibling pattern this one is built from.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const BUG_STOMP_MD_PATH = join(REPO_ROOT, 'commands', 'bug-stomp.md');

function sectionAfter(content, headingPattern, stopPattern = /^##\s/m) {
  const startIdx = content.search(headingPattern);
  if (startIdx === -1) return '';
  const afterHeadingLineIdx = content.indexOf('\n', startIdx) + 1;
  const stopRelIdx = content.slice(afterHeadingLineIdx).search(stopPattern);
  return stopRelIdx === -1
    ? content.slice(startIdx)
    : content.slice(startIdx, afterHeadingLineIdx + stopRelIdx);
}

function frontmatterOf(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

/** True if ANY occurrence of `pattern` in `content` has `nearPattern` within `windowSize` chars after it. */
function anyOccurrenceNear(content, pattern, nearPattern, windowSize = 300) {
  const mentions = [...content.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))];
  return mentions.some((m) => nearPattern.test(content.slice(m.index, m.index + windowSize)));
}

let content = '';

beforeAll(() => {
  if (existsSync(BUG_STOMP_MD_PATH)) {
    content = readFileSync(BUG_STOMP_MD_PATH, 'utf8');
  }
});

describe('commands/bug-stomp.md exists', () => {
  it('exists at commands/bug-stomp.md', () => {
    expect(existsSync(BUG_STOMP_MD_PATH)).toBe(true);
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

  it('opens with the # /ai-team:bug-stomp heading', () => {
    expect(content).toMatch(/^# \/ai-team:bug-stomp/m);
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
// AC1: confirmed defects (never suspicions) become bug-type items with a
// repro description, stamped with severity/attributedAgent/fingerprint.
// =============================================================================

describe('AC1: confirmed defects become stamped bug-type items with a repro description', () => {
  it('creates work items typed as bug', () => {
    expect(content).toMatch(/--type\s+["']?bug\b/i);
  });

  it('items carry a repro description', () => {
    expect(content).toMatch(/repro/i);
  });

  it('items are stamped with --severity, --attributedAgent, and --fingerprint', () => {
    expect(content).toMatch(/--severity/);
    expect(content).toMatch(/--attributedAgent|--attributed-agent/);
    expect(content).toMatch(/--fingerprint/);
  });

  it('ports the sweep severity table (Must Fix -> critical/high, Should Fix -> medium)', () => {
    expect(content).toMatch(/critical/i);
    expect(content).toMatch(/\bhigh\b/i);
    expect(content).toMatch(/medium/i);
  });

  it('attributes the agent via the earliest-flagged-stage rule, referenced not restated', () => {
    expect(content).toMatch(/earliest-flagged-stage/i);
    const pairs = [
      /murdock[^.\n]{0,20}testing|testing[^.\n]{0,20}murdock/i,
      /\bba\b[^.\n]{0,20}implement|implement[^.\n]{0,20}\bba\b/i,
      /lynch[^.\n]{0,20}review|review[^.\n]{0,20}lynch/i,
    ];
    const restatedPairCount = pairs.filter((p) => p.test(content)).length;
    expect(restatedPairCount, 'restates the earliest-flagged-stage classification table instead of referencing it').toBeLessThan(2);
  });

  it('finds fingerprints via match-or-create against ateam learnings fingerprints', () => {
    expect(content).toMatch(/ateam learnings fingerprints/);
    expect(content).toMatch(/match-or-create|match or create/i);
  });

  it('only CONFIRMED defects become items — a suspicion is not a finding', () => {
    expect(content).toMatch(/confirmed/i);
    expect(content).toMatch(/suspicion/i);
  });
});

// =============================================================================
// AC2: default scope follows the code-review skill (dirty tree vs diff base)
// — referenced, not restated, so the two commands can't drift apart.
// =============================================================================

describe('AC2: default scope follows the ai-team:code-review skill, referenced not restated', () => {
  it('references the ai-team:code-review skill for scope rules', () => {
    expect(content).toMatch(/ai-team:code-review/);
  });

  it('states the default scope: uncommitted work when dirty, else diff against base', () => {
    expect(content).toMatch(/uncommitted|dirty/i);
    expect(content).toMatch(/diff/i);
    expect(content).toMatch(/base/i);
  });
});

// =============================================================================
// AC3: --paths narrows, --all widens.
// =============================================================================

describe('AC3: --paths narrows the hunt, --all widens it to the whole codebase', () => {
  it('documents --paths accepting one or more globs', () => {
    expect(content).toMatch(/--paths/);
    expect(anyOccurrenceNear(content, /--paths/, /glob/i)).toBe(true);
  });

  it('documents --paths as narrowing the hunt', () => {
    expect(anyOccurrenceNear(content, /--paths/, /narrow/i)).toBe(true);
  });

  it('documents --all as widening to the whole codebase', () => {
    expect(content).toMatch(/--all\b/);
    expect(anyOccurrenceNear(content, /--all\b/, /widen|whole codebase/i)).toBe(true);
  });
});

// =============================================================================
// AC4: a clean hunt (no confirmed defects) is a valid, complete outcome —
// creates no mission.
// =============================================================================

describe('AC4: a clean hunt (no confirmed defects) creates no mission', () => {
  it('states a clean/no-defects hunt is a valid, complete outcome', () => {
    expect(content).toMatch(/clean|no defects/i);
  });

  it('creates no mission on a clean hunt', () => {
    expect(anyOccurrenceNear(content, /clean|no defects found/i, /no mission|creates? no mission/i, 300)).toBe(true);
  });
});

// =============================================================================
// AC5: mission brief inventorying the hunt (what was hunted, what was
// found), with DoD derived from the confirmed defects.
// =============================================================================

describe('AC5: mission brief inventories the hunt, DoD derived from confirmed defects', () => {
  it('sets prdPath to a mission brief file when creating the mission', () => {
    expect(content).toMatch(/prdPath/);
    expect(content).toMatch(/mission brief|mission-brief/i);
  });

  it('references the mission-brief skill/contract rather than inventing a format', () => {
    expect(content).toMatch(/mission-brief/i);
  });

  it('the brief inventories what was hunted and what was found', () => {
    expect(content).toMatch(/hunt/i);
    expect(content).toMatch(/found|findings/i);
  });

  it('states the Definition of Done is derived from the confirmed defects', () => {
    expect(anyOccurrenceNear(content, /definition of done/i, /confirmed|defect/i, 350)).toBe(true);
  });
});

// =============================================================================
// AC6: an already-active mission is reported and refused, never a second.
// =============================================================================

describe('AC6: an already-active mission is reported and refused, never a second one created', () => {
  it('checks for an active/current mission before creating one', () => {
    expect(content).toMatch(/missions-current|getCurrentMission|current mission/i);
  });

  it('reports the current mission and stops when one is active', () => {
    expect(anyOccurrenceNear(content, /current mission/i, /stop|refuse|already active|no second/i, 400)).toBe(true);
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
// AC7: full existing item contract on every created item.
// =============================================================================

describe('AC7: created work items carry the full existing item contract', () => {
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
    if (/--dependencies/.test(content)) {
      expect(anyOccurrenceNear(content, /--dependencies/, /repeatable|not[^.\n]{0,20}comma/i)).toBe(true);
    }
  });
});

// =============================================================================
// WI-939 lesson (repeated on WI-938, watch for it here too): the resolved
// quality profile must be wired into the ACTUAL createMission invocation.
// =============================================================================

describe('quality profile is wired into the actual createMission call (WI-939 lesson)', () => {
  it("defaults to the 'normal' profile", () => {
    expect(content).toMatch(/\bnormal\b/);
  });

  it('is overridable via --quality or -q', () => {
    expect(content).toMatch(/--quality|-q\b/);
  });

  it('does not restate the normal profile bundle (critical-path + hands-on) inline', () => {
    const hasCriticalPath = /critical-path/i.test(content);
    const hasHandsOn = /hands-on/i.test(content);
    expect(hasCriticalPath && hasHandsOn, 'restates the normal bundle instead of referencing the resolver').toBe(false);
  });

  it('references the resolver rather than re-deriving profile meaning', () => {
    expect(content).toMatch(/qa-contract|resolveQualityProfile|resolver/i);
  });

  it('the actual createMission invocation passes the resolved contract via --testing-level, --review-tier, and --profile', () => {
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
// Never fixes or commits — creates a mission and stops, like every other
// entry point.
// =============================================================================

describe('never fixes or commits — creates a mission and stops', () => {
  it('does not autofix or commit findings itself', () => {
    expect(content).not.toMatch(/autofix/i);
    expect(content).not.toMatch(/one commit for the whole/i);
  });

  it('states execution is left to /ai-team:run', () => {
    expect(content).toMatch(/\/ai-team:run/);
  });
});
