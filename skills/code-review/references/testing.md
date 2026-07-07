# Testing Patterns

Examples of good and bad testing practices.

---

## Test Behavior, Not Implementation

### Bad
```typescript
// Tests implementation details, not behavior
test('calls setState with correct value', () => {
  const wrapper = shallow(<Counter />);
  wrapper.instance().handleClick();
  expect(wrapper.state('count')).toBe(1);
});
```

### Good
```typescript
// Tests behavior from the user's perspective
test('increments counter when button is clicked', async () => {
  render(<Counter initialCount={0} />);
  await userEvent.click(screen.getByRole('button', { name: /increment/i }));
  expect(screen.getByText('Count: 1')).toBeInTheDocument();
});
```

**What to flag:** Tests that reach into component internals (`.state()`, `.instance()`) are brittle — they break when implementation changes even if behavior is correct. Test what the user sees and does.

---

## Focused Assertions

### Bad
```typescript
// Huge test with no clear assertion intent
test('user flow', async () => {
  const user = await createUser({ name: 'Test' });
  const order = await createOrder(user.id, items);
  await processPayment(order.id);
  await shipOrder(order.id);
  const result = await getOrder(order.id);
  expect(result.status).toBe('shipped');
  expect(result.tracking).toBeTruthy();
  expect(result.items.length).toBe(3);
  expect(result.user.name).toBe('Test');
  // 20 more assertions...
});
```

### Good
```typescript
// Focused test with clear intent
test('shipped order includes tracking number', async () => {
  const order = await createOrder(testUser.id, testItems);
  await processPayment(order.id);

  const shipped = await shipOrder(order.id);

  expect(shipped.status).toBe('shipped');
  expect(shipped.trackingNumber).toMatch(/^TRK-\d{10}$/);
});
```

**What to flag:** Each test should have a single clear reason to fail. Avoid large integration tests that assert everything at once — split them. Test names should describe the expected behavior.

---

## Deterministic Tests

### Bad
```typescript
// Flaky: depends on real timing
test('debounce works', async () => {
  fireEvent.change(input, { target: { value: 'test' } });
  await new Promise((r) => setTimeout(r, 500));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

### Good
```typescript
// Deterministic: uses fake timers
test('debounce delays API call until user stops typing', () => {
  jest.useFakeTimers();
  render(<SearchInput />);

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test' } });
  jest.advanceTimersByTime(300);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/search?q=test');
});
```

**What to flag:** Use fake timers instead of real delays. Tests that depend on timing, network, or external services without mocking are flaky. If a test uses `setTimeout` or `sleep` to wait for something, it's almost certainly fragile.

---

## Test Quality Checklist

- Do tests exist for the new/changed behavior?
- Does each test have a descriptive name that explains the expected outcome?
- Are edge cases covered (empty input, null, boundary values)?
- Are error paths tested, not just happy paths?
- Are mocks/stubs minimal — only faking what's necessary?
- Do tests clean up after themselves (no shared mutable state between tests)?
- Are snapshot tests used sparingly and intentionally (not as a lazy catch-all)?
