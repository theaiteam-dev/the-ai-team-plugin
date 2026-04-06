---
name: work-breakdown
description: Work item structure, sizing, and acceptance criteria standards for the A(i)-Team pipeline. Consult this skill when creating work items, reviewing decomposition quality, sizing features, writing acceptance criteria, or determining item types.
---

# Work Breakdown Skill

Reference for work item structure, types, sizing, and acceptance criteria used throughout the A(i)-Team pipeline. Face uses this to create items. Sosa uses this to critique them. Hannibal uses this to understand item fields.

---

## Item Types

Choose the type that matches the nature of the work:

| Type | Use When | Test Expectation |
|------|----------|------------------|
| `feature` | User-facing functionality, business logic, API endpoints with request/response contracts, components that render and respond to user input | 3–5 tests: happy path, error path, edge cases |
| `task` | Scaffolding, setup, infrastructure, types-only work, config files, utilities without business logic, test fixtures | 1–3 smoke tests: "does it compile, run, integrate?" |
| `bug` | Fixing broken behavior | 2–3 tests: reproduce bug, verify fix, regression guard |
| `enhancement` | Improving existing feature | 2–4 tests: new/changed behavior only |

### Feature vs. Task — Quick Indicators

**Should be `type: "feature"`:**
- User-facing behavior with observable outcomes
- Business logic with state changes
- API endpoints under test
- Components that render and respond to input

**Should be `type: "task"`:**
- Types/interfaces only (no runtime code)
- Configuration files (package.json, tsconfig, vite.config, etc.)
- Project scaffolding (directory structure, boilerplate)
- Utility functions without business logic
- Test fixtures and helpers

**Red flags for wrong type:**
- Item has `outputs.types` but no `outputs.impl` → likely `task`, not `feature`
- Title contains "setup", "configure", "create types" → likely `task`
- All acceptance criteria describe file existence, not behavior → likely `task`

### Type Examples

| Work | Type | Reason |
|------|------|--------|
| "Create TypeScript types for order data" | `task` | Types-only, no runtime |
| "Implement order creation API" | `feature` | Business logic, user-facing |
| "Set up Vitest configuration" | `task` | Infrastructure |
| "Add order validation rules" | `feature` | Business logic |
| "Update README with API docs" | `task` + NO_TEST_NEEDED | Documentation |
| "Fix typos in CHANGELOG" | `task` + NO_TEST_NEEDED | Markdown |
| "Add .env.example" | `task` + NO_TEST_NEEDED | Config |

---

## Sizing Rules

**Goal:** Smallest independently-completable units — but not smaller.

- One logical unit of functionality per item
- If you can split further without creating artificial boundaries, split it
- Each item should be describable in 1–2 sentences
- No arbitrary time limits — focus on logical cohesion

**Typical decomposition:** 5–15 items for most PRDs. 20+ is a red flag. 30+ is almost certainly over-split.

### Good Splits

- "User authentication service" → separate items for login, logout, token refresh, password reset
- "Order processing" → separate items for create order, cancel order, refund order

### Bad Splits (Over-splitting)

- Splitting a single function across multiple items
- Creating artificial boundaries that require excessive cross-references
- 5 items that all write to the same file and could be described as "build the X component"
- Each item generates a test file, and 40 test files for one PRD is excessive

### Over-splitting Consolidation

When items should be merged, the consolidation instruction should identify:
1. Which items to merge (by ID)
2. The combined objective covering all merged behavior
3. Merged acceptance criteria from all items
4. Which item IDs to delete after merging

### Under-splitting Red Flags

- Single item mixes frontend and backend logic
- Item covers multiple independent user-facing behaviors
- Acceptance criteria list more than 5–7 distinct measurable outcomes
- Two different developers would interpret scope very differently

---

## Required Fields

Every work item has these required fields. All four must be populated — the API rejects items missing them.

### `description`

A human-readable executive summary for the kanban board. Synthesizes objective + context into 1–3 prose sentences a PM could skim and understand.

**BAD:**
```
"See objective and acceptance criteria above"  # empty
"Objective: Users can log in. Acceptance: Returns 200. Context: auth.ts"  # dump of structured data
```

**GOOD:**
```
"Email/password auth service that issues JWTs, consumed by the existing auth middleware at
src/middleware/auth.ts. Follows the bcrypt pattern already in the codebase."
```

### `objective`

One behavioral sentence describing the observable outcome this item delivers. Not an implementation task — a user or system outcome.

**BAD:**
```
"Create the auth service"           # describes implementation, not outcome
"Handle authentication"             # vague, unmeasurable
```

