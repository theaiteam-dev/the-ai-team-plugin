#!/usr/bin/env tsx

/**
 * Seed script for demo data in the Kanban Viewer.
 *
 * Injects realistic mission data via the kanban-viewer REST API for UI verification.
 * Creates a representative in-progress mission with items distributed across stages,
 * hook events from all 7 agents, correlation pairs, denied events, and activity logs.
 *
 * Usage:
 *   npx tsx packages/kanban-viewer/scripts/seed-demo-data.ts
 *   npx tsx packages/kanban-viewer/scripts/seed-demo-data.ts --project my-project
 *
 * Environment:
 *   API_BASE  - API base URL (default: http://localhost:3000)
 *   DELAY     - Milliseconds between API calls (default: 2000)
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const DELAY = parseInt(process.env.DELAY || '2000', 10);

// Parse --project CLI argument, default to "seed-demo"
function parseProjectId(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) {
      return args[i + 1];
    }
    if (args[i].startsWith('--project=')) {
      return args[i].split('=')[1];
    }
  }
  return 'seed-demo';
}

const PROJECT_ID = parseProjectId();

// ANSI colors for output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

function log(message: string) {
  console.log(`${colors.green}[SEED]${colors.reset} ${message}`);
}

function warn(message: string) {
  console.log(`${colors.yellow}[SEED]${colors.reset} ${message}`);
}

function info(message: string) {
  console.log(`${colors.blue}[SEED]${colors.reset} ${message}`);
}

function error(message: string) {
  console.log(`${colors.red}[SEED]${colors.reset} ${message}`);
}

function agentLog(agent: string, message: string) {
  info(`[${agent}] ${message}`);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if the API server is reachable before running the seed.
 */
async function checkApiHealth(apiBase: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiBase}/api/board`, {
      headers: {
        'X-Project-ID': PROJECT_ID,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Make an API request with error handling.
 * Automatically includes projectId as X-Project-ID header in all requests.
 */
async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${API_BASE}${path}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': PROJECT_ID,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error?.message || `API request failed: ${response.status}`);
    }

    return data;
  } catch (err) {
    error(`API request failed: ${method} ${path}`);
    throw err;
  }
}

/**
 * Create a new project if it doesn't exist.
 */
async function ensureProjectExists(): Promise<boolean> {
  log(`Ensuring project exists: ${PROJECT_ID}`);
  try {
    const response = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: PROJECT_ID,
        name: `Demo Project - ${PROJECT_ID}`,
      }),
    });

    if (response.status === 201) {
      info(`Project created: ${PROJECT_ID}`);
      return true;
    } else if (response.status === 409) {
      info(`Project already exists: ${PROJECT_ID}`);
      return false;
    } else {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Failed to create project: ${response.status}`);
    }
  } catch (err) {
    error(`Failed to ensure project exists: ${PROJECT_ID}`);
    throw err;
  }
}

/**
 * Archive any existing mission to clean up from previous runs.
 */
async function archivePreviousMission(): Promise<void> {
  try {
    const response = await apiRequest<{
      success: true;
      data: { mission: { id: string }; archivedItems: number };
    }>('POST', '/api/missions/archive');
    warn(`Archived previous mission ${response.data.mission.id} with ${response.data.archivedItems} items`);
  } catch {
    // No active mission to archive - that's fine
  }
}

/**
 * Release any stale claims from previous failed runs.
 */
async function cleanupStaleClaims(): Promise<void> {
  const board = await getBoardState();
  const claimedStages = ['testing', 'implementing', 'review', 'probing'];
  const claimedItems = board.items.filter(item => claimedStages.includes(item.stageId));

  for (const item of claimedItems) {
    try {
      await apiRequest('POST', '/api/board/release', { itemId: item.id });
      warn(`Released stale claim on ${item.id}`);
    } catch {
      // Item had no claim - that's fine
    }
  }
}

/**
 * Get the current board state.
 */
async function getBoardState(): Promise<{
  stages: { id: string; name: string }[];
  items: { id: string; title: string; stageId: string }[];
  agents: { name: string; currentItemId: string | null }[];
}> {
  const response = await apiRequest<{
    success: true;
    data: {
      stages: { id: string; name: string }[];
      items: { id: string; title: string; stageId: string }[];
      agents: { name: string; currentItemId: string | null }[];
    };
  }>('GET', '/api/board');
  return response.data;
}

