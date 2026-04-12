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

### 10. Scaffold File-Existence-Only Tests (BANNED)

Tests that verify scaffold files exist or have non-empty content, but never check that the toolchain produces working output. Config files, build plugins, and entry points can all exist yet be completely unwired — producing zero output at build time.

```typescript
// BAD: Every file exists, but nothing proves the build works
it('has a tailwind config', () => {
  expect(fs.existsSync('tailwind.config.ts')).toBe(true);
});
it('has a vite config', () => {
  expect(fs.existsSync('vite.config.ts')).toBe(true);
});
it('has a CSS entry point', () => {
  expect(fs.existsSync('src/index.css')).toBe(true);
});
// All three pass even if Tailwind is never wired into Vite
// and the build produces zero CSS bytes.

// GOOD: Verify the build toolchain produces expected artifacts
it('build produces non-zero CSS output', async () => {
  const result = await $`bun run build`;
  const cssFiles = glob.sync('dist/**/*.css');
  expect(cssFiles.length).toBeGreaterThan(0);
  const cssSize = fs.statSync(cssFiles[0]).size;
  expect(cssSize).toBeGreaterThan(0);
});

it('build produces non-zero JS output', async () => {
  const result = await $`bun run build`;
  const jsFiles = glob.sync('dist/**/*.js');
  expect(jsFiles.length).toBeGreaterThan(0);
});

// ALSO GOOD: Verify the dev server starts without errors
it('dev server starts cleanly', async () => {
  const proc = spawn('bun', ['run', 'dev']);
  const output = await collectUntil(proc.stderr, 'ready in', 5000);
  expect(output).not.toMatch(/error/i);
  proc.kill();
});
```

**Rule:** For scaffold/task items that set up a build toolchain, at least one test must verify the build produces expected output — not just that config files exist. "Configured" means "the build uses it and produces output," not "the file is on disk."

### 11. Hardcoded Counts (FRAGILE)

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

### 12. Stubbing the Children of a Composition (BANNED)

When the component under test IS a composition — a shell, layout, page, or container whose job is to assemble children — replacing those children with `vi.spyOn(...).mockImplementation(...)`, `vi.spyOn(...).mockReturnValue(...)`, or `vi.mock('./Child', ...)` leaves nothing real to verify. The composition's observable behavior *is* the rendered subtree. Stubbing the subtree yields "state-bookkeeping coverage" that passes even when the shell is broken from a user's perspective.

This is the same rule as Ban #2 (Mocking Your Own Subject), applied to the case where the subject is the seam between its children. For a shell component, the children are part of the subject.

```typescript
// BAD: App's only job is composing TodoList / CreateTodoForm / EmptyState / ErrorBanner.
// This test replaces all four with prop-capturing stubs and asserts on the captured props.
let captured: TodoListProps;
vi.spyOn(TodoListModule, 'TodoList').mockImplementation((props) => {
  captured = props; return null;
});
vi.spyOn(CreateTodoFormModule, 'CreateTodoForm').mockImplementation(() => null);
// ...etc
render(<App />);
expect(captured.onDelete).toBeDefined();  // tautological — captured references the mock's args

// Failure modes this test cannot catch:
//   - App wires `onDelete` to the wrong prop name on the real component
//   - App never imports TodoList at all (replaced with an inline <div>)
//   - The real TodoList requires props App doesn't pass
//   - A broken render in a grandchild (TodoItem, ErrorBanner body, etc.)
```

```typescript
// GOOD: render the real children, mock only the outermost I/O (the API client)
vi.mock('../lib/api', () => ({
  fetchTodos: vi.fn(),
  createTodo: vi.fn(),
  deleteTodo: vi.fn(),
  updateTodo: vi.fn(),
}));
import { fetchTodos, deleteTodo } from '../lib/api';

it('deletes a todo when the user confirms', async () => {
  (fetchTodos as Mock).mockResolvedValue([
    { id: '1', title: 'Walk dog', completed: false, createdAt: '2024-01-01' },
  ]);
  (deleteTodo as Mock).mockResolvedValue(undefined);
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /delete walk dog/i }));
  await user.click(screen.getByRole('button', { name: /confirm/i }));
  expect(deleteTodo).toHaveBeenCalledWith('1');
  expect(screen.queryByText('Walk dog')).not.toBeInTheDocument();
});
```

