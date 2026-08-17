/**
 * Tests for the shared execution-contract reader (WI-775).
 *
 * WI-799 flips the "this repo's own ateam.config.json" describe block below:
 * once a dedicated QA dev-server script gives Frankie a fresh, isolated
 * kanban-viewer to drive, this repo's real surfaces array declares 'web' and
 * canFrankieDrive() must return true -- a deliberate real-file read (not a
 * fixture) so this cannot silently regress back to an inert skip (AC8).
 *
 * readExecutionContract() parses the `execution-contract` fields
 * (surfaces, qa.seed, qa.account.credential_env, qa.drive, testing_level,
 * evidence, review_tier) out of <cwd>/ateam.config.json and returns a
 * fully-defaulted object -- never undefined, never throws, even when the
 * file is missing, malformed, or contains unrelated/drifted fields.
 *
 * canFrankieDrive(surfaces) answers "does this repo have a surface
 * Frankie can drive today" -- true only when 'web' is present. This is
 * deliberately narrow per PRD 010 section 2.5: FlowSpec ships a web
 * adapter only today; cli/conduit/api adapters are roadmap issues
 * (queso/FlowSpec#6/#7/#8), so every other surface returns false until
 * an adapter ships.
 *
 * The module lives at: scripts/hooks/lib/qa-contract.js
 *
 * Read pattern copied from packages/kanban-viewer/src/lib/token-cost.ts
 * loadPricingFromConfig() per the item's context notes: process.cwd()-
 * relative sync read, hand-rolled type guards, catch-all collapsing to
 * defaults, module-level cache with an exported reset for tests. Mocking
 * follows the same fs.readFileSync spy pattern as that module's own test
 * file (packages/kanban-viewer/src/__tests__/token-cost.test.ts).
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { readExecutionContract, canFrankieDrive, _resetQaContractCache } from '../lib/qa-contract.js';

/**
 * Mocks fs.readFileSync so any read of a path ending in ateam.config.json
 * returns `content`. Pass `content: null` to simulate the file being
 * absent (ENOENT). All other paths delegate to the real fs.
 */
function mockConfigFile(content) {
  // Captured BEFORE vi.spyOn installs the mock — the fallback branch below
  // must call this real implementation, not `fs.readFileSync` (which, once
  // spied, IS the mock itself; calling it from inside its own implementation
  // re-enters the spy and recurses to a stack overflow for any non-config
  // read).
  const originalReadFileSync = fs.readFileSync;
  vi.spyOn(fs, 'readFileSync').mockImplementation((filePath, ...rest) => {
    if (typeof filePath === 'string' && filePath.endsWith('ateam.config.json')) {
      if (content === null) {
        const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
        throw err;
      }
      return content;
    }
    return originalReadFileSync(filePath, ...rest);
  });
}

describe('mockConfigFile() test helper - fallback recursion (CodeRabbit PR #55)', () => {
  it('delegates non-config reads to the real fs.readFileSync instead of recursing into the spy', () => {
    mockConfigFile(JSON.stringify({ surfaces: ['web'] }));

    // Any file that does NOT end in ateam.config.json exercises the
    // fallback branch. Before the fix, the fallback called `fs.readFileSync`
    // — which, once spied, IS the mock — recursing until the stack blew
    // (RangeError: Maximum call stack size exceeded) instead of returning
    // the file's real content.
    const targetPath = path.join(process.cwd(), 'package.json');
    expect(() => fs.readFileSync(targetPath, 'utf-8')).not.toThrow();

    const content = fs.readFileSync(targetPath, 'utf-8');
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
  });
});

const ALL_DEFAULTS = {
  surfaces: [],
  qa: {
    seed: null,
    account: { credential_env: null },
    drive: 'flowspec',
  },
  testing_level: 'critical-path',
  evidence: { prd_work: null, default: 'screenshots' },
  review_tier: 'hands-on',
};

beforeEach(() => {
  _resetQaContractCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetQaContractCache();
});

