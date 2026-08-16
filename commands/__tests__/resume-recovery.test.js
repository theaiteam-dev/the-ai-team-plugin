/**
 * Tests for resume command recovery strategy consistency.
 *
 * Validates that commands/resume.md has a single, internally consistent
 * recovery strategy that covers all pipeline stages and is compatible
 * with VALID_TRANSITIONS from board.ts.
 *
 * Bug: resume.md currently has 3 contradictory recovery strategies and
 * is missing the probing stage from recovery rules.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TRANSITION_MATRIX } from '../../packages/shared/src/stages.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESUME_MD_PATH = path.resolve(__dirname, '..', 'resume.md');

/**
 * VALID_TRANSITIONS imported from the shared package (source of truth).
 * These define which stage moves the board_move tool will accept.
 */
const VALID_TRANSITIONS = TRANSITION_MATRIX;

/**
 * All active pipeline stages that could be interrupted mid-work, or that
 * otherwise need explicit recovery guidance on resume.
 * Most of these (testing/implementing/review/probing) are stages where an
 * agent is actively working when a session is interrupted. 'staged' is the
 * exception (WI-787): no agent owns it, but items can still be sitting there
 * when a session resumes, so it needs its own documented recovery rule too.
 */
const ACTIVE_PIPELINE_STAGES = ['testing', 'implementing', 'review', 'probing', 'staged'];

/**
 * Parse recovery rules from resume.md.
 *
 * Scans three sections for recovery actions:
 * 1. "Recover interrupted work" (Behavior step 3)
 * 2. "Recovery Rules" (dedicated section)
 * 3. "Native Teams Recovery" (native teams section)
 *
 * Returns a map of stage -> recovery action for each section found.
 */
function parseRecoveryRules(content) {
  const behaviorSection = new Map();
  const recoveryRulesSection = new Map();
  const nativeTeamsSection = new Map();

  const lines = content.split('\n');

  let inBehaviorRecovery = false;
  let inNativeTeams = false;
  let inRecoveryRules = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section boundaries
    if (/recover interrupted work/i.test(line)) {
      inBehaviorRecovery = true;
      inNativeTeams = false;
      inRecoveryRules = false;
      continue;
    }
    if (/native teams recovery/i.test(line)) {
      inBehaviorRecovery = false;
      inNativeTeams = true;
      inRecoveryRules = false;
      continue;
    }
    if (/^## Recovery Rules/i.test(line)) {
      inBehaviorRecovery = false;
      inNativeTeams = false;
      inRecoveryRules = true;
      continue;
    }
    // Exit behavior section at next step
    if (/^\d+\.\s+\*\*(?!Recover)/i.test(line) && inBehaviorRecovery) {
      inBehaviorRecovery = false;
    }
    // Exit recovery rules at next major section
    if (/^## (?!Recovery Rules)/i.test(line) && inRecoveryRules) {
      inRecoveryRules = false;
    }

    // Parse behavior section recovery moves
    if (inBehaviorRecovery) {
      // Match: `testing` items -> back to `ready` stage
      const moveMatch = line.match(/`(\w+)`\s+items?\s*(?:→|->)\s*(?:back to\s+)?`(\w+)`/i);
      if (moveMatch) {
        behaviorSection.set(moveMatch[1], moveMatch[2]);
      }
      // Match: board_move(itemId, to="ready")
      const boardMoveMatch = line.match(/board_move\(\w+,\s*to="(\w+)"\)/);
      if (boardMoveMatch) {
        // Find which stage this board_move is for by looking at preceding lines
        for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
          const stageMatch = lines[j].match(/in (\w+) stage/i);
          if (stageMatch) {
            behaviorSection.set(stageMatch[1], boardMoveMatch[1]);
            break;
          }
        }
      }
    }

    // Parse native teams section - look for stage-to-agent mappings
    if (inNativeTeams) {
      const columnsMatch = line.match(/board\.columns\.(\w+)/);
      if (columnsMatch) {
        const stage = columnsMatch[1];
        // Look ahead for spawnTeammate call
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const spawnMatch = lines[j].match(/spawnTeammate\("(\w+)"/);
          if (spawnMatch) {
            nativeTeamsSection.set(stage, `respawn-${spawnMatch[1]}`);
            break;
          }
        }
      }
    }

    // Parse Recovery Rules section
    if (inRecoveryRules) {
      // Match: ### Items in `testing` stage
      const sectionMatch = line.match(/###\s+Items in `(\w+)`/i);
      if (sectionMatch) {
        const stage = sectionMatch[1];
        // Look at next few lines for the action
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const actionLine = lines[j];
          // Match: Move to `ready` stage
          const moveAction = actionLine.match(/Move to `(\w+)`/i);
          if (moveAction) {
            recoveryRulesSection.set(stage, moveAction[1]);
            break;
          }
          // Match: Stay in `review` stage / Never re-done
          const stayAction = actionLine.match(/Stay (?:in )?`?(\w+)`?/i);
          if (stayAction) {
            recoveryRulesSection.set(stage, `stay-${stayAction[1]}`);
            break;
          }
          const neverAction = actionLine.match(/Never re-done/i);
          if (neverAction) {
            recoveryRulesSection.set(stage, 'stay-done');
            break;
          }
        }
      }
    }
  }

  return { behaviorSection, recoveryRulesSection, nativeTeamsSection };
}

