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
 * PIKE REWRITE (later in the same branch): commands/bug-fix.md no longer
 * reproduces the defect or files items itself. It now dispatches Pike
 * (agents/pike.md, subagent_type `ai-team:pike`) in two phases — phase one
 * reproduces on a scratch surface and writes the brief, the MAIN AGENT
 * creates the mission from that brief, then the SAME Pike instance is
 * resumed via SendMessage for phase two to file the `bug` items. The
 * original suites below still hold (they pin the command's outward
 * contract); the suites under the "PIKE REWRITE" banner at the bottom of
 * this file pin the two-phase split, its ordering, and the boundaries that
 * keep the main agent out of orchestration.
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

// =============================================================================
// PIKE REWRITE (this section covers the two-phase Pike flow that replaced the
// original single-agent command). The command no longer reproduces the defect
// or files items itself: it dispatches Pike (agents/pike.md, subagent_type
// `ai-team:pike`) for phase one (repro + brief), creates the mission itself
// from that brief, then resumes the SAME Pike instance for phase two (item
// creation). Everything below asserts that split, its ordering, and the
// boundaries that keep the main agent from drifting into orchestration.
//
// Helpers below follow the existing section-slicing convention in this file;
// the sibling doc-contract tests (commands/__tests__/bug-stomp-command.test.js,
// commands/__tests__/entry-point-conformance.test.js) use the same approach.
// =============================================================================

/** The single line containing `pattern`, or '' if no line matches. */
function lineWith(pattern) {
  return content.split('\n').find((line) => pattern.test(line)) ?? '';
}

/**
 * Parses the `## Who Does What` responsibility table into
 * { step, mainAgent, pike } cells. The table's two agent columns are the
 * machine-readable statement of which side of the split owns each action, so
 * a row's EMPTY cell is as load-bearing as its filled one.
 */
function whoDoesWhatRows() {
  const section = sectionAfter(content, /^## Who Does What/m);
  if (!section) return [];
  return section
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length === 3 && !/^-+$/.test(cells[0]))
    .map(([step, mainAgent, pike]) => ({ step, mainAgent, pike }));
}

