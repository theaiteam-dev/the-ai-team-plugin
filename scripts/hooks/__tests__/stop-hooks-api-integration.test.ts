/**
 * Integration tests for the Stop hooks' REAL (non-mock) HTTP path.
 *
 * Why this file exists
 * --------------------
 * Both Stop hooks previously built URLs like
 * `${apiUrl}/api/projects/${projectId}/board` — routes that have never
 * existed. The real API is flat and keyed by the `X-Project-ID` header:
 * `/api/board` and `/api/missions/current`. Every production invocation
 * therefore 404'd, and the fail-open branch silently allowed the stop —
 * meaning ALL mission-completion enforcement in both files was inert.
 *
 * The unit suites never caught it because they inject __TEST_MOCK_BOARD__ /
 * __TEST_MOCK_MISSION__, which short-circuit the fetch path entirely. These
 * tests drive the hooks against a stub HTTP server serving the *real*
 * response envelopes, with no mocks set, so that:
 *
 *   1. a URL that drifts away from a real route fails the suite (the stub
 *      404s unknown paths, the hook fails open, the block assertion fails);
 *   2. a response-shape drift fails the suite (the stub serves the same
 *      `{ success, data: { items: [{ stageId }] } }` envelope the Next.js
 *      route handlers return, not the hooks' internal `columns` shape).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFile } from 'child_process';
import { createServer, type Server } from 'http';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const HOOKS_DIR = join(__dirname, '..');
// Deliberately NOT 'test-project': the mission-active marker is a file named
// after the project id in tmpdir, and stop-guards.test.ts creates and deletes
// that exact marker. Vitest runs the two files in parallel, so sharing the id
// makes this suite flaky — its marker vanishes mid-run.
const PROJECT_ID = 'stop-hooks-api-integration-project';
const MISSION_ID = 'M-INT-001';

// enforce-orchestrator-stop.js only enforces while a mission marker exists.
const MISSION_MARKER = join(tmpdir(), `.ateam-mission-active-${PROJECT_ID}`);

// ---------------------------------------------------------------------------
// Stub API server — serves the same envelopes the real Next.js routes return.
// ---------------------------------------------------------------------------

/** Board payload in the real API shape: a flat item list keyed by stageId. */
function boardPayload(items: Array<{ id: string; stageId: string }>) {
  return {
    success: true,
    data: {
      stages: [],
      claims: [],
      currentMission: { id: MISSION_ID, name: 'Integration mission', state: 'running' },
      items: items.map((i) => ({ ...i, title: i.id, type: 'feature', status: 'pending' })),
    },
  };
}

/** Current-mission payload in the real API shape (note: no finalReview key). */
function missionPayload(state: string) {
  return {
    success: true,
    data: {
      id: MISSION_ID,
      name: 'Integration mission',
      state,
      prdPath: 'prd/test.md',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      archivedAt: null,
      scalingRationale: null,
    },
  };
}

let server: Server;
let apiUrl: string;

/** Every path the hook actually requested, in order. */
let requestedPaths: string[] = [];

