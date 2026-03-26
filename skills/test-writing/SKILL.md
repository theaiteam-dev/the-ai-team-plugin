---
name: test-writing
description: Comprehensive test quality guardrails for AI testing agents. Banned anti-patterns with code examples, the litmus test, and positive guidance for writing tests that actually verify production behavior.
---

# Test Writing Skill

Every test must exercise real application code and assert on an observable outcome. If it does not call real code, it is not a test.

---

## Banned Anti-Patterns

### 1. Type-Shape Tests (BANNED)

Tests that import types and assert object literals equal themselves. TypeScript already validates shapes at compile time. These tests pass even if every production function is deleted.

```typescript
// BAD: Tests nothing - TypeScript already enforces this
import { User } from '../types';
it('has correct shape', () => {
  const user: User = { id: '1', name: 'Alice', email: 'a@b.com' };
  expect(user.id).toBe('1');
  expect(user.name).toBe('Alice');
});

// GOOD: Test a function that produces or consumes the type
import { createUser } from '../services/user';
it('creates a user with generated ID', () => {
  const user = createUser({ name: 'Alice', email: 'a@b.com' });
  expect(user.id).toMatch(/^usr_/);
  expect(user.name).toBe('Alice');
});
```

### 2. Mocking Your Own Subject (BANNED)

Tests that `vi.mock()` the module under test, then call the mock. You are testing the mock framework, not your code.

```typescript
// BAD: Mocks the module it is supposed to test
vi.mock('../services/order', () => ({
  calculateTotal: vi.fn().mockReturnValue(42),
}));
import { calculateTotal } from '../services/order';
it('calculates total', () => {
  expect(calculateTotal([{ price: 10, qty: 2 }])).toBe(42); // tests the mock
});

// GOOD: Import the real module, mock only its dependencies
import { calculateTotal } from '../services/order';
it('calculates total with tax', () => {
  const items = [{ price: 10, qty: 2 }, { price: 5, qty: 1 }];
  expect(calculateTotal(items, { taxRate: 0.1 })).toBe(27.5);
});
```

### 3. Tailwind CSS Class Assertions (BANNED)

`toHaveClass` with Tailwind utilities tests styling strings, not behavior. JSDOM does not compute CSS. These pass on broken layouts and fail on harmless refactors.

```typescript
// BAD: Tests a class name string, not behavior
render(<StatusBadge status="active" />);
const badge = screen.getByText('Active');
expect(badge).toHaveClass('bg-green-500 rounded-full text-white');

// GOOD: Test behavior and accessibility
render(<StatusBadge status="active" />);
expect(screen.getByText('Active')).toBeInTheDocument();
expect(screen.getByRole('status')).toHaveAccessibleName('Active');
```

### 4. Source File Regex Matching (BANNED)

Using `readFileSync` to read production code as strings and regex-match. Tests must render or execute code, not pattern-match source text.

```typescript
// BAD: Reads source code as a string
const src = readFileSync('src/services/auth.ts', 'utf-8');
expect(src).toMatch(/async function authenticate/);
expect(src).toContain('bcrypt.compare');

// GOOD: Call the function and observe behavior
import { authenticate } from '../services/auth';
it('rejects invalid credentials', async () => {
  await expect(authenticate('user', 'wrong')).rejects.toThrow('Invalid credentials');
});
```

### 5. Local Reimplementations (BANNED)

Defining the function-under-test inside the test file. Always import from production code. A locally defined copy can drift from the real implementation silently.

```typescript
// BAD: Reimplements the function in the test
function slugify(s: string) { return s.toLowerCase().replace(/\s+/g, '-'); }
it('slugifies a string', () => {
  expect(slugify('Hello World')).toBe('hello-world');
});

// GOOD: Import the real function
import { slugify } from '../utils/string';
it('slugifies a string', () => {
  expect(slugify('Hello World')).toBe('hello-world');
});
```

### 6. Tautological Mock Assertions (BANNED)

Mocking a function to return X, calling it, then asserting it was called. The result assertion is the test; the call assertion is noise that tests the mock framework.

