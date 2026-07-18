/**
 * Unit tests for sendTokenUsage() — the centralized /api/hooks/token-usage
 * POST (lib/observer.js). Wire-level behavior (real subprocess, real server)
 * is covered in observe-per-message-emit.test.js; this file pins the guard
 * conditions and header contract at the function level.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendTokenUsage } from '../lib/observer.js';

const mockFetch = vi.fn();

const RECORD = {
  messageId: 'm1',
  model: 'claude-opus-4-8',
  inputTokens: 10,
  outputTokens: 5,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  agentName: 'murdock',
  timestamp: '2026-07-14T00:00:00.000Z',
};

describe('sendTokenUsage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, text: async () => '' });
    process.env.ATEAM_PROJECT_ID = 'test-project';
    process.env.ATEAM_API_URL = 'http://localhost:3000';
    delete process.env.ACCESS_CLIENT_ID;
    delete process.env.ACCESS_CLIENT_SECRET;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ATEAM_PROJECT_ID;
    delete process.env.ATEAM_API_URL;
    delete process.env.ACCESS_CLIENT_ID;
    delete process.env.ACCESS_CLIENT_SECRET;
  });

  it('returns false and does not POST for an empty records array', async () => {
    expect(await sendTokenUsage([])).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns false and does not POST for a non-array argument', async () => {
    // @ts-expect-error — intentional bad input; the guard must hold
    expect(await sendTokenUsage(undefined)).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips entirely when ATEAM_PROJECT_ID is unset', async () => {
    delete process.env.ATEAM_PROJECT_ID;
    expect(await sendTokenUsage([RECORD])).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POSTs the records with CF-Access headers when creds are present', async () => {
    process.env.ACCESS_CLIENT_ID = 'cf-id';
    process.env.ACCESS_CLIENT_SECRET = 'cf-secret';

    expect(await sendTokenUsage([RECORD])).toBe(true);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/hooks/token-usage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Project-ID': 'test-project',
          'CF-Access-Client-Id': 'cf-id',
          'CF-Access-Client-Secret': 'cf-secret',
        }),
        body: JSON.stringify([RECORD]),
      })
    );
  });

  it('omits CF-Access headers when creds are absent', async () => {
    // beforeEach deletes the creds — pin that the headers are truly absent,
    // not attached with blank values.
    expect(await sendTokenUsage([RECORD])).toBe(true);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers).not.toHaveProperty('CF-Access-Client-Id');
    expect(options.headers).not.toHaveProperty('CF-Access-Client-Secret');
    expect(options.headers['X-Project-ID']).toBe('test-project');
  });

  it('returns false (never throws) on a non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 302, text: async () => 'redirect' });
    expect(await sendTokenUsage([RECORD])).toBe(false);
  });

  it('returns false (never throws) on a network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await sendTokenUsage([RECORD])).toBe(false);
  });

  it('falls back to the default timeout for invalid ATEAM_TOKEN_USAGE_TIMEOUT_MS values', async () => {
    // AbortSignal.timeout THROWS on negative/fractional/infinite delays; if a
    // bad env value reached it, the fire-and-forget catch would silently kill
    // every POST. The validator must fall back so the POST still succeeds.
    for (const bad of ['-100', '1.5', 'Infinity', 'abc', '0']) {
      mockFetch.mockClear();
      process.env.ATEAM_TOKEN_USAGE_TIMEOUT_MS = bad;
      expect(await sendTokenUsage([RECORD])).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    delete process.env.ATEAM_TOKEN_USAGE_TIMEOUT_MS;
  });
});
