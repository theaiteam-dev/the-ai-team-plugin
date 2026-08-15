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

import { existsSync } from 'fs';
import { join } from 'path';
import { readExecutionContract, canFrankieDrive } from './qa-contract.js';

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
 * @returns {{ activeCounts: Record<string, number>, totalActive: number, doneCount: number }}
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
  };
}

/**
 * Frankie's mission-tail walk precedes Stockwell's Final Mission Review: on a
 * repo with a drivable surface, the mission cannot end until his evidence
 * bundle exists on disk.
 *
 * Unlike every other check in these hooks, this one keys off a LOCAL
 * filesystem condition, so adversity that has nothing to do with mission
 * progress (no Playwright headless shell, no flowspec, dev server down) could
 * otherwise trap the operator. Two safety valves prevent that: any thrown
 * error fails open, and `ATEAM_SKIP_FRANKIE_GATE=1` overrides the gate — an
 * override named in the block message itself so it is discoverable from
 * inside the trap.
 *
 * @param {{ missionId: string|null|undefined, doneCount: number, cwd?: string }} args
 * @returns {string|null} A block message, or null to allow the stop.
 */
export function checkFrankieEvidence({ missionId, doneCount, cwd = process.cwd() }) {
  try {
    const override = String(process.env.ATEAM_SKIP_FRANKIE_GATE || '')
      .trim()
      .toLowerCase();
    if (override === '1' || override === 'true') return null;

    // Only reached once every item is genuinely done — callers check the
    // active count first. No mission id means no path to check evidence
    // against, which is itself unexpected: fail open rather than block on an
    // unresolvable path.
    if (!missionId || !(doneCount > 0)) return null;

    if (!canFrankieDrive(readExecutionContract().surfaces)) return null;

    if (existsSync(join(cwd, '.qa-evidence', missionId, 'report.md'))) return null;

    return (
      `STOP: Frankie's evidence bundle is missing. ` +
      `Expected: .qa-evidence/${missionId}/report.md. ` +
      `Dispatch Frankie to walk the mission DoD before the Final Mission Review can proceed. ` +
      `If Frankie cannot run in this environment (no Playwright headless shell, no flowspec, ` +
      `dev server unavailable), re-run with ATEAM_SKIP_FRANKIE_GATE=1 to override this gate.`
    );
  } catch {
    // Config unreadable, filesystem unavailable, anything else — fail open,
    // matching every other check in these hooks.
    return null;
  }
}
