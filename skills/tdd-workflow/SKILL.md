# TDD Workflow Skill

Test-Driven Development guidance for the A(i)-Team.

## The TDD Cycle

```
   ┌─────────────────────────────────────────┐
   │                                         │
   │    RED → GREEN → REFACTOR → REPEAT      │
   │                                         │
   └─────────────────────────────────────────┘
```

### 1. RED - Write a Failing Test

**Murdock's domain.**

- Write a test that describes the desired behavior
- The test MUST fail (no implementation exists)
- The failure should be for the RIGHT reason (missing code, not syntax error)

```typescript
it('should return user by ID', () => {
  const user = userService.getById('123');
  expect(user.id).toBe('123');
  expect(user.name).toBeDefined();
});
// FAILS: userService.getById is not defined
```

### 2. GREEN - Make It Pass

**B.A.'s domain.**

- Write the MINIMUM code to make the test pass
- Don't over-engineer
- Don't add features not covered by tests
- Ugly is OK at this stage

```typescript
function getById(id: string): User {
  return { id, name: 'Hardcoded' }; // Just enough to pass
}
// PASSES
```

### 3. REFACTOR - Improve the Code

**B.A.'s domain (with Lynch watching).**

- Clean up the implementation
- Remove duplication
- Improve naming
- Tests MUST still pass after refactoring

```typescript
function getById(id: string): User {
  return users.find(u => u.id === id) ?? notFound(id);
}
// STILL PASSES
```

### 4. REPEAT

- Add the next test
- Make it pass
- Refactor
- Continue until all acceptance criteria are met

## Work Item Ordering

The A(i)-Team enforces TDD through its pipeline stages. Each work item flows through stages in strict order:

```
briefings → ready → testing (Murdock) → implementing (B.A.) → review (Lynch) → probing (Amy) → done
```

The pipeline enforces the TDD contract:
- Murdock writes tests and types first (RED phase)
- B.A. implements to pass those tests (GREEN phase)
- B.A. refactors for clarity (REFACTOR phase)
- Lynch verifies tests + implementation as a cohesive unit
- Amy probes for bugs that tests missed

## Benefits of TDD in A(i)-Team

### 1. Clear Acceptance Criteria
Tests define "done" unambiguously. B.A. knows exactly what to build.

### 2. Parallel Safety
Tests and implementations can't conflict because tests come first.

### 3. Quality Gate
Lynch reviews against tests. If tests pass and match spec, it ships.

### 4. Fearless Refactoring
After tests pass, B.A. can improve code knowing tests catch regressions.

## Test Types

### Unit Tests
- Test single functions/methods
- Mock dependencies
- Fast execution
- High coverage

### Integration Tests
- Test component interactions
- Minimal mocking
- Verify wiring
- Medium coverage

### End-to-End Tests
- Test full user flows
- No mocking
- Slow but comprehensive
- Critical paths only

## Test Granularity by Work Item Type

**The `type` field determines how many tests to write:**

| Type | Test Count | Focus |
|------|------------|-------|
| `feature` | 3-5 tests | Happy path, error path, key edge cases |
| `task` | 1-3 smoke tests | "Does it compile? Does it run? Does it integrate?" |
| `bug` | 2-3 tests | Reproduce bug, verify fix, regression guard |
| `enhancement` | 2-4 tests | New/changed behavior only |

### Scaffolding Work (`type: "task"`)

Scaffolding items need minimal testing — but the tests must verify the **toolchain works end-to-end**, not just that files exist on disk.

**The TDD cycle for scaffolds:**
- **RED:** The build produces nothing (no project exists yet)
- **GREEN:** The build produces expected artifacts (non-zero CSS, JS, dev server starts)
- **REFACTOR:** Clean up config, remove unnecessary defaults

**Good tests for scaffolding:**
- "Does the build produce non-zero output?" (CSS, JS, assets)
- "Does the dev server start without errors?"
- "Does typecheck pass?"
- "Can I import and use the types?"

