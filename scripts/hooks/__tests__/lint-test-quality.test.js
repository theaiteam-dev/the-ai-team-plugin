/**
 * Tests for lint-test-quality.js hook.
 *
 * Covers:
 * 1. Type-shape detector does NOT count matcher calls as "real behavior" (#9)
 * 2. import type is ignored by mock-your-own-subject check (#10)
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';

const HOOK = join(import.meta.dirname, '..', 'lint-test-quality.js');

function runHook(fileContent, filePath = 'src/foo.test.ts') {
  const stdin = {
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content: fileContent,
    },
  };
  try {
    const stdout = execFileSync('node', [HOOK], {
      encoding: 'utf8',
      timeout: 5000,
      input: JSON.stringify(stdin),
    });
    return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || '').trim(),
      exitCode: err.status ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Fix #9: Type-shape detector — matcher calls must not count as "real calls"
// ---------------------------------------------------------------------------

describe('type-shape detector — matcher calls are not real behavior (#9)', () => {
  it('flags a file that only imports types and uses expect().toEqual() on a literal', () => {
    const content = `
import type { Order } from './types/order';

test('order shape', () => {
  const o: Order = { id: 1, total: 0 };
  expect(o).toEqual({ id: 1, total: 0 });
});
`;
    const result = runHook(content);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Type-shape test detected');
  });

  it('flags a file using .toBe() on a literal (no real function calls)', () => {
    const content = `
import type { Status } from './types/status';

test('status literal', () => {
  const s: Status = 'active';
  expect(s).toBe('active');
});
`;
    const result = runHook(content);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Type-shape test detected');
  });

  it('does NOT flag a file that calls a real function (even with type imports)', () => {
    const content = `
import type { Order } from './types/order';
import { createOrder } from './order-service';

test('createOrder returns expected shape', () => {
  const result = createOrder({ items: [] });
  expect(result).toEqual({ id: 1, total: 0 });
});
`;
    const result = runHook(content);
    expect(result.exitCode).toBe(0);
  });

  it('does NOT flag a file that awaits an async function', () => {
    const content = `
import type { Order } from './types/order';
import { fetchOrder } from './order-service';

test('fetchOrder resolves', async () => {
  const result = await fetchOrder(1);
  expect(result).toEqual({ id: 1, total: 0 });
});
`;
    const result = runHook(content);
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fix #10: import type must be ignored by mock-your-own-subject check
// ---------------------------------------------------------------------------

describe('mock-your-own-subject — import type is ignored (#10)', () => {
  it('does NOT flag vi.mock when the only import is import type', () => {
    const content = `
import { vi, test, expect } from 'vitest';
import type { Foo } from './foo';

vi.mock('./foo');

test('mocked foo works', () => {
  const { doThing } = require('./foo');
  expect(doThing()).toBe('mocked');
});
`;
    const result = runHook(content);
    // Should not trigger mock-your-own-subject
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Mock-your-own-subject');
  });

  it('still flags vi.mock when there is a real (non-type) import from the same path', () => {
    const content = `
import { doThing } from './foo';
import { vi, test, expect } from 'vitest';

vi.mock('./foo');

test('mocked foo', () => {
  expect(doThing()).toBe('mocked');
});
`;
    const result = runHook(content);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Mock-your-own-subject");
    expect(result.stderr).toContain('./foo');
  });

  it('does NOT flag when both a real import and import type exist from different paths', () => {
    const content = `
import { helper } from './utils';
import type { Foo } from './foo';
import { vi, test, expect } from 'vitest';

vi.mock('./foo');

test('uses helper, mocks foo', () => {
  expect(helper()).toBe('ok');
});
`;
    const result = runHook(content);
    // ./foo is only type-imported, ./utils is real-imported but not mocked — no violation
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Mock-your-own-subject');
  });
});
