#!/usr/bin/env node
/**
 * stop-gates.js - Shared mission-completion gate logic for Hannibal's two
 * Stop hooks.
 *
 * Hannibal is gated by two near-identical hooks depending on how he is run:
 *
 *   - enforce-final-review.js      — bound via agents/hannibal.md frontmatter,
 *                                    so it only fires for SUBAGENT sessions.
 *   - enforce-orchestrator-stop.js — registered plugin-wide in hooks/hooks.json,
 *                                    so it fires for the MAIN session, which is
 *                                    where Hannibal actually runs.
 *
 * Keeping the gates in one module is what stops a mandatory check from
 * landing in only one of them (as the Frankie evidence gate originally did,
 * leaving the primary execution mode ungated).
 *
 * API shape note
 * --------------
 * The A(i)-Team API is flat and keyed by the `X-Project-ID` header —
 * `/api/board` and `/api/missions/current`. There is no
 * `/api/projects/:id/board`; requests to it 404, and a 404 fails open. The
 * URL builders below are the single place those routes are spelled out.
 *
 * Responses are `{ success, data }` envelopes, and the board returns a flat
 * `items[]` list keyed by `stageId` — not the `columns` map the gate logic
 * (and the __TEST_MOCK_* fixtures) speak. normalizeBoard/normalizeMission
 * adapt at the fetch boundary so the gates below see one shape only.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { frankieDriveReadiness, readExecutionContractFrom } from './qa-contract.js';
import { apiEventHeaders } from './observer.js';
// ONE copy of the verdict rule, shared with the promotion API. These hooks are
// ESM and resolve this specifier against their own file path, and
// packages/shared is `"type": "module"` with a COMMITTED dist/ — so the built
// module imports directly, with no generated mirror to drift. See
// packages/shared/src/final-review-verdict.ts for the rule itself.
import { parseFinalReviewVerdict } from '../../../packages/shared/dist/final-review-verdict.js';

/** Stages that mean a mission still has work in flight. */
export const ACTIVE_STAGES = [
  'briefings',
  'ready',
  'testing',
  'implementing',
  'review',
  'probing',
  'blocked',
];

function trimTrailingSlash(apiUrl) {
  return String(apiUrl || '').replace(/\/+$/, '');
}

/**
 * Board URL. `includeCompleted=true` is mandatory: /api/board excludes `done`
 * items by default, so without it the done count is always 0 and every
 * mission-completion gate downstream stays silent.
 */
export function buildBoardUrl(apiUrl) {
  return `${trimTrailingSlash(apiUrl)}/api/board?includeCompleted=true`;
}

export function buildMissionUrl(apiUrl) {
  return `${trimTrailingSlash(apiUrl)}/api/missions/current`;
}

/**
 * The current-mission payload does not carry the final review report; it
 * lives on the mission record and is served by its own route.
 */
export function buildFinalReviewUrl(apiUrl, missionId) {
  return `${trimTrailingSlash(apiUrl)}/api/missions/${encodeURIComponent(missionId)}/final-review`;
}

/**
 * Items belonging to ONE mission.
 *
 * /api/board is project-wide: it cannot tell a staged item of the mission in
 * flight from a staged leftover of a force-ended earlier one. Promotion,
 * however, only ever clears the CURRENT mission's items (the final-review
 * route scopes its sweep through the MissionItem join), so gating on the
 * project-wide staged set blocks every future stop on an item no promotion
 * will ever touch. `?missionId=` applies the same join server-side.
 */
export function buildItemsUrl(apiUrl, missionId) {
  return `${trimTrailingSlash(apiUrl)}/api/items?missionId=${encodeURIComponent(missionId)}`;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Unwraps a `{ success, data }` API envelope. Payloads that are already the
 * inner object (test mocks) pass through untouched.
 */
function unwrapEnvelope(payload) {
  if (isPlainObject(payload) && 'data' in payload && 'success' in payload) {
    return payload.data;
  }
  return payload;
}

/**
 * Normalizes a board payload to `{ columns: { <stageId>: item[] } }`.
 *
 * Accepts either the real API envelope (a flat `items[]` list keyed by
 * `stageId`) or an already-column-shaped object. Anything unrecognized
 * collapses to empty columns rather than throwing — adversity must not trap
 * the operator.
 *
 * @returns {{ columns: Record<string, unknown[]> }}
 */
export function normalizeBoard(payload) {
  const body = unwrapEnvelope(payload);

  if (isPlainObject(body) && isPlainObject(body.columns)) {
    return { columns: body.columns };
  }

  const items = isPlainObject(body) && Array.isArray(body.items) ? body.items : [];
  const columns = {};
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    const stage = item.stageId || item.stage;
    if (typeof stage !== 'string') continue;
    (columns[stage] ||= []).push(item);
  }

  return { columns };
}

