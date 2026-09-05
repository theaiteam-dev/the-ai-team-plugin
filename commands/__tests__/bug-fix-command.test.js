/**
 * Tests for WI-939: /ai-team:bug-fix turns a reported bug into a mission.
 *
 * commands/bug-fix.md is a new slash command that accepts either a GitHub
 * issue number or a quoted free-text description, produces a repro-oriented
 * mission brief (WI-935's skill), and creates one or more `bug`-type work
 * items — all without a human-authored PRD. It defaults to the 'quick'
 * quality profile (WI-937's resolver).
 *
 * This repo tests command markdown by parsing prose invariants rather than
 * executing the command — see commands/__tests__/resume-recovery.test.js and
 * playbooks/__tests__/mission-tail-order.test.js for the established
 * convention this file follows: extract stable structural anchors (headings,
 * flag names, referenced concepts) and assert their presence/relationships,
 * never pin exact sentence wording B.A. is free to phrase differently.
 *
 * Two Sosa W1 fixes are folded into this item's ACs (not separate items):
 *   - an already-active mission must be reported and refused, never a second
 *     mission forced into existence (contrast with commands/plan.md's
 *     `createMission --force`, which this command must NOT use)
 *   - every created work item must carry the full existing item contract
 *     (type/description/objective/acceptance/context/outputs) so
 *     /ai-team:run needs no change to execute them
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const BUG_FIX_MD_PATH = join(REPO_ROOT, 'commands', 'bug-fix.md');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

/**
 * Returns the frontmatter block content (between the opening and closing
 * `---` fences) or null if the file has none.
 */
