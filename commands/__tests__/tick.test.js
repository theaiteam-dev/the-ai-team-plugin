/**
 * Tests for the /ai-team:tick slash command (commands/tick.md) — WI-007.
 *
 * The slash command is a markdown file Claude reads on every wake-up. It:
 *   1. Runs `ateam controller tick --json`
 *   2. Executes each returned action via the right Claude primitive
 *      (Task/TeamCreate for dispatch, SendMessage for message, etc.)
 *   3. Confirms each completed action via `ateam controller checkpoint confirm`
 *   4. Re-arms the next tick via ScheduleWakeup
 *
 * These tests use the same source-text-matching pattern as
 * commands/__tests__/resume-recovery.test.js — the artifact under test IS the
 * markdown prose, so reading the file and asserting required phrases is the
 * only meaningful contract test. The work item's context explicitly calls for
 * this pattern.
 *
 * RED phase: commands/tick.md does not exist yet. Every assertion fails until
 * B.A. creates the file and wires the required steps.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TICK_MD_PATH = path.resolve(__dirname, '..', 'tick.md');

/**
 * Read tick.md — returns "" if the file is absent so individual `expect`
 * assertions surface the missing-content failure rather than a beforeAll
 * setup error. The "no such file" failure mode is still surfaced via the
 * dedicated `should exist` test.
 */
function readTickMd() {
  try {
    return fs.readFileSync(TICK_MD_PATH, 'utf-8');
  } catch {
    return '';
  }
}

