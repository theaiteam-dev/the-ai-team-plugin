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

### 3. Utility-Class Assertions and Class-List Diffs (BANNED)

Asserting on utility-class strings (`toHaveClass('bg-green-500 ...')`) tests styling tokens, not behavior. Headless test environments don't compute CSS — these pass on broken layouts and fail on harmless refactors.

The same rule applies to *diffing* class lists across states (e.g., capturing the class set on render A, then on render B, and asserting the delta matches a hardcoded regex). Multiple class tokens are no more behavioral than one. If the only thing the test checks is "this set of style tokens changed," it's brittle — any styling refactor breaks it without any user-visible change.

```typescript
// BAD: Tests a class name string, not behavior
render(<StatusBadge status="active" />);
const badge = screen.getByText('Active');
expect(badge).toHaveClass('bg-green-500 rounded-full text-white');

// ALSO BAD: Diffs class lists across states with hardcoded patterns
const before = element.className.split(/\s+/);
await user.click(toggle);
const after = element.className.split(/\s+/);
const added = after.filter((c) => !before.includes(c));
expect(added).toEqual(expect.arrayContaining([/line-through/, /text-gray-/]));
// Passes only as long as those exact tokens are used. Any styling refactor breaks it.

// GOOD: Test the user-visible effect
render(<StatusBadge status="active" />);
expect(screen.getByText('Active')).toBeInTheDocument();
expect(screen.getByRole('status')).toHaveAccessibleName('Active');

// GOOD: For state changes, assert the user-observable change
await user.click(toggle);
expect(screen.getByRole('checkbox', { name: /walk dog/i })).toBeChecked();
// (or: assert content/role/aria changed — not which tokens did)
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

// also BAD: query union — same anti-pattern in disguise
// Test passes whether the impl renders role=alert OR role=status.
// If the AC or accessibility convention demands one specific role
// (validation errors → role="alert"), pin that role directly.
const alert = screen.queryByRole('alert');
const status = screen.queryByRole('status');
const messageNode = alert ?? status;
expect(messageNode).not.toBeNull();

// GOOD: Pin the exact expected value
const status = getOrderStatus(completedOrder);
expect(status).toBe('shipped');

// GOOD: Pin the exact role required by the AC
expect(screen.getByRole('alert')).toHaveTextContent(/required/i);
```

**Rule of thumb:** if you're combining two `query*` calls with `??` or `||`, you're letting the implementation pick which assertion runs. The implementation should not be choosing what the test asserts.

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

### 13. Render-Count and Call-Order Assertions (BANNED)

Asserting on how many times a component rendered, the order in which effects fired, or the order in which mocked dependencies were invoked. Components legitimately re-render — extra renders, batched effects, and reordered initialization are not bugs unless they produce a wrong outcome. Tests that pin those internals fail on safe refactors and miss real bugs that produce the wrong outcome through the "right" sequence.

```typescript
// BAD: Asserts on the number of renders
const renderSpy = vi.fn();
function Probe() { renderSpy(); return null; }
render(<App><Probe /></App>);
await user.click(screen.getByRole('button', { name: /load/i }));
expect(renderSpy).toHaveBeenCalledTimes(3); // breaks on any legitimate re-render

// BAD: Asserts on the order spies were invoked
const spyA = vi.spyOn(ModuleA, 'init');
const spyB = vi.spyOn(ModuleB, 'init');
render(<App />);
expect(spyA.mock.invocationCallOrder[0]).toBeLessThan(spyB.mock.invocationCallOrder[0]);

// GOOD: Assert on the outcome the user/system observes
render(<App />);
await user.click(screen.getByRole('button', { name: /load/i }));
expect(await screen.findByText(/3 results/i)).toBeInTheDocument();
expect(httpClient.get).toHaveBeenCalledWith('/api/results');
```

**Exception:** asserting on the *arguments* a mock received, or that it was called *exactly once* when re-entrancy matters (see "Re-entrancy" below), is fine. The ban is on render counts and call-order timing as proxies for correctness.

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