/**
 * Normalizes a mission payload to the shape the gates read.
 *
 * `final_review_verdict` and `postcheck` are the internal names; on the real
 * API they are the mission's `finalReview` markdown and its lifecycle state
 * (POST /api/missions/postcheck moves a mission to `completed` on pass and
 * `failed` otherwise). Already-normalized payloads keep their own values.
 *
 * `postcheck` is NOT synthesized from the mission state. It used to be
 * (`{ passed: state === 'completed' }`), and because the current-mission
 * payload has never carried a `postcheck` key, that turned the post-check
 * gate into a pure mission-state check that passed with zero evidence a
 * post-check ever ran — and, before the current-mission route learned to
 * prefer the ACTIVE mission, a stale completed mission from a PREVIOUS run
 * could satisfy it for the mission actually in flight. An absent key is now
 * `null`, which the post-check gate reads as "not passed" (fail closed).
 * The mission lifecycle is what releases that gate instead — see
 * checkPostcheck() for the full end-of-mission sequence.
 *
 * @returns {{ id: string|null, state: string|null, final_review_verdict: unknown, postcheck: unknown }|null}
 */
export function normalizeMission(payload) {
  const body = unwrapEnvelope(payload);
  if (!isPlainObject(body)) return null;

  const state = typeof body.state === 'string' ? body.state : null;

  return {
    id: typeof body.id === 'string' ? body.id : null,
    state,
    final_review_verdict:
      'final_review_verdict' in body ? body.final_review_verdict : (body.finalReview ?? null),
    postcheck: 'postcheck' in body ? body.postcheck : null,
  };
}

/**
 * Re-exported so every Stop-gate consumer (and this module's own tests) reads
 * the verdict through one import. The implementation lives in
 * packages/shared/src/final-review-verdict.ts and is shared verbatim with the
 * promotion API — the Stop gates and the transaction that promotes staged
 * items to done can never disagree about the same report text, because there
 * is no second copy to disagree with.
 *
 * The rule in one line: the verdict is the report's LAST non-empty line, or
 * 'unknown'. 'unknown' fails CLOSED here — see checkUnparseableVerdict().
 */
export { parseFinalReviewVerdict };

/**
 * The trailer every block message points the operator back at. Spelled once
 * so the hooks, agents/stockwell.md, and the playbooks stay literally
 * identical.
 */
const TRAILER_REQUIREMENT =
  `The report's LAST line must be exactly "VERDICT: FINAL APPROVED" or "VERDICT: FINAL REJECTED" ` +
  `(optionally bolded) — nothing may follow it. Re-POST the review with the verdict as the final ` +
  `line: ateam missions-final-review writeFinalReview.`;

/**
 * Gate: an explicit FINAL REJECTED verdict must not fall through to the
 * post-check gate ("run postcheck" would misdirect the operator). Instead the
 * stop blocks with the ADR 0004 restart-at-Frankie path. Approved and
 * unrecognized reviews return null — the pre-existing gates apply unchanged.
 *
 * @param {unknown} review - The mission's final_review_verdict text.
 * @returns {string|null} A block message, or null to fall through.
 */
export function checkFinalReviewRejection(review) {
  if (parseFinalReviewVerdict(review) !== 'rejected') return null;
  return (
    `STOP: Stockwell's Final Mission Review verdict is FINAL REJECTED. Do NOT run post-checks ` +
    `and do NOT dispatch Tawnia. For each item Stockwell named, move it out of staged to testing ` +
    `or implementing using the earliest-flagged-stage rule (WI-794) — a real, rejection-cap-counted ` +
    `transition, not a manual reopen (done is terminal, ADR 0005; items here are still in staged, ` +
    `never done). Once every named item is reworked and back in staged, the mission tail RESTARTS ` +
    `at Frankie (ADR 0004): he re-walks the FULL Definition of Done before Stockwell re-reviews, so ` +
    `the evidence bundle always reflects the final code.`
  );
}

/**
 * Fetches JSON from `url` with a hard timeout — the single place every
 * board/mission/final-review request in this module routes through, so an
 * unreachable or merely slow API fails open (resolves null) instead of
 * stalling the Stop hook indefinitely or rejecting out from under its
 * caller (fetch() alone has no timeout and, without a catch, an unreachable
 * host either hangs the hook or crashes it — the opposite of the documented
 * fail-open contract every gate in this module relies on).
 *
 * Returns null — never throws — on a non-2xx response, a timeout, a
 * connection error, or a body that isn't valid JSON.
 *
 * @param {string} url
 * @param {RequestInit} [opts] - Forwarded to fetch() verbatim (headers,
 *   etc.); `signal` is added internally and must not be passed by the
 *   caller.
 * @param {number} [timeoutMs]
 * @returns {Promise<unknown|null>}
 */
