#!/usr/bin/env node
/**
 * observer-preflight.js - two-sided telemetry preflight (SessionStart hook + --check)
 *
 * WHY THIS EXISTS: observer telemetry depends on env vars in the HOOK process
 * env (the harness env), which is NOT the same env Bash tool calls see — Bash
 * shells source the user's profile on top of the harness env. A mission can
 * therefore run perfectly (the `ateam` CLI works in every Bash call) while
 * every observer POST silently dies: missing ATEAM_PROJECT_ID falls back to
 * garbage attribution, and missing CF-Access creds get a 302 that the
 * fire-and-forget observer swallows. A real overnight mission (M-20260714-001)
 * completed green with ZERO telemetry this way.
 *
 * Two modes:
 *
 * 1. Hook mode (default; wired as a SessionStart hook in hooks/hooks.json):
 *    runs in the REAL hook env. Records what it sees — project id present?
 *    CF creds present? does an authenticated GET against the API succeed? —
 *    to a status file keyed by cwd. Prints a warning to the session context
 *    ONLY when the env looks mission-shaped but broken (loud where it
 *    matters, silent for unrelated sessions). Always exits 0: preflight must
 *    never block a session.
 *
 * 2. --check mode (run via Bash from the /ai-team:run precheck): reads the
 *    status file written by hook mode for this cwd and exits non-zero with an
 *    explanation when telemetry would be silently degraded. A MISSING status
 *    file is itself a failure — it means SessionStart hooks are not firing at
 *    all in this session (plugin hooks disabled, --bare, ...), so nothing
 *    else will be observed either.
 */

import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { apiEventHeaders } from './lib/observer.js';

const STATUS_DIR = join(tmpdir(), 'ateam-observer-preflight');

/**
 * Without a session id to compare (older harness, env not propagated), --check
 * falls back to an age gate: a status older than this is treated as "not
 * written by this session".
 */
const MAX_STATUS_AGE_MS = 12 * 3600_000;

/**
 * Status file path for a working directory (stable key both modes can derive).
 * Canonicalize symlinks first: hook mode keys on the harness-supplied cwd
 * (logical path) while --check keys on process.cwd() (symlink-resolved) — on
 * e.g. macOS /var → /private/var they'd hash differently and --check would
 * falsely report "hooks not firing".
 */
function statusPathFor(cwd) {
  let canonical = cwd || 'unknown';
  try {
    canonical = realpathSync(canonical);
  } catch {
    // Path doesn't resolve (deleted dir, permission) — hash the raw string;
    // both modes will at least fail the same way.
  }
  const key = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return join(STATUS_DIR, `${key}.json`);
}

/**
 * Host-based locality check. Parses the URL rather than pattern-matching the
 * string — a substring regex classifies `http://evil.com//localhost:9` as
 * local. Unparseable URLs are treated as remote (fail closed: creds required).
 */
