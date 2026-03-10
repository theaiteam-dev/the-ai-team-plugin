# Testing Anti-Patterns: Rules for AI Testing Agents

This document catalogs anti-patterns identified during test suite audits. **These are mandatory rules.** Any test agent that generates tests matching these patterns is producing waste, not coverage.

**Origin:** Approximately 40-50% of AI-generated tests were identified as no-value or low-value, produced by agents optimizing for test count rather than regression protection.

---

## Anti-Pattern 1: CSS Class String Assertions

**Severity:** BANNED — never write these

Tests that use `querySelector` or `className` checks to verify CSS/Tailwind class names exist in rendered HTML.

### What it looks like

```tsx
// BAD — every one of these is worthless
it('should apply rounded-xl border border-border bg-card to sidebar', () => {
  const { container } = render(<ShopPage />);
  const card = container.querySelector('.rounded-xl.border.border-border.bg-card');
  expect(card).toBeInTheDocument();
});

it('should have flex items-center gap-2 on controls container', () => {
  const { container } = render(<Component />);
  const controlsContainer = container.querySelector('.flex.items-center.gap-2');
  expect(controlsContainer).toBeTruthy();
});

it('should use w-14 h-14 for preview card image', () => {
  const previewCard = container.querySelector('[data-testid="preview"]');
  const imageContainer = previewCard?.querySelector('.w-14.h-14');
  expect(imageContainer).toBeTruthy();
});
```

### Why it's worthless

- Tailwind utility classes appear in HTML as literal class names, so this tests that the developer typed the class. It doesn't verify layout, color, spacing, or any visual outcome.
- Fails on harmless refactors (e.g., extracting classes to a `cn()` call, switching from `gap-2` to `gap-3`).
- **Passes on broken code** — an element can have all the right class names and still be visually wrong (wrong parent, `display: none`, overlapping elements, z-index issues).
- JSDOM doesn't compute CSS. These tests literally cannot verify visual behavior.

### What to write instead

- Test **behavior**: clicking, submitting, toggling, showing/hiding content based on state.
- Test **content**: rendered text, image alt text, link hrefs, ARIA attributes.
- Test **state changes**: "when X happens, Y appears/disappears."
- For actual visual verification, use Playwright/browser testing, not unit tests.

```tsx
// GOOD — tests behavior, not class names
it('should show sale badge when product has compareAtPrice', () => {
  render(<ProductCard product={saleProduct} />);
  expect(screen.getByText('Sale')).toBeInTheDocument();
});

it('should not show sale badge when price equals compareAtPrice', () => {
  render(<ProductCard product={regularProduct} />);
  expect(screen.queryByText('Sale')).not.toBeInTheDocument();
});
```

---

## Anti-Pattern 2: Design Token Compliance Sections

**Severity:** BANNED — never write these

Copy-pasted `describe('Design Token Compliance')` blocks that render a component and regex-check the innerHTML for forbidden Tailwind color classes.

### What it looks like

```tsx
// BAD — this exact block was copy-pasted into 10+ test files
describe('Design Token Compliance', () => {
  it('should NOT use hardcoded gray color classes', () => {
    const { container } = render(<CartEmpty products={mockProducts(2)} />);
    const html = container.innerHTML;

    expect(html).not.toMatch(/\bbg-gray-\d+/);
    expect(html).not.toMatch(/\btext-gray-\d+/);
    expect(html).not.toMatch(/\bborder-gray-\d+/);
  });

  it('should NOT use hardcoded blue color classes', () => {
    const { container } = render(<CartEmpty products={[]} />);
    const html = container.innerHTML;

    expect(html).not.toMatch(/\bbg-blue-\d+/);
    expect(html).not.toMatch(/\btext-blue-\d+/);
  });

  it('should use semantic tokens', () => {
    const { container } = render(<Component />);
    const html = container.innerHTML;
    const hasSemanticTokens = html.includes('bg-card') || html.includes('text-muted-foreground');
    expect(hasSemanticTokens).toBe(true);
  });
});
```

### Why it's worthless

- This is a **lint rule**, not a test. It checks that certain strings don't appear in rendered HTML. Use ESLint or Stylelint if you want to enforce token usage.
- The negative check (`not.toMatch(/bg-gray-/)`) fires **false positives** on legitimate intentional gray usage and **false negatives** if violations are in CSS-in-JS, computed styles, or child components that aren't rendered in the mock.
- The positive check (`html.includes('bg-card')`) passes if **any single element** in the entire rendered tree has `bg-card` — a single button makes the whole test green regardless of violations elsewhere.
- Copy-pasting this block into every test file inflates test count by 2-4 per file while providing no real regression protection.

