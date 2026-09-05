/**
 * Tests for WI-942: Execution-contract consumers read the mission's
 * contract first.
 *
 * Migrates every reader of the execution contract — stop-gates.js, Frankie,
 * Hannibal, Tawnia, /ai-team:run, and both orchestration playbooks — from
 * reading ateam.config.json unconditionally to asking for the mission's
 * stored contract first (WI-937's resolveExecutionContract/
 * resolveQualityProfile) and falling back to config for missions without
 * one (FR-9). Per Sosa's W4 flag this item's real write surface is larger
 * than its declared outputs.impl (stop-gates.js) — nine prose consumers are
 * in scope too. The AC3 anti-drift sweep (no consumer restates the
 * quick/normal/deep bundle mapping) lives as a SEPARATE sibling suite in
 * playbooks/__tests__/mission-tail-order.test.js per this item's own
 * context, reusing that file's collectMarkdownFiles()/allMarkdownFiles()
 * helpers — it is deliberately NOT duplicated here.
 *
 * WI-941 FAILURE SHAPE (explicitly flagged for this item — Amy caught it
 * twice already this mission): a prose claim that a behavior happens is not
 * the same as verifying the behavior is actually wired/conditional/
 * enforced. Every test below checks for the CONCRETE textual anchor the
 * described behavior requires (a specific parameter, a specific fallback
 * clause, a specific unchanged value) — never just "the topic is mentioned
 * somewhere in the file."
 *
 * QUALITY PROCESS: the AC3 anti-drift heuristic (reused from this file's
 * sibling suite) was validated against the CURRENT repo state before being
 * trusted — it initially false-flagged commands/setup.md (which legitimately
 * lists smoke/evidence-only as independent enum options, not a profile
 * mapping) until the "quick" token requirement was added to match the
 * normal/deep checks. See playbooks/__tests__/mission-tail-order.test.js
 * for that suite.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkFrankieEvidence } from '../lib/stop-gates.js';

const REPO_ROOT = join(__dirname, '..', '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function sectionAfter(content, headingPattern, stopPattern = /^#{1,3}\s/m) {
  const startIdx = content.search(headingPattern);
  if (startIdx === -1) return '';
  const afterHeadingLineIdx = content.indexOf('\n', startIdx) + 1;
  const stopRelIdx = content.slice(afterHeadingLineIdx).search(stopPattern);
  return stopRelIdx === -1
    ? content.slice(startIdx)
    : content.slice(startIdx, afterHeadingLineIdx + stopRelIdx);
}

let frankieMd;
let hannibalMd;
let tawniaMd;
let runMd;
let orchestrationLegacyMd;
let orchestrationNativeMd;

beforeAll(() => {
  frankieMd = read('agents/frankie.md');
  hannibalMd = read('agents/hannibal.md');
  tawniaMd = read('agents/tawnia.md');
  runMd = read('commands/run.md');
  orchestrationLegacyMd = read('playbooks/orchestration-legacy.md');
  orchestrationNativeMd = read('playbooks/orchestration-native.md');
});

// =============================================================================
// stop-gates.js (AC4) — the "repo-fact" fields (surfaces, qa.drive) that
// arm the Frankie evidence gate must NEVER be influenced by a mission's
// stored contract. This is a regression pin: today's checkFrankieEvidence
// only ever reads surfaces/qa.drive from ateam.config.json (verified by
// grep — it never touches testing_level/review_tier at all), and this test
// proves that stays true even when a scratch config ALSO carries
// testing_level/review_tier values that a naive migration might
// accidentally start consuming.
// =============================================================================

describe('stop-gates.js checkFrankieEvidence — repo-fact fields stay config-only (AC4)', () => {
  const scratchDirs = [];

  function scratch(opts = {}) {
    const { surfaces = ['hardware'], testingLevel, reviewTier } = opts;
    const dir = mkdtempSync(join(tmpdir(), 'ateam-wi942-'));
    scratchDirs.push(dir);
    const config = { surfaces };
    if (testingLevel !== undefined) config.testing_level = testingLevel;
    if (reviewTier !== undefined) config.review_tier = reviewTier;
    writeFileSync(join(dir, 'ateam.config.json'), JSON.stringify(config));
    return dir;
  }

  afterEach(() => {
    for (const dir of scratchDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  it('a non-drivable surface stays inert regardless of testing_level/review_tier present in config', () => {
    // 'hardware' is never drivable — this proves the gate's arming decision
    // depends only on `surfaces`, not on the presence of the other fields.
    const withoutContractFields = checkFrankieEvidence({
      missionId: 'M-TEST-001',
      stagedCount: 1,
      cwd: scratch({ surfaces: ['hardware'] }),
    });
    const withContractFields = checkFrankieEvidence({
      missionId: 'M-TEST-001',
      stagedCount: 1,
      cwd: scratch({ surfaces: ['hardware'], testingLevel: 'full-dod', reviewTier: 'auto' }),
    });
    expect(withoutContractFields).toBeNull();
    expect(withContractFields).toBeNull();
    expect(withContractFields).toBe(withoutContractFields);
  });

  it('a drivable surface arms the gate identically whether or not testing_level/review_tier are present', () => {
    const withoutContractFields = checkFrankieEvidence({
      missionId: 'M-TEST-001',
      stagedCount: 1,
      cwd: scratch({ surfaces: ['web'] }),
    });
    const withContractFields = checkFrankieEvidence({
      missionId: 'M-TEST-001',
      stagedCount: 1,
      cwd: scratch({ surfaces: ['web'], testingLevel: 'smoke', reviewTier: 'evidence-only' }),
    });
    // Both must block identically (same missing-evidence message content) —
    // the presence of testing_level/review_tier in config must not change
    // the gate's arming decision or message.
    expect(withoutContractFields).not.toBeNull();
    expect(withContractFields).not.toBeNull();
    expect(withContractFields).toBe(withoutContractFields);
  });
});

// =============================================================================
// agents/frankie.md — the "Reading the Execution Contract" bullet (AC1,
// AC2, AC3, AC4). This is the prose that must change, per the item's own
// context: from an unconditional "read ateam.config.json" to mission-first,
// config-fallback.
// =============================================================================

describe('agents/frankie.md — mission-first execution contract read (AC1, AC2)', () => {
  it('reads the MISSION contract first, not ateam.config.json unconditionally', () => {
    const bullet = sectionAfter(frankieMd, /- \*\*The execution contract\*\*/);
    expect(bullet).not.toBe('');
    // Must name the actual mission-contract fetch mechanism, not just the
    // word "mission" in passing (the WI-941 failure shape).
    expect(bullet).toMatch(/missions-current|getCurrentMission|resolveExecutionContract/);
  });

  it('falls back to ateam.config.json explicitly when the mission has none', () => {
    const bullet = sectionAfter(frankieMd, /- \*\*The execution contract\*\*/);
    expect(bullet).toMatch(/ateam\.config\.json/);
    expect(bullet).toMatch(/fallback|falls? back|no (stored )?contract|none/i);
  });

  it('the graduation table still reads testing_level "per Reading the Execution Contract" — inherits the mission-first fix automatically', () => {
    const table = sectionAfter(frankieMd, /## Spec Graduation Scope/m);
    expect(table).toMatch(/testing_level/);
    expect(table).toMatch(/Reading the Execution Contract/);
  });
});