describe('readExecutionContract() - full contract (PRD 010 section 2.1 example)', () => {
  it('returns every declared field when the config carries the full contract block', () => {
    mockConfigFile(
      JSON.stringify({
        surfaces: ['web'],
        qa: {
          seed: 'bun run seed:test',
          account: { credential_env: 'ATEAM_QA_PASSWORD' },
          drive: 'flowspec',
        },
        testing_level: 'critical-path',
        evidence: { prd_work: 'video+screenshots', default: 'screenshots' },
        review_tier: 'hands-on',
      })
    );

    const contract = readExecutionContract();

    expect(contract.surfaces).toEqual(['web']);
    expect(contract.qa.seed).toBe('bun run seed:test');
    expect(contract.qa.account.credential_env).toBe('ATEAM_QA_PASSWORD');
    expect(contract.qa.drive).toBe('flowspec');
    expect(contract.testing_level).toBe('critical-path');
    expect(contract.evidence.prd_work).toBe('video+screenshots');
    expect(contract.evidence.default).toBe('screenshots');
    expect(contract.review_tier).toBe('hands-on');
  });
});

describe('readExecutionContract() - no execution-contract fields present', () => {
  it('returns documented defaults rather than undefined, when the config has unrelated fields but no contract block', () => {
    mockConfigFile(JSON.stringify({ ateamCliVersion: 'latest', packageManager: 'bun' }));

    const contract = readExecutionContract();

    expect(contract).toEqual(ALL_DEFAULTS);
  });
});

describe('readExecutionContract() - partial contract', () => {
  it('preserves declared fields and defaults only the absent ones', () => {
    mockConfigFile(
      JSON.stringify({
        surfaces: ['fixture-flow'],
        review_tier: 'evidence-only',
      })
    );

    const contract = readExecutionContract();

    // Declared fields preserved
    expect(contract.surfaces).toEqual(['fixture-flow']);
    expect(contract.review_tier).toBe('evidence-only');

    // Absent fields still fall back to documented defaults
    expect(contract.qa.seed).toBeNull();
    expect(contract.qa.account.credential_env).toBeNull();
    expect(contract.qa.drive).toBe('flowspec');
    expect(contract.testing_level).toBe('critical-path');
    expect(contract.evidence.prd_work).toBeNull();
    expect(contract.evidence.default).toBe('screenshots');
  });

  it('preserves a nested qa.drive override without losing the qa.seed default', () => {
    mockConfigFile(JSON.stringify({ qa: { drive: 'golden-pair-diff' } }));

    const contract = readExecutionContract();

    expect(contract.qa.drive).toBe('golden-pair-diff');
    expect(contract.qa.seed).toBeNull();
    expect(contract.qa.account.credential_env).toBeNull();
  });
});

describe('readExecutionContract() - missing or malformed config', () => {
  it('returns the all-defaults contract and does not throw when ateam.config.json is absent', () => {
    mockConfigFile(null);

    expect(() => readExecutionContract()).not.toThrow();
    expect(readExecutionContract()).toEqual(ALL_DEFAULTS);
  });

  it('returns the all-defaults contract and does not throw when the file contains malformed JSON', () => {
    mockConfigFile('{ this is not valid json');

    expect(() => readExecutionContract()).not.toThrow();
    expect(readExecutionContract()).toEqual(ALL_DEFAULTS);
  });

  it('returns the all-defaults contract when the file parses to a non-object JSON value', () => {
    mockConfigFile('[]');

    expect(() => readExecutionContract()).not.toThrow();
    expect(readExecutionContract()).toEqual(ALL_DEFAULTS);
  });
});

describe('readExecutionContract() - unrecognised enum values', () => {
  it('falls back to the default testing_level and does not leak the invalid value through', () => {
    mockConfigFile(JSON.stringify({ surfaces: ['web'], testing_level: 'exhaustive' }));

    const contract = readExecutionContract();

    expect(contract.testing_level).toBe('critical-path');
    expect(contract.testing_level).not.toBe('exhaustive');
    // Confirms only the invalid field was reset, not the whole contract
    expect(contract.surfaces).toEqual(['web']);
  });

  it('falls back to the default review_tier and does not leak the invalid value through', () => {
    mockConfigFile(JSON.stringify({ surfaces: ['web'], review_tier: 'yolo' }));

    const contract = readExecutionContract();

    expect(contract.review_tier).toBe('hands-on');
    expect(contract.review_tier).not.toBe('yolo');
    expect(contract.surfaces).toEqual(['web']);
  });
});