```typescript
// GOOD: Verifies the build toolchain works
it('build produces CSS and JS output', async () => {
  const result = execSync('bun run build', { encoding: 'utf-8' });
  expect(glob.sync('dist/**/*.css').length).toBeGreaterThan(0);
  expect(glob.sync('dist/**/*.js').length).toBeGreaterThan(0);
});

// GOOD: Testing that config loads and works
it('loads valid configuration', () => {
  const config = loadConfig();
  expect(config.name).toBeDefined();
  expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
});
```

**Bad tests for scaffolding:** File-existence checks (`fs.existsSync('vite.config.ts')`) that pass even when config files are orphaned and the build produces zero output. See Ban 10 in the `test-writing` skill.

### Feature Work (`type: "feature"`)

Features need behavioral testing with proper coverage of paths.

```typescript
describe('OrderService.createOrder', () => {
  it('creates order with valid items', async () => {
    // Happy path
  });

  it('rejects order with empty items', async () => {
    // Validation error
  });

  it('handles inventory shortage gracefully', async () => {
    // Edge case
  });

  it('calculates total with tax correctly', async () => {
    // Business logic
  });
});
```

## A(i)-Team Test Strategy

```
Murdock writes:
├── Unit tests (most items)
├── Integration tests (integration items)
└── E2E tests (final integration items)

Coverage target: 80%+ for features, smoke tests for scaffolding
```

## Test Quality Checklist

- [ ] Tests are independent (no shared state)
- [ ] Tests are deterministic (no flaky tests)
- [ ] Tests are fast (mock slow operations)
- [ ] Tests are readable (clear arrange/act/assert)
- [ ] Tests cover edge cases
- [ ] Tests cover error paths
- [ ] Tests document expected behavior

## Anti-Patterns

### Field-by-Field Testing (Most Common Mistake)

This is the #1 anti-pattern for scaffolding work. Don't test every property individually.

```typescript
// BAD: 39 tests for a Zod schema (actual example that shipped)
describe('OrderSchema', () => {
  it('validates id is string', () => { ... });
  it('validates id is required', () => { ... });
  it('validates name is string', () => { ... });
  it('validates name is required', () => { ... });
  it('validates items is array', () => { ... });
  // ... 34 more tests like this
});

// GOOD: 3 tests that prove the schema works
describe('OrderSchema', () => {
  it('accepts valid order data', () => {
    expect(() => OrderSchema.parse(validOrder)).not.toThrow();
  });

  it('rejects invalid order data', () => {
    expect(() => OrderSchema.parse({})).toThrow();
  });

  it('provides useful error messages', () => {
    const result = OrderSchema.safeParse({ id: 123 });
    expect(result.error?.issues[0].message).toContain('string');
  });
});
```

**Rule of thumb:** If you're writing more than 5 tests for a type definition, config file, or schema - you're testing structure, not behavior. Step back and ask "what would break in production?"

### Testing Implementation
```typescript
// BAD: Testing internal state
expect(service._cache.size).toBe(1);

// GOOD: Testing behavior
expect(service.get('key')).toBe('value');
```

### Brittle Assertions
```typescript
// BAD: Exact error message
expect(error.message).toBe('User not found with ID: 123');

// GOOD: Error type
expect(error).toBeInstanceOf(NotFoundError);
```

### Test Interdependence
```typescript
// BAD: Tests share state
let user;
it('creates user', () => { user = create(); });
it('updates user', () => { update(user); }); // Depends on previous test

// GOOD: Independent tests
it('creates user', () => { const user = create(); expect(user).toBeDefined(); });
it('updates user', () => { const user = create(); update(user); expect(...); });
```

## Murdock's Mantra

> "Write the test first. Watch it fail. Then make it pass.
> If you can't write a test for it, you don't understand it.
> If you don't understand it, you shouldn't build it."