### What to write instead

Nothing. If you need design token enforcement, add an ESLint rule that scans source files (not rendered HTML) for forbidden patterns. That's a one-time setup, not 40 tests.

---

## Anti-Pattern 3: Mock-Data-Equals-Mock-Data

**Severity:** BANNED — never write these

Tests that define a mock data object and then assert that the object's own properties match the values just hardcoded 10 lines above.

### What it looks like

```tsx
// BAD — you defined this mock 10 lines ago
const mockCollectionLoaderData = {
  collection: {
    handle: 'baby-dragons',
    title: 'Baby Dragons',
  },
  pageInfo: {
    hasNextPage: true,
    endCursor: 'cursor-end',
  },
};

it('should have the correct collection handle', () => {
  expect(mockCollectionLoaderData.collection.handle).toBe('baby-dragons');
});

it('should use getPaginationVariables for pagination', () => {
  expect(mockCollectionLoaderData.pageInfo.hasNextPage).toBe(true);
  expect(mockCollectionLoaderData.pageInfo.endCursor).toBe('cursor-end');
});
```

### Why it's worthless

- No application code is executed. You're testing that JavaScript object property access works. It does.
- These tests **always pass** and **can never fail** unless someone edits the mock data in the same file — which would also update the assertion.
- They inflate the test count without covering a single code path.

### What to write instead

Test what happens when the **component receives** that data. Pass mock data to the component via a mocked loader, then assert on the **rendered output**:

```tsx
// GOOD — tests that the component renders the data correctly
it('should display collection title from loader data', () => {
  mockUseLoaderData.mockReturnValue(mockCollectionLoaderData);
  render(<CollectionPage />);
  expect(screen.getByRole('heading', { name: 'Baby Dragons' })).toBeInTheDocument();
});
```

---

## Anti-Pattern 4: Source Code String Grep

**Severity:** BANNED — never write these

Tests that import a module and call `.toString()` on functions or components, then check whether the stringified source code contains certain keywords.

### What it looks like

```tsx
// BAD — stringifying source code and grepping it
it('should use critical/deferred data loading pattern', async () => {
  const moduleSource = await import('~/routes/($locale)._index');
  const loaderString = moduleSource.loader.toString();

  expect(loaderString).toContain('loadCriticalData');
});

it('should use Suspense for deferred data', async () => {
  const Homepage = (await import('~/routes/($locale)._index')).default;
  const source = Homepage.toString();

  expect(source).toContain('Suspense');
});
```

### Why it's worthless

- A function's `.toString()` output is **minified/transformed** in production builds, so these tests only pass in dev.
- A rename from `loadCriticalData` to `loadAboveTheFold` fails this test despite being functionally identical.
- A no-op stub function with the right name passes this test despite doing nothing.
- This is `grep` wearing a test costume. If you want to verify code patterns exist, use an actual linter or code review.

### What to write instead

Test the **behavior** of the loader or component, not its source code:

```tsx
// GOOD — tests that the loader actually works
it('should return featured collection data', async () => {
  const response = await loader({ context: mockContext, request: new Request('http://localhost/'), params: {} });
  const data = await response.json();
  expect(data.featuredCollection).toBeDefined();
  expect(data.featuredCollection.handle).toBe('frontpage');
});
```

---

## Anti-Pattern 5: `expect(true).toBe(true)` Stubs

**Severity:** BANNED — never write these

Tests with no real assertion — either literal `expect(true).toBe(true)` or a comment saying "TODO: implement" followed by a trivially-passing assertion.

### What it looks like

```tsx
// BAD — every single one of these is a lie in the test count
it('should render active filter badge for category filter', async () => {
  // TODO: implement filter badge UI
  expect(true).toBe(true);
});

it('should show products matching current URL sort parameter', async () => {
  // URL state management for sort
  expect(true).toBe(true);
});

it('should show "No products found" when filters exclude everything', async () => {
  // Will be tested when filters return empty results
  await renderShopPage();

  expect(true).toBe(true);
});
```

### Why it's worthless

- These tests **always pass** and provide **zero coverage**. They are dead weight.
- They make the test count look higher than it is, giving false confidence.
- The `describe` block title describes real behavior that **was never actually tested**. This is actively misleading.
- Some even call render functions before the noop assertion, wasting test runtime for nothing.

### What to write instead

Either write the real test or don't write a test at all. Placeholder tests are worse than no tests — they tell you everything passes when nothing was checked.