describe('readExecutionContract() - surfaces enum validation (PRD 010 section 2.1, finding B4)', () => {
  /** Spies on stderr and silences it; returns the spy for warning asserts. */
  function spyStderr() {
    return vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  }

  it('passes all six PRD surface values through untouched, with no warning', () => {
    const stderrSpy = spyStderr();
    mockConfigFile(
      JSON.stringify({
        surfaces: ['web', 'api', 'fixture-flow', 'golden-pair', 'hardware', 'cli'],
      })
    );

    const contract = readExecutionContract();

    expect(contract.surfaces).toEqual([
      'web',
      'api',
      'fixture-flow',
      'golden-pair',
      'hardware',
      'cli',
    ]);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('drops a case-mistake like "Web" and warns naming the rejected value (case-sensitivity made obvious)', () => {
    const stderrSpy = spyStderr();
    mockConfigFile(JSON.stringify({ surfaces: ['Web'] }));

    const contract = readExecutionContract();

    expect(contract.surfaces).toEqual([]);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const warning = stderrSpy.mock.calls[0][0];
    expect(warning).toMatch(/"Web"/); // names the exact rejected spelling
    expect(warning).toMatch(/case-sensitive/i); // makes the case mistake obvious
    expect(warning).toMatch(/\bweb\b/); // the valid lowercase spelling is right there
  });

  it('keeps the valid values and drops only the invalid ones from a mixed list, warning names each rejected value', () => {
    const stderrSpy = spyStderr();
    mockConfigFile(JSON.stringify({ surfaces: ['Web', 'web', 'webapp', 'api'] }));

    const contract = readExecutionContract();

    expect(contract.surfaces).toEqual(['web', 'api']);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const warning = stderrSpy.mock.calls[0][0];
    expect(warning).toMatch(/"Web"/);
    expect(warning).toMatch(/"webapp"/);
    expect(warning).not.toMatch(/"api"/);
  });

  it('an all-invalid list collapses to [] and behaves exactly like an empty surfaces list (fail-inert)', () => {
    spyStderr();
    mockConfigFile(JSON.stringify({ surfaces: ['Web', 'desktop'] }));

    const contract = readExecutionContract();

    expect(contract.surfaces).toEqual([]);
    expect(canFrankieDrive(contract.surfaces, 'flowspec')).toBe(false);
  });

  it('keeps a valid string surface and drops a non-string entry from a mixed-type list, warning naming the non-string value (CodeRabbit: mixed types must not be silently dropped)', () => {
    const stderrSpy = spyStderr();
    mockConfigFile(JSON.stringify({ surfaces: ['web', 42] }));

    const contract = readExecutionContract();

    expect(contract.surfaces).toEqual(['web']);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const warning = stderrSpy.mock.calls[0][0];
    expect(warning).toMatch(/42/);
  });

  it('drops an all-non-string list to [] (not the whole-array-skip the old .every() guard produced), still warning', () => {
    const stderrSpy = spyStderr();
    mockConfigFile(JSON.stringify({ surfaces: [42] }));

    const contract = readExecutionContract();

    expect(contract.surfaces).toEqual([]);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const warning = stderrSpy.mock.calls[0][0];
    expect(warning).toMatch(/42/);
  });
});

describe('readExecutionContract() - tolerates malformed neighboring fields', () => {
  it('extracts contract fields correctly even when unrelated config fields are the wrong shape (drifted devServer)', () => {
    // Mirrors the real drift documented in adr/0001: packages/kanban-viewer's
    // own ateam.config.json has devServer as a bare string instead of an object.
    mockConfigFile(
      JSON.stringify({
        devServer: 'http://localhost:5566',
        pricing: 'not-an-object-either',
        surfaces: ['web'],
        review_tier: 'auto',
      })
    );

    expect(() => readExecutionContract()).not.toThrow();
    const contract = readExecutionContract();
    expect(contract.surfaces).toEqual(['web']);
    expect(contract.review_tier).toBe('auto');
  });
});

describe('canFrankieDrive() - drivability per surface (PRD 010 section 2.5: web-only today)', () => {
  it.each([
    ['web', true],
    ['api', false],
    ['fixture-flow', false],
    ['golden-pair', false],
    ['hardware', false],
    ['cli', false],
  ])('surfaces=[%s], drive=flowspec -> %s', (surface, expected) => {
    expect(canFrankieDrive([surface], 'flowspec')).toBe(expected);
  });

  it('returns false for an empty surfaces list', () => {
    expect(canFrankieDrive([], 'flowspec')).toBe(false);
  });

  it('returns false for an absent surfaces list', () => {
    expect(canFrankieDrive(undefined, 'flowspec')).toBe(false);
  });

  it('returns true when web is present alongside other surfaces', () => {
    expect(canFrankieDrive(['api', 'web', 'cli'], 'flowspec')).toBe(true);
  });
});

describe('canFrankieDrive() - driver support (CodeRabbit PR #55: qa.drive must be a SUPPORTED driver, not just any string)', () => {
  it('returns true for a drivable surface with the supported flowspec driver', () => {
    expect(canFrankieDrive(['web'], 'flowspec')).toBe(true);
  });

  it('returns false for a drivable surface paired with an unsupported custom driver', () => {
    expect(canFrankieDrive(['web'], 'selenium-custom')).toBe(false);
  });

  it('returns false for a non-drivable surface even with the supported driver', () => {
    expect(canFrankieDrive(['api'], 'flowspec')).toBe(false);
  });

  it('treats a missing/undefined drive as the DEFAULT_CONTRACT.qa.drive default (flowspec)', () => {
    expect(canFrankieDrive(['web'], undefined)).toBe(true);
    expect(canFrankieDrive(['web'])).toBe(true);
  });
});

describe("this repo's own ateam.config.json", () => {
  it('carries an execution-contract block whose every field parses into the reader shape', () => {
    // No fs mocking here -- this reads the real root ateam.config.json,
    // proving the reader's shape and this repo's own declared contract
    // agree (AC7).
    const contract = readExecutionContract();

    expect(Array.isArray(contract.surfaces)).toBe(true);
    expect(contract.qa.seed === null || typeof contract.qa.seed === 'string').toBe(true);
    expect(
      contract.qa.account.credential_env === null ||
        typeof contract.qa.account.credential_env === 'string'
    ).toBe(true);
    expect(typeof contract.qa.drive).toBe('string');

    expect(['smoke', 'critical-path', 'full-dod']).toContain(contract.testing_level);
    expect(['hands-on', 'evidence-only', 'auto']).toContain(contract.review_tier);
    expect(typeof contract.evidence.default).toBe('string');
  });

  it('declares a drivable surface (web), so Frankie can walk this repo (WI-799)', () => {
    // Deliberately reads the REAL ateam.config.json — no fs mocking in this
    // describe block — rather than an inline fixture. Per AC8/AC1: the
    // drivability check must fail the moment the real config regresses to
    // an empty (or missing) surfaces array, not just when a fixture says so.
    //
    // This repo previously declared surfaces: [] on purpose: the checked-in
    // kanban-viewer dev script hardcoded port 5566 (already held by a
    // long-running prod-copy Docker container) and ran `prisma migrate
    // deploy` against whatever DATABASE_URL resolved to -- so making 'web'
    // drivable would have forced every mission's Frankie walk to run against
    // a live prod-copy database instead of a safe, isolated one. WI-799
    // resolves that by giving Frankie a dedicated QA dev-server script that
    // starts fresh on its own port (5567) against a scratch database, so
    // declaring 'web' here no longer creates that hazard.
    const contract = readExecutionContract();

    expect(contract.surfaces).toContain('web');
    expect(canFrankieDrive(contract.surfaces, contract.qa.drive)).toBe(true);
  });
});

// ============================================================================
// WI-799 AC2/AC3/AC4/AC5/AC6/AC7: devServer is deliberately OUTSIDE
// qa-contract.js's scope (see the file docstring above and the module's own
// comment at scripts/hooks/lib/qa-contract.js line ~138), so these read the
// real target files directly rather than going through readExecutionContract().
// Added in response to Lynch's rejection: these ACs are testable using
// patterns already established in this repo (real-file reads, no fixtures)
// and should not be left uncovered.
// ============================================================================

describe("packages/kanban-viewer/package.json - 'dev:qa' script (WI-799 AC2/AC3/AC4)", () => {
  let scripts;

  beforeAll(() => {
    const pkgPath = path.join(process.cwd(), 'packages/kanban-viewer/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    scripts = pkg.scripts;
  });

  it('AC2: dev:qa exists and binds port 5567, not the hardcoded 5566 the existing dev script uses', () => {
    expect(scripts['dev:qa']).toBeDefined();
    expect(scripts['dev:qa']).toContain('--port 5567');
    expect(scripts['dev:qa']).not.toContain('--port 5566');
  });

  it('AC3: dev:qa resolves DATABASE_URL to a scratch qa.db, never ateam.db or prod.db', () => {
    expect(scripts['dev:qa']).toMatch(/qa\.db/);
    expect(scripts['dev:qa']).not.toMatch(/ateam\.db/);
    expect(scripts['dev:qa']).not.toMatch(/prod\.db/);
  });

  it('AC3: dev:qa removes the scratch database before migrating, so each run starts fresh', () => {
    const rmIndex = scripts['dev:qa'].indexOf('rm -f');
    const migrateIndex = scripts['dev:qa'].indexOf('migrate deploy');

    expect(rmIndex).toBeGreaterThan(-1);
    expect(migrateIndex).toBeGreaterThan(-1);
    expect(rmIndex).toBeLessThan(migrateIndex);
  });

  it('AC4: dev and dev:qa are constructed to never contend — disjoint ports, disjoint DATABASE_URL targets', () => {
    // Cross-checks BOTH scripts together (not just dev:qa in isolation) so a
    // future edit that moves `dev` off 5566, or moves `dev:qa` onto it,
    // fails here even if each script's own AC2/AC3 assertions still pass.
    expect(scripts['dev']).toContain('--port 5566');
    expect(scripts['dev']).not.toContain('--port 5567');
    expect(scripts['dev:qa']).toContain('--port 5567');
    expect(scripts['dev:qa']).not.toContain('--port 5566');
    expect(scripts['dev:qa']).not.toMatch(/ateam\.db|prod\.db/);
    // NOTE: this proves non-contention by construction (disjoint port +
    // disjoint DB target declared in the script strings). It does not start
    // a real server alongside the standing Docker container — that would be
    // a heavier, environment-dependent integration test; flagging as a
    // possible follow-up rather than attempting it here.
  });
});

describe('ateam.config.json - devServer block (WI-799 AC5)', () => {
  it('devServer targets the QA port, invokes dev:qa, and is pipeline-managed', () => {
    // devServer sits OUTSIDE the execution-contract block (qa-contract.js
    // deliberately never parses it — see the module's own comment) so this
    // reads the raw JSON directly instead of going through
    // readExecutionContract().
    const configPath = path.join(process.cwd(), 'ateam.config.json');
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    expect(raw.devServer.url).toBe('http://localhost:5567');
    expect(raw.devServer.start).toContain('dev:qa');
    expect(raw.devServer.managed).toBe(true);
  });
});

describe('agents/frankie.md - managed:true server lifecycle (WI-799 AC6)', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(path.join(process.cwd(), 'agents/frankie.md'), 'utf-8');
  });

  it('branches on devServer.managed and documents the managed:true start/poll/stop lifecycle', () => {
    expect(content).toMatch(/devServer\.managed/);

    const managedTrueIndex = content.indexOf('managed: true');
    expect(managedTrueIndex).toBeGreaterThan(-1);

    // Slice to just the managed:true bullet (ends at the next top-level
    // heading) so these assertions are scoped to that branch specifically,
    // not satisfied by unrelated "start"/"stop" prose elsewhere in the file.
    const nextHeadingIndex = content.indexOf('## Process', managedTrueIndex);
    const managedTrueSection = content.slice(
      managedTrueIndex,
      nextHeadingIndex > -1 ? nextHeadingIndex : undefined
    );

    expect(managedTrueSection).toMatch(/start it yourself/i);
    expect(managedTrueSection).toMatch(/devServer\.start/);
    expect(managedTrueSection).toMatch(/poll/i);
    expect(managedTrueSection).toMatch(/devServer\.url/);
    expect(managedTrueSection).toMatch(/[Ss]top the server/);
  });
});

describe('commands/setup.md and agents/amy.md - managed field documents both values (WI-799 AC7)', () => {
  it('commands/setup.md describes both managed:false and managed:true', () => {
    const content = fs.readFileSync(path.join(process.cwd(), 'commands/setup.md'), 'utf-8');

    expect(content).toMatch(/managed.*false.*(the default|human|standing process)/is);
    expect(content).toMatch(/managed.*true.*(pipeline owns|Frankie)/is);
  });

  it('agents/amy.md describes both managed:false and managed:true', () => {
    const content = fs.readFileSync(path.join(process.cwd(), 'agents/amy.md'), 'utf-8');

    expect(content).toMatch(/managed.*false.*(default|user manages)/is);
    expect(content).toMatch(/managed.*true.*(pipeline owns|Frankie)/is);
  });
});