async function fetchJsonOrNull(url, opts = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...opts, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches and normalizes the board. Returns null when the API is unreachable,
 * times out, or answers non-2xx — callers must treat null as "allow the
 * stop".
 */
export async function fetchBoard(apiUrl, projectId) {
  const payload = await fetchJsonOrNull(buildBoardUrl(apiUrl), {
    headers: apiEventHeaders(projectId),
  });
  if (!payload) return null;
  return normalizeBoard(payload);
}

/**
 * Fetches and normalizes the current mission, backfilling the final review
 * report from its own route (the current-mission payload omits it).
 * Returns null when there is no active mission or the API is unreachable,
 * times out, or answers non-2xx.
 */
export async function fetchMission(apiUrl, projectId) {
  const payload = await fetchJsonOrNull(buildMissionUrl(apiUrl), {
    headers: apiEventHeaders(projectId),
  });
  if (!payload) return null;

  const mission = normalizeMission(payload);
  if (!mission || !mission.id || mission.final_review_verdict) return mission;

  // Review lookup is best-effort — fetchJsonOrNull's own fail-open (null on
  // timeout/error/non-2xx/bad JSON) leaves the verdict unset, which blocks
  // with an actionable "dispatch Stockwell" message rather than hanging or
  // crashing the hook.
  const reviewPayload = await fetchJsonOrNull(buildFinalReviewUrl(apiUrl, mission.id), {
    headers: apiEventHeaders(projectId),
  });
  if (reviewPayload) {
    const body = unwrapEnvelope(reviewPayload);
    if (isPlainObject(body) && body.finalReview) {
      mission.final_review_verdict = body.finalReview;
    }
  }

  return mission;
}

/**
 * Fetches the item list for ONE mission (via `/api/items?missionId=`) and
 * normalizes it to a plain array.
 *
 * Returns null — never throws — when the API is unreachable, answers non-2xx,
 * or the payload isn't a list. Callers must read null as "mission membership
 * is unknown" and fall back to the project-wide board view (fail closed:
 * keep gating on everything rather than silently gating on nothing).
 *
 * @returns {Promise<unknown[]|null>}
 */
export async function fetchMissionItems(apiUrl, projectId, missionId) {
  if (!missionId) return null;

  const payload = await fetchJsonOrNull(buildItemsUrl(apiUrl, missionId), {
    headers: apiEventHeaders(projectId),
  });
  if (!payload) return null;

  const body = unwrapEnvelope(payload);
  if (Array.isArray(body)) return body;
  if (isPlainObject(body) && Array.isArray(body.items)) return body.items;
  return null;
}

/**
 * Splits the board's terminal columns into "belongs to the current mission"
 * and "orphaned" sets.
 *
 * WHY: `stagedCount` used to come straight off /api/board, which is
 * project-wide. A single orphaned staged item — created while no mission was
 * current, or stranded by a force-ended previous mission — blocked EVERY
 * future stop with advice ("re-POST the final review to trigger promotion")
 * that could never work: promotion only sweeps the current mission's items,
 * so nothing would ever clear it. The same mismatch fed a stale-evidence
 * verdict into checkFrankieEvidence, since an orphan's work-log timestamps
 * were compared against THIS mission's bundle.
 *
 * FAIL-CLOSED FALLBACK: when `missionItems` is null (API unreachable, an API
 * server too old to honor `?missionId=`) or empty (a mission with no linked
 * items — nothing to scope against), the project-wide board view is returned
 * unchanged with `scoped: false`. Scoping may only ever REMOVE items from the
 * gated set when we positively know which items the mission owns.
 *
 * @param {Record<string, unknown[]>} columns - normalizeBoard()'s columns.
 * @param {unknown[]|null} missionItems - fetchMissionItems() output.
 * @returns {{ scoped: boolean, stagedItems: unknown[], stagedCount: number, doneCount: number, orphanStagedIds: string[] }}
 */
export function scopeBoardToMission(columns, missionItems) {
  const cols = isPlainObject(columns) ? columns : {};
  const boardStaged = Array.isArray(cols.staged) ? cols.staged : [];
  const boardDone = Array.isArray(cols.done) ? cols.done : [];

  const known = Array.isArray(missionItems)
    ? missionItems
        .filter((item) => isPlainObject(item) && typeof item.id === 'string')
        .map((item) => item.id)
    : [];

  if (known.length === 0) {
    return {
      scoped: false,
      stagedItems: boardStaged,
      stagedCount: boardStaged.length,
      doneCount: boardDone.length,
      orphanStagedIds: [],
    };
  }

  const ids = new Set(known);
  const belongs = (item) => isPlainObject(item) && ids.has(item.id);
  const stagedItems = boardStaged.filter(belongs);

  return {
    scoped: true,
    stagedItems,
    stagedCount: stagedItems.length,
    doneCount: boardDone.filter(belongs).length,
    orphanStagedIds: boardStaged
      .filter((item) => !belongs(item))
      .map((item) => (isPlainObject(item) && typeof item.id === 'string' ? item.id : '?'))
      .filter((id) => id !== '?'),
  };
}

/**
 * Counts items sitting in stages that mean work is still in flight.
 *
 * WI-791: `staged` is deliberately NOT an ACTIVE_STAGES entry — it is a
 * holding pen between Amy's probing and the mission-tail promotion to done
 * (WI-790), not in-flight pipeline work. Folding it into totalActive would
 * make the "totalActive > 0 → block" check swallow an all-staged board with
 * the generic "items still active" message instead of the correct
 * Frankie-evidence / not-yet-promoted diagnosis. stagedCount is reported as
 * its own independent field instead, alongside totalActive and doneCount.
 *
 * @returns {{ activeCounts: Record<string, number>, totalActive: number, doneCount: number, stagedCount: number }}
 */
export function countBoard(columns) {
  const cols = isPlainObject(columns) ? columns : {};
  const activeCounts = {};
  let totalActive = 0;

  for (const stage of ACTIVE_STAGES) {
    const count = Array.isArray(cols[stage]) ? cols[stage].length : 0;
    if (count > 0) {
      activeCounts[stage] = count;
      totalActive += count;
    }
  }

  return {
    activeCounts,
    totalActive,
    doneCount: Array.isArray(cols.done) ? cols.done.length : 0,
    stagedCount: Array.isArray(cols.staged) ? cols.staged.length : 0,
  };
}

/**
 * Reads the declared `surfaces` and `qa.drive` for the Frankie gate.
 *
 * Delegates to qa-contract.js's readExecutionContractFrom(cwd) so there is
 * EXACTLY ONE parse rule for ateam.config.json's execution-contract block.
 * This module used to hand-roll a second, stricter parser here: a single
 * non-string entry (`["web", 42]`) collapsed the whole `surfaces` array to
 * `[]` with no diagnostic, which silently disarmed the mission-completion
 * gate — while normalizeContract() drops only the bad entry, warns on
 * stderr, and keeps the valid siblings. Two parsers meant two answers to
 * the same question; there is now one.
 *
 * readExecutionContract() is bound to process.cwd() (and cached per
 * process), but the Frankie gate resolves its evidence path against the
 * caller-supplied `cwd` — resolving the contract against a DIFFERENT
 * directory made the gate incoherent (and forced tests to stub the reader),
 * which is why the cwd-parameterized reader exists. Everything the gate
 * reads resolves against the same `cwd`. Drivability itself still comes
 * from the real canFrankieDrive() in qa-contract.js.
 */
function readSurfacesAndDrive(cwd) {
  const contract = readExecutionContractFrom(cwd);
  return { surfaces: contract.surfaces, drive: contract.qa.drive };
}

/**
 * Coerces a timestamp field (ISO string, epoch number, or Date) to epoch ms,
 * or null when it carries no usable value. Empty strings are rejected here
 * rather than by the caller: `completedAt ?? updatedAt` only falls back on
 * null/undefined, so an item with `completedAt: ''` would otherwise resolve
 * to `''` — Date.parse('') is NaN — silently dropping that item's timestamp
 * instead of falling back to its (possibly fresh) `updatedAt`, letting a
 * stale pre-rework evidence report satisfy the staleness check.
 */
function toEpochMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A board item's work-log entries, under whichever key the payload uses:
 * the API's ItemWithRelations shape says `workLogs`, CLAUDE.md's work-item
 * documentation (and the CLI's rendering) says `work_log`.
 */
function workLogEntries(item) {
  for (const key of ['workLogs', 'work_log', 'workLog']) {
    if (Array.isArray(item[key])) return item[key];
  }
  return [];
}

/**
 * The moment an item TRANSITIONED INTO `staged`, in epoch ms, or null when
 * no work-log entry records it.
 *
 * `updatedAt` is NOT that moment: Prisma stamps it via `@updatedAt` on every
 * write, so any incidental touch after the walk (a title edit, an
 * assignedAgent clear, a work-log-less board-move) would postdate a
 * perfectly valid evidence bundle and force a full DoD re-walk. The stage
 * change itself is recorded as a work-log entry — Amy's `completed` entry is
 * what advances probing → staged (POST /api/agents/stop writes the entry in
 * the same transaction as the stage update), so the newest `completed` entry
 * on an item currently sitting in staged IS its transition into staged.
 * Annotations (`note`) are deliberately ignored.
 *
 * `tail_rework` entries are NOT ignored, even though they move an item OUT of
 * staged. An item currently sitting in staged whose newest `tail_rework`
 * POSTDATES its newest `completed` was pulled out after Frankie's walk and put
 * back by a board-move that wrote no `completed` entry (WI-794's mission-tail
 * rework path) — so the newest `completed` is the PRE-rework transition, and
 * honoring it would let a pre-rework (stale) evidence bundle satisfy the gate
 * forever. In that state the tail_rework timestamp is the newest evidence we
 * have that the item left staged, so it becomes the transition time: the
 * bundle must postdate the rework. `updatedAt` is deliberately still not
 * consulted — that is the @updatedAt churn this function exists to avoid, and
 * re-walking after a rework already clears the gate.
 */
function stagedTransitionAt(item) {
  let latestCompleted = null;
  let latestRework = null;

  for (const entry of workLogEntries(item)) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.action !== 'string') continue;
    const action = entry.action.toLowerCase();
    if (action !== 'completed' && action !== 'tail_rework') continue;
    const ts = toEpochMs(entry.timestamp);
    if (ts === null) continue;
    if (action === 'completed') {
      if (latestCompleted === null || ts > latestCompleted) latestCompleted = ts;
    } else if (latestRework === null || ts > latestRework) {
      latestRework = ts;
    }
  }

  // Re-entry into staged went unrecorded (no `completed` after the rework):
  // the rework itself is the newest transition the log can prove.
  if (latestRework !== null && (latestCompleted === null || latestRework > latestCompleted)) {
    return latestRework;
  }
  return latestCompleted;
}