/** Mutable per-test server state. */
let state = {
  items: [] as Array<{ id: string; stageId: string }>,
  /** Item ids linked to MISSION_ID through the MissionItem join. */
  missionItemIds: [] as string[],
  missionState: 'running',
  finalReview: null as string | null,
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url || '';
    requestedPaths.push(url);
    const path = url.split('?')[0];
    const search = new URLSearchParams(url.split('?')[1] || '');

    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    // The real /api/board requires the project header and excludes done items
    // unless includeCompleted=true — both reproduced here, because a hook that
    // forgets either one sees a board that can never be complete.
    if (path === '/api/board') {
      if (req.headers['x-project-id'] !== PROJECT_ID) {
        return send(400, { success: false, error: { code: 'VALIDATION_ERROR' } });
      }
      const includeCompleted = search.get('includeCompleted') === 'true';
      const items = includeCompleted
        ? state.items
        : state.items.filter((i) => i.stageId !== 'done');
      return send(200, boardPayload(items));
    }

    if (path === '/api/missions/current') {
      if (req.headers['x-project-id'] !== PROJECT_ID) {
        return send(400, { success: false, error: { code: 'VALIDATION_ERROR' } });
      }
      return send(200, missionPayload(state.missionState));
    }

    // The real /api/items honors ?missionId= by joining MissionItem. Mission
    // membership is what separates THIS mission's staged items from stragglers
    // another mission left on the project board.
    if (path === '/api/items') {
      if (req.headers['x-project-id'] !== PROJECT_ID) {
        return send(400, { success: false, error: { code: 'VALIDATION_ERROR' } });
      }
      const missionId = search.get('missionId');
      const items = missionId
        ? state.items.filter((i) => state.missionItemIds.includes(i.id))
        : state.items;
      return send(200, { success: true, data: items });
    }

    if (path === `/api/missions/${MISSION_ID}/final-review`) {
      return send(200, {
        success: true,
        data: { missionId: MISSION_ID, finalReview: state.finalReview },
      });
    }

    // Anything else — including the legacy /api/projects/:id/board and
    // /api/projects/:id/missions/current — does not exist.
    return send(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: `No route for ${path}` },
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('stub server has no port');
  apiUrl = `http://127.0.0.1:${address.port}`;

  writeFileSync(MISSION_MARKER, new Date().toISOString());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    unlinkSync(MISSION_MARKER);
  } catch {
    /* ignore */
  }
  for (const dir of scratchDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

beforeEach(() => {
  requestedPaths = [];
  state = { items: [], missionItemIds: [], missionState: 'running', finalReview: null };
});

// ---------------------------------------------------------------------------
// Scratch repos — the Frankie gate resolves both the execution contract and
// the evidence path relative to the hook process's cwd.
// ---------------------------------------------------------------------------

const scratchDirs: string[] = [];

function makeScratchRepo(opts: { surfaces: string[]; evidence?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), 'ateam-stop-integration-'));
  scratchDirs.push(dir);
  writeFileSync(join(dir, 'ateam.config.json'), JSON.stringify({ surfaces: opts.surfaces }));
  if (opts.evidence) {
    mkdirSync(join(dir, '.qa-evidence', MISSION_ID), { recursive: true });
    writeFileSync(join(dir, '.qa-evidence', MISSION_ID, 'report.md'), '# Evidence\n');
  }
  return dir;
}

/**
 * Runs a hook with NO test mocks — the real fetch path against the stub.
 *
 * Must be async: the stub server shares this process's event loop, so a
 * synchronous execFileSync would block the very server the hook is waiting
 * on, and every request would deadlock until the timeout.
 */
function runHookLive(
  name: string,
  stdin: object,
  cwd: string,
  extraEnv: Record<string, string> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = {
    ...process.env,
    ATEAM_API_URL: apiUrl,
    ATEAM_PROJECT_ID: PROJECT_ID,
    ...extraEnv,
  };
  // Guard against a stray mock leaking in from the ambient environment and
  // silently turning this back into a unit test — and against an ambient
  // gate-skip var silently disabling the Frankie gate under test.
  delete env.__TEST_MOCK_BOARD__;
  delete env.__TEST_MOCK_MISSION__;
  delete env.__TEST_MOCK_NO_MISSION__;
  if (!('ATEAM_SKIP_FRANKIE_GATE' in extraEnv)) {
    delete env.ATEAM_SKIP_FRANKIE_GATE;
  }

  return new Promise((resolve) => {
    const child = execFile(
      'node',
      [join(HOOKS_DIR, name)],
      { env, cwd, encoding: 'utf8', timeout: 10000 },
      (err: any, stdout, stderr) => {
        resolve({
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
          exitCode: err ? (err.code ?? 1) : 0,
        });
      }
    );
    child.stdin?.end(JSON.stringify(stdin));
  });
}