/**
 * Create a new mission.
 */
async function createMission(name: string, prdPath: string): Promise<string> {
  log(`Creating mission: ${name}`);
  const response = await apiRequest<{ success: true; data: { id: string } }>(
    'POST',
    '/api/missions',
    { name, prdPath }
  );
  info(`Mission created: ${response.data.id}`);
  return response.data.id;
}

/**
 * Create a work item.
 */
async function createItem(item: {
  title: string;
  description: string;
  type: 'feature' | 'bug' | 'enhancement' | 'task';
  priority: 'critical' | 'high' | 'medium' | 'low';
  dependencies?: string[];
}): Promise<string> {
  const response = await apiRequest<{ success: true; data: { id: string } }>(
    'POST',
    '/api/items',
    item
  );
  info(`Created item ${response.data.id}: ${item.title}`);
  return response.data.id;
}

/**
 * Read an item's current stage.
 */
async function getItemStage(itemId: string): Promise<string> {
  const response = await apiRequest<{ success: true; data: { stageId: string } }>(
    'GET',
    `/api/items/${encodeURIComponent(itemId)}`
  );
  return response.data.stageId;
}

/**
 * Move an item to a different stage.
 *
 * No-ops when the item is already in the target stage. POST /api/board/move
 * rejects self-transitions with INVALID_TRANSITION (400), and apiRequest
 * throws on any non-2xx, so a redundant move would abort the seed run and
 * leave a half-seeded board. agentStop advances the item to the next
 * pipeline stage on its own (advance defaults to true), so the "move it to
 * where the agent just left it" calls below are exactly that case.
 */
async function moveItem(
  itemId: string,
  toStage: string,
  force = false
): Promise<void> {
  const currentStage = await getItemStage(itemId);
  if (currentStage === toStage) {
    info(`Skipped move ${itemId} → ${toStage} (already there)`);
    return;
  }

  await apiRequest('POST', '/api/board/move', {
    itemId,
    toStage,
    force,
  });
  info(`Moved ${itemId} → ${toStage}`);
}

/**
 * Agent starts work on an item (claims + moves to in_progress + logs).
 */
async function agentStart(itemId: string, agent: string): Promise<void> {
  await apiRequest('POST', '/api/agents/start', {
    itemId,
    agent,
  });
  agentLog(agent, `Started work on ${itemId}`);
}

/**
 * Agent stops work on an item (releases + moves to review/blocked + logs).
 */
async function agentStop(
  itemId: string,
  agent: string,
  summary: string,
  outcome: 'completed' | 'blocked' = 'completed'
): Promise<void> {
  await apiRequest('POST', '/api/agents/stop', {
    itemId,
    agent,
    summary,
    outcome,
  });
  agentLog(agent, `Stopped work on ${itemId}: ${summary}`);
}

/**
 * Claim an item for an agent (without moving to a new stage).
 */
async function claimItem(itemId: string, agent: string): Promise<void> {
  await apiRequest('POST', '/api/board/claim', {
    itemId,
    agent,
  });
  agentLog(agent, `Claimed ${itemId}`);
}

/**
 * Post a hook event (simulates observer hooks firing during agent work).
 */
async function postHookEvent(event: {
  eventType: string;
  agentName: string;
  toolName?: string;
  status: string;
  summary: string;
  correlationId?: string;
  timestamp: string;
  payload?: string;
  durationMs?: number;
}): Promise<void> {
  await apiRequest('POST', '/api/hooks/events', event);
  info(`[HookEvent] ${event.agentName} ${event.eventType} (${event.status})`);
}

/**
 * Log an activity message.
 */
async function logActivity(
  message: string,
  agent?: string,
  level: 'info' | 'warn' | 'error' = 'info'
): Promise<void> {
  await apiRequest('POST', '/api/activity', {
    message,
    agent,
    level,
  });
  if (agent) {
    agentLog(agent, message);
  } else {
    info(message);
  }
}

/**
 * Generate a correlation ID with a readable prefix.
 */