describe('Pike dispatch: the command delegates the investigation to subagent_type ai-team:pike', () => {
  it('names agents/pike.md as the investigator it dispatches', () => {
    expect(content).toMatch(/agents\/pike\.md/);
  });

  it('dispatches Pike by the ai-team:pike subagent_type', () => {
    expect(content).toMatch(/subagent_type:\s*["']ai-team:pike["']/);
  });

  it('declares the subagent_type exactly once — the phase-one dispatch is the only Agent() spawn in the happy path', () => {
    const declarations = content.match(/subagent_type:/g) ?? [];
    expect(
      declarations.length,
      `expected exactly one subagent_type declaration (phase one); found ${declarations.length}`
    ).toBe(1);
  });

  it('the dispatch lives in the phase-one investigation step, not the mission-creation step', () => {
    const stepFour = sectionAfter(content, /^## Step 4:/m);
    const stepFive = sectionAfter(content, /^## Step 5:/m);
    expect(stepFour, 'expected a ## Step 4 section').not.toBeNull();
    expect(stepFour).toMatch(/subagent_type:\s*["']ai-team:pike["']/);
    expect(stepFive, 'expected a ## Step 5 section').not.toBeNull();
    expect(stepFive, 'mission creation must not dispatch an agent').not.toMatch(/subagent_type/);
  });

  it('does not dispatch any pipeline agent (no ai-team:murdock/ba/lynch/amy/hannibal subagent types)', () => {
    expect(content).not.toMatch(/ai-team:(murdock|ba|lynch|amy|hannibal|stockwell|frankie|tawnia)\b/i);
    expect(content).toMatch(/do not dispatch any pipeline agent/i);
  });
});

describe('two-phase split: phase one writes the brief only, phase two files items after the mission exists', () => {
  it('phase one is labelled as such in the dispatch prompt', () => {
    const stepFour = sectionAfter(content, /^## Step 4:/m);
    expect(stepFour).toMatch(/PHASE ONE/i);
  });

  it('phase one is told NOT to create the mission and NOT to create work items', () => {
    const stepFour = sectionAfter(content, /^## Step 4:/m);
    expect(stepFour).toMatch(/do NOT create the mission/i);
    expect(stepFour).toMatch(/do NOT create\s+work items/i);
  });

  it('phase one produces the brief at .mission-briefs/<slug>.md', () => {
    const stepFour = sectionAfter(content, /^## Step 4:/m);
    expect(stepFour).toMatch(/\.mission-briefs\//);
    expect(stepFour).toMatch(/slug/i);
  });

  it('phase one files no items: ateam items createItem does not appear in the phase-one step', () => {
    const stepFour = sectionAfter(content, /^## Step 4:/m);
    expect(stepFour, 'item creation must not appear in the phase-one dispatch').not.toMatch(/ateam items createItem/);
  });

  it('phase two is labelled as such and runs against an existing mission id', () => {
    const stepSix = sectionAfter(content, /^## Step 6:/m);
    expect(stepSix, 'expected a ## Step 6 section').not.toBeNull();
    expect(stepSix).toMatch(/PHASE TWO/i);
    expect(stepSix).toMatch(/mission exists/i);
    expect(stepSix).toMatch(/mission_id|mission id/i);
  });

  it('phase two creates the bug items and leaves them in briefings', () => {
    const stepSix = sectionAfter(content, /^## Step 6:/m);
    expect(stepSix).toMatch(/ateam items createItem/);
    expect(stepSix).toMatch(/briefings/);
    expect(stepSix).toMatch(/no board moves|leave every item in briefings/i);
  });

  it('orders the phases: phase-one dispatch, then mission creation, then phase-two item creation', () => {
    const dispatchIdx = content.search(/^## Step 4:/m);
    const missionIdx = content.search(/^## Step 5:/m);
    const itemsIdx = content.search(/^## Step 6:/m);
    expect(dispatchIdx).toBeGreaterThan(-1);
    expect(missionIdx).toBeGreaterThan(dispatchIdx);
    expect(itemsIdx).toBeGreaterThan(missionIdx);
    // And the real invocations follow the same order, not just the headings.
    expect(content.search(/ateam missions createMission/)).toBeLessThan(content.search(/ateam items createItem/));
  });

  it('states explicitly that items are created against the mission, never before it', () => {
    expect(content).toMatch(/never before|after the mission exists|the mission now exists/i);
  });
});

describe('mission creation belongs to the main agent, which never becomes Hannibal', () => {
  it('the mission-creation step is attributed to the main agent in its heading', () => {
    expect(content).toMatch(/^## Step 5: Create the Mission \(Main Agent\)/m);
  });

  it('the main agent runs createMission inside that step', () => {
    const stepFive = sectionAfter(content, /^## Step 5:/m);
    expect(stepFive).toMatch(/ateam missions createMission/);
    expect(stepFive).toMatch(/--prdPath/);
  });

  it('states the command does not become Hannibal and mirrors /ai-team:plan rather than /ai-team:run', () => {
    const line = lineWith(/does not become Hannibal/i);
    expect(line, 'expected a "does not become Hannibal" statement').not.toBe('');
    expect(line).toMatch(/\/ai-team:plan/);
    expect(line).toMatch(/main agent stays the main agent/i);
  });

  it('forbids loading an orchestration playbook', () => {
    expect(content).toMatch(/do not load an orchestration playbook/i);
  });

  it('the Who Does What table assigns createMission to the main agent and leaves Pike\'s cell empty', () => {
    const rows = whoDoesWhatRows();
    expect(rows.length, 'expected a parsable ## Who Does What table').toBeGreaterThan(0);
    const missionRow = rows.find((row) => /createMission/.test(row.step));
    expect(missionRow, `expected a createMission row; rows: ${JSON.stringify(rows)}`).toBeTruthy();
    expect(missionRow.mainAgent, 'createMission must be owned by the main agent').toMatch(/yes/i);
    expect(missionRow.pike, 'Pike must not own mission creation').toBe('');
  });

  it('the Who Does What table assigns createItem to Pike (phase two) and leaves the main agent\'s cell empty', () => {
    const rows = whoDoesWhatRows();
    const itemsRow = rows.find((row) => /createItem/.test(row.step));
    expect(itemsRow, `expected a createItem row; rows: ${JSON.stringify(rows)}`).toBeTruthy();
    expect(itemsRow.pike, 'item creation must be owned by Pike in phase two').toMatch(/phase two/i);
    expect(itemsRow.mainAgent, 'the main agent must not own item creation').toBe('');
  });
});

describe('phase two resumes the same Pike instance, with a documented fresh-agent fallback', () => {
  it('the default is resuming the phase-one instance via SendMessage, not a fresh spawn', () => {
    const stepSix = sectionAfter(content, /^## Step 6:/m);
    expect(stepSix).toMatch(/SendMessage/);
    expect(stepSix).toMatch(/resume the phase-one instance|same (live )?instance/i);
    expect(stepSix).toMatch(/rather than spawning fresh|not a fresh|only as fallback/i);
  });

  it('says why the same instance is preferred: it still holds the repro and the suspected cause', () => {
    const stepSix = sectionAfter(content, /^## Step 6:/m);
    expect(stepSix).toMatch(/still holds/i);
    expect(stepSix).toMatch(/repro/i);
  });

  it('documents a fresh ai-team:pike fallback when the phase-one instance is gone', () => {
    const stepSix = sectionAfter(content, /^## Step 6:/m);
    expect(stepSix).toMatch(/fallback/i);
    expect(stepSix).toMatch(/no longer available|is gone/i);
    expect(stepSix).toMatch(/spawn a new `?ai-team:pike/i);
  });

  it('requires the fallback to be reported, since items filed from a summary carry less detail', () => {
    const stepSix = sectionAfter(content, /^## Step 6:/m);
    expect(stepSix).toMatch(/fallback was used/i);
  });

  it('the Agent Invocations table records the same-instance default and the fallback', () => {
    const invocations = sectionAfter(content, /^## Agent Invocations/m);
    expect(invocations, 'expected an ## Agent Invocations section').not.toBeNull();
    expect(invocations).toMatch(/SendMessage/);
    expect(invocations).toMatch(/fallback/i);
    expect(invocations).toMatch(/ai-team:pike/);
  });
});

describe('branching on the phase-one outcome: REPRODUCED continues, NOT_REPRODUCED and BLOCKED stop', () => {
  it('phase one returns one of REPRODUCED / NOT_REPRODUCED / BLOCKED', () => {
    for (const outcome of ['REPRODUCED', 'NOT_REPRODUCED', 'BLOCKED']) {
      expect(content, `expected the ${outcome} outcome to be named`).toMatch(new RegExp(outcome));
    }
  });

  it('NOT_REPRODUCED creates no mission and stops', () => {
    const bullet = lineWith(/^-\s+\*\*NOT_REPRODUCED\*\*/);
    expect(bullet, 'expected a NOT_REPRODUCED branch bullet').not.toBe('');
    expect(bullet).toMatch(/create no mission|no mission/i);
    expect(bullet).toMatch(/stop/i);
  });

  it('BLOCKED creates no mission, stops, and is not worked around by pointing Pike elsewhere', () => {
    const bullet = lineWith(/^-\s+\*\*BLOCKED\*\*/);
    expect(bullet, 'expected a BLOCKED branch bullet').not.toBe('');
    expect(bullet).toMatch(/create no mission|no mission/i);
    expect(bullet).toMatch(/stop/i);
    expect(bullet).toMatch(/do not work around/i);
  });

  it('REPRODUCED is the only branch that continues to mission creation', () => {
    const bullet = lineWith(/^-\s+\*\*REPRODUCED\*\*/);
    expect(bullet, 'expected a REPRODUCED branch bullet').not.toBe('');
    expect(bullet).toMatch(/continue to Step 5/i);
  });

  it('both stop-cases are restated in the ## Errors section as complete outcomes, not failures', () => {
    const errors = sectionAfter(content, /^## Errors/m);
    expect(errors, 'expected an ## Errors section').not.toBeNull();
    expect(errors).toMatch(/cannot be reproduced/i);
    expect(errors).toMatch(/blocked/i);
    const reproLine = errors.split('\n').find((line) => /cannot be reproduced/i.test(line)) ?? '';
    expect(reproLine).toMatch(/no mission/i);
    const blockedLine = errors.split('\n').find((line) => /repro blocked/i.test(line)) ?? '';
    expect(blockedLine).toMatch(/no mission/i);
  });
});

describe('--quality is validated BEFORE Pike is dispatched (an invalid flag never spends investigation time)', () => {
  it('has a dedicated validation step that precedes the Pike dispatch', () => {
    const validationIdx = content.search(/^## Step 3:/m);
    const dispatchIdx = content.search(/subagent_type:\s*["']ai-team:pike["']/);
    expect(validationIdx, 'expected a ## Step 3 validation section').toBeGreaterThan(-1);
    expect(dispatchIdx, 'expected a Pike dispatch').toBeGreaterThan(-1);
    expect(
      validationIdx,
      'the --quality validation step must appear before the Pike dispatch, or an invalid flag is only caught after a repro attempt'
    ).toBeLessThan(dispatchIdx);
  });

  it('the validation step names all three valid profiles and creates no mission on an invalid value', () => {
    const stepThree = sectionAfter(content, /^## Step 3:/m);
    expect(stepThree).toMatch(/quick/i);
    expect(stepThree).toMatch(/normal/i);
    expect(stepThree).toMatch(/deep/i);
    expect(stepThree).toMatch(/no mission/i);
  });

  it('the validation step says Pike is not dispatched on an invalid value', () => {
    const stepThree = sectionAfter(content, /^## Step 3:/m);
    expect(stepThree).toMatch(/do not dispatch Pike/i);
  });

  it('states why validating first matters: the flag fails before a repro is attempted', () => {
    const stepThree = sectionAfter(content, /^## Step 3:/m);
    expect(stepThree).toMatch(/before a repro is attempted|before[^.\n]{0,60}repro/i);
  });

  it('the ## Errors section records the invalid-flag case as "Pike not dispatched"', () => {
    const errors = sectionAfter(content, /^## Errors/m);
    const qualityLine = errors.split('\n').find((line) => /quality/i.test(line)) ?? '';
    expect(qualityLine, 'expected an invalid --quality row in ## Errors').not.toBe('');
    expect(qualityLine).toMatch(/no mission/i);
    expect(qualityLine).toMatch(/Pike not dispatched/i);
  });

  it('the issue-form metadata gate likewise stops before dispatching Pike', () => {
    // Same ordering property one gate earlier: a closed/non-bug issue must
    // not cost a repro attempt either.
    expect(content).toMatch(/Do not dispatch Pike\./);
  });
});

describe('free text: accepted as an argument, passed verbatim to Pike, never authorization to skip a step', () => {
  it('documents free text as an optional trailing argument in ## Arguments', () => {
    const args = sectionAfter(content, /^## Arguments/m);
    expect(args).toMatch(/free text/i);
    expect(args).toMatch(/optional/i);
  });

  it('the Usage lines show free text alongside the issue and description forms', () => {
    const usage = sectionAfter(content, /^## Usage/m);
    expect(usage).toMatch(/free text/i);
  });

  it('free text is passed to Pike verbatim as triage context', () => {
    const args = sectionAfter(content, /^## Arguments/m);
    expect(args).toMatch(/verbatim/i);
    expect(args).toMatch(/triage context/i);
    // And the input-resolution step preserves it verbatim for the prompt.
    expect(sectionAfter(content, /^## Step 2:/m)).toMatch(/verbatim/i);
  });

  it('the Pike dispatch prompt carries the free text through as its own field', () => {
    const stepFour = sectionAfter(content, /^## Step 4:/m);
    expect(stepFour).toMatch(/free[_ ]text/i);
    expect(stepFour).toMatch(/none/);
  });

  it('carries a binding precedence rule: triage context, never authorization to skip a step', () => {
    expect(content).toMatch(/free-text precedence rule/i);
    const ruleIdx = content.search(/free-text precedence rule/i);
    const window = content.slice(ruleIdx, ruleIdx + 700);
    expect(window).toMatch(/binding/i);
    expect(window).toMatch(/never authorization to skip a step/i);
  });

  it('the precedence rule binds Pike as well as the command, and names the skips it forbids', () => {
    const ruleIdx = content.search(/free-text precedence rule/i);
    const window = content.slice(ruleIdx, ruleIdx + 700);
    expect(window).toMatch(/on Pike|and on Pike/i);
    expect(window).toMatch(/skip the repro/i);
    expect(window).toMatch(/before the mission/i);
    expect(window).toMatch(/stop and ask/i);
  });

  it('a free-text conflict is escalated to the operator, never resolved toward the faster path', () => {
    const ruleIdx = content.search(/free-text precedence rule/i);
    const window = content.slice(ruleIdx, ruleIdx + 700);
    expect(window).toMatch(/do not resolve the conflict yourself|silently resolving/i);
    const errors = sectionAfter(content, /^## Errors/m);
    expect(errors).toMatch(/free-text conflict/i);
    expect(errors).toMatch(/assumed answer/i);
  });
});

describe('terminal condition: a planning entry point that writes no code and hands off to /ai-team:run', () => {
  it('declares itself a PLANNING entry point with an explicit terminal condition', () => {
    const terminal = lineWith(/\*\*Terminal condition/);
    expect(terminal, 'expected a bolded terminal-condition statement').not.toBe('');
    expect(terminal).toMatch(/planning entry point/i);
  });

  it('the terminal state is: a mission exists and bug items sit in briefings', () => {
    const terminal = lineWith(/\*\*Terminal condition/);
    expect(terminal).toMatch(/mission exists/i);
    expect(terminal).toMatch(/briefings/);
  });

  it('the terminal state excludes implementation, tests, commits, and any item past briefings', () => {
    const terminal = lineWith(/\*\*Terminal condition/);
    expect(terminal).toMatch(/no implementation/i);
    expect(terminal).toMatch(/no tests/i);
    expect(terminal).toMatch(/no commits/i);
    expect(terminal).toMatch(/no items past `?briefings/i);
  });

  it('names /ai-team:run as the successor and forbids starting it', () => {
    expect(content).toMatch(/successor[^.\n]{0,40}\/ai-team:run/i);
    expect(content).toMatch(/do not start it/i);
  });

  it('the final step verifies the board and the working tree before stopping', () => {
    const stepSeven = sectionAfter(content, /^## Step 7:/m);
    expect(stepSeven, 'expected a ## Step 7 section').not.toBeNull();
    expect(stepSeven).toMatch(/ateam board getBoard/);
    expect(stepSeven).toMatch(/briefings/);
    expect(stepSeven).toMatch(/git status --short/);
  });

  it('treats an unexpected working-tree change as a self-detectable boundary violation, reported not reverted', () => {
    const stepSeven = sectionAfter(content, /^## Step 7:/m);
    expect(stepSeven).toMatch(/\.mission-briefs\//);
    expect(stepSeven).toMatch(/violation/i);
    expect(stepSeven).toMatch(/do not revert/i);
  });
});

describe('the failing-test source flag stays out of scope, and Pike is forbidden from writing one', () => {
  it('states a failing-test source flag is out of scope and deferred to a later PRD', () => {
    expect(content).toMatch(/failing-test source flag[^.\n]{0,80}out of scope/i);
    expect(content).toMatch(/deferred to a later PRD/i);
  });

  it('forbids Pike from writing a failing test as a repro artifact', () => {
    expect(content).toMatch(/Pike is forbidden from writing a failing test/i);
  });

  it('states the command never writes implementation or tests, and that Pike is hook-blocked from doing so', () => {
    expect(content).toMatch(/never writes implementation or tests/i);
    expect(content).toMatch(/hook-blocked/i);
  });
});
