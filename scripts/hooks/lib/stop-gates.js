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
import { canFrankieDrive } from './qa-contract.js';

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
 * Fetches and normalizes the board. Returns null when the API is unreachable
 * or answers non-2xx — callers must treat null as "allow the stop".
 */
export async function fetchBoard(apiUrl, projectId) {
  const response = await fetch(buildBoardUrl(apiUrl), {
    headers: { 'X-Project-ID': projectId },
  });
  if (!response.ok) return null;
  return normalizeBoard(await response.json());
}

/**
 * Fetches and normalizes the current mission, backfilling the final review
 * report from its own route (the current-mission payload omits it).
 * Returns null when there is no active mission or the API answers non-2xx.
 */
export async function fetchMission(apiUrl, projectId) {
  const response = await fetch(buildMissionUrl(apiUrl), {
    headers: { 'X-Project-ID': projectId },
  });
  if (!response.ok) return null;

  const mission = normalizeMission(await response.json());
  if (!mission || !mission.id || mission.final_review_verdict) return mission;

  try {
    const reviewResponse = await fetch(buildFinalReviewUrl(apiUrl, mission.id), {
      headers: { 'X-Project-ID': projectId },
    });
    if (reviewResponse.ok) {
      const body = unwrapEnvelope(await reviewResponse.json());
      if (isPlainObject(body) && body.finalReview) {
        mission.final_review_verdict = body.finalReview;
      }
    }
  } catch {
    // Review lookup is best-effort — a failure leaves the verdict unset,
    // which blocks with an actionable "dispatch Stockwell" message rather
    // than crashing the hook.
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
 * Reads the declared `surfaces` from `<cwd>/ateam.config.json`, applying the
 * same guard as qa-contract.js's readExecutionContract() (an array of strings,
 * anything else collapses to `[]`).
 *
 * readExecutionContract() is bound to process.cwd() (and cached per process),
 * but the Frankie gate resolves its evidence path against the caller-supplied
 * `cwd` — resolving the contract against a DIFFERENT directory made the gate
 * incoherent (and forced tests to stub the reader). Everything the gate reads
 * now resolves against the same `cwd`. Drivability itself still comes from the
 * real canFrankieDrive() in qa-contract.js.
 */
function readSurfaces(cwd) {
  try {
    const raw = JSON.parse(readFileSync(join(cwd, 'ateam.config.json'), 'utf-8'));
    const surfaces = isPlainObject(raw) ? raw.surfaces : undefined;
    return Array.isArray(surfaces) && surfaces.every((s) => typeof s === 'string')
      ? surfaces
      : [];
  } catch {
    // Missing or malformed config — no declared surfaces, gate stays inert.
    return [];
  }
}

/**
 * The most recent transition timestamp derivable from a board column's item
 * list, in epoch ms. `completedAt` is the transition record when the API
 * provides it; `updatedAt` is the fallback. Returns null when no timestamp
 * is derivable — callers must skip the staleness check (fail open).
 *
 * WI-791: used against the `staged` column now, not `done` — items sit in
 * staged while awaiting Frankie's walk, so a staged item's last update IS
 * its move into staged (the moment the evidence bundle needs to postdate).
 */
function latestTransition(items) {
  if (!Array.isArray(items)) return null;
  let latest = null;
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    const ts = Date.parse(item.completedAt ?? item.updatedAt ?? '');
    if (Number.isFinite(ts) && (latest === null || ts > latest)) latest = ts;
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

    if (!canFrankieDrive(readSurfaces(cwd))) return null;

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
 * fact that promotion hasn't run yet).
 *
 * @param {number} stagedCount
 * @returns {string|null} A block message, or null when nothing is staged.
 */
export function checkStagedNotPromoted(stagedCount) {
  if (!(stagedCount > 0)) return null;
  return (
    `STOP: ${stagedCount} item(s) remain staged, not yet promoted to done. Promotion runs ` +
    `automatically inside the same transaction that persists Stockwell's Final Mission Review once ` +
    `its verdict is FINAL APPROVED — dispatch Stockwell if the review has not been written yet, or ` +
    `check the review's verdict if it has already been written. The mission cannot stop while items ` +
    `sit in staged.`
  );
}
