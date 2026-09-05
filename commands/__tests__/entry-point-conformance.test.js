/**
 * Tests for WI-945: Every entry point honours the same mission contract.
 *
 * This is the integration item: WI-938 (`/ai-team:review`), WI-939
 * (`/ai-team:bug-fix`), WI-940 (`/ai-team:bug-stomp`), and WI-941
 * (`/ai-team:plan`'s quality-profile extension) each own exactly one command
 * file and can only verify themselves. This file reads all four together —
 * `commands/plan.md`, `commands/review.md`, `commands/bug-fix.md`,
 * `commands/bug-stomp.md` — and pins the five shared, cross-cutting
 * guarantees named in this item's own acceptance criteria. It does NOT
 * re-litigate any single command's already-approved individual behavior
 * (per this item's implementation-license note, C4) — every assertion here
 * is a property that holds (or must hold) ACROSS all four files at once.
 *
 * Convention: this repo tests command/agent markdown by parsing prose
 * invariants, never by executing the commands (they have no runtime) — see
 * commands/__tests__/resume-recovery.test.js (single-file-to-set coverage:
 * every active pipeline stage has a recovery rule) and
 * playbooks/__tests__/mission-tail-order.test.js (multi-file cross-cutting
 * sweeps) for the two precedents this file follows. AC2 (no restatement of
 * the quality-profile bundle mapping) gets its primary, exhaustive sweep as
 * a sibling suite added to mission-tail-order.test.js per this item's own
 * dispatch instructions (reusing that file's collectMarkdownFiles() helper
 * and allMarkdownFiles() file set, NOT looksLikeConfigTemplate() — that
 * heuristic detects ateam.config.json template blocks, an unrelated thing);
 * this file carries only a lighter "references the resolver" check for AC2
 * so the AC still has its own assertion here, without duplicating the full
 * exhaustive sweep in two places.
 *
 * SCOPING DECISION — AC4 (active-mission refusal): this item's own AC text
 * says "any entry point" refuses when a mission is already active. Reading
 * all four files fresh (not carried over from earlier, possibly stale
 * investigation) turned up a direct conflict: `commands/plan.md` ALWAYS
 * archives the existing mission via `--force` ("`--force`: Archive existing
 * mission if any"), and `commands/bug-fix.md`'s own Step 1 explicitly
 * contrasts itself against exactly this ("Unlike `/ai-team:plan`, this
 * command never passes `--force` to `createMission`: a bug fix does not get
 * to archive whatever the operator is already running") — a sentence
 * WI-939 already wrote and already locked in with its own regression test
 * ("does NOT use --force on createMission (unlike /ai-team:plan, which
 * always archives)" in commands/__tests__/bug-fix-command.test.js).
 * Requiring plan.md to also refuse would silently overturn that already-
 * shipped, already-tested, Sosa-reviewed design decision from a prior item
 * in this same mission — that is scope creep this item's own text does not
 * license (C4 says "adding a missing shared guarantee," not "changing an
 * approved command's documented behavior"). So AC4 here is scoped to the
 * real seam: the THREE evidence-derived entry points (built in parallel by
 * three separate work items, so free to drift from each other) must state
 * the IDENTICAL refuse-and-point-at-current-mission contract. plan.md's own
 * (deliberately different) contract is still checked for presence, just not
 * forced into "refuse".
 *
 * SCOPING DECISION — AC5 (NFR-1 ordering): per this item's own context, only
 * work AFTER mission creation is asserted — pre-mission attribution is a
 * documented, accepted gap (PRD section 9, Observer hooks). This uses each
 * file's own first literal occurrence of "ateam missions createMission" and
 * "ateam items createItem" (mirroring mission-tail-order.test.js's
 * checkAscendingOrder milestone-index approach) rather than a stricter
 * section-boundary parse, since the CLI-reference tables at the bottom of
 * every file restate both commands again — but always AFTER the real steps,
 * so the first-occurrence index is never contaminated by the tables.
 *
 * QUALITY PROCESS: before trusting any RED state below, each check was
 * traced by hand against the actual current text of all four files (read in
 * full this session, not assumed from earlier work on WI-938/939/940/941).
 * Two real, substantive gaps were found this way, not manufactured to have
 * something to test:
 *   - AC3 (invalid --quality rejection): only plan.md documents it today.
 *     review.md, bug-fix.md, and bug-stomp.md name the flag and its default
 *     but never say what happens on an invalid value — no "invalid" or
 *     "reject" language anywhere in any of the three, and none lists it in
 *     their own "## Errors" section.
 *   - AC5 (mission-before-work ordering): review.md's Step 3 ("Map Severity
 *     and Create Work Items") and bug-stomp.md's Step 4 ("File Each
 *     Confirmed Defect") both call `ateam items createItem` BEFORE their own
 *     later "Create the Mission" step — items would be created with no
 *     mission to attach to. plan.md and bug-fix.md are already correctly
 *     ordered (mission step precedes item-creation step in both).
 * The consolidated flag-wiring check below additionally found plan.md is
 * the only one of the four whose example `createMission` invocation line
 * never shows the literal `--testing-level`/`--review-tier`/`--profile`
 * flags (it only comments that they should be "added" conditionally) — the
 * other three show them concretely, a pattern proactively carried over from
 * WI-938/939/940.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

/**
 * Slices `content` from the first line matching `headingPattern` to the
 * next line matching `stopPattern` (default: a `##`- or `###`-level
 * heading), or to the end of the document if none follows.
 */