**GOOD:**
```
"Users can log in with email/password and receive a session token"
"The /api/orders endpoint returns paginated order history for authenticated users"
```

### `acceptance`

Measurable criteria defining "done." Each criterion must describe an observable, measurable outcome. Murdock maps these directly to test cases — if a criterion is vague, the test will be vague.

**Rules:**
- Follow "Given X, when Y, then Z" or "verb + observable outcome" structure
- Each `feature` must have at least 1 happy-path criterion and 1 error-path criterion
- Each `task` needs 1–2 "done when" criteria (e.g., "vitest runs with zero tests passing")
- `feature` items typically have 3–5 criteria; `task` items have 1–3

**BAD:**
```
"Uses bcrypt for hashing"           # implementation choice, not behavior
"Error handling works"              # unmeasurable
"Performance is good"               # unmeasurable
```

**GOOD:**
```
"Returns 401 with {error: 'invalid_credentials'} when password is wrong"
"Passwords are not stored in plaintext; comparing a correct password returns true"
"POST /api/orders with valid items returns 201 with order ID"
"POST /api/orders with empty items array returns 400"
```

#### Error Path Enumeration (Mandatory for Features with Multiple Async Operations)

If a feature has multiple async operations (create, update, delete, fetch), each operation that can fail MUST have its own error-path criterion. A single "when an API call fails, show error" is too vague — Murdock cannot map it to specific tests.

**BAD:**
```
"When an API call fails, ErrorBanner displays the error message"
# Which API call? All of them? Murdock guesses.
```

**GOOD:**
```
"When createTodo fails, ErrorBanner displays the error and the input is preserved"
"When toggleTodo fails, the todo reverts to its previous state and ErrorBanner shows the error"
"When deleteTodo fails, the todo remains in the list and ErrorBanner shows the error"
```

#### Accessibility Criteria (Mandatory for UI Items with .tsx Output)

If a work item outputs `.tsx` files, include at least one a11y criterion. Murdock writes a11y-aware tests; B.A. implements markup to pass them. Catching gaps here is far cheaper than Amy finding them post-implementation.

**BAD:**
```
# No a11y criteria at all
# Murdock writes getByRole('checkbox') with no accessible name — passes but unusable by screen readers
```

**GOOD:**
```
"Each todo item's checkbox has an accessible label containing the todo title"
"ErrorBanner uses role='alert' so screen readers announce errors immediately"
"Inline edit can be triggered via keyboard (Enter or F2), not only double-click"
```

### `context`

Integration points and references downstream agents need to understand WHERE this code fits.

**Include:**
- Which existing files will import or call this (e.g., "Called by OrderController at `src/controllers/order.ts:45`")
- Existing patterns to follow (e.g., "Follow the validation pattern in `src/lib/validate-user.ts`")
- Constraints or gotchas (e.g., "Must handle the legacy date format from the Shopify webhook")

**BAD:**
```
"Any information the agents need"   # useless placeholder
```

**GOOD:**
```
"This service is consumed by the existing OrderController at src/controllers/order.ts.
Follow the repository pattern used by UserRepository at src/repos/user.ts.
The database uses snake_case column names."
```

---

## Output Path Conventions

The `outputs` field is critical — without it, Murdock and B.A. don't know where to create files.

```yaml
outputs:
  types: "src/types/feature-name.ts"    # Optional — only if new shared types needed
  test:  "src/__tests__/feature-name.test.ts"   # REQUIRED for testable items
  impl:  "src/services/feature-name.ts"         # REQUIRED
```

### Matching Project Conventions

During decomposition, note the target project's directory conventions and match `outputs` paths to them:

| Check | Convention |
|-------|-----------|
| Test directory | `__tests__/`, `tests/`, `test/`, or colocated. Use whichever exists. |
| Source directory | `src/`, `lib/`, `app/`, or root. Match `outputs.impl` accordingly. |
| Types directory | `src/types/`, `types/`, or colocated. Match existing. |

If no convention exists, default to `src/__tests__/` for tests and `src/` for implementation.

### When NOT to Create a Separate Types File

Do not set `outputs.types` for a small, local interface (2–5 fields) used only by one module. Colocate it with the implementation instead.

- **Skip `outputs.types`** when: interface is only used by one module, has ≤5 fields, or is a simple input/output shape
- **Set `outputs.types`** when: type is imported by two or more different source files, or represents a domain entity used across the codebase

**BAD:**
```yaml
outputs:
  types: "src/types/create-order-input.ts"   # overkill — only used in order.service.ts
  test:  "src/__tests__/order.test.ts"
  impl:  "src/services/order.ts"
```