describe('Resume command recovery strategy consistency', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(RESUME_MD_PATH, 'utf-8');
  });

  test('should have ONE consistent recovery strategy with no contradictions between sections', () => {
    const { behaviorSection, recoveryRulesSection, nativeTeamsSection } = parseRecoveryRules(content);

    // Collect all stages that have recovery rules in any section
    const allStages = new Set([
      ...behaviorSection.keys(),
      ...recoveryRulesSection.keys(),
    ]);

    const contradictions = [];

    for (const stage of allStages) {
      const behaviorAction = behaviorSection.get(stage);
      const rulesAction = recoveryRulesSection.get(stage);

      if (behaviorAction && rulesAction) {
        // Normalize: "stay-X" means item stays at stage X
        const behaviorIsStay = behaviorAction === `stay-${stage}` || behaviorAction === stage;
        const rulesIsStay = rulesAction === `stay-${stage}` || rulesAction === stage;
        const behaviorTarget = behaviorIsStay ? stage : behaviorAction;
        const rulesTarget = rulesIsStay ? stage : rulesAction;

        if (behaviorTarget !== rulesTarget) {
          contradictions.push(
            `Stage '${stage}': Behavior section says -> '${behaviorAction}', ` +
            `Recovery Rules section says -> '${rulesAction}'`
          );
        }
      }
    }

    // For native teams: the strategy should be consistent with the main strategy.
    // If the main strategy says "stay at current stage" (re-dispatch agent),
    // native teams respawning at that stage is consistent.
    // If the main strategy says "move to different stage", native teams must too.
    if (nativeTeamsSection.size > 0) {
      for (const stage of ACTIVE_PIPELINE_STAGES) {
        const mainAction = behaviorSection.get(stage) || recoveryRulesSection.get(stage);
        const nativeAction = nativeTeamsSection.get(stage);

        if (mainAction && nativeAction) {
          const mainIsStay = mainAction === `stay-${stage}` || mainAction === stage;
          const nativeIsRespawn = nativeAction.startsWith('respawn-');

          // If main says move backward but native just respawns - contradiction
          if (!mainIsStay && nativeIsRespawn) {
            contradictions.push(
              `Stage '${stage}': Main strategy says move to '${mainAction}', ` +
              `but Native Teams section just respawns agent at current stage`
            );
          }
        }
      }
    }

    expect(contradictions).toEqual([]);
  });

  test('should cover ALL active pipeline stages in recovery rules: testing, implementing, review, probing', () => {
    const { behaviorSection, recoveryRulesSection } = parseRecoveryRules(content);

    // Merge both sections to find all covered stages
    const coveredStages = new Set([
      ...behaviorSection.keys(),
      ...recoveryRulesSection.keys(),
    ]);

    const missingStages = ACTIVE_PIPELINE_STAGES.filter(
      (stage) => !coveredStages.has(stage)
    );

    expect(missingStages).toEqual([]);
  });

  test('should only use recovery moves that are compatible with VALID_TRANSITIONS in board.ts', () => {
    const { behaviorSection, recoveryRulesSection } = parseRecoveryRules(content);

    const invalidMoves = [];

    // Check behavior section moves
    for (const [fromStage, toStage] of behaviorSection.entries()) {
      if (toStage.startsWith('stay-')) continue; // Staying is not a board_move
      if (toStage === fromStage) continue; // No-op

      const validTargets = VALID_TRANSITIONS[fromStage];
      if (validTargets && !validTargets.includes(toStage)) {
        invalidMoves.push(
          `Behavior section: '${fromStage}' -> '${toStage}' is not in VALID_TRANSITIONS ` +
          `(valid: ${validTargets.join(', ')})`
        );
      }
    }

    // Check Recovery Rules section moves
    for (const [fromStage, toStage] of recoveryRulesSection.entries()) {
      if (toStage.startsWith('stay-')) continue; // Staying is not a board_move
      if (toStage === fromStage) continue; // No-op

      const validTargets = VALID_TRANSITIONS[fromStage];
      if (validTargets && !validTargets.includes(toStage)) {
        invalidMoves.push(
          `Recovery Rules section: '${fromStage}' -> '${toStage}' is not in VALID_TRANSITIONS ` +
          `(valid: ${validTargets.join(', ')})`
        );
      }
    }

    expect(invalidMoves).toEqual([]);
  });
});

