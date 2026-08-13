#!/usr/bin/env node
/**
 * qa-contract.js - Reads and normalizes the project execution contract
 * (surfaces, qa.*, testing_level, evidence, review_tier) from the repo's
 * ateam.config.json, and answers whether a repo has a surface Frankie can
 * drive today.
 *
 * Mirrors packages/kanban-viewer/src/lib/token-cost.ts's
 * loadPricingFromConfig(): a process.cwd()-relative synchronous read,
 * hand-rolled type guards, a catch-all that collapses to defaults, and a
 * module-level cache with an exported test-only reset.
 *
 * This is the EXECUTABLE definition of the new execution-contract fields
 * only (PRD 010 §2.1) — it does not parse or validate the rest of
 * ateam.config.json (`checks`, `devServer`, `precheck`, `postcheck`,
 * `packageManager`, `pricing`). token-cost.ts keeps its own reader for
 * `pricing`. See adr/0006-ateam-config-schema-deferred.md for why a
 * whole-config schema is deliberately out of scope here.
 */
import fs from 'fs';
import path from 'path';

/** Surfaces FlowSpec can drive today. Widen this the day an adapter ships
 * (queso/FlowSpec roadmap issues #6/#7/#8 for cli/conduit/api) — this
 * constant is the single place that decision lives. */
const DRIVABLE_SURFACES = ['web'];

const TESTING_LEVEL_VALUES = ['smoke', 'critical-path', 'full-dod'];
const REVIEW_TIER_VALUES = ['hands-on', 'evidence-only', 'auto'];

/**
 * The fully-defaulted execution contract, returned whenever a field is
 * absent, malformed, or the whole config file is missing/unreadable.
 */
const DEFAULT_CONTRACT = {
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

/**
 * Module-level cache for the execution contract loaded from
 * ateam.config.json.
 * null = not yet read this process; any other value = the resolved contract.
 */
let _cachedContract = null;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringOrDefault(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Field-by-field deep merge of the raw parsed config against
 * DEFAULT_CONTRACT — a partial declaration (e.g. only `qa.drive`) must not
 * wipe out sibling defaults (e.g. `qa.seed` stays null, not undefined).
 * Enum fields (`testing_level`, `review_tier`) fall back to their own
 * default independently when the declared value isn't recognized; sibling
 * fields are untouched. `qa.drive` is NOT an enum — any declared string
 * passes through unvalidated; it only defaults when absent.
 *
 * @param {unknown} raw - The parsed JSON contents of ateam.config.json (or
 *   null/anything on a read/parse failure).
 * @returns {object} A fully-defaulted execution contract.
 */
function normalizeContract(raw) {
  const root = isPlainObject(raw) ? raw : {};

  const surfaces =
    Array.isArray(root.surfaces) && root.surfaces.every((s) => typeof s === 'string')
      ? root.surfaces
      : DEFAULT_CONTRACT.surfaces;

  const qaRaw = isPlainObject(root.qa) ? root.qa : {};
  const accountRaw = isPlainObject(qaRaw.account) ? qaRaw.account : {};
  const qa = {
    seed: stringOrDefault(qaRaw.seed, DEFAULT_CONTRACT.qa.seed),
    account: {
      credential_env: stringOrDefault(
        accountRaw.credential_env,
        DEFAULT_CONTRACT.qa.account.credential_env
      ),
    },
    drive: stringOrDefault(qaRaw.drive, DEFAULT_CONTRACT.qa.drive),
  };

  const testing_level = TESTING_LEVEL_VALUES.includes(root.testing_level)
    ? root.testing_level
    : DEFAULT_CONTRACT.testing_level;

  const evidenceRaw = isPlainObject(root.evidence) ? root.evidence : {};
  const evidence = {
    prd_work: stringOrDefault(evidenceRaw.prd_work, DEFAULT_CONTRACT.evidence.prd_work),
    default: stringOrDefault(evidenceRaw.default, DEFAULT_CONTRACT.evidence.default),
  };

  const review_tier = REVIEW_TIER_VALUES.includes(root.review_tier)
    ? root.review_tier
    : DEFAULT_CONTRACT.review_tier;

  return { surfaces, qa, testing_level, evidence, review_tier };
}

/**
 * Reads and normalizes the execution contract from
 * <process.cwd()>/ateam.config.json.
 *
 * Never throws — a missing file, malformed JSON, or a non-object JSON
 * value all collapse to the all-defaults contract. Malformed fields
 * OUTSIDE the execution-contract block (e.g. `devServer` as a bare string,
 * per the known root-vs-kanban-viewer config drift in
 * adr/0001-token-usage-accounting.md) never affect contract extraction —
 * this reader only ever looks at `surfaces`, `qa`, `testing_level`,
 * `evidence`, and `review_tier`.
 *
 * Result is cached at module level so the file is read at most once per
 * process; call `_resetQaContractCache()` (tests only) to force a re-read.
 *
 * @returns {{
 *   surfaces: string[],
 *   qa: { seed: string|null, account: { credential_env: string|null }, drive: string },
 *   testing_level: string,
 *   evidence: { prd_work: string|null, default: string },
 *   review_tier: string,
 * }}
 */
export function readExecutionContract() {
  if (_cachedContract !== null) {
    return _cachedContract;
  }

  try {
    const configPath = path.join(process.cwd(), 'ateam.config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    _cachedContract = normalizeContract(parsed);
  } catch {
    _cachedContract = normalizeContract(null);
  }

  return _cachedContract;
}

/**
 * Answers "does this repo have a surface Frankie can drive today?"
 *
 * Deliberately narrow: FlowSpec (the default `qa.drive`) only runs `web`
 * today (PRD 010 §2.5) — `cli`, `conduit`, and `api` adapters are roadmap
 * issues (queso/FlowSpec #6/#7/#8). Any surface FlowSpec can't drive yet
 * returns false, so the mission-completion gate stays inert on those repos
 * instead of deadlocking them. This is the single place to widen when an
 * adapter ships.
 *
 * @param {string[]|undefined} surfaces - A contract's `surfaces` array
 *   (e.g. from `readExecutionContract().surfaces`).
 * @returns {boolean} true iff `surfaces` contains 'web'.
 */
export function canFrankieDrive(surfaces) {
  return Array.isArray(surfaces) && surfaces.some((s) => DRIVABLE_SURFACES.includes(s));
}

/**
 * Resets the module-level execution-contract cache.
 * Intended for use in tests only — do not call in production code.
 */
export function _resetQaContractCache() {
  _cachedContract = null;
}