**GOOD:**
```yaml
outputs:
  test: "src/__tests__/order.test.ts"
  impl: "src/services/order.ts"              # define CreateOrderInput here
```

---

## Non-Code Work Items (NO_TEST_NEEDED)

Some work items involve no executable code — documentation, config changes, markdown fixes, file deletions. These cannot be meaningfully unit tested.

**How to flag:**
1. Set `type: "task"`
2. Set `outputs.test: ""` (empty string)
3. Set `outputs.impl` to the file being changed (e.g., `"README.md"`, `".gitignore"`)
4. Include `NO_TEST_NEEDED` on its own line in the `description` field

**Example:**
```bash
ateam items createItem \
  --title "Update README with new API endpoints" \
  --type task \
  --description "Document the new /orders and /refunds endpoints in the README. NO_TEST_NEEDED." \
  --objective "Developers can find API documentation for /orders and /refunds in the README" \
  --acceptance "README contains usage examples for GET /api/orders and POST /api/refunds" \
  --context "Endpoints were added in WI-003 and WI-005. Follow the existing API docs format." \
  --outputTest "" \
  --outputImpl "README.md" \
  --priority low
```

**Pipeline effect:** Hannibal skips the testing stage (moves directly from `ready` to `implementing`). B.A. makes the change. Lynch and Amy still run.

### What Qualifies for NO_TEST_NEEDED

| Work | Reason |
|------|--------|
| Markdown/documentation updates (README, CHANGELOG, docs/*.md) | No runtime behavior |
| Config files NOT loaded by code (.gitignore, .prettierrc, .editorconfig) | No runtime impact |
| CI/CD configs (static) (.github/workflows/*.yml) | Tested by CI execution, not unit tests |
| File deletions/renames tracked by git | Git history is the test |
| Agent prompt files (agents/*.md) | Markdown consumed by Claude, not compiled |
| Comment-only code changes | No behavior change |
| Static asset additions (images, fonts, SVGs) | Not executable |

### What Does NOT Qualify (Always Needs Tests)

| Work | Reason |
|------|--------|
| TypeScript types used in runtime code | Type errors cause compilation failures |
| Config files loaded by code (vite.config, jest.config, package.json scripts) | Config errors cause runtime failures |
| Any file imported by source code | Direct runtime impact |
| Test utilities and fixtures | Test infrastructure must work correctly |

**When in doubt:** Leave `outputs.test` populated. A minimal smoke test is better than a false NO_TEST_NEEDED on something with runtime impact.

### Verification Checklist Before Flagging NO_TEST_NEEDED

- [ ] File is not imported by any source code
- [ ] File is not executed at runtime
- [ ] Change affects only human-readable content, not machine-executable logic
- [ ] No compilation or runtime errors could result from this change

---

## Parallel Groups and Dependencies

### Parallel Groups

Assign `parallel_group` to prevent conflicting concurrent work within a wave:
- Features modifying the **same file** → same group (only one runs at a time)
- Features in the **same logical component** → same group
- Independent components → different groups (run concurrently)

### Dependencies

Dependencies control which wave an item belongs to:
- Item B depends on item A if it needs A's types, functions, or data contracts
- Keep dependencies minimal — prefer loose coupling
- Detect and reject circular dependencies (use `ateam deps-check checkDeps --json`)

**Dependency waves:**
- Wave 0: items with no dependencies (run first)
- Wave 1: items that depend on Wave 0 items
- Wave 2: items that depend on Wave 1 items

**Important:** Within a wave, items flow through pipeline stages independently. Wave 1 items wait for their specific dependencies to reach `done` — they do NOT wait for all Wave 0 items.

**BAD (stage batching — never do this):**
```
Wait for all Wave 0 items to finish testing before any Wave 0 item can implement
```

**GOOD (individual flow):**
```
Item 001 finishes testing → immediately advance 001 to implementing
Item 002 still in testing → that's fine, they're independent
```

### When Items CAN Run in Parallel

Items can be in the same wave (no declared dependencies between them) when:
- They operate on different files with no shared types
- They are logically independent features
- They don't both modify shared configuration or root layout files

### When Items MUST Be Sequential (Dependencies Required)

- Item B imports types or functions defined by item A
- Item B wires item A's component into a route or layout
- Item B tests or depends on item A's API contract
- Item B documents item A's output

---

## Item ID Convention

IDs are generated by the API with format `WI-XXX` (e.g., `WI-001`, `WI-002`).

- **DO NOT hardcode IDs** — the API assigns them automatically
- Capture the `id` field from the `ateam items createItem` response
- Use the **exact returned ID** when specifying dependencies
- Wrong: `--dependencies "001,002"` | Correct: `--dependencies "WI-001,WI-002"`