function sectionAfter(content, headingPattern, stopPattern = /^#{2,3}\s/m) {
  const startIdx = content.search(headingPattern);
  if (startIdx === -1) return '';
  const afterHeadingLineIdx = content.indexOf('\n', startIdx) + 1;
  const stopRelIdx = content.slice(afterHeadingLineIdx).search(stopPattern);
  return stopRelIdx === -1
    ? content.slice(startIdx)
    : content.slice(startIdx, afterHeadingLineIdx + stopRelIdx);
}

/**
 * Every line in `content` that actually INVOKES `ateam missions
 * createMission` with flags — i.e. requires a trailing `--` flag on the same
 * line, not just the bare phrase. This excludes decorative mentions (e.g.
 * plan.md's ASCII flow-diagram box "│ 1. ateam missions createMission │",
 * which names the step but carries no flags at all) while still matching
 * real bash examples and CLI-reference-table rows, which always show flags.
 */
function createMissionInvocationLines(content) {
  return content.split('\n').filter((line) => /ateam missions createMission\s+--/.test(line));
}

let planMd;
let reviewMd;
let bugFixMd;
let bugStompMd;

beforeAll(() => {
  planMd = read('commands/plan.md');
  reviewMd = read('commands/review.md');
  bugFixMd = read('commands/bug-fix.md');
  bugStompMd = read('commands/bug-stomp.md');
});

function entryPoints() {
  return [
    { name: 'commands/plan.md', get: () => planMd },
    { name: 'commands/review.md', get: () => reviewMd },
    { name: 'commands/bug-fix.md', get: () => bugFixMd },
    { name: 'commands/bug-stomp.md', get: () => bugStompMd },
  ];
}

// =============================================================================
// AC1: every entry point sets the mission's prdPath to a mission brief; none
// of them can create a mission without one.
// =============================================================================

describe('AC1: every entry point sets prdPath to a mission brief; none creates a mission without one', () => {
  it.each(entryPoints())("$name's createMission invocation always carries --prdPath", ({ name, get }) => {
    const lines = createMissionInvocationLines(get());
    expect(lines.length, `${name}: expected at least one "ateam missions createMission" invocation line`).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, `${name}: createMission invocation is missing --prdPath: "${line}"`).toMatch(/--prdPath/);
    }
  });

  it.each(entryPoints())("$name's --prdPath value ends in .md", ({ name, get }) => {
    const lines = createMissionInvocationLines(get());
    const hasMdPath = lines.some((line) => /--prdPath\s+"[^"]*\.md"/.test(line));
    expect(hasMdPath, `${name}: expected --prdPath to point at a ".md" file on the invocation line`).toBe(true);
  });

  it.each(entryPoints())('$name documents where its brief comes from (the mission-brief skill\'s .mission-briefs/ convention, or, for plan.md only, the PRD file itself)', ({ name, get }) => {
    // plan.md's PRD-file-IS-the-brief contract is a decided, already-tested
    // regression (see commands/__tests__/plan-quality-profile.test.js); the
    // other three write a derived brief under .mission-briefs/.
    expect(get(), `${name}: expected a brief-source reference`).toMatch(/\.mission-briefs\/|PRD file/i);
  });
});