describe('commands/tick.md (WI-007: /ai-team:tick slash command)', () => {
  let content;

  beforeAll(() => {
    content = readTickMd();
  });

  // ---------------------------------------------------------------------------
  // Sanity: file exists and has the cost-targeted sonnet frontmatter so Claude
  // executes the routine on a fast/cheap model, not whatever the user happens
  // to be on. The work item context names this explicitly.
  // ---------------------------------------------------------------------------

  test('the file exists at commands/tick.md with `model: sonnet` frontmatter', () => {
    expect(fs.existsSync(TICK_MD_PATH)).toBe(true);
    // Frontmatter block at the top of the file (per existing run.md / resume.md).
    expect(content).toMatch(/^---\s*\nmodel:\s*sonnet\s*\n---/m);
  });

  // ---------------------------------------------------------------------------
  // AC1 — `ateam controller tick --json` runs FIRST, and the controller's
  // summary is printed as `[Hannibal] {summary}` so the run log stays readable
  // even on no-op ticks.
  // ---------------------------------------------------------------------------

  test('AC1: runs `ateam controller tick --json` first and prints summary as `[Hannibal] {summary}`', () => {
    // The exact CLI invocation must appear.
    expect(content).toContain('ateam controller tick --json');

    // The summary must be printed with the [Hannibal] prefix.
    // Match the literal prefix bracketed Hannibal label rather than a free-form
    // mention — operators grep for this prefix in the run log.
    expect(content).toMatch(/\[Hannibal\]/);

    // And the summary must be tied to the controller's `summary` field so a
    // future refactor that prints something else (e.g. mission state) doesn't
    // silently break the contract.
    expect(content).toMatch(/\[Hannibal\][^\n]*summary|summary[^\n]*\[Hannibal\]/i);

    // Sanity: the controller tick invocation appears BEFORE the first action
    // dispatch — otherwise actions would be executed against stale state.
    const tickIdx = content.indexOf('ateam controller tick --json');
    const firstDispatchIdx = content.search(/\bdispatch\b/);
    if (firstDispatchIdx !== -1) {
      expect(tickIdx).toBeGreaterThanOrEqual(0);
      expect(tickIdx).toBeLessThan(firstDispatchIdx);
    }
  });

  // ---------------------------------------------------------------------------
  // AC2–AC6 — Each action kind dispatches via the right primitive / CLI.
  // Cross-product: 5 action kinds × required invocation, one assertion per kind.
  // Using a parametrized table keeps the AC mapping legible and the failure
  // message names exactly which kind is missing.
  // ---------------------------------------------------------------------------

  describe('AC2–AC6: each action kind invokes the correct Claude primitive / CLI', () => {
    test('AC2: `dispatch` action spawns the named agent via Task (legacy) AND TeamCreate (native-teams)', () => {
      // Both primitives must be named because the slash command must handle
      // both dispatch modes — the controller emits the same `dispatch` kind
      // and the slash command branches on mode.
      expect(content).toMatch(/\bTask\b/);
      expect(content).toMatch(/\bTeamCreate\b/);

      // Both modes must be named so the branching contract is explicit.
      expect(content).toMatch(/\bnative[- ]teams\b/i);
      expect(content).toMatch(/\blegacy\b/i);
    });

    test('AC2: `dispatch` prompt comes from `ateam items renderItem --id <itemId>` — NOT inlined', () => {
      // The CLI call that produces the prompt at dispatch time must appear.
      expect(content).toMatch(/ateam items renderItem\s+--id/);

      // Negative half: there must be no inlined per-item prompt template in
      // the slash command — the PRD says "No prompts in the action JSON",
      // so anything that looks like a `prompt:` literal followed by item-shaped
      // markdown is a regression.
      // We accept the literal token "prompt" (it's a Claude primitive
      // parameter name) but reject any obvious inlined acceptance-criteria
      // block that would mean the command is re-inventing the prompt.
      expect(content).not.toMatch(/acceptance criteria:[\s\S]{0,200}implement this/i);
    });

    test('AC3: `message` action sends via SendMessage with the literal action text', () => {
      expect(content).toContain('SendMessage');
      // The action kind name must appear so the action-kind dispatch table
      // is unambiguous.
      expect(content).toMatch(/\bmessage\b/);
    });

    test('AC4: `final-review` action spawns Stockwell via a Claude primitive', () => {
      expect(content).toMatch(/\bfinal[- ]review\b/i);
      expect(content).toMatch(/\bStockwell\b/);
    });

    test('AC5: `release` action calls both `ateam board-release releaseItem` AND `ateam pool release`', () => {
      expect(content).toContain('ateam board-release releaseItem');
      expect(content).toContain('ateam pool release');
      // The action kind name itself must appear in the dispatch table.
      expect(content).toMatch(/\brelease\b/);
    });

    test('AC6: `move` action calls `ateam board-move moveItem --itemId <id> --toStage <stage>`', () => {
      // Pin the exact CLI verb (`board-move moveItem`) AND both required
      // flags (`--itemId` and `--toStage`). Anything weaker would pass a
      // partial wiring that crashes at runtime.
      expect(content).toContain('ateam board-move moveItem');
      expect(content).toMatch(/--itemId/);
      expect(content).toMatch(/--toStage/);
    });
  });

  // ---------------------------------------------------------------------------
  // AC7 — After each action succeeds, confirm it via the atomic server-side
  // append (`checkpoint confirm`), NEVER the whole-document upsert
  // (`checkpoint put`). The "never put" half is an "only/never" qualifier and
  // requires its own negative assertion.
  // ---------------------------------------------------------------------------

  describe('AC7: per-action confirmation uses `checkpoint confirm`, never `checkpoint put`', () => {
    test('positive: calls `ateam controller checkpoint confirm --action-id <id>`', () => {
      expect(content).toContain('ateam controller checkpoint confirm');
      expect(content).toMatch(/--action-id/);
    });

    test('negative: does NOT use `ateam controller checkpoint put` for per-action confirmation', () => {
      // `checkpoint put` is whole-document and race-prone for per-action
      // updates (per WI-005). The slash command must never call it.
      expect(content).not.toContain('ateam controller checkpoint put');
    });
  });

  // ---------------------------------------------------------------------------
  // AC8 — On `needsJudgment`, load ONLY the evidence packet — NEVER the
  // orchestration playbook. The "only/never" qualifier requires both halves.
  // ---------------------------------------------------------------------------

  describe('AC8: `needsJudgment` loads only the evidence packet, never an orchestration playbook', () => {
    test('positive: references `needsJudgment` and the `evidence` packet', () => {
      expect(content).toContain('needsJudgment');
      // `evidence` is the field name on needsJudgment per the AC.
      expect(content).toMatch(/\bevidence\b/);
      // Decisions are written to ActivityLog per the AC.
      expect(content).toMatch(/ActivityLog|ateam activity/);
    });

    test('negative: does NOT actively `Read(...orchestration-{legacy,native}.md)` anywhere in the routine', () => {
      // The slash command must NOT load the orchestration playbook — that's
      // /ai-team:run's job. We assert no actual Read() call against a
      // playbook path; descriptive prose mentioning "playbook" is fine.
      expect(content).not.toMatch(/Read\s*\(\s*[^)]*orchestration-(legacy|native)\.md/i);
    });
  });

  // ---------------------------------------------------------------------------
  // AC9 — After all actions (or judgment resolution), re-arm the next tick
  // via ScheduleWakeup using the response's nextWakeSeconds and the literal
  // `/ai-team:tick` prompt so the loop self-perpetuates.
  // ---------------------------------------------------------------------------

  test('AC9: re-arms via `ScheduleWakeup` with `nextWakeSeconds` and prompt `/ai-team:tick`', () => {
    expect(content).toContain('ScheduleWakeup');
    expect(content).toContain('nextWakeSeconds');
    expect(content).toContain('/ai-team:tick');

    // The three references must co-locate in the same configuration block —
    // we approximate that by asserting all three appear within a window of
    // each other (within ~600 chars, which is generous for a config example).
    const swIdx = content.indexOf('ScheduleWakeup');
    const promptIdx = content.indexOf('/ai-team:tick');
    const nwsIdx = content.indexOf('nextWakeSeconds');
    expect(swIdx).toBeGreaterThanOrEqual(0);
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(nwsIdx).toBeGreaterThanOrEqual(0);
    // The prompt and nextWakeSeconds should both appear within 600 chars of
    // a ScheduleWakeup invocation (not in a totally unrelated section).
    expect(Math.abs(swIdx - promptIdx)).toBeLessThan(600);
    expect(Math.abs(swIdx - nwsIdx)).toBeLessThan(600);
  });

  // ---------------------------------------------------------------------------
  // AC10 — Skip re-arm when nextWakeSeconds == 0 OR the mission state is
  // terminal (completed/aborted/archived). Both halves of the "only/never"
  // qualifier must be present.
  // ---------------------------------------------------------------------------

  describe('AC10: does NOT re-arm when nextWakeSeconds == 0 or mission state is terminal', () => {
    test('mentions skipping re-arm on `nextWakeSeconds == 0`', () => {
      // The condition (zero / 0) must be linked to a "skip" / "do not" /
      // "not re-arm" cue so the contract is unambiguous.
      expect(content).toMatch(/nextWakeSeconds\s*(?:==|is)?\s*0[^\n]*(?:do(?:es)? not|skip|don'?t|no(?:t)?)\s*re-?arm|do(?:es)? not|skip|don'?t|no(?:t)?\s*re-?arm[\s\S]{0,200}nextWakeSeconds\s*(?:==|is)?\s*0/i);
    });

    test('mentions skipping re-arm on terminal mission states (completed|aborted|archived)', () => {
      // All three terminal states must be named so no state is silently
      // missed (the AC lists them explicitly).
      expect(content).toMatch(/\bcompleted\b/);
      expect(content).toMatch(/\baborted\b/);
      expect(content).toMatch(/\barchived\b/);

      // And the terminal-state guard must be linked to "do not re-arm" / skip
      // cue so it's a stop-condition, not a passing mention.
      expect(content).toMatch(/(?:terminal|completed|aborted|archived)[\s\S]{0,300}(?:do(?:es)? not|skip|don'?t|no(?:t)?)\s*re-?arm|(?:do(?:es)? not|skip|don'?t|no(?:t)?)\s*re-?arm[\s\S]{0,300}(?:terminal|completed|aborted|archived)/i);
    });
  });

  // ---------------------------------------------------------------------------
  // AC11 — Non-zero exit from `ateam controller tick` → prints the error,
  // re-arms with a 120s back-off, and does NOT execute any actions from a
  // partial response. Cross-product: error handling × no-action guarantee.
  // ---------------------------------------------------------------------------

  describe('AC11: non-zero exit from controller tick → error logged + 120s back-off + no actions executed', () => {
    test('mentions the non-zero / failure exit path for `ateam controller tick`', () => {
      // The contract names this case explicitly so the test pins the
      // failure-mode language.
      expect(content).toMatch(/non[- ]zero|exit\s+(?:code\s+)?(?:!=|<>|≠)?\s*0|fail-?closed|API\s+unreachable|exits?\s+non[- ]zero/i);
    });

    test('the error path uses a 120-second ScheduleWakeup back-off', () => {
      // The 120s back-off must appear in connection with ScheduleWakeup —
      // not just anywhere in the file (e.g. accidentally inside a
      // documentation table).
      expect(content).toContain('120');
      // Within 400 chars of a `ScheduleWakeup` reference, expect `120` to
      // appear so the back-off is wired to the re-arm primitive.
      const swMatches = [...content.matchAll(/ScheduleWakeup/g)].map((m) => m.index);
      const has120Nearby = swMatches.some((idx) => {
        const window = content.slice(idx, idx + 400);
        return /\b120\b/.test(window);
      });
      expect(has120Nearby).toBe(true);
    });

    test('on non-zero exit, does NOT execute any actions from a partial response', () => {
      // The contract phrase must appear so a future edit that drops it (and
      // accidentally executes partial actions) is flagged. We accept any of
      // a few common phrasings — but all of them link the failure to the
      // "no actions" guarantee.
      expect(content).toMatch(/no actions|do(?:es)? not execute|skip actions|abort|don'?t (?:execute|run) actions|no dispatch/i);
    });
  });
});