/**
 * WI-798: deepen the `staged` stub (added by WI-787 as a plain "Stay in
 * `staged`") into the real approved-review-vs-no-review-vs-rejected
 * recovery logic. The three generic tests above only check that SOME
 * single recovery action exists per stage and that Behavior/Recovery Rules
 * agree on it — they cannot express a 3-way conditional (staged's crash
 * window can land in three genuinely different states: an approved review
 * already exists and promotion just needs finishing; no review exists yet
 * and the tail must restart at Frankie; or a FINAL REJECTED review exists
 * and the named items need surfacing, not silent action). These tests read
 * the raw "### Items in `staged` stage" section content directly, the same
 * "extract a stable structural anchor, assert on its content" approach
 * playbooks/__tests__/mission-tail-order.test.js uses for WI-796.
 *
 * Also verified directly (see /tmp debug harness during authoring, not
 * checked in): the existing `behaviorSection` map is EMPTY for every stage
 * against the current file — Behavior step 3's prose ("for item in testing
 * stage: ... dispatch Murdock on item") doesn't match either of the
 * parser's two recognized Behavior-section patterns, so today's
 * no-contradictions test passes vacuously for every stage, not just
 * staged. AC4 asks for `staged` specifically to be phrased so it lands in
 * BOTH maps, making that check non-vacuous for at least this one stage.
 */