describe('agents/frankie.md — resolver referenced, not restated (AC3)', () => {
  it('references the resolver rather than re-deriving contract-parsing rules', () => {
    const bullet = sectionAfter(frankieMd, /- \*\*The execution contract\*\*/);
    expect(bullet).toMatch(/qa-contract\.js|resolveExecutionContract|resolver/i);
  });
});

describe('agents/frankie.md — repo-fact fields and the review_tier exclusion are unchanged (AC4)', () => {
  it('surfaces, qa.seed, credential_env, and qa.drive still come from ateam.config.json', () => {
    const bullet = sectionAfter(frankieMd, /- \*\*The execution contract\*\*/);
    expect(bullet).toMatch(/surfaces/);
    expect(bullet).toMatch(/qa\.seed/);
    expect(bullet).toMatch(/credential_env/);
    expect(bullet).toMatch(/qa\.drive/);
  });

  it('review_tier remains explicitly excluded from Frankie\'s read (unchanged exclusion)', () => {
    const bullet = sectionAfter(frankieMd, /- \*\*The execution contract\*\*/);
    expect(bullet).toMatch(/review_tier/);
    expect(bullet).toMatch(/exclude|not (your|part of|relevant to) (the )?walk|deliberately/i);
  });
});

// =============================================================================
// agents/hannibal.md, agents/tawnia.md, commands/run.md — the review_tier
// naming seam (AC5). review_tier has ZERO runtime consumers today (verified
// by grep in the item's context) — this item makes it observable in the
// end-of-mission report. At least one of these three candidate seams must
// carry it; this test does not over-prescribe WHICH one.
// =============================================================================