function parseStopOutput(stdout: string): Record<string, unknown> {
  if (!stdout) return {};
  try {
    return JSON.parse(stdout);
  } catch {
    return {};
  }
}

// ===========================================================================
// enforce-orchestrator-stop.js — the hook that actually binds in the primary
// execution mode (plugin-wide Stop hook, main session).
// ===========================================================================
describe('enforce-orchestrator-stop — real API path', async () => {
  const HOOK = 'enforce-orchestrator-stop.js';

  it('requests /api/board (not /api/projects/:id/board) and blocks on active items', async () => {
    state.items = [{ id: 'WI-001', stageId: 'testing' }];
    const dir = makeScratchRepo({ surfaces: ['web'] });

    const result = await runHookLive(HOOK, { session_id: 'main-1' }, dir);

    expect(
      requestedPaths.some((p) => p.startsWith('/api/board')),
      `hook never hit /api/board — requested: ${JSON.stringify(requestedPaths)}`
    ).toBe(true);
    expect(requestedPaths.some((p) => p.includes('/api/projects/'))).toBe(false);

    expect(result.exitCode).toBe(0);
    expect(
      parseStopOutput(result.stdout).decision,
      'a 404 would have failed open and allowed the stop — this asserts the fetch actually landed'
    ).toBe('block');
  });

  it('parses the real board envelope: items are grouped by stageId, not read from a "columns" key', async () => {
    state.items = [
      { id: 'WI-001', stageId: 'implementing' },
      { id: 'WI-002', stageId: 'review' },
    ];
    const dir = makeScratchRepo({ surfaces: ['web'] });

    const output = parseStopOutput((await runHookLive(HOOK, {}, dir)).stdout);

    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/2 items still active/);
    expect(String(output.additionalContext)).toMatch(/implementing: 1/);
    expect(String(output.additionalContext)).toMatch(/review: 1/);
  });

  it('sees done items — it must ask the board to include completed items, which are excluded by default', async () => {
    state.items = [{ id: 'WI-001', stageId: 'done' }];
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: true });

    const output = parseStopOutput((await runHookLive(HOOK, {}, dir)).stdout);

    // With evidence present, the next gate is the final review — reaching it at
    // all proves the done item was counted (a doneCount of 0 allows the stop).
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/Final Mission Review/i);
  });

  it('blocks on the Frankie evidence gate over the real API path when items are staged and no bundle exists (WI-791)', async () => {
    // WI-791: checkFrankieEvidence keys on stagedCount, not doneCount — real
    // API item shape (stageId: 'staged'), through the real /api/board fetch
    // and normalizeBoard/countBoard pipeline, not a __TEST_MOCK_BOARD__ fixture.
    state.items = [{ id: 'WI-001', stageId: 'staged' }];
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: false });

    const output = parseStopOutput((await runHookLive(HOOK, {}, dir)).stdout);

    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/frankie/i);
  });

  it('blocks with a "staged, not promoted" message over the real API path once Frankie evidence exists but the item has not been promoted (WI-791 AC2)', async () => {
    state.items = [{ id: 'WI-001', stageId: 'staged' }];
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: true });

    const output = parseStopOutput((await runHookLive(HOOK, {}, dir)).stdout);

    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).not.toMatch(/frankie/i);
    expect(String(output.additionalContext)).toMatch(/staged/i);
  });

  it('does not treat an all-staged board as an empty board over the real API path (AC2 — the exact regression this item prevents)', async () => {
    // Confirms the real /api/board fetch (which excludes literal 'done'
    // items by default but never filters 'staged' ones) plus the real
    // countBoard/normalizeBoard pipeline correctly report stagedCount > 0,
    // so the mission cannot silently stop while nothing is active AND
    // nothing has reached done, purely because it's sitting in staged.
    state.items = [{ id: 'WI-001', stageId: 'staged' }];
    const dir = makeScratchRepo({ surfaces: ['hardware'] }); // non-drivable — Frankie itself stays inert

    const result = await runHookLive(HOOK, {}, dir);

    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(
      output.decision,
      'an all-staged board must never be treated as an empty (no-mission) board'
    ).toBe('block');
  });

  it('allows the stop once every gate is genuinely satisfied via the real API shapes', async () => {
    state.items = [{ id: 'WI-001', stageId: 'done' }];
    state.missionState = 'completed';
    state.finalReview = '# Final Mission Review\n\nVERDICT: FINAL APPROVED';
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: true });

    const result = await runHookLive(HOOK, {}, dir);

    expect(result.exitCode).toBe(0);
    expect(parseStopOutput(result.stdout).decision).not.toBe('block');
  });

  it('blocks with the restart-at-Frankie path when the stored review carries VERDICT: FINAL REJECTED (real final-review route)', async () => {
    state.items = [{ id: 'WI-001', stageId: 'done' }];
    state.missionState = 'completed';
    state.finalReview = '# Final Mission Review\n\n- WI-001: broken\n\nVERDICT: FINAL REJECTED';
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: true });

    const output = parseStopOutput((await runHookLive(HOOK, {}, dir)).stdout);

    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/FINAL REJECTED/);
    expect(String(output.additionalContext)).toMatch(/RESTARTS at Frankie/i);
    expect(String(output.additionalContext)).not.toMatch(/Run ateam missions-postcheck/i);
  });

  it('blocks a RUNNING mission with an approved review over the real API path — the payload carries no post-check evidence', async () => {
    // /api/missions/current has never returned a `postcheck` key. The gate used
    // to synthesize one from the mission state, so it passed with zero evidence
    // a post-check had run. Absent now means "not passed".
    state.items = [{ id: 'WI-001', stageId: 'done' }];
    state.missionItemIds = ['WI-001'];
    state.missionState = 'running';
    state.finalReview = '# Final Mission Review\n\nVERDICT: FINAL APPROVED\n';
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: true });

    const output = parseStopOutput((await runHookLive(HOOK, {}, dir)).stdout);

    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/post-check/i);
  });

  it('scopes staged items to the current mission AND blocks on the orphan it scoped out, over the real API path', async () => {
    // /api/board is project-wide; promotion only ever sweeps the current
    // mission's items, so a staged straggler could never be cleared by
    // re-POSTing a review — which is why it is kept out of the promotion
    // COUNTS. Keeping it out of the GATES too let it vanish, and the mission
    // ended with an unexplained item parked in staged. Driven through the real
    // /api/items?missionId= route.
    state.items = [
      { id: 'WI-001', stageId: 'done' },
      { id: 'WI-ORPHAN', stageId: 'staged' },
    ];
    state.missionItemIds = ['WI-001'];
    state.missionState = 'completed';
    state.finalReview = '# Final Mission Review\n\nVERDICT: FINAL APPROVED\n';
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: true });

    const result = await runHookLive(HOOK, {}, dir);

    expect(
      requestedPaths.some((p) => p.startsWith('/api/items?missionId=')),
      `hook never asked for mission membership — requested: ${JSON.stringify(requestedPaths)}`
    ).toBe(true);
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/WI-ORPHAN/);
    expect(String(output.additionalContext)).toMatch(/belong to NO mission/i);
  });

  it('blocks a RUNNING mission with an approved review and an EMPTY board over the real API path (promoted then archived — the post-check is still owed)', async () => {
    // The board carries nothing at all: the approved review promoted every item
    // and archival took them off the board. The hook used to read "no items" as
    // "no mission" and allow the stop BEFORE it had even fetched the mission,
    // so the post-check never ran and the mission stayed `running` forever.
    state.items = [];
    state.missionItemIds = [];
    state.missionState = 'running';
    state.finalReview = '# Final Mission Review\n\nVERDICT: FINAL APPROVED\n';
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: true });

    const output = parseStopOutput((await runHookLive(HOOK, {}, dir)).stdout);

    expect(output.decision, 'an empty board is not evidence a post-check ran').toBe('block');
    expect(String(output.additionalContext)).toMatch(/ateam missions-postcheck/);
  });

  it('an empty board with NO review still allows the stop over the real API path (a mission that has not created items yet)', async () => {
    state.items = [];
    state.missionItemIds = [];
    state.missionState = 'running';
    state.finalReview = null;
    const dir = makeScratchRepo({ surfaces: ['web'] });

    const result = await runHookLive(HOOK, {}, dir);

    expect(result.exitCode).toBe(0);
    expect(parseStopOutput(result.stdout).decision).not.toBe('block');
  });

  it('still blocks when the mission OWNS the staged item (scoping narrows, it does not disarm)', async () => {
    state.items = [{ id: 'WI-001', stageId: 'staged' }];
    state.missionItemIds = ['WI-001'];
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: true });

    const output = parseStopOutput((await runHookLive(HOOK, {}, dir)).stdout);

    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/staged/i);
  });

  it('fails open when the API returns 404 for every route (adversity must not trap the operator)', async () => {
    state.items = [{ id: 'WI-001', stageId: 'testing' }];
    const dir = makeScratchRepo({ surfaces: ['web'] });

    // Point the hook at a path prefix the stub serves nothing on.
    const result = await runHookLive(HOOK, {}, dir, { ATEAM_API_URL: `${apiUrl}/nonexistent` });

    expect(result.exitCode).toBe(0);
    expect(parseStopOutput(result.stdout).decision).not.toBe('block');
  });
});