If a feature isn't implemented yet, don't write tests for it. Write the tests when the feature exists.

---

## Anti-Pattern 6: Testing Your Own Mocks

**Severity:** BANNED — never write these

Tests that define a mock component *inside the test file* and then test that mock instead of importing the real component.

### What it looks like

```tsx
// BAD — this is an entirely fake component defined IN the test file
function TrustBadges() {
  return (
    <div className="grid grid-cols-3 gap-4 pt-4" data-testid="trust-badges">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Truck className="h-5 w-5 text-primary" />
        <span>Free shipping 50+</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Shield className="h-5 w-5 text-primary" />
        <span>30 day returns</span>
      </div>
    </div>
  );
}

// Now testing the mock — the real TrustBadgesPDP component is never imported
it('should display free shipping text', () => {
  render(<TrustBadges />);
  expect(screen.getByText('Free shipping 50+')).toBeInTheDocument();
});
```

### Why it's worthless

- You're testing code you just wrote in the test file. The actual production component is never imported, never rendered, never tested.
- These tests **always pass** because you control both the implementation and the assertions.
- The real component could be completely broken and these tests would still be green.

### What to write instead

Import the **real component** and test it:

```tsx
// GOOD — tests the actual component
import { TrustBadgesPDP } from '../TrustBadgesPDP';

it('should display free shipping text', () => {
  render(<TrustBadgesPDP />);
  expect(screen.getByText('Free shipping 50+')).toBeInTheDocument();
});
```

---

## Anti-Pattern 7: Runtime TypeScript Type Assertions

**Severity:** BANNED — never write these

Tests that use `expectTypeOf` or similar runtime type-checking utilities to verify TypeScript types that are already enforced by the compiler.

### What it looks like

```tsx
// BAD — types are compile-time, not runtime
import { expectTypeOf } from 'vitest';

it('should export all product types', () => {
  expectTypeOf<Product>().not.toBeNever();
  expectTypeOf<ProductVariant>().not.toBeNever();
  expectTypeOf<ProductImage>().not.toBeNever();
  expectTypeOf<Money>().not.toBeNever();
});

it('should have title as string on ProductNode', () => {
  const product = createMockProduct();
  expectTypeOf(product.title).toEqualTypeOf<string>();
});
```

### Why it's worthless

- TypeScript already catches these at compile time. If `Product` doesn't exist or `title` isn't a `string`, `tsc` fails. Running `typecheck` covers this.
- `expectTypeOf` is erased at compile time if types are correct — at runtime, it's testing Vitest's internals, not your types.
- An entire test file of type assertions is an entire file that tests nothing.

### What to write instead

Nothing. Run `typecheck` in CI. That's it. If you want to verify type exports specifically, a single `import type { Product } from '~/types'` at the top of a test file will fail compilation if the type doesn't exist.

---

## Anti-Pattern 8: File Existence / Scaffold Tests

**Severity:** BANNED — never write these

Tests that use `fs.existsSync` to check that project files exist, or read `package.json` to verify it has certain dependencies or scripts.

### What it looks like

```tsx
// BAD — all of this
import { existsSync, readFileSync } from 'node:fs';

it('should exist', () => {
  expect(existsSync(join(rootDir, 'package.json'))).toBe(true);
});

it('should have required dependencies', () => {
  const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
  ['@shopify/hydrogen', 'react', 'react-dom', 'tailwindcss'].forEach((dep) => {
    expect(packageJson.dependencies).toHaveProperty(dep);
  });
});

it('should have vite.config.ts', () => {
  expect(existsSync(join(rootDir, 'vite.config.ts'))).toBe(true);
});
```

### Why it's worthless

- If `package.json` doesn't exist, **nothing works**. Not the test runner, not the build, nothing. This test can never actually catch a failure.
- If a file is missing, the build or import would fail far earlier than this test.
- These inflate test count while catching exactly zero real bugs.

### What to write instead

Nothing. File existence is validated by the build system, the import system, and every other test in the suite. You don't need dedicated tests for it.

---

## Anti-Pattern 9: CSS File Content String Matching

**Severity:** BANNED — never write these

Tests that read CSS files as raw strings and use `toContain` or `toMatch` to check for presence/absence of class names or selectors.

### What it looks like

```tsx
// BAD — reading CSS as a string and grepping
const appCssPath = resolve(process.cwd(), 'app/styles/app.css');
const cssContent = readFileSync(appCssPath, 'utf-8');

it('should NOT contain .header selector', () => {
  expect(cssContent).not.toMatch(/\.header\s*{/);
});

it('should NOT contain .cart-main selector', () => {
  expect(cssContent).not.toMatch(/\.cart-main/);
});
```

