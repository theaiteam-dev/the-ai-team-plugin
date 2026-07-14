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

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { apiEventHeaders } from './lib/observer.js';

const STATUS_DIR = join(tmpdir(), 'ateam-observer-preflight');

/** Status file path for a working directory (stable key both modes can derive). */
function statusPathFor(cwd) {
  const key = createHash('sha256').update(cwd || 'unknown').digest('hex').slice(0, 16);
  return join(STATUS_DIR, `${key}.json`);
}

function isLocalApi(apiUrl) {
  return /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/.test(apiUrl);
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
  // SessionStart sends hook context JSON on stdin; cwd is the reliable key.
  let cwd = process.cwd();
  try {
    const raw = readFileSync(0, 'utf8');
    const input = JSON.parse(raw);
    if (input.cwd) cwd = input.cwd;
  } catch {
    // No/invalid stdin (e.g. manual invocation) — fall back to process.cwd().
  }

  const apiUrl = (process.env.ATEAM_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const projectId = process.env.ATEAM_PROJECT_ID || '';
  const status = {
    timestamp: new Date().toISOString(),
    cwd,
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
  } catch {
    // Best-effort — never block session start over a tmp write.
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
  let status;
  try {
    status = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    process.stdout.write(
      'OBSERVER PREFLIGHT: FAIL\n' +
      `No preflight status file for this directory (${path}).\n` +
      'The SessionStart observer hook did not run in this session — plugin hooks are not firing ' +
      '(hooks disabled, --bare, or plugin not loaded), so NO observer telemetry will be recorded.\n'
    );
    process.exit(1);
  }

  const { ok, problems } = evaluate(status);
  const ageMinutes = Math.round((Date.now() - Date.parse(status.timestamp)) / 60000);
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
    `probe=${status.probe.attempted ? `HTTP ${status.probe.status}` : 'skipped'} recorded=${ageMinutes} min ago\n`
  );
  process.exit(0);
}

if (process.argv.includes('--check')) {
  checkMode();
} else {
  await hookMode();
}
