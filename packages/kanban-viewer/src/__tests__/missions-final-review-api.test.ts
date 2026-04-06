import { describe, it, expect, beforeEach } from 'vitest';
import { POST, GET } from '@/app/api/missions/[missionId]/final-review/route';
import { prisma } from '@/lib/db';

/**
 * Tests for the final review report API endpoints.
 *
 * POST /api/missions/:missionId/final-review
 *   Stores finalReview markdown text on the mission record.
 *
 * GET /api/missions/:missionId/final-review
 *   Returns the stored final review report for the mission.
 *
 * Both endpoints return 404 when the mission does not exist.
 */

const PROJECT_ID = 'test-final-review-project';
const MISSION_ID = 'M-20260406-final-review-test';

function makeRequest(method: string, body?: unknown) {
  return new Request(`http://localhost:3000/api/missions/${MISSION_ID}/final-review`, {
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
    create: { id: PROJECT_ID, name: 'Final Review API Test Project' },
  });

  await prisma.mission.upsert({
    where: { id: MISSION_ID },
    update: { finalReview: null },
    create: {
      id: MISSION_ID,
      name: 'Final Review Test Mission',
      state: 'completed',
      prdPath: '/prd/test.md',
      projectId: PROJECT_ID,
      startedAt: new Date(),
    },
  });
});

describe('POST /api/missions/:missionId/final-review', () => {
  it('should store finalReview and return 200 with success', async () => {
    const report = '## Final Review\n\n### Verdict: APPROVED\n\n- All PRD requirements met\n- 12 tests passing\n- No security issues';
    const response = await POST(makeRequest('POST', { finalReview: report }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.missionId).toBe(MISSION_ID);

    const saved = await prisma.mission.findUnique({ where: { id: MISSION_ID } });
    expect(saved?.finalReview).toBe(report);
  });

  it('should return 404 when mission does not exist', async () => {
    const missingParams = { params: Promise.resolve({ missionId: 'M-does-not-exist' }) };
    const response = await POST(
      new Request('http://localhost:3000/api/missions/M-does-not-exist/final-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': PROJECT_ID },
        body: JSON.stringify({ finalReview: 'some report' }),
      }),
      missingParams
    );

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.success).toBe(false);
  });
});

describe('GET /api/missions/:missionId/final-review', () => {
  it('should return the stored final review report', async () => {
    const report = '## Final Review\n\nFINAL APPROVED - all requirements addressed.';

    // Store it first
    await POST(makeRequest('POST', { finalReview: report }), routeParams);

    // Then fetch it
    const response = await GET(makeRequest('GET'), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.missionId).toBe(MISSION_ID);
    expect(data.data.finalReview).toBe(report);
  });

  it('should return 404 when mission does not exist', async () => {
    const missingParams = { params: Promise.resolve({ missionId: 'M-does-not-exist' }) };
    const response = await GET(
      new Request('http://localhost:3000/api/missions/M-does-not-exist/final-review', {
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