## Coverage Hygiene (Avoiding Redundancy)

A passing test suite isn't free — every test is code that must be read, maintained, and re-run. Tests that re-cover ground already covered elsewhere add maintenance load without adding signal. Aim for *one* good test per behavior at the *right* level.

### Test invariants once, at the highest meaningful scope

If you want to verify a global property (e.g., "no component ships pure-black or pure-white colors", "every page has a single H1", "no form submits without a submit button"), scan once at the highest level that exercises it — typically a page-level or app-level test, or a dedicated invariant suite. Repeating the same scan in every component file produces N copies of the same signal and N places to update when the rule changes.

```typescript
// BAD: Same color-invariant scan repeated in every component test file
// EmptyState.test.tsx, ErrorBanner.test.tsx, CreateTodo.test.tsx, TodoItem.test.tsx, App.test.tsx
it('uses no pure black or white colors', () => {
  render(<EmptyState />);
  const styles = getComputedStyleTokens(document.body);
  expect(styles).not.toContain('rgb(0, 0, 0)');
  expect(styles).not.toContain('rgb(255, 255, 255)');
});

// GOOD: One scan at app level, exercised against the whole rendered tree
// App.test.tsx
it('no component renders pure-black or pure-white colors (all states)', () => {
  for (const state of ['empty', 'loading', 'error', 'list', 'modal-open']) {
    render(<App initialState={state} />);
    expect(getComputedStyleTokens(document.body)).not.toMatchAny([/rgb\(0, 0, 0\)/, /rgb\(255, 255, 255\)/]);
    cleanup();
  }
});
```

### Don't re-cover behaviors at every layer

If `<TextInput>` already verifies trim-then-submit, the parent form does *not* need to re-verify trimming. The parent's responsibility is *wiring* — that it passes the user's input to the child and handles the child's output. Each behavior gets tested at its lowest correct scope, and parents test their own contribution (composition, wiring, layout choices) on top.

```typescript
// BAD: Trim-then-submit asserted in 3 places
// TextInput.test.tsx: asserts trim-then-submit on the button
// TextInput.test.tsx: asserts trim-then-submit on Enter
// CreateTodoForm.test.tsx: asserts trim-then-submit again (same TextInput)
// App.test.tsx: asserts trim-then-submit a fourth time end-to-end

// GOOD: Test the behavior where it lives, test wiring at parents
// TextInput.test.tsx: asserts trim-then-submit (button + Enter)
// CreateTodoForm.test.tsx: asserts the form invokes onSubmit with the trimmed value
// (does NOT re-test trimming itself)
// App.test.tsx: asserts the new todo appears in the list after submit (wiring)
```

**Heuristic:** if a parent test fails because of a bug in a child's internal behavior, the bug should have been caught by the child's own tests. The parent's tests should fail because of *wiring* breakage (wrong prop passed, wrong event handler, missing import).

### Parametrize close variants

Multiple tests that differ only in input or expected value should collapse into one parametrized test. Three tests for "rejects empty / whitespace-only / tab-only" is one table-driven test with three rows. The rows describe the cases; the test body describes the contract.

```typescript
// BAD: Four near-identical tests
it('rejects empty submission', () => { /* "" */ });
it('rejects whitespace-only submission', () => { /* "   " */ });
it('rejects tab-only submission', () => { /* "\t\t" */ });
it('rejects newline-only submission', () => { /* "\n" */ });

// GOOD: One parametrized test, four rows
it.each([
  ['empty', ''],
  ['whitespace', '   '],
  ['tabs', '\t\t'],
  ['newlines', '\n'],
])('rejects %s submission', async (_label, input) => {
  render(<CreateTodo onSubmit={vi.fn()} />);
  await user.type(screen.getByRole('textbox'), input);
  await user.click(screen.getByRole('button', { name: /add/i }));
  expect(screen.getByRole('alert')).toHaveTextContent(/required/i);
});
```

