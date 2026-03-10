# Test Writing Skill

Universal test quality rules for AI testing agents. Every test must exercise real application code and assert on an observable outcome. If it does not call real code, it is not a test.

## Five Banned Categories

### 1. Don't Test Styling or CSS in Unit Tests

- `querySelector` for CSS/Tailwind class names
- `className` checks on rendered elements
- Responsive breakpoint class assertions (`lg:grid-cols-2`, `md:sticky`)
- Design token compliance blocks (regex-checking innerHTML for color classes)

**Why it's worthless:** JSDOM doesn't compute CSS. These tests verify that a developer typed a class name string. They pass on broken layouts and fail on harmless refactors.

**Write instead:** Test behavior (click, toggle, show/hide), content (rendered text, ARIA attributes), or state changes. Use Playwright for actual visual verification.

### 2. Don't Grep Source Code

- `fn.toString()` followed by `toContain('keyword')`
- `readFileSync('Component.tsx')` followed by string matching
- Importing a module and checking `typeof X === 'function'` or `X.toBeDefined()`
- Reading CSS files as strings and matching selectors

**Why it's worthless:** Source code strings change on rename, are minified in production, and can match in comments or dead branches. A no-op stub with the right name passes; a working rename fails.

**Write instead:** Call the function and assert on its return value or side effects. If the import works, the export exists.

### 3. Don't Test Your Own Fixtures

- Define mock object, then assert its own properties match the values just hardcoded
- Define a fake component inside the test file, then test that fake component
- Configure a mock to return X, then assert the mock returns X
- Configure a mock to return a value, call a function, assert the mock was called (`toHaveBeenCalledWith`) — this only proves the mock works, not the function under test

**Why it's worthless:** No application code is executed. These tests always pass and can never fail unless someone edits the mock in the same file. Call-argument assertions on pre-configured mocks are tautological — the mock returns the value regardless, so asserting it was called adds nothing.

**Write instead:** Pass mock data to the real component/function and assert on rendered output or return values. The result assertion is the real test; drop the call assertion.

### 4. Don't Write Placeholder Tests

- `expect(true).toBe(true)`
- Empty test bodies with TODO comments
- Tests that call setup functions then assert a tautology
- `expect(fs.existsSync('package.json')).toBe(true)` (file existence checks)

**Why it's worthless:** Always passes, zero coverage, inflates test count, actively misleading when the `describe` title describes real behavior that was never tested.

**Write instead:** Either write the real test or don't write a test at all. Placeholder tests are worse than no tests.

### 5. Don't Duplicate What the Compiler or Build Already Checks

- Runtime type assertions (`expectTypeOf`, `typeof result === 'string'`)
- Export count assertions (`Object.keys(module).length === 5`)
- File existence checks for committed files (`existsSync('.eslintrc')`)
- Duplicate tests verifying identical behavior under different describe blocks

**Why it's worthless:** TypeScript catches type errors at compile time. Git tracks file existence. The build system validates imports. These are redundant by definition.

**Write instead:** Nothing. Run `typecheck` in CI. Use the imported function in a real test.

## Self-Check Before Submitting Tests

For every test you wrote, answer these questions:

1. **Does this test call real application code?** If no, delete it.
2. **Can this test fail when the application breaks?** If no, delete it.
3. **Does this test assert on an observable outcome?** (Rendered content, return value, side effect, thrown error.) If no, delete it.
4. **Is there already another test covering the same behavior?** If yes, delete the duplicate.
5. **Would a lint rule or the compiler catch this instead?** If yes, delete it.
6. **Does my assertion use `??` or `||` to accept multiple possible values?** If so, pin the single correct value.
7. **Does my test have an `if/else` branch where the `else` path passes silently?** If so, assert existence unconditionally first.
8. **Am I asserting `toHaveBeenCalledWith` on a mock I pre-configured to return a value?** If so, drop the call assertion and keep only the result assertion.

If you can describe your test as any of these, delete it:
- "Checks that a CSS class name string exists in HTML"
- "Checks that a source file exists on disk"
- "Checks that an imported function is defined"
- "Checks that a mock object has the property I gave it"
- "Checks that a source code string contains a keyword"
- "Checks that a type exists at runtime"
- "Always passes regardless of application state"
- "Tests a component defined inside the test file, not the real one"
- "Asserts the mock was called, not what the code did with the result"
- "Has a fallback else-branch where failure silently becomes a passing alternative"
- "Uses OR-pattern matching where only one specific value is correct"

See `references/testing-anti-patterns.md` for detailed examples of each banned pattern with code samples.

See `references/testing-good-patterns.md` for positive examples — behavior-focused assertions, fixture helpers, boundary testing, full contract verification, and more.
