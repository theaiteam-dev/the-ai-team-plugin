/**
 * Tests for the shared execution-contract reader (WI-775).
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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readExecutionContract, canFrankieDrive, _resetQaContractCache } from '../lib/qa-contract.js';

/**
 * Mocks fs.readFileSync so any read of a path ending in ateam.config.json
 * returns `content`. Pass `content: null` to simulate the file being
 * absent (ENOENT). All other paths delegate to the real fs.
 */
function mockConfigFile(content) {
  vi.spyOn(fs, 'readFileSync').mockImplementation((filePath, ...rest) => {
    if (typeof filePath === 'string' && filePath.endsWith('ateam.config.json')) {
      if (content === null) {
        const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
        throw err;
      }
      return content;
    }
    return fs.readFileSync(filePath, ...rest);
  });
}

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
  ])('surfaces=[%s] -> %s', (surface, expected) => {
    expect(canFrankieDrive([surface])).toBe(expected);
  });

  it('returns false for an empty surfaces list', () => {
    expect(canFrankieDrive([])).toBe(false);
  });

  it('returns false for an absent surfaces list', () => {
    expect(canFrankieDrive(undefined)).toBe(false);
  });

  it('returns true when web is present alongside other surfaces', () => {
    expect(canFrankieDrive(['api', 'web', 'cli'])).toBe(true);
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

  it('declares no drivable surface, so Frankie never runs on this repo', () => {
    // This plugin repo's missions are CLI/prose work; the one web app it
    // contains (packages/kanban-viewer) is NOT a QA-drivable surface today:
    // there is no isolated QA seed (the kanban-viewer `seed` script writes
    // through DATABASE_URL to the same SQLite file the running container
    // uses for live mission tracking, and creates zero test fixtures), and
    // flowspec isn't installed here. Declaring `surfaces: ['web']` before
    // those exist would make Frankie mandatory on every mission in this repo
    // with nothing safe for him to drive -- the self-referential deadlock
    // agents/tawnia.md's precondition exemption and agents/face.md's
    // Project Readiness Audit exemption both describe. Flip this the day
    // this repo grows a real isolated QA seed; both prose surfaces name
    // this repo explicitly and must be updated with it.
    const contract = readExecutionContract();

    expect(contract.surfaces).toEqual([]);
    expect(canFrankieDrive(contract.surfaces)).toBe(false);
  });
});