function frontmatterOf(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

/**
 * Slices `content` from the first line matching `headingPattern` to the
 * next line matching `stopPattern` (default: any `##`-level heading), or to
 * the end of the document if none follows. Mirrors the section-slicing
 * helper pattern used in skills/__tests__/mission-brief-contract.test.js and
 * agents/frankie.md's own test coverage.
 */
function sectionAfter(content, headingPattern, stopPattern = /^##\s/m) {
  const startIdx = content.search(headingPattern);
  if (startIdx === -1) return null;
  const afterHeadingLineIdx = content.indexOf('\n', startIdx) + 1;
  const stopRelIdx = content.slice(afterHeadingLineIdx).search(stopPattern);
  return stopRelIdx === -1
    ? content.slice(startIdx)
    : content.slice(startIdx, afterHeadingLineIdx + stopRelIdx);
}

// Defaults to '' (not undefined) when the file doesn't exist yet, so every
// content-dependent test below fails with a clean assertion message instead
// of a TypeError — the dedicated existence test still fails loudly first.
let content = '';

beforeAll(() => {
  if (existsSync(BUG_FIX_MD_PATH)) {
    content = readFileSync(BUG_FIX_MD_PATH, 'utf8');
  }
});

describe('commands/bug-fix.md exists', () => {
  it('exists at commands/bug-fix.md', () => {
    expect(existsSync(BUG_FIX_MD_PATH)).toBe(true);
  });
});

// =============================================================================
// Frontmatter and structure — this repo's commands/ use ONLY a `model:` key
// (no description:, argument-hint:, or allowed-tools: anywhere), and follow
// commands/sweep.md's heading skeleton: H1, Usage, Arguments, Pre-Flight,
// then numbered Steps.
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

  it('opens with the # /ai-team:bug-fix heading', () => {
    expect(content).toMatch(/^# \/ai-team:bug-fix/m);
  });

  it('has ## Usage and ## Arguments sections', () => {
    expect(content).toMatch(/^## Usage/m);
    expect(content).toMatch(/^## Arguments/m);
  });

  it('has a ## Pre-Flight: Environment Check section that checks ATEAM_PROJECT_ID', () => {
    const preflight = sectionAfter(content, /^## Pre-Flight/m);
    expect(preflight, 'expected a ## Pre-Flight section').not.toBeNull();
    expect(preflight).toMatch(/ATEAM_PROJECT_ID/);
  });

  it('has at least one numbered ## Step heading for the main flow', () => {
    expect(content).toMatch(/^## Step \d+:/m);
  });

  it('the Usage section documents both argument forms: an issue number and a quoted description', () => {
    const usage = sectionAfter(content, /^## Usage/m);
    expect(usage).toMatch(/issue/i);
    expect(usage).toMatch(/description/i);
  });
});

// =============================================================================
// AC1/AC2: the two input forms — GitHub issue number (reads via gh, applies
// the closed/non-bug metadata gate) and quoted free-text description (no
// metadata gate, never consults GitHub). Both produce "the same shape of
// mission."
// =============================================================================

describe('AC1: issue-number form reads the issue via gh and creates a mission with a bug-type item', () => {
  it('reads the issue via the gh CLI', () => {
    expect(content).toMatch(/\bgh\b/);
    expect(content).toMatch(/issue/i);
  });

  it('creates work items typed as bug', () => {
    expect(content).toMatch(/--type\s+["']?bug\b/i);
  });

  it('the created item(s) description language ties back to a repro', () => {
    expect(content).toMatch(/repro/i);
  });
});

describe('AC2: description form creates the same shape of mission without consulting GitHub', () => {
  it('documents a quoted free-text description as an alternative argument form', () => {
    const args = sectionAfter(content, /^## Arguments/m);
    expect(args).toMatch(/description/i);
    expect(args).toMatch(/quoted|"|'/);
  });

  it('states the description form does not consult GitHub / has no metadata gate', () => {
    // Loose but specific: somewhere the doc must say the description path
    // skips gh/GitHub entirely — not just that gh exists elsewhere in the file.
    expect(content).toMatch(/description[^.\n]{0,200}(no|without)[^.\n]{0,60}(github|gh\b|metadata gate)/is);
  });
});

// =============================================================================
// AC3: issue nonexistent/closed-as-fixed/non-bug — report why and stop,
// create no mission. This is the metadata gate, issue-form only.
// =============================================================================

describe('AC3: a nonexistent, closed, or non-bug issue reports why and creates no mission', () => {
  it('checks for a closed issue and stops', () => {
    expect(content).toMatch(/closed/i);
  });

  it('checks for a non-bug issue (missing/wrong label or type) and stops', () => {
    expect(content).toMatch(/not a bug|non-bug/i);
  });

  it('checks for a nonexistent issue number and stops', () => {
    expect(content).toMatch(/does not exist|not found/i);
  });

  it('explicitly creates no mission for these stop cases', () => {
    // Same "report and stop, no mission" shape as sweep.md's clean-outcome
    // language — the stop cases and "no mission" must appear near each other,
    // not just both exist somewhere unrelated in the file.
    expect(content).toMatch(/(closed|not a bug|non-bug|does not exist)[^.\n]{0,200}(no mission|creates? no mission)|(?:no mission|creates? no mission)[^.\n]{0,200}(closed|not a bug|non-bug|does not exist)/is);
  });
});

// =============================================================================
// AC4: an unreproducible defect is a clean, complete outcome — no mission.
// Mirrors FR-6's exact framing ("a valid, complete outcome") and
// commands/sweep.md's "a clean sweep is a valid, complete outcome" pattern.
// =============================================================================

describe('AC4: an unreproducible defect is a complete outcome, not an error, and creates no mission', () => {
  it('states that a failed repro attempt is a complete/valid outcome', () => {
    expect(content).toMatch(/reproduc/i);
    expect(content).toMatch(/valid|complete/i);
  });

  it('does not treat a failed repro as an error to escalate', () => {
    // The clean-outcome language must sit near "reproduc" — not just both
    // present anywhere in an 800-line file.
    const reproIdx = content.search(/reproduc/i);
    expect(reproIdx).toBeGreaterThan(-1);
    const window = content.slice(Math.max(0, reproIdx - 100), reproIdx + 300);
    expect(window).toMatch(/no mission|valid|complete outcome/i);
  });
});

// =============================================================================
// AC5: the mission's prdPath points at a readable mission brief (WI-935's
// skill) whose Definition of Done is derived from the reported repro.
// =============================================================================

describe('AC5: mission brief prdPath with a repro-derived Definition of Done', () => {
  it('sets prdPath to a mission brief file when creating the mission', () => {
    expect(content).toMatch(/prdPath/);
    expect(content).toMatch(/mission brief|mission-brief/i);
  });

  it('references the mission-brief skill/contract rather than restating its format', () => {
    // WI-935 is the single source of truth for the brief's shape (title,
    // executive summary, Definition of Done, scope) — bug-fix.md should
    // point at it, not restate the section list itself.
    expect(content).toMatch(/mission-brief/i);
  });

  it('states the Definition of Done is derived from the repro', () => {
    const window = content.slice(
      Math.max(0, content.search(/definition of done/i) - 50),
      content.search(/definition of done/i) + 300
    );
    expect(content).toMatch(/definition of done/i);
    expect(window).toMatch(/repro/i);
  });
});

// =============================================================================
// AC6 (Sosa W1 fix #1): an already-active mission is reported and refused —
// never force-archived into a second one. Contrast with commands/plan.md's
// `createMission --force`, which this command must NOT use.
// =============================================================================

describe('AC6: an already-active mission is reported and refused, never a second one created', () => {
  it('checks for an active/current mission before creating one', () => {
    expect(content).toMatch(/missions-current|getCurrentMission|current mission/i);
  });

  it('reports the current mission and stops when one is active', () => {
    const window = content.slice(
      Math.max(0, content.search(/current mission/i) - 50),
      content.search(/current mission/i) + 400
    );
    expect(content).toMatch(/current mission/i);
    expect(window).toMatch(/stop|refuse|already active|no second/i);
  });

  it('does NOT use --force on createMission (unlike /ai-team:plan, which always archives)', () => {
    // Scoped to actual `ateam missions createMission ...` invocation LINES
    // (bash examples), not prose — a sentence explaining that the command
    // never passes --force legitimately contains both tokens near each
    // other without being an invocation. An earlier version of this test
    // used a whole-content proximity regex and false-failed against exactly
    // that correct, expected prose (caught via a synthetic-content sanity
    // check before trusting RED — see the file's own self-check discipline).
    const invocationLines = content.split('\n').filter((line) => /ateam missions createMission/.test(line));
    expect(invocationLines.length, 'expected at least one createMission invocation line').toBeGreaterThan(0);
    for (const line of invocationLines) {
      expect(line, `createMission invocation must not pass --force: "${line}"`).not.toMatch(/--force/);
    }
  });
});

// =============================================================================
// AC7 (Sosa W1 fix #2): every created item carries the full existing item
// contract — type, description, objective, acceptance, context, outputs —
// so /ai-team:run needs no change to execute them.
// =============================================================================

describe('AC7: created work items carry the full existing item contract', () => {
  it('item-creation guidance includes every field of the existing contract', () => {
    for (const flag of ['--type', '--description', '--objective', '--acceptance', '--context']) {
      expect(content, `expected ${flag} in an item-creation example`).toContain(flag);
    }
    // outputs uses the dotted flag convention (--outputs.test / --outputs.impl)
    expect(content).toMatch(/--outputs\.(test|impl|types)/);
  });

  it('states the contract is the same one /ai-team:run already executes — no pipeline change needed', () => {
    expect(content).toMatch(/\/ai-team:run/);
  });

  it('uses ateam items createItem one at a time, not batched', () => {
    expect(content).toMatch(/ateam items createItem/);
    // Matches the "one at a time" discipline CLAUDE.md and other commands
    // document for createItem — a loose but specific check for that phrase
    // or an equivalent sequential-not-batched statement.
    expect(content).toMatch(/one at a time|sequentially|not batch/i);
  });
});

// =============================================================================
// Context-driven correctness requirements (not separate ACs, but explicitly
// named in the item's context — worth pinning to avoid an Amy-style finding
// later): gh absent/unauthenticated is a reported stop, not a crash; quality
// profiles are referenced, not restated (ADR 0009's naming-layer discipline).
// =============================================================================

describe('gh CLI absence/auth failure is a reported stop, not a crash', () => {
  it('handles gh being unavailable or unauthenticated as a graceful stop', () => {
    expect(content).toMatch(/gh[^.\n]{0,100}(not installed|not authenticated|unavailable|not found)|(?:not installed|not authenticated|unavailable)[^.\n]{0,100}gh\b/is);
  });
});

describe('quality profile is referenced, not restated (ADR 0009 naming-layer discipline)', () => {
  it("defaults to the 'quick' profile", () => {
    expect(content).toMatch(/\bquick\b/);
  });

  it('does not restate the quick profile bundle (smoke + evidence-only) inline', () => {
    // Restating both enum values together would be exactly the drift ADR
    // 0009 forbids — the command should point at the resolver (qa-contract.js
    // / resolveQualityProfile), never re-derive what "quick" maps to.
    const hasSmoke = /\bsmoke\b/i.test(content);
    const hasEvidenceOnly = /evidence-only/i.test(content);
    expect(hasSmoke && hasEvidenceOnly, 'bug-fix.md restates the quick bundle instead of referencing the resolver').toBe(false);
  });

  it('is overridable via --quality or -q', () => {
    expect(content).toMatch(/--quality|-q\b/);
  });

  it('the actual createMission invocation passes the resolved contract via --testing-level, --review-tier, and --profile', () => {
    // WI-939 rework (Lynch's rejection): resolving the profile via
    // resolveQualityProfile() in PROSE is not the same as wiring it into the
    // mission-creation CALL. These three flags are exactly what WI-934 added
    // to `ateam missions createMission` (packages/ateam-cli/cmd/
    // missions_createMission.go:76-102) to stamp the executionContract at
    // creation time, and they're required all-or-nothing together
    // (validate.RequireFlags). Without them on the actual invocation line,
    // every bug-fix mission gets executionContract: null regardless of what
    // was resolved — silently defeating FR-9. Scoped to the invocation LINE
    // itself (mirroring the --force check above), not prose anywhere in the
    // file, so a future edit that drops the flags from the real command but
    // leaves the surrounding explanation intact still fails here.
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

describe('--test <path> (failing-test source) is explicitly out of scope for this item', () => {
  it('does not implement a --test flag (deferred to a later PRD)', () => {
    expect(content).not.toMatch(/--test\s+<path>/);
  });
});