function correlationId(prefix: string): string {
  return `corr-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/**
 * Post a pre/post hook event pair with a computed duration.
 * The duration is the difference between post and pre timestamps in milliseconds.
 */
async function postCorrelationPair(opts: {
  agentName: string;
  toolName: string;
  preSummary: string;
  postSummary: string;
  durationMs: number;
}): Promise<void> {
  const corrId = correlationId(opts.agentName);
  const preTime = new Date();
  const postTime = new Date(preTime.getTime() + opts.durationMs);

  await postHookEvent({
    eventType: 'pre_tool_use',
    agentName: opts.agentName,
    toolName: opts.toolName,
    status: 'success',
    summary: opts.preSummary,
    correlationId: corrId,
    timestamp: preTime.toISOString(),
  });

  await postHookEvent({
    eventType: 'post_tool_use',
    agentName: opts.agentName,
    toolName: opts.toolName,
    status: 'success',
    summary: opts.postSummary,
    correlationId: corrId,
    timestamp: postTime.toISOString(),
    durationMs: opts.durationMs,
  });
}

// ---------------------------------------------------------------------------
// COUNTERS for summary
// ---------------------------------------------------------------------------
let itemsCreated = 0;
let hookEventsPosted = 0;
let activityEntriesLogged = 0;
let activeClaimsSet = 0;

async function trackedPostHookEvent(event: Parameters<typeof postHookEvent>[0]): Promise<void> {
  await postHookEvent(event);
  hookEventsPosted++;
}

async function trackedPostCorrelationPair(opts: Parameters<typeof postCorrelationPair>[0]): Promise<void> {
  await postCorrelationPair(opts);
  hookEventsPosted += 2;
}

async function trackedLogActivity(
  message: string,
  agent?: string,
  level: 'info' | 'warn' | 'error' = 'info'
): Promise<void> {
  await logActivity(message, agent, level);
  activityEntriesLogged++;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function main() {
  console.log('========================================');
  console.log('  SEED DEMO DATA');
  console.log('========================================');
  console.log('');
  log(`Project ID: ${PROJECT_ID}`);
  log(`API Base: ${API_BASE}`);

  // Health check
  const isHealthy = await checkApiHealth(API_BASE);
  if (!isHealthy) {
    error(`API server is not reachable at ${API_BASE}`);
    console.log('Run "npm run dev" to start the development server.');
    process.exit(1);
  }
  log('API server is reachable. Starting seed...');

  try {
    // -------------------------------------------------------------------------
    // CLEANUP: Archive previous mission and release stale claims
    // -------------------------------------------------------------------------

    log('Cleaning up from previous runs...');

    try {
      await archivePreviousMission();
    } catch (cleanupErr) {
      warn(`Could not archive previous mission: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`);
      warn('This is non-fatal, continuing...');
    }

    try {
      await cleanupStaleClaims();
    } catch (cleanupErr) {
      warn(`Could not cleanup stale claims: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`);
      warn('This is non-fatal, continuing...');
    }

    // -------------------------------------------------------------------------
    // SETUP: Ensure project exists, create mission
    // -------------------------------------------------------------------------

    await ensureProjectExists();
    await sleep(DELAY);

    await createMission(
      'Demo Mission - Feature Dashboard',
      'prd/demo-feature-dashboard.md'
    );
    await sleep(DELAY);

    // -------------------------------------------------------------------------
    // CREATE 5 WORK ITEMS
    // -------------------------------------------------------------------------

    log('Creating work items...');

    // WI-1: Will end up in "done" stage
    const wi1 = await createItem({
      title: 'User authentication via OAuth2',
      description: `## Objective
Implement OAuth2-based user authentication with JWT session tokens.

## Acceptance Criteria
- Users can sign in via GitHub OAuth
- JWT tokens issued on successful auth
- Tokens expire after 24 hours
- Refresh tokens supported`,
      type: 'feature',
      priority: 'critical',
    });
    itemsCreated++;

    await sleep(DELAY);

    // WI-2: Will end up in "review" stage with Lynch claimed
    const wi2 = await createItem({
      title: 'Dashboard widget data API',
      description: `## Objective
Create REST API endpoints for dashboard widget data, including time-series metrics and aggregations.

## Acceptance Criteria
- GET /api/widgets/:id/data returns paginated results
- Supports date range filtering
- Response time < 200ms for typical queries`,
      type: 'feature',
      priority: 'high',
      dependencies: [wi1],
    });
    itemsCreated++;

    await sleep(DELAY);

    // WI-3: Will end up in "implementing" stage with B.A. claimed
    const wi3 = await createItem({
      title: 'Kanban board drag-and-drop',
      description: `## Objective
Add drag-and-drop reordering to the kanban board columns.

## Acceptance Criteria
- Cards can be dragged between columns
- Order persists after page refresh
- Animations are smooth (60fps)
- Touch events supported on mobile`,
      type: 'feature',
      priority: 'high',
    });
    itemsCreated++;

    await sleep(DELAY);

    // WI-4: Will end up in "ready" stage (no claim)
    const wi4 = await createItem({
      title: 'Activity feed pagination',
      description: `## Objective
Add infinite scroll pagination to the activity feed panel.

## Acceptance Criteria
- Loads 50 entries per page
- Scroll loads next page automatically
- Loading spinner shown during fetch`,
      type: 'enhancement',
      priority: 'medium',
    });
    itemsCreated++;

    await sleep(DELAY);

    // WI-5: Will end up in "testing" stage with Murdock claimed
    const wi5 = await createItem({
      title: 'Email notification service',
      description: `## Objective
Implement email notifications for mission state changes and agent completions.

## Acceptance Criteria
- Sends email on mission completion
- Configurable notification preferences
- Supports HTML and plain-text templates
- Rate limiting: max 10 emails/hour per user`,
      type: 'feature',
      priority: 'medium',
    });
    itemsCreated++;

    log(`Created ${itemsCreated} work items.`);
    await sleep(DELAY);

    // -------------------------------------------------------------------------
    // PIPELINE: Move WI-1 all the way through to "done"
    // -------------------------------------------------------------------------

    log('=== Processing WI-1 through full pipeline to done ===');

    // WI-1: briefings → ready
    await moveItem(wi1, 'ready', true);
    await trackedLogActivity('WI-1 is ready for testing', 'Hannibal');
    await sleep(DELAY);

    // WI-1: Murdock writes tests (ready → testing via agentStart)
    await agentStart(wi1, 'Murdock');
    await trackedLogActivity('Writing OAuth2 authentication tests', 'Murdock');
    await sleep(DELAY);

    // Hook events: Murdock pre/post pairs
    await trackedPostCorrelationPair({
      agentName: 'Murdock',
      toolName: 'Write',
      preSummary: 'Writing test file src/__tests__/auth.test.ts',
      postSummary: 'Auth test file written with 4 test cases',
      durationMs: 150,
    });

    await trackedPostCorrelationPair({
      agentName: 'Murdock',
      toolName: 'Read',
      preSummary: 'Reading PRD requirements for OAuth2 scope',
      postSummary: 'PRD requirements read successfully',
      durationMs: 80,
    });

    // Denied: Murdock tried to write implementation (out of scope)
    await trackedPostHookEvent({
      eventType: 'pre_tool_use',
      agentName: 'Murdock',
      toolName: 'Write',
      status: 'denied',
      summary: 'Blocked: Murdock attempted to write implementation file src/auth/oauth.ts',
      timestamp: new Date().toISOString(),
      payload: JSON.stringify({ reason: 'Murdock scope: tests only, not implementation' }),
    });

    await sleep(DELAY);
    await trackedLogActivity('OAuth2 test suite complete: 4 test cases covering happy path, token expiry, and invalid scopes', 'Murdock');

    // Murdock stop hook event
    await trackedPostHookEvent({
      eventType: 'stop',
      agentName: 'Murdock',
      status: 'success',
      summary: 'Murdock completed test writing for WI-1',
      timestamp: new Date().toISOString(),
    });

    await agentStop(wi1, 'Murdock', 'Test suite complete with 4 test cases for OAuth2 auth');
    await sleep(DELAY);

    // WI-1: testing → implementing (B.A.)
    await moveItem(wi1, 'implementing', true);
    await claimItem(wi1, 'B.A.');
    await trackedLogActivity('Implementing OAuth2 authentication service', 'B.A.');
    await sleep(DELAY);

    // Hook events: B.A. pre/post pairs
    await trackedPostCorrelationPair({
      agentName: 'B.A.',
      toolName: 'Write',
      preSummary: 'Writing src/auth/oauth.ts',
      postSummary: 'OAuth2 service implementation written',
      durationMs: 320,
    });

    await trackedPostCorrelationPair({
      agentName: 'B.A.',
      toolName: 'Edit',
      preSummary: 'Editing src/middleware/auth.ts to wire up OAuth2',
      postSummary: 'Middleware updated with OAuth2 integration',
      durationMs: 180,
    });

    await trackedPostCorrelationPair({
      agentName: 'B.A.',
      toolName: 'Bash',
      preSummary: 'Running tests: npm test src/__tests__/auth.test.ts',
      postSummary: 'Tests passed: 4/4 passing',
      durationMs: 2100,
    });

    // Denied: B.A. tried to write a test file (out of scope)
    await trackedPostHookEvent({
      eventType: 'pre_tool_use',
      agentName: 'B.A.',
      toolName: 'Write',
      status: 'denied',
      summary: 'Blocked: B.A. attempted to write test file src/__tests__/auth-extra.test.ts',
      timestamp: new Date().toISOString(),
      payload: JSON.stringify({ reason: 'B.A. scope: implementation only, not tests' }),
    });

    await sleep(DELAY);
    await trackedLogActivity('OAuth2 implementation complete. All 4 tests passing.', 'B.A.');

    // B.A. stop hook event
    await trackedPostHookEvent({
      eventType: 'stop',
      agentName: 'B.A.',
      status: 'success',
      summary: 'B.A. completed implementation of OAuth2 auth service',
      timestamp: new Date().toISOString(),
    });

    await agentStop(wi1, 'B.A.', 'OAuth2 service implemented, all tests passing');
    await sleep(DELAY);

    // WI-1: implementing → review (Lynch)
    await moveItem(wi1, 'review', true);
    await claimItem(wi1, 'Lynch');
    await trackedLogActivity('Reviewing OAuth2 authentication implementation', 'Lynch');
    await sleep(DELAY);

    // Hook events: Lynch
    await trackedPostCorrelationPair({
      agentName: 'Lynch',
      toolName: 'Read',
      preSummary: 'Reading src/auth/oauth.ts for review',
      postSummary: 'Implementation reviewed: clean code, good separation of concerns',
      durationMs: 240,
    });

    await trackedLogActivity('APPROVED: OAuth2 implementation is clean and well-tested', 'Lynch');

    await trackedPostHookEvent({
      eventType: 'stop',
      agentName: 'Lynch',
      status: 'success',
      summary: 'Lynch approved WI-1: OAuth2 auth implementation',
      timestamp: new Date().toISOString(),
    });

    // Release Lynch from WI-1 before moving to probing
    await apiRequest('POST', '/api/board/release', { itemId: wi1 });
    await sleep(DELAY);

    // WI-1: review → probing (Amy)
    await moveItem(wi1, 'probing', true);
    await claimItem(wi1, 'Amy');
    await trackedLogActivity('Probing OAuth2 implementation for edge cases (Raptor Protocol)', 'Amy');
    await sleep(DELAY);

    // Hook events: Amy
    await trackedPostCorrelationPair({
      agentName: 'Amy',
      toolName: 'Bash',
      preSummary: 'Running curl tests against auth endpoints for security probe',
      postSummary: 'Security probe complete: no vulnerabilities found in JWT handling',
      durationMs: 890,
    });

    await trackedPostCorrelationPair({
      agentName: 'Amy',
      toolName: 'Read',
      preSummary: 'Reading auth middleware for timing attack surface analysis',
      postSummary: 'Timing analysis complete: constant-time comparison used correctly',
      durationMs: 150,
    });

    // Denied: Amy attempted to write a raptor test file
    await trackedPostHookEvent({
      eventType: 'pre_tool_use',
      agentName: 'Amy',
      toolName: 'Write',
      status: 'denied',
      summary: 'Blocked: Amy attempted to write src/__tests__/auth-raptor.test.ts',
      timestamp: new Date().toISOString(),
      payload: JSON.stringify({ reason: 'Amy scope: investigation only, not test authoring' }),
    });

    await trackedLogActivity('Probing complete: No critical vulnerabilities. JWT expiry handled correctly. CSRF protection in place.', 'Amy');

    // Amy subagent events
    await trackedPostHookEvent({
      eventType: 'subagent_stop',
      agentName: 'Amy',
      status: 'success',
      summary: 'Amy probing subagent completed security investigation for WI-1',
      timestamp: new Date().toISOString(),
    });

    // Release Amy before moving out of probing
    await apiRequest('POST', '/api/board/release', { itemId: wi1 });
    await sleep(DELAY);

    // WI-1: probing → staged → done
    //
    // 'staged' is the per-item pipeline's real terminal stage: the transition
    // matrix (packages/shared/src/stages.ts) allows probing → staged, and
    // 'done' is reachable only from 'staged' at the mission tail. A direct
    // probing → done move is INVALID_TRANSITION.
    //
    // The demo board is deliberately mid-mission (WI-2..WI-5 are still in
    // flight), so it cannot seed an APPROVED final review to promote WI-1 the
    // way a real mission would — POST /api/missions/:id/final-review rolls an
    // approval back while any item is short of staged/done. This staged → done
    // board-move is the only way to seed a 'done' card here.
    await moveItem(wi1, 'staged', true);
    await moveItem(wi1, 'done', true);
    await trackedLogActivity('WI-1 complete! OAuth2 authentication shipped.', 'Hannibal');
    await sleep(DELAY);

    // -------------------------------------------------------------------------
    // WI-2: brief → ready → testing → implementing → review (Lynch currently working)
    // -------------------------------------------------------------------------

    log('=== Setting up WI-2 in review stage with Lynch claimed ===');

    await moveItem(wi2, 'ready', true);
    await trackedLogActivity('WI-2 dashboard widget API is ready (WI-1 dependency satisfied)', 'Hannibal');
    await sleep(DELAY);

    // Murdock writes tests for WI-2
    await agentStart(wi2, 'Murdock');
    await trackedLogActivity('Writing tests for dashboard widget data API', 'Murdock');

    await trackedPostCorrelationPair({
      agentName: 'Murdock',
      toolName: 'Write',
      preSummary: 'Writing src/__tests__/widget-api.test.ts',
      postSummary: 'Widget API test file written with 5 test cases',
      durationMs: 200,
    });

    await trackedPostHookEvent({
      eventType: 'subagent_start',
      agentName: 'Murdock',
      status: 'success',
      summary: 'Murdock subagent spawned for WI-2 widget API tests',
      timestamp: new Date().toISOString(),
    });

    await agentStop(wi2, 'Murdock', 'Widget API tests written: 5 test cases for GET endpoint, pagination, filtering');
    await sleep(DELAY);

    // B.A. implements WI-2
    await moveItem(wi2, 'implementing', true);
    await claimItem(wi2, 'B.A.');
    await trackedLogActivity('Implementing dashboard widget data API endpoints', 'B.A.');

    await trackedPostCorrelationPair({
      agentName: 'B.A.',
      toolName: 'Write',
      preSummary: 'Writing src/api/widgets/[id]/data/route.ts',
      postSummary: 'Widget data API route implemented with pagination',
      durationMs: 450,
    });

    await agentStop(wi2, 'B.A.', 'Widget data API complete, all 5 tests passing, p95 latency < 200ms');
    await sleep(DELAY);

    // WI-2 now in review with Lynch currently active
    await moveItem(wi2, 'review', true);
    await claimItem(wi2, 'Lynch');
    await trackedLogActivity('Reviewing dashboard widget API implementation', 'Lynch');
    activeClaimsSet++; // Lynch on WI-2

    await trackedPostCorrelationPair({
      agentName: 'Lynch',
      toolName: 'Read',
      preSummary: 'Reading src/api/widgets/[id]/data/route.ts',
      postSummary: 'Reviewing pagination logic and query efficiency',
      durationMs: 310,
    });

    // Lynch is still working (no agentStop yet — this is the "currently active" state)
    await sleep(DELAY);

    // -------------------------------------------------------------------------
    // WI-3: briefings → ready → testing → implementing (B.A. currently working)
    // -------------------------------------------------------------------------

    log('=== Setting up WI-3 in implementing stage with B.A. claimed ===');

    await moveItem(wi3, 'ready', true);
    await trackedLogActivity('WI-3 kanban drag-and-drop is ready for testing', 'Hannibal');
    await sleep(DELAY);

    await agentStart(wi3, 'Murdock');
    await trackedLogActivity('Writing drag-and-drop interaction tests', 'Murdock');

    await trackedPostCorrelationPair({
      agentName: 'Murdock',
      toolName: 'Write',
      preSummary: 'Writing src/__tests__/drag-drop.test.ts',
      postSummary: 'Drag-drop test file written with 3 test cases',
      durationMs: 170,
    });

    await trackedPostHookEvent({
      eventType: 'subagent_stop',
      agentName: 'Murdock',
      status: 'success',
      summary: 'Murdock subagent completed drag-drop test writing for WI-3',
      timestamp: new Date().toISOString(),
    });

    await agentStop(wi3, 'Murdock', 'Drag-drop tests: 3 cases covering column transfer, order persistence, mobile touch');
    await sleep(DELAY);

    // B.A. is currently implementing WI-3
    await moveItem(wi3, 'implementing', true);
    await claimItem(wi3, 'B.A.');
    await trackedLogActivity('Implementing kanban drag-and-drop with @dnd-kit/core', 'B.A.');
    activeClaimsSet++; // B.A. on WI-3

    await trackedPostCorrelationPair({
      agentName: 'B.A.',
      toolName: 'Edit',
      preSummary: 'Editing src/components/KanbanBoard.tsx to add DnD context',
      postSummary: 'KanbanBoard wrapped with DndContext and SortableContext',
      durationMs: 520,
    });

    // B.A. is still working (no agentStop yet)
    await sleep(DELAY);

    // -------------------------------------------------------------------------
    // WI-4: briefings → ready (no claim)
    // -------------------------------------------------------------------------

    log('=== Setting up WI-4 in ready stage (no claim) ===');

    await moveItem(wi4, 'ready', true);
    await trackedLogActivity('WI-4 activity feed pagination is ready for testing', 'Hannibal');
    await sleep(DELAY);

    // -------------------------------------------------------------------------
    // WI-5: briefings → ready → testing (Murdock currently working)
    // -------------------------------------------------------------------------

    log('=== Setting up WI-5 in testing stage with Murdock claimed ===');

    await moveItem(wi5, 'ready', true);
    await trackedLogActivity('WI-5 email notification service ready for testing', 'Hannibal');
    await sleep(DELAY);

    // Murdock is currently writing tests for WI-5
    await agentStart(wi5, 'Murdock');
    await trackedLogActivity('Writing email notification service tests', 'Murdock');
    activeClaimsSet++; // Murdock on WI-5

    await trackedPostCorrelationPair({
      agentName: 'Murdock',
      toolName: 'Read',
      preSummary: 'Reading PRD for email notification requirements and rate limit specs',
      postSummary: 'PRD read: email service requires SendGrid integration, 10/hr rate limit',
      durationMs: 90,
    });

    await trackedPostCorrelationPair({
      agentName: 'Murdock',
      toolName: 'Write',
      preSummary: 'Writing src/__tests__/email-service.test.ts',
      postSummary: 'Email service tests scaffolded, adding rate limit test cases',
      durationMs: 230,
    });

    // Murdock is still working (no agentStop yet)
    await sleep(DELAY);

    // -------------------------------------------------------------------------
    // EXTRA HOOK EVENTS: Face, Tawnia, Hannibal subagent events
    // -------------------------------------------------------------------------

    log('=== Posting additional hook events for all 7 agents ===');

    // Face - decomposition phase events
    await trackedPostHookEvent({
      eventType: 'subagent_start',
      agentName: 'Face',
      status: 'success',
      summary: 'Face subagent started to decompose PRD into work items',
      timestamp: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    });

    await trackedPostCorrelationPair({
      agentName: 'Face',
      toolName: 'Read',
      preSummary: 'Reading prd/demo-feature-dashboard.md for decomposition',
      postSummary: 'PRD parsed: 5 feature items identified across 3 dependency waves',
      durationMs: 280,
    });

    await trackedPostHookEvent({
      eventType: 'subagent_stop',
      agentName: 'Face',
      status: 'success',
      summary: 'Face decomposed PRD into 5 work items: WI-1 through WI-5',
      timestamp: new Date(Date.now() - 3500000).toISOString(),
    });

    // Tawnia - documentation events (from earlier in mission)
    await trackedPostHookEvent({
      eventType: 'subagent_start',
      agentName: 'Tawnia',
      status: 'success',
      summary: 'Tawnia documentation subagent started for mission init',
      timestamp: new Date(Date.now() - 3400000).toISOString(),
    });

    await trackedPostCorrelationPair({
      agentName: 'Tawnia',
      toolName: 'Edit',
      preSummary: 'Editing CHANGELOG.md to document new auth feature',
      postSummary: 'CHANGELOG updated with OAuth2 authentication section',
      durationMs: 140,
    });

    await trackedPostHookEvent({
      eventType: 'stop',
      agentName: 'Tawnia',
      status: 'success',
      summary: 'Tawnia documentation complete for WI-1',
      timestamp: new Date(Date.now() - 3300000).toISOString(),
    });

    // Hannibal orchestration events
    await trackedPostHookEvent({
      eventType: 'pre_tool_use',
      agentName: 'Hannibal',
      toolName: 'Bash',
      status: 'success',
      summary: 'Hannibal dispatching Murdock subagent for WI-5',
      timestamp: new Date().toISOString(),
    });

    // -------------------------------------------------------------------------
    // ACTIVITY LOG ENTRIES: Mission lifecycle
    // -------------------------------------------------------------------------

    log('=== Posting activity log entries ===');

    // Mission init
    await trackedLogActivity('Mission initialized: Demo Mission - Feature Dashboard', 'Hannibal');
    await trackedLogActivity('Running pre-mission checks...', 'Hannibal');
    await trackedLogActivity('Lint: PASSED', 'Hannibal');
    await trackedLogActivity('TypeCheck: PASSED', 'Hannibal');
    await trackedLogActivity('Unit Tests: PASSED (23/23)', 'Hannibal');
    await trackedLogActivity('Pre-mission checks complete. Starting pipeline.', 'Hannibal');
    await sleep(DELAY);

    // Face decomposition
    await trackedLogActivity('Decomposing PRD into work items...', 'Face');
    await trackedLogActivity('Identified 5 work items across 3 dependency waves', 'Face');
    await trackedLogActivity('Wave 0: WI-1 (no deps), WI-3 (no deps), WI-5 (no deps)', 'Face');
    await trackedLogActivity('Wave 1: WI-2 (depends on WI-1), WI-4 (no deps)', 'Face');
    await sleep(DELAY);

    // Hannibal dispatching agents
    await trackedLogActivity('Wave 0 started: dispatching Murdock for WI-1', 'Hannibal');
    await trackedLogActivity('WI-1 pipeline complete. OAuth2 auth shipped to production.', 'Hannibal');
    await trackedLogActivity('Wave 1 started: WI-2 unblocked by WI-1 completion', 'Hannibal');
    await trackedLogActivity('Pipeline status: WI-1 done, WI-2 in review, WI-3 implementing, WI-4 ready, WI-5 testing', 'Hannibal');
    await sleep(DELAY);

    // Agent work summaries
    await trackedLogActivity('Test suite complete: 4/4 passing for OAuth2 auth (WI-1)', 'Murdock');
    await trackedLogActivity('Implementation verified: 5/5 widget API tests passing (WI-2)', 'B.A.', 'info');
    await trackedLogActivity('APPROVED: WI-1 OAuth2 auth — clean implementation, well-tested, no security issues', 'Lynch');
    await trackedLogActivity('Probing complete: WI-1 passed Raptor Protocol. JWT expiry, CSRF, token rotation all verified.', 'Amy');

    // -------------------------------------------------------------------------
    // FINAL SUMMARY
    // -------------------------------------------------------------------------

    console.log('');
    log('========================================');
    log('  SEED COMPLETE');
    log('========================================');
    log('');
    log('Items created:');
    log(`  - WI-1 (done): User authentication via OAuth2`);
    log(`  - WI-2 (review, Lynch active): Dashboard widget data API`);
    log(`  - WI-3 (implementing, B.A. active): Kanban board drag-and-drop`);
    log(`  - WI-4 (ready, no claim): Activity feed pagination`);
    log(`  - WI-5 (testing, Murdock active): Email notification service`);
    log('');
    log('Summary:');
    log(`  Items created:           ${itemsCreated}`);
    log(`  Hook events posted:      ${hookEventsPosted}`);
    log(`  Activity entries logged: ${activityEntriesLogged}`);
    log(`  Active agent claims:     ${activeClaimsSet} (Lynch/WI-2, B.A./WI-3, Murdock/WI-5)`);
    log('');
    log('Agents represented in hook events:');
    log('  Hannibal, Face, Murdock, B.A., Lynch, Amy, Tawnia');
    log('');
    log('Denied hook events: 3');
    log('  - Murdock blocked from writing implementation (WI-1)');
    log('  - B.A. blocked from writing test file (WI-1)');
    log('  - Amy blocked from writing raptor test file (WI-1)');
    log('');
    log(`Open http://localhost:3000?projectId=${PROJECT_ID} to view the board.`);
    log('');

    process.exit(0);
  } catch (err) {
    error(`Seed failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error(err);
    process.exit(1);
  }
}

// Run the seed
main();