/**
 * The most recent transition-into-staged timestamp derivable from a board
 * column's item list, in epoch ms. Returns null when no timestamp is
 * derivable — callers must skip the staleness check (fail open).
 *
 * Per item, the work-log-derived transition wins; `completedAt`/`updatedAt`
 * are the fallback for items whose payload carries no work log at all (a
 * board fetched without relations, or an item whose stage change predates
 * work-log recording). Picks the first NON-EMPTY of `completedAt`/`updatedAt`
 * rather than `completedAt ?? item.updatedAt` — see toEpochMs().
 *
 * WI-791: used against the `staged` column now, not `done` — items sit in
 * staged while awaiting Frankie's walk, so the moment they entered staged is
 * what the evidence bundle needs to postdate.
 */
function latestTransition(items) {
  if (!Array.isArray(items)) return null;
  let latest = null;
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    const fromWorkLog = stagedTransitionAt(item);
    const ts =
      fromWorkLog !== null
        ? fromWorkLog
        : [item.completedAt, item.updatedAt].map(toEpochMs).find((value) => value !== null) ?? null;
    if (ts !== null && (latest === null || ts > latest)) latest = ts;
  }
  return latest;
}

/**
 * Frankie's mission-tail walk precedes Stockwell's Final Mission Review: on a
 * repo with a drivable surface, the mission cannot end until his evidence
 * bundle exists on disk — and that bundle must be trustworthy:
 *
 *   1. Missing report → block (dispatch Frankie).
 *   2. Report older than the newest staged transition → block (STALE: rework
 *      happened after the walk; ADR 0004 requires a FULL DoD re-walk so the
 *      evidence always reflects the final code).
 *   3. Report containing failing (❌) DoD statements → block (Frankie's walk
 *      FAILED; do not dispatch Stockwell).
 *
 * WI-791: keyed on `stagedCount`/`stagedItems`, not `doneCount`/`doneItems` —
 * items sit in `staged` awaiting the walk (done now only happens via WI-790's
 * atomic promotion, gated behind Stockwell's approved review — by which point
 * the walk has already happened and been evidenced against the staged
 * transition).
 *
 * Unlike every other check in these hooks, this one keys off a LOCAL
 * filesystem condition, so adversity that has nothing to do with mission
 * progress (no Playwright headless shell, no flowspec, dev server down) could
 * otherwise trap the operator. Two safety valves prevent that, and they cover
 * ALL three checks: any thrown error (unreadable report included) fails open,
 * and `ATEAM_SKIP_FRANKIE_GATE=1` overrides the gate — an override named in
 * each block message itself so it is discoverable from inside the trap. The
 * staleness check additionally fails open when the board items carry no
 * usable timestamp.
 *
 * @param {{ missionId: string|null|undefined, stagedCount: number, stagedItems?: unknown[], cwd?: string }} args
 * @returns {string|null} A block message, or null to allow the stop.
 */
