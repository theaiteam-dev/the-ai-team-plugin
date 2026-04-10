import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for POST / GET /api/missions/[missionId]/final-review
 *
 * These routes store and retrieve the Stockwell final mission review report.
 *
 * Guardrails under test:
 * 1. POST validates the `finalReview` body field — must be present and a non-empty string
 * 2. Both POST and GET scope the mission lookup to the requesting project so one project
 *    cannot read or write another project's mission even if it knows the mission ID
 * 3. Cross-project requests return 404 MISSION_NOT_FOUND without leaking existence
 */

// Mock Prisma client
const mockPrisma = vi.hoisted(() => ({
  mission: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

import { POST, GET } from '@/app/api/missions/[missionId]/final-review/route';

function buildRequest(projectId: string, body?: unknown): Request {
  return new Request('http://localhost:3000/api/missions/M-001/final-review', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Project-ID': projectId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function buildGetRequest(projectId: string): Request {
  return new Request('http://localhost:3000/api/missions/M-001/final-review', {
    method: 'GET',
    headers: { 'X-Project-ID': projectId },
  });
}

function buildContext(missionId: string) {
  return { params: Promise.resolve({ missionId }) };
}

const mockMissionProjectA = {
  id: 'M-001',
  projectId: 'project-a',
  name: 'Mission for Project A',
  finalReview: null,
};

describe('POST /api/missions/[missionId]/final-review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('finalReview body validation', () => {
    it('accepts a valid finalReview string and writes it to the DB', async () => {
      mockPrisma.mission.findFirst.mockResolvedValue(mockMissionProjectA);
      mockPrisma.mission.update.mockResolvedValue({
        ...mockMissionProjectA,
        finalReview: '# Final Review\n\nAll good.',
      });

      const req = buildRequest('project-a', { finalReview: '# Final Review\n\nAll good.' });
      const res = await POST(req, buildContext('M-001'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.missionId).toBe('M-001');

      expect(mockPrisma.mission.update).toHaveBeenCalledWith({
        where: { id: 'M-001' },
        data: { finalReview: '# Final Review\n\nAll good.' },
      });
    });

    it('returns 400 VALIDATION_ERROR when body is empty object', async () => {
      const req = buildRequest('project-a', {});
      const res = await POST(req, buildContext('M-001'));

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      // Must not have touched the DB
      expect(mockPrisma.mission.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.mission.update).not.toHaveBeenCalled();
    });

    it('returns 400 VALIDATION_ERROR when finalReview is a number', async () => {
      const req = buildRequest('project-a', { finalReview: 42 });
      const res = await POST(req, buildContext('M-001'));

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(mockPrisma.mission.update).not.toHaveBeenCalled();
    });

    it('returns 400 VALIDATION_ERROR when finalReview is an empty string', async () => {
      const req = buildRequest('project-a', { finalReview: '' });
      const res = await POST(req, buildContext('M-001'));

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(mockPrisma.mission.update).not.toHaveBeenCalled();
    });

    it('returns 400 VALIDATION_ERROR when finalReview is null', async () => {
      const req = buildRequest('project-a', { finalReview: null });
      const res = await POST(req, buildContext('M-001'));

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(mockPrisma.mission.update).not.toHaveBeenCalled();
    });
  });

  describe('project scoping', () => {
    it('succeeds when project A stores a review for its own mission', async () => {
      mockPrisma.mission.findFirst.mockResolvedValue(mockMissionProjectA);
      mockPrisma.mission.update.mockResolvedValue({
        ...mockMissionProjectA,
        finalReview: 'review body',
      });

      const req = buildRequest('project-a', { finalReview: 'review body' });
      const res = await POST(req, buildContext('M-001'));

      expect(res.status).toBe(200);
      // The lookup must include projectId in its where clause
      expect(mockPrisma.mission.findFirst).toHaveBeenCalledWith({
        where: { id: 'M-001', projectId: 'project-a' },
      });
    });

    it('returns 404 MISSION_NOT_FOUND when project B targets a project A mission', async () => {
      // From project B's perspective, findFirst returns null because the projectId filter
      // excludes project A's mission. The response must NOT distinguish from "missing".
      mockPrisma.mission.findFirst.mockResolvedValue(null);

      const req = buildRequest('project-b', { finalReview: 'evil write' });
      const res = await POST(req, buildContext('M-001'));

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('MISSION_NOT_FOUND');

      // Project B must NOT have triggered an update on project A's mission
      expect(mockPrisma.mission.update).not.toHaveBeenCalled();

      // And the lookup must have been scoped to project-b
      expect(mockPrisma.mission.findFirst).toHaveBeenCalledWith({
        where: { id: 'M-001', projectId: 'project-b' },
      });
    });
  });
});

describe('GET /api/missions/[missionId]/final-review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the finalReview for a mission that belongs to the requesting project', async () => {
    mockPrisma.mission.findFirst.mockResolvedValue({ finalReview: '# Stored review' });

    const req = buildGetRequest('project-a');
    const res = await GET(req, buildContext('M-001'));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.finalReview).toBe('# Stored review');
    expect(data.data.missionId).toBe('M-001');

    expect(mockPrisma.mission.findFirst).toHaveBeenCalledWith({
      where: { id: 'M-001', projectId: 'project-a' },
      select: { finalReview: true },
    });
  });

  it('returns 404 MISSION_NOT_FOUND when project B tries to read a project A mission', async () => {
    // Scoped lookup returns null because projectId filter excludes it
    mockPrisma.mission.findFirst.mockResolvedValue(null);

    const req = buildGetRequest('project-b');
    const res = await GET(req, buildContext('M-001'));

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.code).toBe('MISSION_NOT_FOUND');

    expect(mockPrisma.mission.findFirst).toHaveBeenCalledWith({
      where: { id: 'M-001', projectId: 'project-b' },
      select: { finalReview: true },
    });
  });
});
