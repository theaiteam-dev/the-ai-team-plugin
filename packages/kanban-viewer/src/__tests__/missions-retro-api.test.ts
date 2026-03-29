import { describe, it, expect, beforeEach } from 'vitest';
import { POST, GET } from '@/app/api/missions/[missionId]/retro/route';
import { prisma } from '@/lib/db';

/**
 * Tests for the retro report API endpoints (WI-011).
 *
 * POST /api/missions/:missionId/retro
 *   Stores retroReport markdown text on the mission record.
 *
 * GET /api/missions/:missionId/retro
 *   Returns the stored retro report for the mission.
 *
 * Both endpoints return 404 when the mission does not exist.
 */

const PROJECT_ID = 'test-retro-project';
const MISSION_ID = 'M-20260329-retro-test';

function makeRequest(method: string, body?: unknown) {
  return new Request(`http://localhost:3000/api/missions/${MISSION_ID}/retro`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Project-ID': PROJECT_ID,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const routeParams = { params: Promise.resolve({ missionId: MISSION_ID }) };

beforeEach(async () => {
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {},
    create: { id: PROJECT_ID, name: 'Retro API Test Project' },
  });

  await prisma.mission.upsert({
    where: { id: MISSION_ID },
    update: { retroReport: null },
    create: {
      id: MISSION_ID,
      name: 'Retro Test Mission',
      state: 'completed',
      prdPath: '/prd/test.md',
      projectId: PROJECT_ID,
      startedAt: new Date(),
    },
  });
});

describe('POST /api/missions/:missionId/retro', () => {
  it('should store retroReport and return 200 with success', async () => {
    const report = '## Retro\n\n### What went well\n- Fast delivery\n\n### What to improve\n- More tests';
    const response = await POST(makeRequest('POST', { retroReport: report }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.missionId).toBe(MISSION_ID);

    const saved = await prisma.mission.findUnique({ where: { id: MISSION_ID } });
    expect(saved?.retroReport).toBe(report);
  });

  it('should return 404 when mission does not exist', async () => {
    const missingParams = { params: Promise.resolve({ missionId: 'M-does-not-exist' }) };
    const response = await POST(
      new Request('http://localhost:3000/api/missions/M-does-not-exist/retro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': PROJECT_ID },
        body: JSON.stringify({ retroReport: 'some report' }),
      }),
      missingParams
    );

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.success).toBe(false);
  });
});

describe('GET /api/missions/:missionId/retro', () => {
  it('should return the stored retro report', async () => {
    const report = '## Sprint Retro\n\nGreat sprint overall.';

    // Store it first
    await POST(makeRequest('POST', { retroReport: report }), routeParams);

    // Then fetch it
    const response = await GET(makeRequest('GET'), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.missionId).toBe(MISSION_ID);
    expect(data.data.retroReport).toBe(report);
  });

  it('should return 404 when mission does not exist', async () => {
    const missingParams = { params: Promise.resolve({ missionId: 'M-does-not-exist' }) };
    const response = await GET(
      new Request('http://localhost:3000/api/missions/M-does-not-exist/retro', {
        method: 'GET',
        headers: { 'X-Project-ID': PROJECT_ID },
      }),
      missingParams
    );

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.success).toBe(false);
  });
});