**Rule:** For composition components (App, pages, layouts, containers, providers whose responsibility is wiring children together), render the full subtree with real children and mock only external boundaries (API, network, timers, `Date.now`). If you find yourself stubbing an immediate child to "focus on the shell's concerns," the shell's concerns ARE the children — there is nothing left to test once they're gone.

This rule applies to **all** forms of replacement, not just `vi.mock()`:

- `vi.mock('./ChildComponent', ...)`
- `vi.spyOn(ChildModule, 'Child').mockImplementation(...)`
- `vi.spyOn(ChildModule, 'Child').mockReturnValue(...)`
- Passing a stub via React Context to swap a child by indirection

A **bare** `vi.spyOn(ChildModule, 'Child')` with no `.mockImplementation` / `.mockReturnValue` is acceptable — it observes the call without replacing behavior, so the real child still renders. That is the module-spy pattern from the Integration Item Wiring Tests section below, and it's the only spy form allowed on children of the SUT.

**Red flag for reviewers:** if a test file for a composition contains `captured = props` or `let captured: XProps;` patterns, it is almost certainly this anti-pattern — the test is capturing props off a mock instead of verifying observable output.

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

## Interaction, Integration, and Accessibility Testing

### Full Interaction Paths

When acceptance criteria specify multiple ways to trigger the same action, test **every** trigger end-to-end. Don't just test that a handler function exists — verify the full path from user action to outcome.

```typescript
// BAD: Tests the handler exists, not that the trigger works
it('has a keydown handler', () => {
  const component = render(<EditableItem {...props} />);
  expect(component.container.querySelector('[onkeydown]')).toBeTruthy();
});

// GOOD: Tests the full interaction path for each trigger
it('activates edit mode on double-click', async () => {
  render(<EditableItem {...props} />);
  await user.dblClick(screen.getByText('Item title'));
  expect(screen.getByRole('textbox')).toHaveValue('Item title');
});

it('activates edit mode via keyboard shortcut', async () => {
  render(<EditableItem {...props} />);
  const title = screen.getByText('Item title');
  title.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('textbox')).toHaveValue('Item title');
});
```

If an element must be reachable for an interaction to work (focusable, enabled, visible), assert that precondition — JSDOM and similar test environments are often more permissive than real runtimes.

### Consumer Wiring

When a module's `context` field says it is consumed by another module, include at least one test that imports the **real** dependency and verifies the integration point. Don't just mock everything away.

```typescript
// BAD: Mocks the dependency this test is supposed to verify wiring for
vi.mock('../api/orders');
it('calls createOrder', async () => { /* tests the mock, not the wiring */ });

// GOOD: Uses the real module, mocks only the outermost I/O
vi.mock('../lib/http-client'); // mock network, keep real module wiring
import { checkout } from '../services/checkout';
import { httpClient } from '../lib/http-client';
it('calls the order API with cart contents', async () => {
  httpClient.post.mockResolvedValue({ id: 'ord_123' });
  const result = await checkout(cartWithTwoItems);
  expect(result.orderId).toBe('ord_123');
  expect(httpClient.post).toHaveBeenCalledWith('/api/orders', expect.objectContaining({
    items: expect.arrayContaining([expect.objectContaining({ sku: 'WIDGET' })]),
  }));
});
```

### Integration Item Wiring Tests (Module Spy Pattern)

**For items that wire multiple components into a parent (integration/assembly items),** text-matching tests are insufficient — they pass whether the real component or an inline reimplementation is used. Use module spies to verify the real component was invoked.

```typescript
// BAD: Passes with inline <p>No todos yet</p> — doesn't verify real component
it('shows empty state', () => {
  render(<App />);
  expect(screen.getByText(/no todos yet/i)).toBeInTheDocument();
});

// GOOD: Fails if App doesn't import and render the real EmptyState
import * as EmptyStateModule from '../components/EmptyState';

it('renders the real EmptyState component when no todos', () => {
  const spy = vi.spyOn(EmptyStateModule, 'EmptyState');
  render(<App />);
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});
```

**When to use this pattern:**
- The work item's ACs say "imports and renders [Component] from [WI-NNN]"
- The item wires 2+ components into a shared parent
- The item is typed as an integration/assembly item

**Rules for integration test files:**
- Do NOT `vi.mock()` any component listed in the work item's dependencies — render them for real
- Do NOT call `.mockImplementation(...)` or `.mockReturnValue(...)` on a spy of any wired component — that replaces the real component with a stub and defeats the purpose of the spy. See Ban #12 above.
- Mock only external boundaries (API calls, timers, network)
- Include at least one module spy per wired component to verify it was actually used. The spy must be **bare** — observe only, do not replace behavior.
- Behavioral assertions (text, roles, interactions) are still valuable — use them alongside spies, not instead of