// =============================================================================
// AC2 (light check here; exhaustive sweep + positive control lives as a
// sibling suite in playbooks/__tests__/mission-tail-order.test.js per this
// item's own dispatch instructions): no entry point restates what
// quick/normal/deep map to.
// =============================================================================

describe('AC2: no entry point restates the quality-profile bundle mapping (see mission-tail-order.test.js for the exhaustive sweep)', () => {
  it.each(entryPoints())('$name references the canonical resolver (qa-contract.js) rather than re-deriving profile meaning', ({ name, get }) => {
    expect(get(), `${name}: expected a reference to the resolver`).toMatch(/qa-contract|resolveQualityProfile|resolver/i);
  });
});

// =============================================================================
// AC3: an unrecognised --quality value is rejected consistently — names all
// three valid profiles, creates no mission, and never silently falls back —
// across all four entry points.
// =============================================================================

describe('AC3: invalid --quality is rejected consistently across all four entry points (names all 3, no mission, no silent fallback)', () => {
  it.each(entryPoints())('$name documents rejecting an invalid --quality value, naming quick/normal/deep, with no mission created', ({ name, get }) => {
    const content = get();
    const idx = content.search(/invalid[^\n]*(?:--quality|-q\b)|(?:--quality|-q\b)[^\n]*invalid/i);
    expect(idx, `${name}: expected explicit "invalid --quality" handling documented somewhere in the file`).toBeGreaterThan(-1);
    const window = content.slice(Math.max(0, idx - 200), idx + 400);
    expect(window, `${name}: invalid-value window should name "quick"`).toMatch(/quick/i);
    expect(window, `${name}: invalid-value window should name "normal"`).toMatch(/normal/i);
    expect(window, `${name}: invalid-value window should name "deep"`).toMatch(/deep/i);
    expect(window, `${name}: invalid-value window should say no mission is created / it is rejected`).toMatch(/no mission|reject/i);
  });

  it.each(entryPoints())('$name lists the invalid --quality case in its own "## Errors" section (no silent fallback left undocumented)', ({ name, get }) => {
    const content = get();
    const errorsSection = sectionAfter(content, /^## Errors/m, /^## (?!Errors)/m);
    expect(errorsSection, `${name}: expected an "## Errors" section`).not.toBe('');
    expect(errorsSection, `${name}: expected the Errors section to mention the invalid-quality case`).toMatch(/quality/i);
  });
});

// =============================================================================
// AC4: active-mission refusal is consistent — scoped to the three
// evidence-derived entry points; see the file-header "SCOPING DECISION" for
// why plan.md's documented --force/archive behavior is preserved rather than
// forced into "refuse" (a prior, already-tested, already-approved design
// decision from WI-939, not a conformance gap this item may close).
// =============================================================================

describe('AC4: active-mission refusal is consistent across the three evidence-derived entry points', () => {
  const EVIDENCE_DERIVED = [
    { name: 'commands/review.md', get: () => reviewMd },
    { name: 'commands/bug-fix.md', get: () => bugFixMd },
    { name: 'commands/bug-stomp.md', get: () => bugStompMd },
  ];

  it.each(EVIDENCE_DERIVED)('$name refuses and points at the current mission when one is already active, and never archives it', ({ name, get }) => {
    const step1 = sectionAfter(get(), /^## Step 1: Check for an Active Mission/m);
    expect(step1, `${name}: expected a "Step 1: Check for an Active Mission" section`).not.toBe('');
    expect(step1, `${name}: expected the active-mission check to call getCurrentMission`).toMatch(/getCurrentMission/);
    expect(step1, `${name}: expected the refusal to report the current mission`).toMatch(/report the current mission/i);
    expect(step1, `${name}: expected explicit refusal language`).toMatch(/refuse/i);
    // Must not silently ARCHIVE via --force. The evidence-derived commands
    // may legitimately mention the string "--force" while explicitly
    // disclaiming it (e.g. "never passes --force to createMission") — that
    // disclaimer is exactly the correct, desired behavior. What must never
    // appear is an actual invocation line that passes the flag.
    const invocationLines = step1.split('\n').filter((line) => /ateam missions createMission/.test(line));
    for (const line of invocationLines) {
      expect(line, `${name}: Step 1 must not show an invocation that passes --force`).not.toMatch(/--force/);
    }
  });

  it('the three evidence-derived entry points use the identical refusal sentence (no drift between the 3 items that built them independently)', () => {
    const REFUSAL_SENTENCE = /report the current mission to the operator and stop — refuse to create a second one\./;
    for (const { name, get } of EVIDENCE_DERIVED) {
      expect(get(), `${name}: expected the canonical refusal sentence, verbatim`).toMatch(REFUSAL_SENTENCE);
    }
  });

  it("plan.md documents its own (deliberately different, already-approved) mission-conflict handling — archiving via --force, not silence", () => {
    expect(planMd).toMatch(/--force/);
    // The description bullet ("- `--force`: Archive existing mission if
    // any") sits well after the flag's first appearance on the example
    // invocation line itself, so this needs a wide window, not a tight one.
    const idx = planMd.search(/--force/);
    const window = planMd.slice(idx, idx + 600);
    expect(window).toMatch(/archive/i);
  });
});

// =============================================================================
// AC5 (NFR-1): no entry point performs item-creating work before its mission
// exists — only asserted on work AFTER mission creation (pre-mission
// attribution is a documented, accepted gap per PRD section 9).
// =============================================================================

describe('AC5 (NFR-1): no entry point creates work items before its mission exists', () => {
  it.each(entryPoints())('$name creates the mission before creating any work items', ({ name, get }) => {
    const content = get();
    const missionIdx = content.search(/ateam missions createMission/);
    const itemsIdx = content.search(/ateam items createItem/);
    expect(missionIdx, `${name}: expected an "ateam missions createMission" invocation`).toBeGreaterThan(-1);
    expect(itemsIdx, `${name}: expected an "ateam items createItem" invocation`).toBeGreaterThan(-1);
    expect(
      missionIdx,
      `${name}: mission creation (first occurrence at index ${missionIdx}) must precede item creation (first occurrence at index ${itemsIdx}) — items cannot be created before their mission exists`
    ).toBeLessThan(itemsIdx);
  });
});

// =============================================================================
// Consolidated flag-wiring check (per team-lead's explicit dispatch context):
// all four commands must wire --testing-level/--review-tier/--profile into
// their ACTUAL createMission invocation line(s), not just resolve the
// contract in prose. WI-938/939/940 each pin this individually for their own
// file; this is the one place that verifies it holds across all four at once.
// =============================================================================

describe('quality-profile flags are wired into every entry point\'s actual createMission invocation (consolidated across all four)', () => {
  it.each(entryPoints())("$name's createMission invocation line(s) carry --testing-level, --review-tier, and --profile together", ({ name, get }) => {
    const lines = createMissionInvocationLines(get());
    expect(lines.length, `${name}: expected at least one createMission invocation line`).toBeGreaterThan(0);
    const hasContractFlags = lines.some(
      (line) => /--testing-level/.test(line) && /--review-tier/.test(line) && /--profile\b/.test(line)
    );
    expect(
      hasContractFlags,
      `${name}: no createMission invocation line carries all three contract flags together — resolving the contract in prose and omitting it from the actual call would silently ship a contract-less mission`
    ).toBe(true);
  });
});