function isLocalApi(apiUrl) {
  try {
    const host = new URL(apiUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Evaluate the recorded env facts into (ok, problems[]). Shared by both modes
 * so hook-mode warnings and --check verdicts can never disagree.
 */
function evaluate(status) {
  const problems = [];
  if (!status.projectIdPresent) {
    problems.push(
      'ATEAM_PROJECT_ID is not set in the HOOK environment — all observer telemetry ' +
      '(hook events, token usage, cost) will be skipped. Set it in the harness env ' +
      '(settings env block or exported before launching claude), not only in a shell profile.'
    );
  }
  if (status.projectIdPresent && !status.local && !status.credsPresent) {
    problems.push(
      'ACCESS_CLIENT_ID / ACCESS_CLIENT_SECRET are not set in the HOOK environment and the ' +
      `API (${status.apiUrl}) is remote — behind Cloudflare Access every observer POST will be ` +
      'rejected (302) and silently dropped.'
    );
  }
  if (status.probe && status.probe.attempted && !status.probe.ok) {
    problems.push(
      `Authenticated probe of ${status.apiUrl} failed` +
      (status.probe.status ? ` (HTTP ${status.probe.status})` : ` (${status.probe.error || 'network error'})`) +
      ' — observer POSTs are unlikely to land.'
    );
  }
  if (!status.projectIdPresent && status.missionIdPresent) {
    problems.push('ATEAM_MISSION_ID is set but ATEAM_PROJECT_ID is not — mission telemetry cannot attribute.');
  }
  return { ok: problems.length === 0, problems };
}

/** A session is "mission-shaped" when it declares ai-team env at all. */
function missionShaped(status) {
  return status.projectIdPresent || status.missionIdPresent;
}

async function hookMode() {
  // SessionStart sends hook context JSON on stdin; cwd is the reliable key and
  // session_id lets --check verify the status was written by THIS session.
  let cwd = process.cwd();
  let sessionId = null;
  try {
    // Guard: never block on an interactive TTY (manual invocation without
    // piped stdin) — the harness always pipes and closes stdin for real hooks.
    if (!process.stdin.isTTY) {
      const raw = readFileSync(0, 'utf8');
      const input = JSON.parse(raw);
      if (input.cwd) cwd = input.cwd;
      if (input.session_id) sessionId = input.session_id;
    }
  } catch {
    // No/invalid stdin (e.g. manual invocation) — fall back to process.cwd().
  }

  const apiUrl = (process.env.ATEAM_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const projectId = process.env.ATEAM_PROJECT_ID || '';
  const status = {
    timestamp: new Date().toISOString(),
    cwd,
    sessionId,
    apiUrl,
    local: isLocalApi(apiUrl),
    projectIdPresent: Boolean(projectId),
    projectId: projectId || null,
    missionIdPresent: Boolean(process.env.ATEAM_MISSION_ID),
    credsPresent: Boolean(process.env.ACCESS_CLIENT_ID && process.env.ACCESS_CLIENT_SECRET),
    probe: { attempted: false, ok: null, status: null, error: null },
  };

  // Live probe only when attribution is possible — keeps unrelated sessions at
  // zero network cost. Bounded so session start is never held hostage.
  if (status.projectIdPresent) {
    status.probe.attempted = true;
    try {
      const response = await fetch(`${apiUrl}/api/projects`, {
        method: 'GET',
        headers: apiEventHeaders(projectId),
        signal: AbortSignal.timeout(2000),
        redirect: 'error', // a CF-Access login redirect is a failure, not a success
      });
      status.probe.ok = response.ok;
      status.probe.status = response.status;
    } catch (error) {
      status.probe.ok = false;
      status.probe.error = String(error?.message ?? error);
    }
  }

  try {
    mkdirSync(STATUS_DIR, { recursive: true });
    writeFileSync(statusPathFor(cwd), JSON.stringify(status, null, 2));
  } catch (error) {
    // Best-effort — never block session start over a tmp write. But do leave a
    // trace on stderr (invisible to the session, visible in hook debugging):
    // a missing status file later makes --check report "hooks not firing".
    process.stderr.write(`[observer-preflight] failed to record status: ${error?.message ?? error}\n`);
  }

  // Loud only where it matters: a mission-shaped env that is broken.
  const { ok, problems } = evaluate(status);
  if (missionShaped(status) && !ok) {
    process.stdout.write(
      '⚠️ A(i)-Team OBSERVER TELEMETRY DEGRADED — this session\'s hook telemetry will NOT land:\n' +
      problems.map((p) => `  - ${p}`).join('\n') +
      '\nBoard state and activity logging still work (they go through the ateam CLI), but hook events and token/cost tracking will be missing.\n'
    );
  }
  process.exit(0);
}

function checkMode() {
  const cwd = process.cwd();
  const path = statusPathFor(cwd);

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    process.stdout.write(
      'OBSERVER PREFLIGHT: FAIL\n' +
      `No preflight status file for this directory (${path}).\n` +
      'The SessionStart observer hook did not run in this session — plugin hooks are not firing ' +
      '(hooks disabled, --bare, or plugin not loaded), so NO observer telemetry will be recorded.\n'
    );
    process.exit(1);
  }

  let status;
  try {
    status = JSON.parse(raw);
  } catch {
    process.stdout.write(
      'OBSERVER PREFLIGHT: FAIL\n' +
      `Preflight status file exists but is corrupt (unparseable JSON): ${path}.\n` +
      'Cannot verify the hook environment — treat telemetry as unverified. Delete the file and start a new session to regenerate it.\n'
    );
    process.exit(1);
  }

  // Verify the status was written by THIS session — a stale file from an
  // earlier session would otherwise report PASS while the current session's
  // hooks aren't firing at all (the exact silent black-hole this preflight
  // exists to catch). Primary: compare the harness session id (present in the
  // Bash env) against the id stamped at SessionStart. Fallback when either
  // side lacks an id: an age gate.
  const currentSessionId = process.env.CLAUDE_CODE_SESSION_ID || '';
  const ageMs = Date.now() - Date.parse(status.timestamp);
  const ageMinutes = Math.round(ageMs / 60000);
  if (currentSessionId && status.sessionId) {
    if (currentSessionId !== status.sessionId) {
      process.stdout.write(
        'OBSERVER PREFLIGHT: FAIL\n' +
        `The status file was written by a DIFFERENT session (${status.sessionId}, ${ageMinutes} min ago), not this one (${currentSessionId}).\n` +
        'The SessionStart observer hook did not fire in the current session — plugin hooks are not firing here, so NO observer telemetry will be recorded.\n'
      );
      process.exit(1);
    }
  } else if (!(Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= MAX_STATUS_AGE_MS)) {
    process.stdout.write(
      'OBSERVER PREFLIGHT: FAIL\n' +
      `Status file is ${Number.isFinite(ageMinutes) ? `${ageMinutes} min old` : 'undatable'} and session identity cannot be verified ` +
      '(no session id available to compare) — it was likely written by an earlier session, and the current session\'s hooks may not be firing.\n'
    );
    process.exit(1);
  }

  const { ok, problems } = evaluate(status);
  if (!ok) {
    process.stdout.write(
      'OBSERVER PREFLIGHT: FAIL\n' +
      `Status recorded ${ageMinutes} min ago from the hook environment:\n` +
      problems.map((p) => `  - ${p}`).join('\n') + '\n'
    );
    process.exit(1);
  }
  process.stdout.write(
    'OBSERVER PREFLIGHT: PASS\n' +
    `project=${status.projectId} api=${status.apiUrl} creds=${status.credsPresent ? 'present' : 'n/a (local api)'} ` +
    `probe=${status.probe.attempted ? `HTTP ${status.probe.status}` : 'skipped'} recorded=${ageMinutes} min ago` +
    `${currentSessionId && status.sessionId ? ' session=verified' : ' session=unverified (age-gated)'}\n`
  );
  process.exit(0);
}

if (process.argv.includes('--check')) {
  checkMode();
} else {
  await hookMode();
}
