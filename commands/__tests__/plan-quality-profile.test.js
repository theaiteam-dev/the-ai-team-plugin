/**
 * Tests for WI-941: /ai-team:plan recommends a quality profile for the
 * operator to ratify.
 *
 * Extends three EXISTING files (none created new): commands/plan.md,
 * agents/face.md, agents/sosa.md. This repo tests command/agent markdown by
 * parsing prose invariants — see commands/__tests__/resume-recovery.test.js
 * and playbooks/__tests__/mission-tail-order.test.js for the convention this
 * file follows: extract stable structural anchors and assert their
 * presence/relationships, never pin exact sentence wording.
 *
 * The core ordering constraint (FR-9): the mission record is created in
 * plan.md's step 2, but the Face/Sosa recommendation doesn't exist until
 * step 5 (Sosa) / is ratified after step 5. So the flag-less path must STAMP
 * the contract onto the already-created mission (WI-934's PATCH
 * /api/missions/{missionId} allow-list) — it cannot pass it at creation.
 * Only the --quality path can pass it at creation time (step 2). The stamp,
 * wherever it happens, must land BEFORE Wave 0 items move to ready (AC3) —
 * this file asserts that ordering directly, not just presence of both steps.
 *
 * Sosa's existing "Definition of Done (for Josh's Blessing)" section
 * (agents/sosa.md ~line 393) is the precedent pattern for "ride the existing
 * refinement gate, no new interruption point" — the profile recommendation
 * must be added the same way, not as a separate AskUserQuestion prompt.
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

let planMd;
let faceMd;
let sosaMd;

beforeAll(() => {
  planMd = read('commands/plan.md');
  faceMd = read('agents/face.md');
  sosaMd = read('agents/sosa.md');
});

// =============================================================================
// AC1: an explicit --quality flag stores the profile at mission creation,
// and no recommendation is solicited.
// =============================================================================

describe('AC1: explicit --quality stores the profile at mission creation, no recommendation solicited', () => {
  it('commands/plan.md documents a --quality (or -q) argument', () => {
    expect(planMd).toMatch(/--quality|-q\b/);
  });

  it('the mission-creation step passes the resolved contract when --quality was given', () => {
    const creationStep = sectionAfter(planMd, /^### 2\. Initialize mission/m);
    expect(creationStep).not.toBe('');
    expect(creationStep).toMatch(/--quality|-q\b/);
    expect(creationStep).toMatch(/executionContract|testing_level|review_tier/);
  });

  it("plan.md's Face pass-1 dispatch prompt threads the --quality state through to Face", () => {
    // WI-941 rework (Amy's rejection): "no recommendation is solicited"
    // cannot be verified by a prose CLAIM elsewhere in the document — Face
    // has no way to condition its own Output bullet on --quality's presence
    // unless the dispatch prompt that spawns it actually carries that state.
    // An earlier version of this test slice a window from the Arguments
    // section (which merely CLAIMS the behavior) and never looked at the
    // dispatch prompt at all — a false green Amy caught by reading all
    // three files directly, not just the diff.
    const step3 = sectionAfter(planMd, /^### 3\. Invoke Face - First Pass/m);
    expect(step3).not.toBe('');
    expect(step3).toMatch(/--quality|-q\b/);
  });

  it("plan.md's Sosa dispatch prompt (Step 5) threads the ground-truth --quality state through to Sosa — not just to Face", () => {
    // WI-941 rework, 2nd cycle (Amy's rejection): threading --quality to
    // Face (Step 3, tested above) is necessary but NOT sufficient. Sosa's
    // own new conditional (in sosa.md) depends on knowing whether a profile
    // was already given — but Sosa is dispatched from a SEPARATE step (5)
    // with her OWN prompt, which does not automatically inherit Step 3's
    // Face prompt content. The 1st rework pass fixed Step 3 and face.md's
    // Output bullet but left Step 5 completely untouched (confirmed via
    // diff-hunk audit and a direct read of the dispatch prompt: it passes
    // only the sosa.md system prompt, "review all work items", the report
    // format, and {prd_content} — no --quality state, no Face report
    // content). Contrast with Step 6, which already knows this pattern:
    // {sosa_report} explicitly threads Sosa's prior output into Face pass
    // 2. Step 5 needs the equivalent — either the raw --quality state (the
    // orchestrator already resolved it in Step 2) or Face's report content
    // — threaded into Sosa's own dispatch prompt.
    const step5 = sectionAfter(planMd, /^### 5\. Invoke Sosa/m);
    expect(step5).not.toBe('');
    // Loose alternation (any of --quality / quality profile / etc.) passed
    // even when Face's ACTUAL report/recommendation was never threaded
    // through — Sosa could still recommend an independently-derived,
    // possibly-conflicting profile from the PRD. Require the concrete
    // placeholder carrying Face's own report/recommendation value.
    expect(step5).toMatch(/\{face_report\}|\{face_output\}|\{face_recommendation\}/);
  });

  it("face.md's Output bullet is conditioned on whether --quality was already given, not unconditional", () => {
    const idx = faceMd.search(/quality profile/i);
    expect(idx).toBeGreaterThan(-1);
    const window = faceMd.slice(Math.max(0, idx - 100), idx + 500);
    // Requires explicit conditional language keyed off --quality's
    // presence — not just any mention of "quick/normal/deep" or "PRD",
    // which the unconditional (bug) version already satisfied.
    expect(window).toMatch(/--quality|already (given|resolved|set)/i);
    expect(window).toMatch(/skip|N\/?A|only when|if (no|not)/i);
  });

  it("sosa.md's report section is conditioned on whether --quality was already given, not unconditional", () => {
    const idx = sosaMd.search(/quality profile/i);
    expect(idx).toBeGreaterThan(-1);
    const window = sosaMd.slice(Math.max(0, idx - 100), idx + 600);
    expect(window).toMatch(/--quality|already (given|resolved|set)/i);
    expect(window).toMatch(/skip|N\/?A|only when|if (no|not)/i);
  });

  it('a concrete example: --quality quick given, no --skip-refinement, produces no recommendation to ratify', () => {
    // Guards against the exact failure Amy demonstrated: an operator runs
    // `/ai-team:plan prd.md --quality quick` (refinement NOT skipped) and
    // still sees Sosa recommend an independently-derived profile that could
    // contradict what was already locked in at creation. This test doesn't
    // require the doc to spell out this literal scenario, but does require
    // the conditional language above to be strong enough to cover the
    // "given AND refinement runs" case specifically, not just skip-refinement.
    const sosaIdx = sosaMd.search(/quality profile/i);
    const sosaWindow = sosaMd.slice(Math.max(0, sosaIdx - 100), sosaIdx + 600);
    // Must not be scoped ONLY to --skip-refinement (that would leave the
    // given+refinement-runs case, Amy's exact scenario, still unconditional).
    const mentionsSkipRefinementOnly = /skip-refinement/i.test(sosaWindow) && !/--quality/i.test(sosaWindow);
    expect(mentionsSkipRefinementOnly, 'sosa.md conditions the recommendation only on --skip-refinement, not on --quality having already been given').toBe(false);
  });
});

// =============================================================================
// AC2: without --quality, Face/Sosa produce a recommendation with rationale,
// riding Sosa's existing refinement-report gate (same pattern as her
// "Definition of Done (for Josh's Blessing)" section) — no new interruption
// point.
// =============================================================================

describe('AC2: flag-less path produces a recommended profile with rationale, riding the existing refinement gate', () => {
  it("sosa.md's refinement report template carries a quality-profile recommendation section", () => {
    expect(sosaMd).toMatch(/quality profile/i);
    // Mirrors the precedent section title shape: "<Thing> (for Josh's Blessing)".
    expect(sosaMd).toMatch(/for (Josh'?s )?[Bb]lessing/);
  });

  it('the profile recommendation includes a stated rationale', () => {
    const idx = sosaMd.search(/quality profile/i);
    expect(idx).toBeGreaterThan(-1);
    const window = sosaMd.slice(idx, idx + 600);
    expect(window).toMatch(/rationale|because|reason/i);
  });

  it('rides the SAME human gate as the existing Definition-of-Done blessing — no new interruption point', () => {
    const idx = sosaMd.search(/quality profile/i);
    const window = sosaMd.slice(Math.max(0, idx - 100), idx + 600);
    expect(window).toMatch(/no new interruption|same (human )?gate|same report/i);
  });

  it("face.md's pass-1 summary output includes a quality-profile recommendation, mirroring its existing Definition of Done outcome item", () => {
    const output = sectionAfter(faceMd, /^## Output/m);
    expect(output).toMatch(/quality profile/i);
  });

  it('the recommendation is derived from the PRD (not an arbitrary/hardcoded default)', () => {
    const idx = faceMd.search(/quality profile/i);
    expect(idx).toBeGreaterThan(-1);
    const window = faceMd.slice(idx, idx + 300);
    expect(window).toMatch(/PRD/);
  });
});

// =============================================================================
// AC3: the ratified profile is stamped onto the mission BEFORE any item
// reaches ready — ordering, not just presence, since a ready item could
// otherwise execute against a contract-less mission.
// =============================================================================

describe('AC3: ratified profile is stamped before any item moves to ready (ordering, not just presence)', () => {
  // Step 6 has TWO parallel branches — "Default: reuse the pass-1 agent" and
  // "Fallback: fresh agent" — each issuing its OWN independent move-to-ready
  // instruction inside its own prompt (only one branch runs per invocation,
  // but either one could). A stamp added to only one branch is a sibling-guard
  // gap (defensive-coding skill §12): whichever branch actually runs must
  // stamp before moving. An earlier version of this test checked ordering
  // across the WHOLE step-6 section using the FIRST match of each pattern —
  // which passed by accident against a synthetic sample that stamped only
  // the Fallback branch, because the Default branch's PRE-EXISTING move
  // instruction (unrelated to the fix) sorted earlier and was never compared
  // against the actual added stamp. Caught via synthetic-sample validation;
  // fixed by checking each branch independently below.

  function splitStep6Branches(step6) {
    const defaultIdx = step6.search(/\*\*Default: reuse the pass-1 agent\.\*\*/);
    const fallbackIdx = step6.search(/\*\*Fallback: fresh agent\.\*\*/);
    expect(defaultIdx, 'expected the Default branch marker').toBeGreaterThan(-1);
    expect(fallbackIdx, 'expected the Fallback branch marker').toBeGreaterThan(-1);
    return {
      defaultBranch: step6.slice(defaultIdx, fallbackIdx),
      fallbackBranch: step6.slice(fallbackIdx),
    };
  }

  it("plan.md's second-pass step stamps the mission's execution contract", () => {
    const step6 = sectionAfter(planMd, /^### 6\. Invoke Face - Second Pass/m);
    expect(step6).not.toBe('');
    expect(step6).toMatch(/PATCH|executionContract/);
  });

  it.each([
    ['Default (reuse pass-1 agent)', 'defaultBranch'],
    ['Fallback (fresh agent)', 'fallbackBranch'],
  ])('the %s branch stamps BEFORE its "move to ready" instruction', (_label, key) => {
    const step6 = sectionAfter(planMd, /^### 6\. Invoke Face - Second Pass/m);
    const { defaultBranch, fallbackBranch } = splitStep6Branches(step6);
    const branch = key === 'defaultBranch' ? defaultBranch : fallbackBranch;

    const stampIdx = branch.search(/PATCH|executionContract/);
    const readyIdx = branch.search(/move[^.\n]*(wave 0|ready)/i);
    expect(stampIdx, `expected a stamp instruction in the ${_label} branch`).toBeGreaterThan(-1);
    expect(readyIdx, `expected a move-to-ready instruction in the ${_label} branch`).toBeGreaterThan(-1);
    expect(stampIdx).toBeLessThan(readyIdx);
  });

  it('the stamp path reuses the existing PATCH endpoint rather than rebuilding it', () => {
    const step6 = sectionAfter(planMd, /^### 6\. Invoke Face - Second Pass/m);
    expect(step6).toMatch(/\/api\/missions\/\{?missionId\}?|PATCH \/api\/missions/);
  });
});

// =============================================================================
// AC4: an invalid --quality value is rejected, naming all three valid
// profiles, and creates no mission.
// =============================================================================

describe('AC4: an invalid --quality value is rejected, naming all three profiles, no mission created', () => {
  // Scoped to the mission-creation step specifically, not "800 chars from
  // the FIRST --quality/-q mention anywhere in the document" — the flag is
  // also mentioned in Arguments (far above, separated by the whole Flow
  // diagram), so a whole-document search could point at a window that never
  // reaches the actual validation language in step 2. Caught via
  // synthetic-sample validation before trusting RED.
  it('validates --quality against the three profile names before creating the mission', () => {
    const creationStep = sectionAfter(planMd, /^### 2\. Initialize mission/m);
    expect(creationStep).toMatch(/--quality|-q\b/);
    expect(creationStep).toMatch(/quick/i);
    expect(creationStep).toMatch(/normal/i);
    expect(creationStep).toMatch(/deep/i);
  });

  it('an invalid value creates no mission', () => {
    const creationStep = sectionAfter(planMd, /^### 2\. Initialize mission/m);
    expect(creationStep).toMatch(/no mission|invalid|reject|error/i);
  });
});

// =============================================================================
// AC5: skipping the refinement gate (--skip-refinement) still yields a
// mission carrying a profile, never none.
// =============================================================================

describe('AC5: --skip-refinement still yields a mission carrying a profile, never none', () => {
  it('documents a concrete default profile near a skip-refinement mention inside ## Behavior', () => {
    // --skip-refinement is ALREADY documented today (Arguments, the Flow
    // diagram, step headings, the Example section) — asserting only its
    // presence would pass vacuously against the pre-WI-941 file and prove
    // nothing about quality profiles. This test requires a profile name to
    // appear near AT LEAST ONE skip-refinement mention specifically inside
    // the ## Behavior section (where B.A. will elaborate the skip path,
    // wherever within Behavior that naturally lands — step 2's mission
    // creation, step 5, or step 6 are all plausible), so it correctly fails
    // until that elaboration exists and doesn't presume a specific spot.
    const behaviorStart = planMd.search(/^## Behavior/m);
    const exampleStart = planMd.search(/^## Example/m);
    expect(behaviorStart, 'expected a ## Behavior section').toBeGreaterThan(-1);
    const behaviorSection =
      exampleStart === -1 ? planMd.slice(behaviorStart) : planMd.slice(behaviorStart, exampleStart);

    const mentions = [...behaviorSection.matchAll(/skip-refinement/g)];
    expect(mentions.length, 'expected at least one skip-refinement mention inside ## Behavior').toBeGreaterThan(0);

    const hasNearbyProfile = mentions.some((m) => {
      const window = behaviorSection.slice(m.index, m.index + 500);
      return /quick|normal|deep/i.test(window);
    });
    expect(hasNearbyProfile, 'expected a concrete profile name near a Behavior-section skip-refinement mention').toBe(true);
  });

  it('a skipped-refinement mission is never left without a contract', () => {
    // Scoped to ### 2. Initialize mission specifically — a whole-document
    // scan for "skip-refinement" + any profile name passes vacuously (e.g.
    // if the skipped path merely NAMES "normal" in prose without ever
    // passing executionContract fields to createMission). The guarantee
    // this test protects is that the skip-refinement default actually
    // reaches the createMission call with a concrete contract, not just
    // that the word "normal" appears somewhere near "skip-refinement".
    const creationStep = sectionAfter(planMd, /^### 2\. Initialize mission/m);
    expect(creationStep).toMatch(/skip-refinement/);
    expect(creationStep).toMatch(/\bnormal\b/i);
    expect(creationStep).toMatch(/executionContract|testing_level|review_tier|profile/i);
  });
});

// =============================================================================
// Regression: plan.md's PRD-file-IS-the-brief behavior is unchanged (FR-4) —
// confirm, don't touch. prdPath still points directly at the PRD file passed
// as the command argument.
// =============================================================================

describe('regression: plan.md still satisfies the mission-brief contract via its PRD file unchanged', () => {
  it('prdPath is still set to the PRD file passed as the command argument', () => {
    // Matches the file's ACTUAL existing wording ("Path to the PRD file
    // (the same file passed as argument to `/ai-team:plan`)") — an earlier
    // version of this test looked for the literal token "prd-file", which
    // never appears in that sentence and made this regression test fail
    // even against the correct, untouched original (caught via the
    // synthetic-sample validation pass before trusting RED).
    const creationStep = sectionAfter(planMd, /^### 2\. Initialize mission/m);
    expect(creationStep).toMatch(/--prdPath/);
    expect(creationStep).toMatch(/PRD file/i);
    expect(creationStep).toMatch(/\/ai-team:plan/);
  });
});

// =============================================================================
// ADR 0009 discipline: none of the three files restate what quick/normal/deep
// map to — they reference the resolver (qa-contract.js) instead.
// =============================================================================

describe('quality profile bundles are referenced, not restated (ADR 0009 naming-layer discipline)', () => {
  for (const [name, getContent] of [
    ['commands/plan.md', () => planMd],
    ['agents/face.md', () => faceMd],
    ['agents/sosa.md', () => sosaMd],
  ]) {
    it(`${name} does not restate the profile-to-enum bundle mapping`, () => {
      const text = getContent();
      // Restating the mapping means BOTH an enum value pair from the same
      // bundle appearing together, e.g. "smoke" + "evidence-only" (quick) or
      // "full-dod" + "hands-on" (deep) — a single stray enum word alone
      // (e.g. mentioning "hands-on" in an unrelated review-tier context) is
      // not restatement by itself.
      const hasQuickPair = /\bsmoke\b/i.test(text) && /evidence-only/i.test(text);
      const hasDeepPair = /full-dod/i.test(text) && /hands-on/i.test(text) && /\bdeep\b/i.test(text);
      // 'hands-on' is shared between normal and deep's review_tier, so the
      // normal pair is scoped with 'critical-path' (normal's testing_level)
      // + 'normal' itself to avoid double-counting a deep-bundle restatement
      // as a normal one.
      const hasNormalPair = /critical-path/i.test(text) && /hands-on/i.test(text) && /\bnormal\b/i.test(text);
      expect(hasQuickPair, `${name} restates the quick bundle (smoke + evidence-only)`).toBe(false);
      expect(hasNormalPair, `${name} restates the normal bundle (critical-path + hands-on)`).toBe(false);
      expect(hasDeepPair, `${name} restates the deep bundle (full-dod + hands-on)`).toBe(false);
    });
  }

  it('commands/plan.md references the resolver rather than re-deriving profile meaning', () => {
    expect(planMd).toMatch(/qa-contract|resolveQualityProfile|resolver/i);
  });
});

// =============================================================================
// Sosa remains a fixed fixture — no profile reduces her review (section 8,
// Open Question 1, decided 2026-09-03). A quick-profile plan still runs the
// full Sosa pass when refinement isn't skipped.
// =============================================================================

describe('Sosa is a fixed fixture regardless of quality profile', () => {
  it('nothing in plan.md conditions the Sosa step on the quality profile', () => {
    const sosaStep = sectionAfter(planMd, /^### 5\. Invoke Sosa/m);
    expect(sosaStep).not.toBe('');
    // The ONLY documented skip condition for step 5 is --skip-refinement,
    // never the quality profile itself (e.g. no "skip Sosa for quick" clause).
    expect(sosaStep).not.toMatch(/skip[^.\n]*quick|quick[^.\n]*skip/i);
  });
});