The same applies to language-agnostic test runners — Go's table tests, pytest's `parametrize`, Rust's `rstest`, JUnit's parameterized tests. The rule is universal.

### One canonical test per acceptance criterion

After mapping ACs 1:1 to tests, scan for two tests that share the same arrange and the same query — they're testing the same thing. Merge them. If you have three tests that all say `render(<Component />); expect(getByRole('status')).toBeInTheDocument()` with different titles ("renders", "renders with no props", "shows the empty state"), keep one.

### Prefer behavior queries over spies when both detect the same thing

If `screen.queryByText('Walk dog')` and `expect(realChildSpy).toHaveBeenCalled()` both fail when the feature breaks, the query is the better assertion — it survives module reorganization, named-export renames, and refactors that the spy doesn't. Use module spies (Ban #12 / Integration Wiring section) when behavior queries can't distinguish a real child from an inline reimplementation. Otherwise, query.

---

## Coverage Holes from Symmetry (Assumed-by-Similarity Gaps)

The most common kind of *missing* coverage comes from assuming a tested path covers its untested siblings. A handler that 5 methods route through is not "covered" because one method's error path was tested. A function that takes a parameter is not "covered for hostile inputs" because a benign input passed.

### Shared handlers need per-entry-point tests

When multiple operations route through one error handler, response parser, or transform, each entry point needs its own smoke test for the shared path. Asymmetric coverage hides bugs where one entry point bypasses the shared code path entirely (forgets to await, forgets to pass the response through the handler, etc.).

```typescript
// BAD: Five API methods share a handleResponse() helper.
// Only listTodos has a 500-error test.
it('listTodos throws on 500', async () => { /* ... */ });
// createTodo, updateTodo, deleteTodo, getTodo all share handleResponse,
// but if any of them forgets to call it, no test catches it.

// GOOD: Each entry point has its own error-path test
it.each([
  ['listTodos',   () => listTodos()],
  ['createTodo',  () => createTodo({ title: 'x' })],
  ['updateTodo',  () => updateTodo('1', { completed: true })],
  ['deleteTodo',  () => deleteTodo('1')],
  ['getTodo',     () => getTodo('1')],
])('%s rejects on non-OK response', async (_name, call) => {
  server.use(http.all('*', () => HttpResponse.json({ error: 'x' }, { status: 500 })));
  await expect(call()).rejects.toThrow(/server error/i);
});
```

### Boundary transformations need hostile inputs

If your code encodes, escapes, sanitizes, or normalizes input before crossing a boundary (URL, SQL, HTML, shell, JSON), test it with input that *requires* the transformation. Benign inputs make encoders look correct even when the encoder is missing entirely. The transformation is only observable on inputs that would produce a different result without it.

```typescript
// BAD: All test inputs are benign — encoder is never observed firing
it('builds the update URL', () => {
  expect(buildUpdateUrl('abc123')).toBe('/api/items/abc123');
});

// GOOD: Use an input that requires encoding
it.each([
  ['/',       '/api/items/%2F'],
  [' a b ',   '/api/items/%20a%20b%20'],
  ['é',       '/api/items/%C3%A9'],
  ['?q=1',    '/api/items/%3Fq%3D1'],
])('encodes %j into the URL path', (id, expected) => {
  expect(buildUpdateUrl(id)).toBe(expected);
});
```

The same applies to HTML escaping (test with `<script>`), SQL parameterization (test with `'); DROP TABLE`), shell quoting (test with `$(rm -rf /)`), and JSON serialization (test with control characters and surrogate pairs).

### Test contracts at the level that owns them, not only end-to-end

A contract like "if onSubmit rejects, the form preserves the user's input" belongs to the form component. Verifying it only through an end-to-end app test means: (1) the form has no isolated test of the contract; (2) when the contract breaks, the failing test is far from the cause; (3) the form is shipped with no record of the contract in its own suite. Test contracts at the unit that owns them, then test wiring at the parent.

