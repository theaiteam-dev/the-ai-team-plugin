/**
 * Tests for WI-008: wire /ai-team:run and /ai-team:resume to enter the tick loop.
 *
 * Both slash commands previously loaded the 1235-line orchestration playbook
 * into Hannibal's context. The cost-reduction goal of this PRD is to replace
 * that load with an invocation of /ai-team:tick (the lightweight controller
 * loop introduced in WI-007). Behind the `--legacy` escape hatch, the old
 * playbook-driven loop is preserved for one release.
 *
 * Test approach (same string-match pattern used by resume-recovery.test.js
 * and tick.test.js): read each markdown file and assert which content appears
 * where. To distinguish "default path" from "--legacy branch" without a real
 * markdown parser, we use proximity: any Read of an orchestration playbook
 * MUST appear within ~1000 chars after a `--legacy` token (i.e. inside a
 * `--legacy` guarded block). If a Read appears with no nearby `--legacy`,
 * the test treats it as a default-path call and fails.
 *
 * RED phase: both files still load the playbook unconditionally — every
 * "default path must not Read the playbook" assertion fails today, and every
 * "default path must invoke /ai-team:tick" assertion fails today. The
 * --legacy assertions also fail because no --legacy branch exists yet.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUN_MD_PATH = path.resolve(__dirname, '..', 'run.md');
const RESUME_MD_PATH = path.resolve(__dirname, '..', 'resume.md');

// Matches an actual Read() call against the orchestration playbook files.
// Allows arbitrary path prefixes (e.g. ${CLAUDE_PLUGIN_ROOT}/playbooks/...).
const PLAYBOOK_READ_RE = /Read\s*\(\s*[^)]*orchestration-(?:legacy|native)\.md[^)]*\)/gi;

// Tokens that signal the file is inside a `--legacy` guarded block.
// We accept any case-sensitive occurrence of the literal flag name; B.A. may
// also reasonably use it in a section header like "## --legacy escape hatch".
const LEGACY_TOKEN = '--legacy';

// Window (in chars) BEFORE a playbook Read in which a `--legacy` marker must
// appear for the Read to count as "guarded by --legacy". 1000 is generous —
// it spans a small section but not the whole file.
const LEGACY_GUARD_PROXIMITY = 1000;

/**
 * Return every occurrence of `Read(.../orchestration-{legacy,native}.md)` in
 * content, as {index, match} pairs.
 */
function findPlaybookReads(content) {
  return [...content.matchAll(PLAYBOOK_READ_RE)].map((m) => ({
    index: m.index,
    match: m[0],
  }));
}

/**
 * Return the offset of the nearest preceding `--legacy` token within
 * LEGACY_GUARD_PROXIMITY chars of offset, or -1 if none.
 */
function nearestLegacyMarkerBefore(content, offset) {
  const windowStart = Math.max(0, offset - LEGACY_GUARD_PROXIMITY);
  const slice = content.slice(windowStart, offset);
  const last = slice.lastIndexOf(LEGACY_TOKEN);
  if (last < 0) return -1;
  return windowStart + last;
}

/**
 * Return every occurrence of the literal /ai-team:tick token in content.
 */
function findTickInvocations(content) {
  return [...content.matchAll(/\/ai-team:tick/g)].map((m) => ({ index: m.index }));
}

/**
 * Return a 1-based line:column for a character offset — used in failure
 * messages so the operator can jump straight to the offending content.
 */
function fmtPos(content, offset) {
  const before = content.slice(0, offset);
  const line = before.split('\n').length;
  const col = offset - before.lastIndexOf('\n');
  return `${line}:${col}`;
}

// ===========================================================================
// commands/run.md
// ===========================================================================

