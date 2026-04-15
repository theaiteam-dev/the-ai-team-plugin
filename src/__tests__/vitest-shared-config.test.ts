/**
 * Smoke tests for root vitest config — packages/shared coverage.
 *
 * Verifies that after updating vitest.config.ts, the packages/shared
 * test files are included in discovery and not blocked by the exclude list.
 */

import { describe, it, expect } from 'vitest';
import micromatch from 'micromatch';
import config from '../../vitest.config.ts';

const SHARED_TEST_PATH = 'packages/shared/src/__tests__/example.test.ts';

describe('root vitest config — packages/shared coverage', () => {
  it('include patterns match packages/shared test files', () => {
    const includes: string[] = (config as any).test?.include ?? [];
    expect(micromatch.isMatch(SHARED_TEST_PATH, includes)).toBe(true);
  });

  it('exclude patterns do not block packages/shared test files', () => {
    const excludes: string[] = (config as any).test?.exclude ?? [];
    expect(micromatch.isMatch(SHARED_TEST_PATH, excludes)).toBe(false);
  });
});