// ===========================================================================
// enforce-final-review.js — same enforcement, bound via hannibal frontmatter.
// ===========================================================================
describe('enforce-final-review — real API path', async () => {
  const HOOK = 'enforce-final-review.js';

  it('requests /api/board (not /api/projects/:id/board) and blocks on active items', async () => {
    state.items = [{ id: 'WI-001', stageId: 'testing' }];
    const dir = makeScratchRepo({ surfaces: ['web'] });

    const result = await runHookLive(HOOK, {}, dir);

    expect(
      requestedPaths.some((p) => p.startsWith('/api/board')),
      `hook never hit /api/board — requested: ${JSON.stringify(requestedPaths)}`
    ).toBe(true);
    expect(requestedPaths.some((p) => p.includes('/api/projects/'))).toBe(false);
    expect(result.exitCode, 'this hook blocks via exit(2), not JSON').toBe(2);
  });

  it('requests /api/missions/current (not /api/projects/:id/missions/current)', async () => {
    state.items = [{ id: 'WI-001', stageId: 'done' }];
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: true });

    await runHookLive(HOOK, {}, dir);

    expect(requestedPaths).toContain('/api/missions/current');
    expect(requestedPaths.some((p) => p.includes('/api/projects/'))).toBe(false);
  });

  it('blocks on the Frankie evidence gate over the real API path (WI-791: staged, not done)', async () => {
    state.items = [{ id: 'WI-001', stageId: 'staged' }];
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: false });

    const result = await runHookLive(HOOK, {}, dir);

    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/frankie/i);
  });

  it('allows the stop once every gate is genuinely satisfied via the real API shapes', async () => {
    state.items = [{ id: 'WI-001', stageId: 'done' }];
    state.missionState = 'completed';
    state.finalReview = '# Final Mission Review\n\nVERDICT: FINAL APPROVED';
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: true });

    const result = await runHookLive(HOOK, {}, dir);

    expect(result.exitCode).toBe(0);
    expect(parseStopOutput(result.stdout).decision).not.toBe('block');
  });

  it('fails open when the API returns 404 for every route', async () => {
    state.items = [{ id: 'WI-001', stageId: 'testing' }];
    const dir = makeScratchRepo({ surfaces: ['web'] });

    const result = await runHookLive(HOOK, {}, dir, { ATEAM_API_URL: `${apiUrl}/nonexistent` });

    expect(result.exitCode).toBe(0);
  });
});
