import { describe, it, expect, afterEach } from 'vitest';
import { getMissionAttachGraceMinutes } from '@/lib/mission-attach';

/**
 * Env validation for the mission-attach grace window. Mirrors the
 * ATEAM_REJECTION_CAP pattern: non-integer or non-positive values must fall
 * back to the default rather than producing a zero/negative window.
 */
describe('getMissionAttachGraceMinutes', () => {
  afterEach(() => {
    delete process.env.ATEAM_MISSION_ATTACH_GRACE_MINUTES;
  });

  it('defaults to 60 when unset or empty', () => {
    delete process.env.ATEAM_MISSION_ATTACH_GRACE_MINUTES;
    expect(getMissionAttachGraceMinutes()).toBe(60);
    process.env.ATEAM_MISSION_ATTACH_GRACE_MINUTES = '';
    expect(getMissionAttachGraceMinutes()).toBe(60);
  });

  it('uses a valid positive integer override', () => {
    process.env.ATEAM_MISSION_ATTACH_GRACE_MINUTES = '180';
    expect(getMissionAttachGraceMinutes()).toBe(180);
  });

  it('falls back to the default for non-integer, zero, and negative values', () => {
    for (const bad of ['abc', '1.5', '0', '-5', 'NaN']) {
      process.env.ATEAM_MISSION_ATTACH_GRACE_MINUTES = bad;
      expect(getMissionAttachGraceMinutes()).toBe(60);
    }
  });
});
