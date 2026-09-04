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

/** The six surfaces PRD 010 §2.1 enumerates. Matching is deliberately
 * case-sensitive to the PRD's lowercase spelling — "Web" is NOT "web". */
const SURFACE_VALUES = ['web', 'api', 'fixture-flow', 'golden-pair', 'hardware', 'cli'];

/** Drivers Frankie can actually run today. `qa.drive` is free-text (any
 * declared string passes normalizeContract() unvalidated — see
 * normalizeContract()'s docstring), but Frankie only ever executes FlowSpec
 * — an unrecognized custom driver must not arm the mission-completion gate,
 * since nobody could produce the FlowSpec evidence it would demand. Widen
 * this the day Frankie gains another driver — this constant is the single
 * place that decision lives. */
const SUPPORTED_DRIVERS = ['flowspec'];

const TESTING_LEVEL_VALUES = ['smoke', 'critical-path', 'full-dod'];
const REVIEW_TIER_VALUES = ['hands-on', 'evidence-only', 'auto'];

/**
 * WI-937: the three named quality profiles, mapped onto the EXISTING
 * TESTING_LEVEL_VALUES / REVIEW_TIER_VALUES enums above — no new knobs are
 * invented here (PRD FR-8, Out of Scope "New quality knobs"). This map is
 * the single place "what does 'quick' mean" is defined; every consumer
 * (agents, playbooks, hooks) resolves it via resolveQualityProfile() rather
 * than restating the bundle.
 *
 * `review_tier: 'auto'` is deliberately never a profile target here — it is
 * earned via the promotion ladder (commands/setup.md), not chosen at
 * kickoff. Only 'deep' carries `probing_guidance`: text Amy's probing pass
 * reads to go beyond the standard Raptor Protocol checks. 'quick' and
 * 'normal' omit the key entirely so every other profile gets the standard
 * probing pass with no special-casing at the call site.
 */
const QUALITY_PROFILES = {
  quick: {
    testing_level: 'smoke',
    review_tier: 'evidence-only',
  },
  normal: {
    testing_level: 'critical-path',
    review_tier: 'hands-on',
  },
  deep: {
    testing_level: 'full-dod',
    review_tier: 'hands-on',
    probing_guidance:
      'Go beyond the standard Raptor Protocol pass: actively probe boundary ' +
      'and off-by-one conditions, concurrent/race scenarios on any shared ' +
      'state, error paths and partial-failure recovery, and cross-feature ' +
      'interactions the tests do not exercise directly. Treat a clean run ' +
      'as insufficient evidence on its own — spend the extra scrutiny this ' +
      'profile was chosen for.',
  },
};

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

/**
 * Resolves a named quality profile ('quick' | 'normal' | 'deep') to its
 * bundle: `{ testing_level, review_tier, probing_guidance? }`. Pure name ->
 * value lookup — no fs access at all — used ONCE, at mission-creation time,
 * by whichever entry-point command computes what to stamp onto the
 * Mission record's executionContract (WI-934). Never used by hooks or by
 * the runtime "what's my effective contract" read — see
 * resolveExecutionContract() for that.
 *
 * Never silently falls back to a default: an unrecognized profile name
 * (a typo, an empty string, undefined) throws rather than guessing, per
 * FR-8's "fails loudly" requirement.
 *
 * @param {string} profileName - 'quick' | 'normal' | 'deep'.
 * @returns {{ testing_level: string, review_tier: string, probing_guidance?: string }}
 * @throws {Error} when profileName is not one of the three known profiles.
 */