### Why it's worthless

- This is a lint rule. Every assertion is `expect(css).not.toMatch(...)` or `expect(css).toContain(...)`. That's a regex scan of a file, not a test of behavior.
- If you need to enforce that certain CSS selectors are removed, use a Stylelint rule or a CI check — not a test per selector.
- When the same pattern appears 71 times (one per selector), it creates the illusion of massive test coverage.

### The ONE exception

Testing that `@keyframes` definitions exist in `tailwind.css` has marginal value for verifying custom animation definitions are present. But even this is better as a lint check.

---

## Anti-Pattern 10: Trivial Existence / typeof Checks

**Severity:** BANNED — never write these

Tests that check if an imported function `isDefined` or `typeof X === 'function'`.

### What it looks like

```tsx
// BAD — if the import succeeded, it's defined
it('should export loader function', async () => {
  const root = await import('~/root');
  expect(root.loader).toBeDefined();
  expect(typeof root.loader).toBe('function');
});

it('should have adaptProduct available', async () => {
  const { adaptProduct } = await import('~/lib/adapters');
  expect(adaptProduct).toBeTruthy();
  expect(typeof adaptProduct).toBe('function');
});
```

### Why it's worthless

- If the import fails, **every test in the file fails**. You don't need a dedicated test for this — it's a prerequisite, not a test case.
- `typeof X === 'function'` is guaranteed by TypeScript. If `loader` wasn't a function, `tsc` would catch it.
- These inflate test count with zero signal.

### What to write instead

Nothing. Use the imported function in a real test. If the import breaks, you'll know.

---

## Anti-Pattern 11: Responsive CSS Breakpoint Class Assertions

**Severity:** BANNED — never write these

Tests that check for responsive Tailwind classes like `lg:grid-cols-2`, `md:sticky`, etc.

### What it looks like

```tsx
// BAD — JSDOM doesn't have viewports
it('should have responsive grid layout', () => {
  const { container } = render(<PDPLayout />);
  const grid = container.querySelector('.lg\\:grid-cols-2');
  expect(grid).toBeInTheDocument();
});

it('should make sidebar sticky on desktop', () => {
  const { container } = render(<PDPLayout />);
  const sidebar = container.querySelector('.md\\:sticky');
  expect(sidebar).toBeInTheDocument();
});
```

### Why it's worthless

- JSDOM has no viewport. Responsive classes are just strings in JSDOM — there's no way to verify they produce the intended layout at any breakpoint.
- This is CSS class assertion (Anti-Pattern 1) with the extra insult of pretending to test responsiveness.

### What to write instead

Use Playwright with viewport resizing for actual responsive testing. In unit tests, focus on behavior, not layout.

---

## Anti-Pattern 12: Component Source File Reading

**Severity:** BANNED — never write these

Tests that read component `.tsx` files from disk using `readFileSync` and check whether the source code contains certain strings.

### What it looks like

```tsx
// BAD — reading component source and grepping
function readComponentFile(filename: string): string {
  return readFileSync(resolve(componentsDir, filename), 'utf-8');
}

it('should apply animation classes to ProductCard', () => {
  const source = readComponentFile('ProductCard.tsx');
  expect(source).toContain('hover-glow');
  expect(source).toContain('transition-transform');
});

it('should apply animation classes to Badge', () => {
  const source = readComponentFile('Badge.tsx');
  expect(source.length).toBeGreaterThan(0); // just checks the file exists
});
```

### Why it's worthless

- You're grepping source code. This is the `grep` command pretending to be a test.
- A class name can appear in a comment, a deleted branch, or a conditional that never executes.
- `source.length > 0` tests that the file is not empty. That's not a test.

### What to write instead

Render the component and test the behavior. If you need to verify animation classes are applied, test with Playwright and actually observe the animation.

---

---

## Anti-Pattern 13: Tautological Mock-Call Assertions

**Severity:** BANNED — never write these

Tests that configure a mock to return a value, call the function under test, and then assert the mock was called — rather than asserting on the actual result.

### What it looks like

```ts
// BAD — toHaveBeenCalledWith proves the mock ran, not that the function works
global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockData })
const result = await fetcher("/api/test")
expect(fetch).toHaveBeenCalledWith("/api/test")  // ← tautological
expect(result).toEqual(mockData)                 // ← this is the only real assertion
```