describe('commands/run.md (WI-008: default invokes /ai-team:tick; --legacy preserves playbook)', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(RUN_MD_PATH, 'utf-8');
  });

  // -------------------------------------------------------------------------
  // AC1 (positive): /ai-team:tick is invoked in the default path
  // (i.e. at least one /ai-team:tick reference appears OUTSIDE a --legacy
  // guard so the default path actually hands off to the tick loop).
  // -------------------------------------------------------------------------
  test('AC1 default: invokes `/ai-team:tick` outside any --legacy guard', () => {
    const ticks = findTickInvocations(content);
    expect(ticks.length).toBeGreaterThan(0);

    const ticksOutsideLegacyGuard = ticks.filter(
      (t) => nearestLegacyMarkerBefore(content, t.index) === -1
    );

    expect(ticksOutsideLegacyGuard.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // AC3 + AC4 (negative): default path does NOT Read the orchestration
  // playbook. Every Read call must be inside a --legacy guarded block.
  // -------------------------------------------------------------------------
  test('AC3/AC4 default: does NOT Read orchestration-{native,legacy}.md outside a --legacy guard', () => {
    const reads = findPlaybookReads(content);

    const ungardedReads = reads
      .filter((r) => nearestLegacyMarkerBefore(content, r.index) === -1)
      .map((r) => `${fmtPos(content, r.index)}: ${r.match}`);

    expect(ungardedReads).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // AC6 (positive): the --legacy branch DOES preserve the original playbook
  // loading — both the `--legacy` flag AND the env-var check AND a playbook
  // Read must be present together so the escape hatch actually works.
  // -------------------------------------------------------------------------
  test('AC6 --legacy: preserves playbook Read AND env-var branching for the escape hatch', () => {
    // The --legacy flag itself must be named so the escape hatch is documented.
    expect(content).toContain(LEGACY_TOKEN);

    // The legacy path must still branch on CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    // — that's how the original playbook was selected.
    expect(content).toContain('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS');

    // At least one playbook Read MUST be present inside a --legacy guard.
    // (If WI-008's only effect were to delete the Read entirely, the escape
    // hatch wouldn't actually be an escape hatch.)
    const reads = findPlaybookReads(content);
    const guardedReads = reads.filter(
      (r) => nearestLegacyMarkerBefore(content, r.index) !== -1
    );

    expect(guardedReads.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // AC9: pre-flight model check preserves the intentional model guard:
  // Sonnet is required for orchestration (Haiku could not drive the tick loop
  // to completion — observed runaway).
  // -------------------------------------------------------------------------
  test('AC9 pre-flight: model check is still present', () => {
    expect(content).toMatch(/if model is NOT sonnet/i);
    expect(content).toContain('Hannibal orchestration runs on Sonnet');
    expect(content).toContain('Please switch first:  /model sonnet');
  });
});

// ===========================================================================
// commands/resume.md
// ===========================================================================

describe('commands/resume.md (WI-008: default invokes /ai-team:tick; --legacy preserves playbook)', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(RESUME_MD_PATH, 'utf-8');
  });

  // -------------------------------------------------------------------------
  // AC2 (positive): /ai-team:tick is invoked in the default path of resume.md
  // -------------------------------------------------------------------------
  test('AC2 default: invokes `/ai-team:tick` outside any --legacy guard', () => {
    const ticks = findTickInvocations(content);
    expect(ticks.length).toBeGreaterThan(0);

    const ticksOutsideLegacyGuard = ticks.filter(
      (t) => nearestLegacyMarkerBefore(content, t.index) === -1
    );

    expect(ticksOutsideLegacyGuard.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // AC5 (negative): default path of resume.md does NOT Read the orchestration
  // playbook. Every Read call must be inside a --legacy guarded block.
  // -------------------------------------------------------------------------
  test('AC5 default: does NOT Read orchestration-{native,legacy}.md outside a --legacy guard', () => {
    const reads = findPlaybookReads(content);

    const ungardedReads = reads
      .filter((r) => nearestLegacyMarkerBefore(content, r.index) === -1)
      .map((r) => `${fmtPos(content, r.index)}: ${r.match}`);

    expect(ungardedReads).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // AC7 (positive): --legacy branch of resume.md preserves playbook loading
  // -------------------------------------------------------------------------
  test('AC7 --legacy: preserves playbook Read AND env-var branching for the escape hatch', () => {
    expect(content).toContain(LEGACY_TOKEN);
    expect(content).toContain('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS');

    const reads = findPlaybookReads(content);
    const guardedReads = reads.filter(
      (r) => nearestLegacyMarkerBefore(content, r.index) !== -1
    );

    expect(guardedReads.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // AC10: pre-flight mission existence check is preserved unchanged.
  // -------------------------------------------------------------------------
  test('AC10 pre-flight: mission existence check is still present', () => {
    expect(content).toContain('ateam missions-current getCurrentMission');
    expect(content).toMatch(/no mission found/i);
  });
});

// ===========================================================================
// Cross-file — AC8: both files print the exact user-facing one-liner so the
// user understands that the controller loop has taken over from the playbook.
// ===========================================================================

describe('AC8 user feedback: both files print the [Hannibal] one-liner on tick entry', () => {
  // The exact one-liner the work item specifies — used so the user knows
  // the cost-reducing tick controller has taken over from the old playbook.
  const ONE_LINER = '[Hannibal] Tick controller engaged. Watching mission via /ai-team:tick.';

  test('commands/run.md contains the exact one-liner', () => {
    const content = fs.readFileSync(RUN_MD_PATH, 'utf-8');
    expect(content).toContain(ONE_LINER);
  });

  test('commands/resume.md contains the exact one-liner', () => {
    const content = fs.readFileSync(RESUME_MD_PATH, 'utf-8');
    expect(content).toContain(ONE_LINER);
  });
});

// ===========================================================================
// AC1/AC2 default-path termination — the default path must invoke
// /ai-team:tick EXACTLY ONCE.
//
// The string-match checks above (AC1/AC2 positive, AC3-5 negative) verified
// "there's a tick invocation in the default path" and "no playbook Read in
// the default path." They did NOT verify the default path *stops* after the
// tick invocation. A subsequent unguarded step that delegates to /ai-team:run
// triggers a second /ai-team:tick (because /ai-team:run in default mode itself
// invokes /ai-team:tick), violating the "invokes /ai-team:tick once" half of
// AC1/AC2.
//
// The minimal pattern we can detect statically is the literal phrase
// "Same as `/ai-team:run`" — that's the exact delegation language B.A.
// left in resume.md step 7 that caused Amy's FLAG. Every occurrence of that
// phrase must be inside a --legacy guarded block (i.e. within
// LEGACY_GUARD_PROXIMITY chars after a preceding --legacy token) so it never
// executes in the default path.
//
// This catches Amy's specific finding without false-positiving on:
//   - user-facing "re-run /ai-team:run" instructions (no "Same as" pattern)
//   - descriptive prose like "same env var check as /ai-team:run" (no literal
//     "Same as `/ai-team:run`" with the exact two-word phrase)
//   - run.md's pre-flight model-switch text (uses "Then re-run", not "Same as")
// ===========================================================================

describe('default-path single-tick guarantee: no unguarded delegation to /ai-team:run', () => {
  // Match the specific delegation pattern: the literal "Same as" two-word
  // phrase followed (allowing whitespace) by `/ai-team:run` in backticks or
  // bare. Case-insensitive so "Same" or "same" both match.
  const DELEGATION_RE = /\bSame as\s*`?\/ai-team:run`?/gi;

  // Reusable assertion for either file — finds every delegation phrase and
  // requires each one to be within LEGACY_GUARD_PROXIMITY chars of a
  // preceding --legacy token.
  function assertNoUnguardedDelegation(filePath, content) {
    const offenses = [];
    for (const m of content.matchAll(DELEGATION_RE)) {
      const guardOffset = nearestLegacyMarkerBefore(content, m.index);
      if (guardOffset === -1) {
        offenses.push(
          `${path.basename(filePath)}:${fmtPos(content, m.index)} — ` +
          `"${m[0]}" outside any --legacy guard. In the default path, ` +
          `/ai-team:run invokes /ai-team:tick — so this delegation causes a ` +
          `2nd /ai-team:tick invocation (violates the "invokes /ai-team:tick ` +
          `once" half of AC1/AC2). Either move this step into the --legacy ` +
          `escape hatch subsection, or add an explicit terminator ` +
          `(e.g. "No further steps are needed.") to the default path so ` +
          `subsequent steps only run under --legacy.`
        );
      }
    }
    expect(offenses).toEqual([]);
  }

  test('commands/run.md has no unguarded "Same as `/ai-team:run`" delegation', () => {
    const content = fs.readFileSync(RUN_MD_PATH, 'utf-8');
    assertNoUnguardedDelegation(RUN_MD_PATH, content);
  });

  test('commands/resume.md has no unguarded "Same as `/ai-team:run`" delegation (Amy FLAG: resume.md step 7)', () => {
    const content = fs.readFileSync(RESUME_MD_PATH, 'utf-8');
    assertNoUnguardedDelegation(RESUME_MD_PATH, content);
  });
});