```typescript
// BAD: The "rejection preserves input" contract only appears in an end-to-end App test.
// CreateTodo.test.tsx never proves CreateTodo holds the contract.

// GOOD: Test the contract in CreateTodo.test.tsx, where it lives
it('preserves input when onSubmit rejects', async () => {
  const onSubmit = vi.fn().mockRejectedValue(new Error('network'));
  render(<CreateTodo onSubmit={onSubmit} />);
  await user.type(screen.getByRole('textbox'), 'Walk dog');
  await user.click(screen.getByRole('button', { name: /add/i }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.getByRole('textbox')).toHaveValue('Walk dog');
});
```

### Async submitters need re-entrancy tests

Anywhere a user can fire an async action twice (double-click submit, mash Enter, click while a request is in flight), test the in-flight guard. "It works on the happy path" doesn't prove the second click is dropped — and "we exposed a `submitting` prop" doesn't prove the parent reads it. Test that the action is invoked *exactly once* when fired multiple times during one in-flight request.

```typescript
// GOOD: Re-entrancy guard
it('drops repeated submits while a request is in flight', async () => {
  const onSubmit = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 50)));
  render(<CreateTodo onSubmit={onSubmit} />);
  await user.type(screen.getByRole('textbox'), 'Walk dog');
  const button = screen.getByRole('button', { name: /add/i });
  await user.click(button);
  await user.click(button); // second click during in-flight
  await user.click(button); // third click during in-flight
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
```

### Verify exposed props/state are actually consumed

If a component exposes a state hook (`submitting`, `loading`, `disabled`) for parents to read, the integration test must verify the parent *consumes* it — not just that it's rendered. A prop that isn't wired to anything observable is dead weight, and "the child renders" isn't the same as "the parent uses what the child exposed."

```typescript
// BAD: Verifies CreateTodo renders, but not that App actually wires `submitting` anywhere
it('renders the form', () => {
  render(<App />);
  expect(screen.getByRole('textbox', { name: /todo/i })).toBeInTheDocument();
});

// GOOD: Asserts the consumer-visible effect of the exposed state
it('disables the submit button while a create is in flight', async () => {
  (createTodo as Mock).mockImplementation(() => new Promise((r) => setTimeout(r, 50)));
  render(<App />);
  await user.type(screen.getByRole('textbox', { name: /todo/i }), 'Walk dog');
  await user.click(screen.getByRole('button', { name: /add/i }));
  expect(screen.getByRole('button', { name: /add/i })).toBeDisabled();
});
```

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
12. No assertion depends on render count, effect-firing order, or mock invocation order. Asserting on mock *arguments* and "called exactly once" for re-entrancy guards is fine; asserting on relative timing is not.
13. No utility-class string is asserted directly, and no test diffs class-token sets across states. Assert on user-visible output (text, role, aria, content swap).
14. No two tests in the suite share the same arrange + query — duplicates are merged or parametrized.
15. No global invariant (color rule, layout rule, "every page has X") is scanned in more than one file. Pick the highest meaningful scope and put the scan there.
16. A behavior tested at a child component is not re-tested at parent components. Parents test wiring (the right value flows through), not the wired behavior itself.
17. Each entry point that funnels through a shared helper (response handler, transform, validator) has its own happy-path and error-path test — coverage of one entry point doesn't cover the others.
18. Inputs that must be encoded, escaped, sanitized, or normalized are tested with values that *require* the transformation (special chars, unicode, quotes, slashes), not only benign inputs.
19. Async contracts owned by a unit (rejection preserves state, in-flight guard, retry on transient error) are tested at that unit's own suite, not only end-to-end.
20. Async submitters have an explicit re-entrancy test asserting the action fires exactly once when triggered multiple times during one in-flight request.
21. Exposed state/props (`submitting`, `loading`, `disabled`) are verified at the consumer level via observable effects, not just by checking the producer renders.

See `references/testing-anti-patterns.md` for extended examples of each banned pattern.
See `references/testing-good-patterns.md` for positive examples of behavior-focused testing.