### Accessibility Testing

When acceptance criteria mention user-facing behavior — form inputs, error messages, interactive controls, status indicators — test using semantic queries and roles, not CSS selectors or test IDs.

**Principles (framework-agnostic):**
- **Query by role, not by class or ID.** Roles (`button`, `textbox`, `alert`, `status`, `checkbox`) reflect what the user (or assistive technology) sees. CSS classes and test IDs don't.
- **Assert labels exist.** Every interactive control should have a human-readable name. A form input without a label is a test failure, not a style issue.
- **Test keyboard paths when the AC says so.** If the criteria say "can be activated via keyboard," verify the element is focusable and the keypress produces the expected outcome.
- **Verify dynamic status announcements.** Error messages, loading indicators, and confirmation banners should have appropriate roles (`alert`, `status`) so they are announced to assistive technology.

```typescript
// GOOD: Semantic queries that reflect what the user sees
render(<LoginForm />);
const emailInput = screen.getByRole('textbox', { name: /email/i });
const submitButton = screen.getByRole('button', { name: /sign in/i });

// GOOD: Error message uses appropriate role
await user.click(submitButton); // submit without filling in email
expect(screen.getByRole('alert')).toHaveTextContent(/email is required/i);

// GOOD: Loading state uses status role
render(<DataTable loading={true} />);
expect(screen.getByRole('status')).toBeInTheDocument();
```

These patterns apply to any framework with a testing library that supports role-based queries (Testing Library, Playwright, Cypress). In non-UI contexts (CLI tools, APIs), the equivalent is testing the user-facing contract: help text, error messages, exit codes.

---

## "Only/Never" Qualifier Tests

When an acceptance criterion contains exclusionary language — "only," "never," "exclusively," "must not" — it implies two test cases, not one:

1. **Positive test:** The thing happens when expected (Y → X)
2. **Negative test:** The thing does NOT happen when the condition is absent (¬Y → ¬X)

Testing only the positive case is the most common way to "cover" an AC while missing a real bug.

```typescript
// AC: "EmptyState is shown ONLY after loading completes successfully with zero results"

// Insufficient: Tests the positive case only
it('shows EmptyState after successful empty load', async () => {
  mockGetTodos.mockResolvedValue([]);
  render(<App />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/no todos/i));
});

// REQUIRED: Negative test — the "only" qualifier demands it
it('does NOT show EmptyState after failed load', async () => {
  mockGetTodos.mockRejectedValue(new Error('Network error'));
  render(<App />);
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  // Dismiss the error
  await user.click(screen.getByLabelText('Dismiss error'));
  // EmptyState must NOT appear — load never succeeded
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
```

**How to check:** After your 1:1 AC reconciliation, scan each criterion for "only," "never," "exclusively," "must not," or "should not." For each match, verify you have both the positive and negative test. If you only have one, add the other.

---

## AC Cross-Product Testing

After mapping each acceptance criterion 1:1 to a test, scan for AC *combinations* that imply untested paths. When one AC defines a trigger and another defines a guard or constraint, their cross-product is a test case.

**Example:** AC-A says "submits via Enter key" and AC-B says "submit disabled during in-flight request." Each has a test individually. But the *combination* — "Enter key blocked during in-flight" — is a distinct scenario that neither test covers alone. If you have tests for A and B individually but not A×B, add the combined test.

**How to check:** After your 1:1 reconciliation pass, identify all "trigger" ACs (user actions: click, keypress, form submit) and all "constraint" ACs (guards, validation, disabled states, loading states). For each trigger × constraint pair, ask: "Is there a test that exercises this trigger while the constraint is active?" If not, add one.

This catches the most common review rejection pattern: guards that only protect one interaction path.

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
9. Scaffold/task items have at least one test verifying build output, not just file existence.
10. Every AC with "only/never/exclusively" has both a positive and negative test.
11. For composition components (shells, layouts, pages, containers), no immediate child is replaced via `vi.mock`, `.mockImplementation`, or `.mockReturnValue`. Children render for real; only external boundaries (API, network, timers) are mocked.

See `references/testing-anti-patterns.md` for extended examples of each banned pattern.
See `references/testing-good-patterns.md` for positive examples of behavior-focused testing.