export function resolveQualityProfile(profileName) {
  const bundle = QUALITY_PROFILES[profileName];
  if (!bundle) {
    throw new Error(
      `Unknown quality profile ${JSON.stringify(profileName)} — must be one of: quick, normal, deep`
    );
  }
  // Return a copy, not the shared module-level object, so a caller mutating
  // the result can never corrupt QUALITY_PROFILES for the next resolve.
  return { ...bundle };
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
 * fields are untouched. `surfaces` entries are filtered against the PRD's
 * six-value enum: unknown entries are dropped with a stderr warning, valid
 * siblings survive. `qa.drive` is NOT an enum — any declared string
 * passes through unvalidated; it only defaults when absent.
 *
 * @param {unknown} raw - The parsed JSON contents of ateam.config.json (or
 *   null/anything on a read/parse failure).
 * @returns {object} A fully-defaulted execution contract.
 */
function normalizeContract(raw) {
  const root = isPlainObject(raw) ? raw : {};

  let surfaces = DEFAULT_CONTRACT.surfaces;
  if (Array.isArray(root.surfaces)) {
    // Unknown values are DROPPED (fail-inert: canFrankieDrive() stays false
    // rather than the gate firing on a surface nobody can drive), but never
    // silently — a typo like "Web" would otherwise disable the mission gate
    // with no diagnostic at all. The warning names each rejected value and
    // the valid set, so a case mistake is obvious at a glance. This applies
    // regardless of the rejected entry's type — SURFACE_VALUES.includes()
    // is false (not a throw) for a non-string entry like `42`, so a mixed
    // list e.g. ["web", 42] keeps the valid `web` and warns about `42`
    // instead of dropping the whole array because one sibling was the wrong
    // type.
    const rejected = root.surfaces.filter((s) => !SURFACE_VALUES.includes(s));
    if (rejected.length > 0) {
      process.stderr.write(
        `qa-contract: dropping unknown surfaces value(s) ${rejected
          .map((s) => JSON.stringify(s))
          .join(', ')} — valid (case-sensitive, lowercase): ${SURFACE_VALUES.join(', ')}\n`
      );
    }
    surfaces = root.surfaces.filter((s) => SURFACE_VALUES.includes(s));
  }

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
 * `<cwd>/ateam.config.json` — the cwd-parameterized reader every caller
 * that resolves the contract against a directory OTHER than process.cwd()
 * must use (scripts/hooks/lib/stop-gates.js's Frankie gate resolves both
 * the contract and the evidence path against a caller-supplied cwd).
 *
 * Sharing normalizeContract() is the point: a second hand-rolled parser
 * would inevitably drift from this one's rules (it did — the gate's private
 * reader collapsed the WHOLE surfaces array to [] on a single non-string
 * entry, silently disarming the mission-completion gate where this one drops
 * the bad entry, warns on stderr, and keeps its valid siblings).
 *
 * Never throws and is NOT cached — each call re-reads the file, since the
 * cwd can differ between calls. Use readExecutionContract() for the cached,
 * process.cwd()-bound read.
 *
 * @param {string} cwd - Directory containing ateam.config.json.
 * @returns {ReturnType<typeof normalizeContract>}
 */
export function readExecutionContractFrom(cwd) {
  try {
    const configPath = path.join(cwd, 'ateam.config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    return normalizeContract(JSON.parse(raw));
  } catch {
    return normalizeContract(null);
  }
}

/**
 * WI-937 / FR-9: the runtime "what's my effective execution contract" read,
 * preferring a mission's own stored contract over the repo's
 * ateam.config.json. Stays synchronous like the rest of this module (ADR
 * 0008) — the mission's contract is supplied by the CALLER (agents and
 * playbooks already shell out to `ateam missions-current getCurrentMission
 * --json`), never fetched inside this function.
 *
 * `missionContract` wins ONLY for testing_level/review_tier, and ONLY when
 * both are present as strings — WI-934's Mission.executionContract never
 * stores anything else (surfaces/qa/evidence always come from config
 * either way). Anything else — undefined, null, or a malformed object
 * missing either field — falls back to config unchanged, fail-inert like
 * every other read in this module.
 *
 * Does NOT touch or replace readExecutionContract() / readExecutionContractFrom(cwd)
 * — hooks with no mission contract to give keep calling those exactly as
 * before; this is reused underneath, not duplicated.
 *
 * @param {{testing_level?: unknown, review_tier?: unknown}|null|undefined} missionContract
 *   - A mission's stored executionContract (WI-934), or absent/malformed.
 * @param {string} [cwd] - Directory containing ateam.config.json, mirroring
 *   readExecutionContractFrom(cwd)'s parameterization.
 * @returns {ReturnType<typeof normalizeContract>}
 */
export function resolveExecutionContract(missionContract, cwd = process.cwd()) {
  const configContract = readExecutionContractFrom(cwd);

  const hasMissionContract =
    isPlainObject(missionContract) &&
    typeof missionContract.testing_level === 'string' &&
    typeof missionContract.review_tier === 'string';

  if (!hasMissionContract) {
    return configContract;
  }

  return {
    ...configContract,
    testing_level: missionContract.testing_level,
    review_tier: missionContract.review_tier,
  };
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

  _cachedContract = readExecutionContractFrom(process.cwd());

  return _cachedContract;
}

/**
 * Answers "does this repo have a surface Frankie can drive today?"
 *
 * Deliberately narrow on TWO axes, both of which must hold:
 *
 *   1. Surface: FlowSpec (the default `qa.drive`) only runs `web` today
 *      (PRD 010 §2.5) — `cli`, `conduit`, and `api` adapters are roadmap
 *      issues (queso/FlowSpec #6/#7/#8).
 *   2. Driver: `qa.drive` is free-text — normalizeContract() lets any
 *      declared string through unvalidated — but Frankie only ever runs
 *      FlowSpec. An unrecognized custom driver (e.g. "selenium-custom")
 *      must not arm the mission-completion gate, since nobody could
 *      produce the FlowSpec evidence it would then demand.
 *
 * A missing/undefined `drive` is treated as DEFAULT_CONTRACT.qa.drive
 * ('flowspec') — every real caller passes the normalized contract's
 * `qa.drive`, which is never actually undefined (normalizeContract()
 * defaults it), so this only matters for callers that omit the argument
 * entirely. Either axis failing returns false, so the mission-completion
 * gate stays inert on those repos instead of deadlocking them. This is the
 * single place to widen when an adapter ships or another driver is
 * supported.
 *
 * @param {string[]|undefined} surfaces - A contract's `surfaces` array
 *   (e.g. from `readExecutionContract().surfaces`).
 * @param {string|undefined} drive - A contract's `qa.drive` string (e.g.
 *   from `readExecutionContract().qa.drive`). Callers should pass this
 *   explicitly rather than relying on the undefined-defaults-to-flowspec
 *   fallback.
 * @returns {boolean} true iff `surfaces` contains 'web' AND `drive` is a
 *   supported driver.
 */
export function canFrankieDrive(surfaces, drive) {
  const hasDrivableSurface = Array.isArray(surfaces) && surfaces.some((s) => DRIVABLE_SURFACES.includes(s));
  const resolvedDrive = drive === undefined ? DEFAULT_CONTRACT.qa.drive : drive;
  return hasDrivableSurface && SUPPORTED_DRIVERS.includes(resolvedDrive);
}

/**
 * Answers "is the DECLARED driver actually installed and runnable in this repo?"
 *
 * canFrankieDrive() only checks the driver NAME is one Frankie supports — it
 * cannot see whether that driver can execute. A repo can declare
 * `qa.drive: "flowspec"` on a `web` surface and never install flowspec, which
 * arms the mission-completion gate against a driver that cannot run (retro
 * M-20260821-002, `qa-driver-declared-but-not-executable`, "FlowSpec armed the
 * gate while unable to run at all"). A supported driver is executable iff its
 * CLI resolves at `<cwd>/node_modules/.bin/<driver>` — exactly what
 * `bunx <driver>` or a package.json script would invoke.
 *
 * An unsupported driver is never "executable-as-a-supported-driver" even if a
 * same-named binary happens to exist. Never throws; an unreadable/absent repo
 * dir returns false (fail-inert, like every other axis here).
 *
 * @param {string|undefined} drive - a contract's `qa.drive` (undefined defaults
 *   to DEFAULT_CONTRACT.qa.drive, matching canFrankieDrive()).
 * @param {string} [cwd] - repo root to resolve the driver binary against.
 * @returns {boolean}
 */
export function isDriverExecutable(drive, cwd = process.cwd()) {
  const resolved = drive === undefined ? DEFAULT_CONTRACT.qa.drive : drive;
  if (!SUPPORTED_DRIVERS.includes(resolved)) {
    return false;
  }
  try {
    return fs.existsSync(path.join(cwd, 'node_modules', '.bin', resolved));
  } catch {
    return false;
  }
}

/**
 * Three-state arming for the mission-completion gate, so a drivable repo whose
 * driver cannot run is neither silently ARMED (a tail deadlock demanding
 * evidence a broken driver can't produce) nor silently SKIPPED (a web app
 * shipping with no QA walk at all — the failure mode of just returning false):
 *
 *   'inert'          — no drivable surface, or an unsupported driver name.
 *                      The gate stays off (equivalent to canFrankieDrive() false).
 *   'driver-missing' — a drivable surface with a supported driver DECLARED, but
 *                      that driver is not installed/executable here. The caller
 *                      surfaces this specifically instead of arming blind.
 *   'armed'          — drivable surface AND the declared driver is executable.
 *
 * @param {string[]|undefined} surfaces
 * @param {string|undefined} drive
 * @param {string} [cwd]
 * @returns {'inert'|'driver-missing'|'armed'}
 */
export function frankieDriveReadiness(surfaces, drive, cwd = process.cwd()) {
  if (!canFrankieDrive(surfaces, drive)) {
    return 'inert';
  }
  return isDriverExecutable(drive, cwd) ? 'armed' : 'driver-missing';
}

/**
 * Resets the module-level execution-contract cache.
 * Intended for use in tests only — do not call in production code.
 */
export function _resetQaContractCache() {
  _cachedContract = null;
}
