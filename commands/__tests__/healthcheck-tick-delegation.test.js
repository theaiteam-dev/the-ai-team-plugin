/**
 * Tests for WI-009: delegate /ai-team:healthcheck to controller tick + document
 * the controller in docs/PLUGIN-DEV.md.
 *
 * Two artifacts under test:
 *   • commands/healthcheck.md — must invoke `ateam controller tick --json --dry-run`
 *     and print the snapshot; must preserve the top-of-file ScheduleWakeup re-arm;
 *     must NOT add a second ScheduleWakeup near the tick call; must NOT load the
 *     orchestration playbook on the needsJudgment path; must preserve no-mission
 *     silent-exit and API-unreachable error handling.
 *   • docs/PLUGIN-DEV.md — must gain a "Tick-based Mission Controller" section
 *     covering the lifecycle, --legacy escape hatch, ATEAM_STALE_CLAIM_SECONDS,
 *     the `ateam controller checkpoint get` debug command, and a worked example
 *     of each action kind.
 *
 * Same string-match pattern as resume-recovery.test.js / tick.test.js. Both
 * files are at known relative paths from this test file.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HEALTHCHECK_MD_PATH = path.resolve(__dirname, '..', 'healthcheck.md');
const PLUGIN_DEV_MD_PATH = path.resolve(__dirname, '..', '..', 'docs', 'PLUGIN-DEV.md');

// Matches an actual Read() call against an orchestration playbook file —
// healthcheck.md must NOT contain any such call.
const PLAYBOOK_READ_RE = /Read\s*\(\s*[^)]*orchestration-(?:legacy|native)\.md/gi;

// Matches an actual ScheduleWakeup invocation (literal call with open paren),
// so descriptive prose mentioning "ScheduleWakeup" doesn't inflate the count.
const SCHEDULE_WAKEUP_CALL_RE = /ScheduleWakeup\s*\(/g;

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

// ===========================================================================
// commands/healthcheck.md
// ===========================================================================

describe('commands/healthcheck.md (WI-009: delegate to controller tick --dry-run)', () => {
  let content;

  beforeAll(() => {
    content = safeRead(HEALTHCHECK_MD_PATH);
  });

  // -------------------------------------------------------------------------
  // AC1 — invokes `ateam controller tick --json --dry-run`
  // -------------------------------------------------------------------------
  test('AC1: invokes `ateam controller tick --json --dry-run`', () => {
    // The exact CLI invocation must appear. We accept either flag order
    // (--json --dry-run OR --dry-run --json) since both produce the same
    // controller behavior — pin the CLI verb and the two required flags
    // rather than their relative order.
    expect(content).toContain('ateam controller tick');
    expect(content).toMatch(/ateam controller tick[^\n]*--dry-run/);
    expect(content).toMatch(/ateam controller tick[^\n]*--json|--json[^\n]*ateam controller tick/);
  });

  // -------------------------------------------------------------------------
  // AC2 — top-of-file ScheduleWakeup re-arm preserved (fires BEFORE any
  // controller logic so a downstream error can't kill the heartbeat loop)
  // -------------------------------------------------------------------------
  test('AC2: top-of-file ScheduleWakeup re-arm is preserved (appears before the tick call)', () => {
    const wakeupMatches = [...content.matchAll(SCHEDULE_WAKEUP_CALL_RE)];
    expect(wakeupMatches.length).toBeGreaterThan(0);

    const firstWakeupIdx = wakeupMatches[0].index;
    const tickIdx = content.indexOf('ateam controller tick');

    // The re-arm must come BEFORE the tick invocation. If the order is
    // swapped, a tick error kills the loop — defeating the "re-arm first"
    // pattern documented in the existing healthcheck.md.
    expect(firstWakeupIdx).toBeGreaterThanOrEqual(0);
    expect(tickIdx).toBeGreaterThanOrEqual(0);
    expect(firstWakeupIdx).toBeLessThan(tickIdx);

    // The re-arm's prompt must point back at /ai-team:healthcheck so the
    // heartbeat loop self-perpetuates (NOT at /ai-team:tick — that's the
    // tick loop's job, not healthcheck's).
    const wakeupBlock = content.slice(firstWakeupIdx, firstWakeupIdx + 400);
    expect(wakeupBlock).toContain('/ai-team:healthcheck');
  });

  // -------------------------------------------------------------------------
  // AC3 — needsJudgment path does NOT load an orchestration playbook
  // -------------------------------------------------------------------------
  test('AC3: does NOT Read orchestration-{legacy,native}.md anywhere in the file', () => {
    // Healthcheck never loaded the playbook before; it must not start now
    // even when the controller surfaces a needsJudgment payload (the
    // needsJudgment evidence packet is enough for an operator snapshot).
    const reads = [...content.matchAll(PLAYBOOK_READ_RE)];
    expect(reads.map((m) => m[0])).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // AC4 — "no active mission" exits silently (preserved)
  // -------------------------------------------------------------------------
  test('AC4: preserves the "no active mission → silent exit, do not re-arm" handling', () => {
    // The phrase ordering / wording can change, but the case + the "no
    // re-arm" cue must remain so the heartbeat loop self-expires when the
    // mission is gone.
    expect(content).toMatch(/no active mission/i);
    expect(content).toMatch(/(?:exit silently|silent exit|do not re-?arm|don'?t re-?arm)/i);
  });

  // -------------------------------------------------------------------------
  // AC5 — "API unreachable / unavailable" error handling preserved
  // -------------------------------------------------------------------------
  test('AC5: preserves the API-unreachable error path', () => {
    // The case must be named. The exact response (print to stderr / exit
    // non-zero / re-arm anyway) may have been intentionally tightened by
    // WI-009 — the AC only requires the case to remain handled, not the
    // exact behavior.
    expect(content).toMatch(/API\s+(?:unreachable|unavailable)/i);
  });

  // -------------------------------------------------------------------------
  // AC6 — the --dry-run tick call does NOT trigger a second ScheduleWakeup.
  // The existing top-of-file re-arm is the ONLY ScheduleWakeup invocation.
  // ("Only/never" qualifier — pin the count to exactly 1.)
  // -------------------------------------------------------------------------
  test('AC6: exactly ONE ScheduleWakeup invocation total (no second re-arm tied to the tick call)', () => {
    const wakeupMatches = [...content.matchAll(SCHEDULE_WAKEUP_CALL_RE)];
    expect(wakeupMatches.length).toBe(1);

    // And it must not be the one near the tick call — i.e. the sole
    // ScheduleWakeup must appear BEFORE the tick invocation. Belt-and-
    // braces with AC2 in case B.A. moves the re-arm later in the file.
    const tickIdx = content.indexOf('ateam controller tick');
    if (tickIdx >= 0) {
      expect(wakeupMatches[0].index).toBeLessThan(tickIdx);
    }
  });
});

// ===========================================================================
// docs/PLUGIN-DEV.md
// ===========================================================================

describe('docs/PLUGIN-DEV.md (WI-009: Tick-based Mission Controller documentation)', () => {
  let content;

  beforeAll(() => {
    content = safeRead(PLUGIN_DEV_MD_PATH);
  });

  // -------------------------------------------------------------------------
  // AC7 — the new section heading is present
  // -------------------------------------------------------------------------
  test('AC7: contains a "Tick-based Mission Controller" section heading', () => {
    // Markdown section header (## or ###) containing the literal title.
    // We accept either heading depth (## or ### or beyond) to leave B.A.
    // some freedom about where the section sits in the document tree.
    expect(content).toMatch(/^#{2,}\s+Tick-based Mission Controller\b/m);
  });

  // -------------------------------------------------------------------------
  // AC8 — the section explains the tick lifecycle
  // (controller emits actions → Claude executes → checkpoint confirms)
  // -------------------------------------------------------------------------
  test('AC8: documents the tick lifecycle — controller emits actions, Claude executes, checkpoint confirms', () => {
    // Three lifecycle elements must all be named so the operator can read
    // the doc and understand the flow without guessing.
    expect(content).toMatch(/\/ai-team:tick|tick\.md/);
    // "controller" + emits/emit/returns/produces (anything that says the
    // controller decides what happens).
    expect(content).toMatch(/controller[\s\S]{0,200}(?:emits|returns|produces|decides)|controller[\s\S]{0,200}actions/i);
    // Checkpoint confirmation must be named so operators know each executed
    // action gets persisted.
    expect(content).toMatch(/checkpoint[\s\S]{0,100}confirm|confirm[\s\S]{0,100}checkpoint/i);
  });

  // -------------------------------------------------------------------------
  // AC8 (extension): worked example covering every action kind so operators
  // can recognize each in a real tick response.
  // -------------------------------------------------------------------------
  test('AC8: worked example covers every action kind (dispatch / message / final-review / release / move / needsJudgment)', () => {
    // Each kind name from the controller's action plan must appear so the
    // doc actually shows what to do with each.
    expect(content).toMatch(/\bdispatch\b/);
    expect(content).toMatch(/\bmessage\b/);
    expect(content).toMatch(/\bfinal-review\b/);
    expect(content).toMatch(/\brelease\b/);
    expect(content).toMatch(/\bmove\b/);
    expect(content).toMatch(/\bneedsJudgment\b/);
  });

  // -------------------------------------------------------------------------
  // AC9 — --legacy escape hatch is mentioned
  // -------------------------------------------------------------------------
  test('AC9: documents the --legacy escape hatch on /ai-team:run and /ai-team:resume', () => {
    expect(content).toContain('--legacy');
    // The flag must be tied to at least one of the commands that accepts it
    // so operators know where to use it.
    expect(content).toMatch(/--legacy[\s\S]{0,300}(?:\/ai-team:run|\/ai-team:resume)|(?:\/ai-team:run|\/ai-team:resume)[\s\S]{0,300}--legacy/);
  });

  // -------------------------------------------------------------------------
  // AC10 — ATEAM_STALE_CLAIM_SECONDS env var is documented
  // -------------------------------------------------------------------------
  test('AC10: documents the ATEAM_STALE_CLAIM_SECONDS env var', () => {
    expect(content).toContain('ATEAM_STALE_CLAIM_SECONDS');
  });

  // -------------------------------------------------------------------------
  // AC11 — the `ateam controller checkpoint get` debug command is mentioned
  // -------------------------------------------------------------------------
  test('AC11: documents the `ateam controller checkpoint get` debug command', () => {
    expect(content).toContain('ateam controller checkpoint get');
  });
});