export function checkFrankieEvidence({ missionId, stagedCount, stagedItems = [], cwd = process.cwd() }) {
  try {
    const override = String(process.env.ATEAM_SKIP_FRANKIE_GATE || '')
      .trim()
      .toLowerCase();
    if (override === '1' || override === 'true') return null;

    // Only reached once every pipeline stage is genuinely empty — callers
    // check the active count first. No mission id means no path to check
    // evidence against, which is itself unexpected: fail open rather than
    // block on an unresolvable path.
    if (!missionId || !(stagedCount > 0)) return null;

    const { surfaces, drive } = readSurfacesAndDrive(cwd);
    const readiness = frankieDriveReadiness(surfaces, drive, cwd);
    // 'inert' — no drivable surface / unsupported driver: gate stays off.
    if (readiness === 'inert') return null;

    const reportPath = join(cwd, '.qa-evidence', missionId, 'report.md');
    if (!existsSync(reportPath)) {
      // 'driver-missing' — the surface is drivable and the driver is DECLARED,
      // but it is not installed/executable here. Arming blind (the generic
      // "evidence missing" message below) sent the operator chasing a walk the
      // declared driver could never run (retro M-20260821-002). Name the driver
      // and the actual remedy instead.
      if (readiness === 'driver-missing') {
        return (
          `STOP: this repo declares a drivable surface with qa.drive='${drive}', but that driver ` +
          `is not installed/executable here (no node_modules/.bin/${drive}). The mission-completion ` +
          `gate armed against a QA driver that cannot run, so Frankie cannot produce the DoD walk it ` +
          `demands. Install '${drive}' in the target repo, correct qa.drive in ateam.config.json, or ` +
          `if this environment intentionally has no driver re-run with ATEAM_SKIP_FRANKIE_GATE=1 to ` +
          `override this gate.`
        );
      }
      return (
        `STOP: Frankie's evidence bundle is missing. ` +
        `Expected: .qa-evidence/${missionId}/report.md. ` +
        `Dispatch Frankie to walk the mission DoD before the Final Mission Review can proceed. ` +
        `If Frankie cannot run in this environment (no Playwright headless shell, no flowspec, ` +
        `dev server unavailable), re-run with ATEAM_SKIP_FRANKIE_GATE=1 to override this gate.`
      );
    }

    // Staleness: a pre-rework report must not satisfy the gate forever. If
    // the newest staged transition postdates the report, items were reworked
    // after the walk — ADR 0004 requires a full re-walk.
    const latestStaged = latestTransition(stagedItems);
    if (latestStaged !== null && statSync(reportPath).mtimeMs < latestStaged) {
      return (
        `STOP: Frankie's evidence bundle is STALE. ` +
        `.qa-evidence/${missionId}/report.md predates the most recent staged transition, so items ` +
        `were reworked after the walk. Dispatch Frankie to re-walk the FULL Definition of Done ` +
        `(every statement, not only previous failures — ADR 0004) so the evidence reflects the ` +
        `final code before the Final Mission Review. ` +
        `If this gate is wrong for this environment, re-run with ATEAM_SKIP_FRANKIE_GATE=1 to override it.`
      );
    }

    // Failed walk: the report's checklist marks each DoD statement ✅/❌.
    // Any ❌ means the walk FAILED — evidence of failure must not read as
    // evidence of completion.
    if (readFileSync(reportPath, 'utf-8').includes('❌')) {
      return (
        `STOP: Frankie's walk FAILED. ` +
        `.qa-evidence/${missionId}/report.md contains failing (❌) Definition of Done statements. ` +
        `Do NOT dispatch Stockwell for the Final Mission Review. For each failing item, move it out ` +
        `of staged to testing or implementing using the earliest-flagged-stage rule (WI-794) — a ` +
        `real, rejection-cap-counted transition, not a manual reopen (done is terminal, ADR 0005; ` +
        `items here are still in staged, never done). Once the named items are reworked and back in ` +
        `staged, dispatch Frankie to re-walk the FULL Definition of Done. ` +
        `If this gate is wrong for this environment, re-run with ATEAM_SKIP_FRANKIE_GATE=1 to override it.`
      );
    }

    return null;
  } catch {
    // Config unreadable, report unreadable, filesystem unavailable, anything
    // else — fail open, matching every other check in these hooks.
    return null;
  }
}