```typescript
// BAD: Asserts the mock was called (tautological)
const fetchUser = vi.fn().mockResolvedValue({ id: '1', name: 'Alice' });
const result = await fetchUser('1');
expect(fetchUser).toHaveBeenCalledWith('1'); // proves nothing
expect(result.name).toBe('Alice');           // also proves nothing - mock returns this regardless

// GOOD: Mock the dependency, test the real consumer
vi.mock('../api/client');
import { getUserProfile } from '../services/profile';
it('returns formatted profile', async () => {
  apiClient.get.mockResolvedValue({ id: '1', name: 'Alice', joined: '2024-01-01' });
  const profile = await getUserProfile('1');
  expect(profile.displayName).toBe('Alice');
  expect(profile.memberSince).toBe('January 2024');
});
```

### 7. Conditional Fallback Paths (BANNED)

`if/else` inside tests where the else branch silently passes. This hides failures by letting the test take an alternate path that always succeeds.

```typescript
// BAD: Silent fallback if element is missing
const button = screen.queryByRole('button', { name: 'Submit' });
if (button) {
  expect(button).toBeEnabled();
} else {
  expect(true).toBe(true); // silently passes when button is missing
}

// GOOD: Assert existence unconditionally, then test behavior
const button = screen.getByRole('button', { name: 'Submit' });
expect(button).toBeEnabled();
```

### 8. OR-Pattern Assertions (BANNED)

Using `??`, `||`, or `oneOf` to accept any of several values. Pin the single expected value. If the value can legitimately vary, parameterize the test.

```typescript
// BAD: Accepts multiple values - masks bugs
const status = getOrderStatus(order);
expect(['pending', 'processing', 'shipped']).toContain(status);

// also BAD:
const label = getLabel() ?? 'fallback';
expect(label).toBe('fallback'); // hides the fact that getLabel() returned undefined

// GOOD: Pin the exact expected value
const status = getOrderStatus(completedOrder);
expect(status).toBe('shipped');
```

### 9. No-Op Assertions (BANNED)

Assertions that can never fail regardless of application state. These inflate test counts and mislead.

```typescript
// BAD: Always passes
expect(true).toBe(true);
expect(items.length).toBeGreaterThanOrEqual(0); // arrays always have length >= 0
expect(result).toBeDefined(); // passes for any non-undefined value including wrong ones

// GOOD: Assert specific expected outcomes
expect(items).toHaveLength(3);
expect(result).toEqual({ id: '1', status: 'active' });
```

### 10. Hardcoded Counts (FRAGILE)

`toHaveLength(22)` breaks when features are added. Test structural properties or derive the count from the source of truth.

```typescript
// BAD: Breaks every time a route is added
expect(Object.keys(routes)).toHaveLength(22);

// GOOD: Test structural properties
expect(routes).toHaveProperty('/api/users');
expect(routes['/api/users'].methods).toContain('GET');

// ALSO GOOD: Derive count from source of truth
import { FEATURE_FLAGS } from '../config';
expect(Object.keys(routes)).toHaveLength(Object.keys(FEATURE_FLAGS).length);
```

---

## What Makes a Good Test

A valid test:

- **Imports and calls real production code** -- no local reimplementations, no mocked subjects
- **Tests behavior, not implementation** -- asserts on outputs, side effects, rendered content
- **Would fail if the code under test were broken** -- deleting the production function causes a red test
- **Would NOT fail on a safe refactor** -- renaming internals or reordering code does not break it
- **Has clear arrange-act-assert structure** -- setup, one action, focused assertions
- **Covers a real scenario** -- a bug, an edge case, a business rule, or a user interaction

---

## The Litmus Test

For every test, ask:

> "If I deleted the production function this test covers, would this test fail?"

If the answer is **no**, the test is invalid. Delete it.

A secondary check:

> "If I introduced a bug in the production function (wrong return value, missing validation, swapped arguments), would this test catch it?"

If the answer is **no**, the test is not useful. Rewrite it to assert on real behavior.

---

## Self-Check Before Submitting

For every test file, verify:

1. Every `it()` block calls at least one function imported from production code.
2. Every `expect()` asserts on a value produced by that production code.
3. No `vi.mock()` targets the module being tested.
4. No `if/else` branches exist inside test bodies.
5. No assertion uses `??`, `||`, or accepts multiple possible values.
6. No assertion is trivially true (`toBeDefined()` on a known value, `>= 0` on a length).
7. No source files are read as strings for regex matching.
8. No functions are redefined locally instead of imported.

See `references/testing-anti-patterns.md` for extended examples of each banned pattern.
See `references/testing-good-patterns.md` for positive examples of behavior-focused testing.
