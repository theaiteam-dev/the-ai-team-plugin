/**
 * Tests for scripts/hooks/lib/send-denied-event.js
 *
 * sendDeniedEvent({ agentName, toolName, reason }) is a fire-and-forget
 * utility that POSTs a "denied" hook event to the A(i)-Team API for Raw
 * Agent View telemetry. It mirrors the sendObserverEvent() pattern in
 * observer.js but always uses eventType "pre_tool_use" and status "denied".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendDeniedEvent } from '../lib/send-denied-event.js';

// Mock fetch globally so no real HTTP calls go out
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('sendDeniedEvent()', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    process.env.ATEAM_API_URL = 'http://localhost:3000';
    process.env.ATEAM_PROJECT_ID = 'test-project';
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  // -------------------------------------------------------------------------
  // 1. Payload construction
  // -------------------------------------------------------------------------
  it('builds payload with correct eventType, status, agentName, toolName, and summary', async () => {
    await sendDeniedEvent({ agentName: 'murdock', toolName: 'Write', reason: 'BLOCKED: Murdock cannot write impl files' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(body.eventType).toBe('pre_tool_use');
    expect(body.status).toBe('denied');
    expect(body.agentName).toBe('murdock');
    expect(body.toolName).toBe('Write');
    expect(body.summary).toBe('BLOCKED: Murdock cannot write impl files');
  });

  // -------------------------------------------------------------------------
  // 2. API endpoint and headers
  // -------------------------------------------------------------------------
  it('POSTs to ${ATEAM_API_URL}/api/hooks/events with correct headers', async () => {
    await sendDeniedEvent({ agentName: 'ba', toolName: 'Edit', reason: 'BLOCKED: B.A. cannot edit test files' });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/hooks/events');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['X-Project-ID']).toBe('test-project');
  });

  // CF-Access: the hosted kanban viewer is behind Cloudflare Access, so the
  // service-token headers are required or the event is silently dropped. These
  // stub the creds explicitly (never rely on the ambient shell, which on a real
  // machine DOES export them) so the assertions are deterministic either way.
  it('adds CF-Access service-token headers when ACCESS_CLIENT_ID/SECRET are set', async () => {
    process.env.ACCESS_CLIENT_ID = 'cf-client-id.access';
    process.env.ACCESS_CLIENT_SECRET = 'cf-client-secret';

    await sendDeniedEvent({ agentName: 'ba', toolName: 'Edit', reason: 'BLOCKED' });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['CF-Access-Client-Id']).toBe('cf-client-id.access');
    expect(init.headers['CF-Access-Client-Secret']).toBe('cf-client-secret');
  });

  it('omits CF-Access headers when creds are absent (never sends undefined)', async () => {
    delete process.env.ACCESS_CLIENT_ID;
    delete process.env.ACCESS_CLIENT_SECRET;

    await sendDeniedEvent({ agentName: 'ba', toolName: 'Edit', reason: 'BLOCKED' });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).not.toHaveProperty('CF-Access-Client-Id');
    expect(init.headers).not.toHaveProperty('CF-Access-Client-Secret');
  });

  // -------------------------------------------------------------------------
  // 3. Fire-and-forget — does NOT throw on network failure
  // -------------------------------------------------------------------------
  it('does not throw when fetch rejects (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      sendDeniedEvent({ agentName: 'amy', toolName: 'Write', reason: 'BLOCKED: Amy cannot write' })
    ).resolves.not.toThrow();
  });

  it('does not throw when API returns non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'Server Error' });

    await expect(
      sendDeniedEvent({ agentName: 'lynch', toolName: 'Write', reason: 'BLOCKED: Lynch cannot write' })
    ).resolves.not.toThrow();
  });

  // -------------------------------------------------------------------------
  // 4. UUID correlationId and ISO 8601 timestamp
  // -------------------------------------------------------------------------
  it('includes a valid UUID v4 correlationId and ISO 8601 timestamp', async () => {
    await sendDeniedEvent({ agentName: 'sosa', toolName: 'Write', reason: 'BLOCKED: Sosa cannot write' });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(body.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });

  it('generates a unique correlationId on each call', async () => {
    await sendDeniedEvent({ agentName: 'murdock', toolName: 'Write', reason: 'BLOCKED' });
    await sendDeniedEvent({ agentName: 'murdock', toolName: 'Write', reason: 'BLOCKED' });

    const body1 = JSON.parse(mockFetch.mock.calls[0][1].body);
    const body2 = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body1.correlationId).not.toBe(body2.correlationId);
  });

  // -------------------------------------------------------------------------
  // 5. Default env fallbacks
  // -------------------------------------------------------------------------
  it('falls back to http://localhost:3000 when ATEAM_API_URL is unset', async () => {
    delete process.env.ATEAM_API_URL;

    await sendDeniedEvent({ agentName: 'ba', toolName: 'Edit', reason: 'BLOCKED' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/hooks/events');
  });

  it('falls back to "default" project ID when ATEAM_PROJECT_ID is unset', async () => {
    delete process.env.ATEAM_PROJECT_ID;

    await sendDeniedEvent({ agentName: 'ba', toolName: 'Edit', reason: 'BLOCKED' });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['X-Project-ID']).toBe('default');
  });

  it('strips trailing slash from ATEAM_API_URL to avoid double slashes', async () => {
    process.env.ATEAM_API_URL = 'http://localhost:3000/';

    await sendDeniedEvent({ agentName: 'lynch', toolName: 'Write', reason: 'BLOCKED' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/hooks/events');
    expect(url).not.toContain('//api');
  });
});