/**
 * WI-791 AC2: items sitting in `staged` have not been promoted to `done`
 * yet, and the Stop hooks themselves never promote anything — promotion
 * only happens inside WI-790's atomic transaction, triggered when Stockwell
 * writes a FINAL APPROVED Final Mission Review. So a mission with items
 * still sitting in staged must not be allowed to end even once Frankie's
 * evidence gate has cleared: an all-staged board must never be mistaken for
 * an empty (no-mission) board.
 *
 * Unlike checkFrankieEvidence, this is a plain board-state fact — it has
 * nothing to do with the local filesystem or environment, so it is
 * unconditional on `stagedCount > 0` and is NOT covered by
 * `ATEAM_SKIP_FRANKIE_GATE` (that override documents itself as suppressing
 * only the Frankie-specific evidence sub-check, not the more fundamental
 * fact that promotion hasn't run yet). It has its OWN override,
 * `ATEAM_SKIP_PROMOTION_GATE=1`, and the separation is deliberate: skipping
 * a walk nobody can drive is a different decision from declaring a mission
 * finished with items the API never promoted.
 *
 * The override exists because this gate CAN otherwise trap an operator
 * forever: an API server that predates WI-790's promotion transaction (or a
 * review whose verdict marker parses as 'unknown') leaves items in staged
 * permanently, and no amount of orchestration will clear them. The message
 * names the override and, when a review has already been written, the exact
 * situation the operator is in — so the way out is visible from inside the
 * trap, exactly as checkFrankieEvidence does.
 *
 * `stagedCount` MUST be scoped to the current mission (see
 * scopeBoardToMission): promotion only sweeps the current mission's items, so
 * a project-wide count lets one orphaned staged item block every future stop
 * with advice that can never work. Orphans are reported through
 * `options.orphanStagedIds` instead — named, with a remediation that actually
 * clears them, and only ever appended to a block this mission's OWN staged
 * items already earned.
 *
 * @param {number} stagedCount - Mission-scoped count of staged items.
 * @param {{ finalReview?: unknown, orphanStagedIds?: string[] }} [options] -
 *   The mission's stored final review text (`final_review_verdict` on the
 *   normalized mission), used to diagnose the "review written but nothing
 *   promoted" case, plus any staged item ids that do NOT belong to this
 *   mission.
 * @returns {string|null} A block message, or null when nothing is staged.
 */
export function checkStagedNotPromoted(stagedCount, options = {}) {
  if (!(stagedCount > 0)) return null;

  const override = String(process.env.ATEAM_SKIP_PROMOTION_GATE || '')
    .trim()
    .toLowerCase();
  if (override === '1' || override === 'true') return null;

  const message = stagedNotPromotedMessage(stagedCount, options);
  const orphans = Array.isArray(options.orphanStagedIds) ? options.orphanStagedIds : [];
  if (orphans.length === 0) return message;

  return (
    `${message} NOTE: ${orphans.length} additional staged item(s) do NOT belong to this mission ` +
    `(${orphans.join(', ')}) and are NOT what is blocking it — promotion only ever sweeps this ` +
    `mission's items, so no review can clear them. Retire each one directly: ` +
    `ateam board-move moveItem --itemId <id> --toStage done (staged -> done is a legal ` +
    `transition), or archive it so it leaves the board.`
  );
}

