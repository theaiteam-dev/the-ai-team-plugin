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
import { canFrankieDrive, readExecutionContractFrom } from './qa-contract.js';

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
    postcheck: 'postcheck' in body ? body.postcheck : { passed: state === 'completed' },
  };
}

/**
 * Parses Stockwell's verdict marker out of the final review text.
 *
 * The playbooks standardize the verdict line as `VERDICT: FINAL APPROVED` /
 * `VERDICT: FINAL REJECTED` (playbooks/orchestration-*.md, agents/stockwell.md).
 * The last VERDICT line wins (a re-review appends below the original). When no
 * VERDICT line exists, a bare `FINAL APPROVED` / `FINAL REJECTED` marker is
 * honored only when exactly one of the two appears — anything else is
 * 'unknown', which callers must treat as "review complete" (fail open: an
 * unrecognized marker must never deadlock the mission tail).
 *
 * @param {unknown} review - The stored finalReview markdown.
 * @returns {'approved'|'rejected'|'unknown'}
 */
export function parseFinalReviewVerdict(review) {
  if (typeof review !== 'string') return 'unknown';

  const verdictLines = review.match(/VERDICT:\s*FINAL\s+(?:APPROVED|REJECTED)/gi);
  if (verdictLines && verdictLines.length > 0) {
    return /REJECTED/i.test(verdictLines[verdictLines.length - 1]) ? 'rejected' : 'approved';
  }

  const approved = /FINAL\s+APPROVED/i.test(review);
  const rejected = /FINAL\s+REJECTED/i.test(review);
  if (approved !== rejected) return approved ? 'approved' : 'rejected';
  return 'unknown';
}

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
    headers: { 'X-Project-ID': projectId },
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
    headers: { 'X-Project-ID': projectId },
  });
  if (!payload) return null;

  const mission = normalizeMission(payload);
  if (!mission || !mission.id || mission.final_review_verdict) return mission;

  // Review lookup is best-effort — fetchJsonOrNull's own fail-open (null on
  // timeout/error/non-2xx/bad JSON) leaves the verdict unset, which blocks
  // with an actionable "dispatch Stockwell" message rather than hanging or
  // crashing the hook.
  const reviewPayload = await fetchJsonOrNull(buildFinalReviewUrl(apiUrl, mission.id), {
    headers: { 'X-Project-ID': projectId },
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
    if (!canFrankieDrive(surfaces, drive)) return null;

    const reportPath = join(cwd, '.qa-evidence', missionId, 'report.md');
    if (!existsSync(reportPath)) {
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
 * @param {number} stagedCount
 * @param {{ finalReview?: unknown }} [options] - The mission's stored final
 *   review text (`final_review_verdict` on the normalized mission), used to
 *   diagnose the "review written but nothing promoted" case.
 * @returns {string|null} A block message, or null when nothing is staged.
 */
export function checkStagedNotPromoted(stagedCount, options = {}) {
  if (!(stagedCount > 0)) return null;

  const override = String(process.env.ATEAM_SKIP_PROMOTION_GATE || '')
    .trim()
    .toLowerCase();
  if (override === '1' || override === 'true') return null;

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
      `STOP: a final review has been written but its verdict could not be parsed, and ` +
      `${stagedCount} item(s) are still staged — promotion only runs on a FINAL APPROVED verdict ` +
      `(WI-790). Re-POST the review with a standard "VERDICT: FINAL APPROVED" / "VERDICT: FINAL ` +
      `REJECTED" line (ateam missions-final-review writeFinalReview). The mission cannot stop ` +
      `while items sit in staged. ${escape}`
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