function extractStagedRecoveryRuleSection(content) {
  const headingMatch = content.match(/### Items in `staged` stage\n/);
  if (!headingMatch) return null;
  const start = headingMatch.index + headingMatch[0].length;
  const rest = content.slice(start);
  const endMatch = rest.match(/\n#{2,3} /);
  return endMatch ? rest.slice(0, endMatch.index) : rest;
}

describe('staged-stage recovery: approved-review vs. no-review vs. FINAL REJECTED branching (WI-798)', () => {
  let content;
  let stagedSection;

  beforeAll(() => {
    content = fs.readFileSync(RESUME_MD_PATH, 'utf-8');
    stagedSection = extractStagedRecoveryRuleSection(content);
  });

  test('the staged recovery rule is phrased so the parser recognizes it in BOTH the Behavior section and the Recovery Rules section (AC4)', () => {
    const { behaviorSection, recoveryRulesSection } = parseRecoveryRules(content);
    expect(behaviorSection.has('staged'), 'expected the Behavior section (step 3) to include a parser-recognized staged case').toBe(true);
    expect(recoveryRulesSection.has('staged'), 'expected the Recovery Rules section to include a parser-recognized staged case').toBe(true);
  });

  test('when an approved final review already exists, resume completes the promotion without re-running Frankie or Stockwell (AC1)', () => {
    expect(stagedSection, 'expected a "### Items in `staged` stage" section').not.toBeNull();
    const approvedBranch = stagedSection.match(/approved[\s\S]{0,400}/i);
    expect(approvedBranch, 'expected an "approved final review already exists" branch').not.toBeNull();
    expect(approvedBranch[0]).toMatch(/promot(?:es?|ion|ing)/i);
    expect(approvedBranch[0]).toMatch(/without re-running|does not re-run|never re-runs?|skip(?:s|ping)?/i);
    expect(approvedBranch[0]).toMatch(/frankie/i);
    expect(approvedBranch[0]).toMatch(/stockwell/i);
  });

  test('when no approved final review exists, resume re-enters the mission tail at Frankie for a full Definition of Done re-walk (AC2)', () => {
    expect(stagedSection).not.toBeNull();
    const noReviewBranch = stagedSection.match(/no (?:approved )?(?:final )?review[\s\S]{0,400}/i);
    expect(noReviewBranch, 'expected a "no approved final review exists" branch').not.toBeNull();
    expect(noReviewBranch[0]).toMatch(/frankie/i);
    expect(noReviewBranch[0]).toMatch(/full\s+(?:definition of done|dod)/i);
  });

  test('when a FINAL REJECTED review exists, resume surfaces the named items to the operator instead of silently promoting or re-walking (AC3)', () => {
    expect(stagedSection).not.toBeNull();
    const rejectedBranch = stagedSection.match(/rejected[\s\S]{0,400}/i);
    expect(rejectedBranch, 'expected a "FINAL REJECTED" branch').not.toBeNull();
    expect(rejectedBranch[0]).toMatch(/operator/i);
    // The REJECTED branch's own text must not itself claim to promote or
    // silently re-walk — that's exactly what AC3 rules out.
    expect(rejectedBranch[0]).not.toMatch(/promot(?:es?|ion|ing)/i);
  });
});

// =============================================================================
// AC5: the resume status template (step 6's "Display recovery summary")
// reports a Staged count alongside Briefings, Ready, Done, Blocked. Also
// pins the worked "## Example" section's output block to the same template
// — WI-796's rework cycle found that a second, unpinned narrative copy of
// the same content is exactly how self-contradicting staleness survives a
// large doc item, so this file checks both copies rather than just the one
// the AC sentence names.
// =============================================================================
describe('resume status template includes a Staged count (WI-798 AC5)', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(RESUME_MD_PATH, 'utf-8');
  });

  test('the "Display recovery summary" step 6 template reports Staged alongside Briefings, Ready, Done, Blocked', () => {
    const section = content.match(/Display recovery summary[\s\S]{0,700}/i);
    expect(section, 'expected a "Display recovery summary" step').not.toBeNull();
    expect(section[0]).toMatch(/-\s*Staged:/i);
  });

  test('the worked "## Example" output block also reports Staged, matching the template (no stale second copy)', () => {
    const exampleSection = content.match(/## Example[\s\S]{0,1200}/i);
    expect(exampleSection, 'expected an "## Example" section').not.toBeNull();
    expect(exampleSection[0]).toMatch(/-\s*Staged:/i);
  });
});