function stagedNotPromotedMessage(stagedCount, options) {
  const review = options.finalReview;
  const hasReview = typeof review === 'string' && review.trim() !== '';
  const escape =
    `If promotion cannot run in this environment, re-run with ATEAM_SKIP_PROMOTION_GATE=1 to ` +
    `override this gate.`;

  if (hasReview) {
    const verdict = parseFinalReviewVerdict(review);

    if (verdict === 'approved') {
      return (
        `STOP: an APPROVED final review exists but ${stagedCount} item(s) are still staged — your ` +
        `API may predate WI-790 promotion (promotion runs inside the same transaction that ` +
        `persists a FINAL APPROVED review, so an approved review should have left nothing in ` +
        `staged). Re-POST the final review (ateam missions-final-review writeFinalReview) to ` +
        `trigger promotion, or set ATEAM_SKIP_PROMOTION_GATE=1 to override this gate. The mission ` +
        `cannot stop while items sit in staged.`
      );
    }

    if (verdict === 'rejected') {
      return (
        `STOP: the final review is FINAL REJECTED and ${stagedCount} item(s) are still staged, so ` +
        `nothing was promoted to done. Rework the items the review named (move each out of staged ` +
        `to testing or implementing, earliest-flagged-stage rule, WI-794), then restart the ` +
        `mission tail. The mission cannot stop while items sit in staged. ${escape}`
      );
    }

    return (
      `STOP: a final review has been written but it states no verdict, and ${stagedCount} item(s) ` +
      `are still staged — promotion only runs on a FINAL APPROVED verdict (WI-790). ` +
      `${TRAILER_REQUIREMENT} The mission cannot stop while items sit in staged. ${escape}`
    );
  }

  return (
    `STOP: ${stagedCount} item(s) remain staged, not yet promoted to done. Promotion runs ` +
    `automatically inside the same transaction that persists Stockwell's Final Mission Review once ` +
    `its verdict is FINAL APPROVED — dispatch Stockwell if the review has not been written yet, or ` +
    `check the review's verdict if it has already been written. The mission cannot stop while items ` +
    `sit in staged. ${escape}`
  );
}

/**
 * FIX B / fail-closed: a staged item that belongs to NO mission item is not
 * something to drop on the floor.
 *
 * scopeBoardToMission() exists so the promotion gate's counts and messages
 * describe the CURRENT mission — promotion only ever sweeps this mission's
 * items, so "re-POST the review" can never clear a straggler from a
 * force-ended earlier run. That scoping was right for the *message*, and wrong
 * as a *release*: with the mission's own staged count at 0, every gate went
 * quiet and the hook emitted {} on the FIRST stop. Board staged=[WI-1] with no
 * MissionItem link and mission items=[WI-99] ended the session with an
 * unexplained item sitting in staged forever — strictly worse than the
 * project-wide count it replaced, which at least blocked.
 *
 * So orphans now BLOCK in their own right, named, with the three remediations
 * that actually clear them. Unlike "re-POST the review", each of these is
 * something the operator can do, which is what makes this a recoverable block
 * rather than a trap. It shares ATEAM_SKIP_PROMOTION_GATE with
 * checkStagedNotPromoted — both answer the same question ("may this mission
 * end with items still sitting in staged?"), so one override covers both, and
 * the message says so.
 *
 * Deliberately NOT released by the stop_hook_active re-entry guard: attaching,
 * moving, or archiving an orphan is always available, so this gate cannot
 * deadlock the way the promotion gate can.
 *
 * @param {string[]|undefined} orphanStagedIds - Staged board items with no
 *   MissionItem link to the current mission (scopeBoardToMission output).
 * @returns {string|null} A block message, or null when there are no orphans.
 */
export function checkOrphanStagedItems(orphanStagedIds) {
  const orphans = Array.isArray(orphanStagedIds) ? orphanStagedIds.filter(Boolean) : [];
  if (orphans.length === 0) return null;

  const override = String(process.env.ATEAM_SKIP_PROMOTION_GATE || '')
    .trim()
    .toLowerCase();
  if (override === '1' || override === 'true') return null;

  return (
    `STOP: ${orphans.length} staged item(s) belong to NO mission — ${orphans.join(', ')}. ` +
    `They are on the board in 'staged' but carry no MissionItem link to the current mission, so ` +
    `no final review will ever promote them and no agent will ever pick them up. An unexplained ` +
    `staged item is never silently ignored. Resolve each one: attach it to this mission (so the ` +
    `tail covers it), move it back into the pipeline with ` +
    `'ateam board-move moveItem --itemId <id> --toStage <testing|implementing|ready>' so it can ` +
    `finish, or archive it so it leaves the board. If this is deliberate and the mission must end ` +
    `anyway, re-run with ATEAM_SKIP_PROMOTION_GATE=1 — the same override that releases the ` +
    `staged-not-promoted gate.`
  );
}

/**
 * Gate: a review has been written but its verdict is not readable.
 *
 * 'unknown' means the report does not STATE a verdict in the one place the
 * verdict is read from (its last line) — see
 * packages/shared/src/final-review-verdict.ts. That is not "review complete":
 * the promotion transaction promotes nothing on an unknown verdict, so
 * treating it as complete would end a mission with an unreviewed board and
 * items that were never promoted.
 *
 * It is also always satisfiable — Stockwell (or Hannibal) re-POSTs the same
 * report with the verdict as its final line — so this blocks unconditionally,
 * including under the stop_hook_active re-entry guard.
 *
 * @param {unknown} review - The mission's final_review_verdict text.
 * @returns {string|null} A block message, or null to fall through.
 */
export function checkUnparseableVerdict(review) {
  if (typeof review !== 'string' || review.trim() === '') return null;
  if (parseFinalReviewVerdict(review) !== 'unknown') return null;

  return (
    `STOP: a Final Mission Review has been written but it states no verdict, so nothing was ` +
    `promoted and the mission's outcome is unknown. ${TRAILER_REQUIREMENT}`
  );
}