describe('AC5: the end-of-mission report names the review tier as the operator\'s review step', () => {
  it('at least one of the candidate seams (tawnia.md, run.md, hannibal.md) names review_tier', () => {
    const files = { 'agents/tawnia.md': tawniaMd, 'commands/run.md': runMd, 'agents/hannibal.md': hannibalMd };
    const carriers = Object.entries(files).filter(([, content]) => /review_tier|review tier/i.test(content));
    expect(
      carriers.length,
      `expected at least one of tawnia.md/run.md/hannibal.md to name the review tier; found in: ${carriers.map(([f]) => f).join(', ') || 'none'}`
    ).toBeGreaterThan(0);
  });

  it('the naming states it comes from the mission contract when present, config when absent', () => {
    const files = [tawniaMd, runMd, hannibalMd];
    const carrierContent = files.find((c) => /review_tier|review tier/i.test(c));
    expect(carrierContent, 'expected to find the review_tier carrier file located by the previous test').toBeDefined();

    const idx = carrierContent.search(/review_tier|review tier/i);
    const window = carrierContent.slice(Math.max(0, idx - 200), idx + 400);
    expect(window).toMatch(/mission/i);
    expect(window).toMatch(/ateam\.config\.json|config/i);
  });

  it('tawnia.md names the concrete retrieval command (missions-current getCurrentMission), not just "the mission\'s contract"', () => {
    // board getBoard omits currentMission.executionContract — only the
    // missions/current route returns it. Without naming the concrete
    // command, Tawnia could read the board and silently fall back to
    // ateam.config.json, reporting the wrong review tier.
    expect(tawniaMd).toMatch(/missions-current\s+getCurrentMission/);

    const idx = tawniaMd.search(/review_tier|review tier/i);
    expect(idx).toBeGreaterThan(-1);
    const window = tawniaMd.slice(Math.max(0, idx - 400), idx + 400);
    expect(window).toMatch(/missions-current\s+getCurrentMission/);
  });

  it('does not restate what hands-on/evidence-only/auto mean beyond naming the resolved value', () => {
    // AC3 applies here too: naming the tier is fine, restating the full
    // enum's meaning (a mini-glossary) is not — that belongs to the
    // resolver/config docs alone.
    for (const [name, content] of [['agents/tawnia.md', tawniaMd], ['commands/run.md', runMd], ['agents/hannibal.md', hannibalMd]]) {
      const idx = content.search(/review_tier|review tier/i);
      if (idx === -1) continue;
      const window = content.slice(idx, idx + 400);
      const enumCount = ['hands-on', 'evidence-only', 'auto'].filter((v) => new RegExp(v, 'i').test(window)).length;
      expect(enumCount, `${name} appears to restate the review_tier enum's meaning near its review_tier mention`).toBeLessThan(2);
    }
  });
});

// =============================================================================
// Orchestration playbooks — the Frankie dispatch prompt template currently
// tells Frankie unconditionally to read "the execution contract from
// ateam.config.json"; it must become mission-first like frankie.md itself.
// =============================================================================

describe('both orchestration playbooks: Frankie dispatch prompt reads the mission contract first (AC1, AC2)', () => {
  // WI-941 FAILURE SHAPE, caught in THIS item's own first draft: an earlier
  // version of this test matched anywhere inside "## Frankie Mission-Tail
  // Dispatch" for "missions-current|getCurrentMission" — but that section
  // ALREADY contains an UNRELATED "ateam missions-current getCurrentMission
  // --json" call (fetching prdPath/missionId, nothing to do with the
  // execution contract), so the test passed vacuously against the
  // UNMODIFIED file. Scoped instead to the exact sentence inside the nested
  // Agent()/Task() prompt template that tells Frankie how to read the
  // contract — "Read the mission's DoD from the PRD and the execution
  // contract from ateam.config.json... graduate specs per the contract's
  // testing_level" — which is the literal prose that must change.
  it.each([
    ['playbooks/orchestration-legacy.md', () => orchestrationLegacyMd],
    ['playbooks/orchestration-native.md', () => orchestrationNativeMd],
  ])('%s\'s Frankie prompt template contract-reading sentence is mission-first', (_name, getContent) => {
    const content = getContent();
    const idx = content.search(/Read the mission's DoD from the PRD and the execution contract/);
    expect(idx, 'expected the Frankie prompt template\'s DoD+contract sentence').toBeGreaterThan(-1);
    const sentence = content.slice(idx, idx + 400);
    // The unmodified sentence reads "...execution contract from
    // ateam.config.json" with NOTHING about the mission's own stored
    // contract in between — require that specific gap to be filled.
    expect(sentence).toMatch(/mission'?s (stored |own )?(execution )?contract|missions-current|getCurrentMission|resolveExecutionContract/i);
    expect(sentence).toMatch(/ateam\.config\.json/);
  });
});