If `fetcher` passed the wrong URL, the mock still returns `mockData` and both assertions still pass.

### Why it's worthless

- The mock is set up to return a value regardless of input. Asserting it "was called" is asserting your mock setup works — not that the code under test is correct.
- The result assertion is the real test. The call assertion is noise that can hide bugs.
- Call-count assertions (`toHaveBeenCalledTimes`) have legitimate uses for verifying side-effect frequency. Call-argument assertions (`toHaveBeenCalledWith`) almost never add value when the mock is pre-configured.

### What to write instead

```ts
// GOOD — only assert the observable result
const result = await fetcher("/api/test")
expect(result).toEqual(mockData)
```

If you need to verify the function was NOT called (e.g., caching), `toHaveBeenCalledTimes(0)` is fine. If you need to verify the correct HTTP method was used, assert on the request shape passed to the mock — but only if the implementation can actually vary.

---

## Anti-Pattern 14: Conditional Fallback Test Paths

**Severity:** BANNED — never write these

Tests that use an `if/else` branch where the `else` path is a fallback that always passes, making the test unable to fail when the expected element is absent.

### What it looks like

```ts
// BAD — if fileInput is missing, the else branch "passes"
const fileInput = document.querySelector('input[type="file"]')
if (fileInput) {
  await user.upload(fileInput as HTMLElement, csvFile)
} else {
  // Fallback: expected to fail, but this just runs a different interaction
  const dropzone = screen.getByText('Drop file here')
  if (dropzone) fireEvent.drop(dropzone, { dataTransfer: { files: [csvFile] } })
}
```

If the `input[type="file"]` doesn't exist, the else branch runs and the test is green regardless.

### Why it's worthless

- A test with a fallback path that is "expected to fail" **cannot fail**. It silently takes the wrong path.
- The test reports green even when the component is completely broken — the exact opposite of what a test should do.
- These are invisible bugs in the test suite: everything looks covered, but nothing is guarded.

### What to write instead

```ts
// GOOD — assert existence unconditionally first
const fileInput = document.querySelector('input[type="file"][accept=".csv"]')
expect(fileInput).not.toBeNull()
await user.upload(fileInput!, csvFile)
```

Assert the element exists before using it. If the element is absent, the test fails with a clear message.

---

## Anti-Pattern 15: OR-Pattern Assertions

**Severity:** BANNED — never write these

Tests that use `??` chaining or `||` matching to accept any of several possible values, when only one specific value is correct.

### What it looks like

```ts
// BAD — accepts any of four error messages; regression to generic toast still passes
const errorEl =
  screen.queryByText(/invalid csv/i) ??
  screen.queryByText(/upload failed/i) ??
  screen.queryByText(/something went wrong/i) ??
  screen.queryByText(/error/i)
expect(errorEl).not.toBeNull()

// BAD — both actions can't be correct; wrong implementation can satisfy either
const rec = recommendations.find(
  (r) => r.action === "increase_bid" || r.action === "expand"
)
expect(rec).toBeDefined()
```

### Why it's worthless

- If the code regresses to showing a generic "Error" toast, `queryByText(/error/i)` matches and the test stays green.
- OR-pattern value matching means a wrong implementation that returns `"expand"` passes a test expecting `"increase_bid"`.
- These tests define a fuzzy contract that is too broad to catch real regressions.

### What to write instead

```ts
// GOOD — match the specific message the real code produces
expect(screen.getByText(/invalid csv format/i)).toBeInTheDocument()

// GOOD — pin the single expected value
const rec = recommendations.find((r) => r.action === "increase_bid")
expect(rec).toBeDefined()
// or
expect(rec?.action).toBe("increase_bid")
```

If you genuinely don't know which of N values is correct, that's a requirements question — answer it before writing the test.

---

## Summary: The One Rule

**Every test must exercise real application code and assert on an observable outcome (rendered content, function return value, side effect, or thrown error).**

If a test can be described as any of these, delete it:
- "Checks that a CSS class name string exists in HTML"
- "Checks that a source file exists on disk"
- "Checks that an imported function is defined"
- "Checks that a mock object has the property I gave it"
- "Checks that a source code string contains a keyword"
- "Checks that a type exists at runtime"
- "Always passes regardless of application state"
- "Tests a component defined inside the test file, not the real one"
- "Asserts the mock was called, not what the real code did with the result"
- "Has an if/else fallback where the else path is 'expected to fail' but actually passes"
- "Uses ?? or || to accept any of several possible values instead of the one correct value"