/**
 * Mission lifecycle states that mean the mission is OVER.
 *
 * `completed` is set by exactly one writer — POST /api/missions/postcheck with
 * `passed: true` — and `failed` by the same route with `passed: false`.
 * `archived` is the mission being closed out. Nothing else in the API writes
 * these values, so reaching one is a fact about THIS mission's lifecycle, not
 * a guess.
 */
export const MISSION_OVER_STATES = ['completed', 'failed', 'archived'];

/**
 * Is this mission still in flight?
 *
 * A missing/unrecognized state answers TRUE (still active) on purpose: the
 * gates below block while a mission is active, so an unknown state must fail
 * CLOSED, not silently release the end-of-mission gates.
 */
export function isMissionActiveState(state) {
  return !(typeof state === 'string' && MISSION_OVER_STATES.includes(state));
}

/**
 * Gate: items have finished the per-item pipeline (staged and/or done) but
 * Stockwell has not written a Final Mission Review.
 *
 * Keyed on `stagedCount + doneCount`, NOT doneCount alone. Nothing reaches
 * `done` except through WI-790's promotion, which only runs when an APPROVED
 * review is persisted — so a board whose items are all staged has doneCount
 * 0 BY CONSTRUCTION, and a doneCount-keyed gate could never fire on the exact
 * board that needs it. Combined with the stop_hook_active re-entry release on
 * checkStagedNotPromoted (the one gate that can be unsatisfiable), that let a
 * mission end in two ordinary stops with no review and no post-check: stop #1
 * blocked on the staged gate, stop #2 skipped it and found every downstream
 * gate keyed on a doneCount of 0.
 *
 * @param {{ pendingCount: number, finalReview: unknown }} args
 * @returns {string|null} A block message, or null to fall through.
 */
export function checkMissingFinalReview({ pendingCount, finalReview }) {
  if (!(pendingCount > 0)) return null;
  if (finalReview) return null;

  return (
    `STOP: ${pendingCount} item(s) have finished the per-item pipeline (staged/done) but Stockwell ` +
    `has not completed the Final Mission Review. Dispatch Stockwell for the Final Mission Review ` +
    `before ending the mission.`
  );
}

/**
 * Gate: the Final Mission Review is APPROVED, but post-checks have not passed.
 *
 * INDEPENDENT OF BOARD CONTENTS (FIX C). This gate used to require
 * `pendingCount > 0` — a count of the mission's staged + done board items.
 * That precondition is exactly wrong at the moment the gate matters: once an
 * APPROVED review promotes every staged item to done (WI-790) and those items
 * are archived, the board is empty, pendingCount is 0, and the gate went
 * silent. The post-check never ran, the mission stayed `running` forever, and
 * every subsequent POST /api/missions 409'd until somebody discovered
 * `force: true`. Whether a post-check is owed is a fact about the MISSION, not
 * about how many cards happen to be on the board, so nothing here reads the
 * board.
 *
 * THE KEY: an APPROVED verdict exists AND this mission has not recorded a
 * post-check pass. A rejected verdict is handled upstream by
 * checkFinalReviewRejection (post-checks must not run at all), and an unknown
 * verdict by checkUnparseableVerdict — neither reaches this gate, and neither
 * owes a post-check.
 *
 * "RECORDED A PASS" = mission state `completed`. POST /api/missions/postcheck
 * is the SOLE writer of that state (`passed: true` -> `completed`,
 * `passed: false` -> `failed`), and it refuses to run unless the mission is
 * `running` — so `completed` is positive evidence a post-check ran and passed,
 * and it cannot be reached any other way. GET /api/missions/current keeps
 * returning the just-finished mission (its tier-2 fallback), which is what
 * lets the end-of-mission stop through.
 *
 * `postcheck.passed === true` in the mission payload is also honored, and is
 * still fail-closed: only an affirmative `true` counts, never any truthy
 * value. On the real API that key has never existed (see normalizeMission), so
 * in production it is always the mission state that releases this gate; the
 * field is read for normalized/test payloads that carry explicit evidence.
 *
 * `failed` and `archived` release it too — not as evidence of a pass, but
 * because the mission lifecycle is OVER and a post-check can never be re-run
 * on either (the route requires `running`). Blocking there would be an
 * unclearable trap; a failed post-check is Hannibal's to report to the human.
 * The board-fact gates above (active items, Frankie evidence, staged not
 * promoted, orphaned staged items, missing review, unparseable verdict) keep
 * enforcing regardless of mission state, so an over state can never end a
 * mission with unpromoted or unexplained items.
 *
 * @param {{ finalReview: unknown, postcheck: unknown, missionState: unknown }} args
 * @returns {string|null} A block message, or null to fall through.
 */
export function checkPostcheck({ finalReview, postcheck, missionState }) {
  if (parseFinalReviewVerdict(finalReview) !== 'approved') return null;
  if (isPlainObject(postcheck) && postcheck.passed === true) return null;
  if (!isMissionActiveState(missionState)) return null;

  return (
    `STOP: the Final Mission Review is FINAL APPROVED but post-checks have not passed. ` +
    `Run ateam missions-postcheck (lint, unit, e2e) — the mission cannot end until it reports ` +
    `passed, and nothing on this mission records a passing post-check yet. This is a fact about ` +
    `the MISSION, not the board: an empty board (items promoted and archived) does not mean the ` +
    `post-check ran.`
  );
}
