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

**The 5-test ceiling:** If Murdock would need more than 5 tests to cover a feature item's acceptance criteria, the item is too big — split it. This works bidirectionally: test count informs sizing (not just the reverse). An item with 8 ACs almost certainly needs splitting; an item with 2 ACs might be too small or under-specified.

### Atomicity (The #1 Decomposition Defect)

Research across 1,000+ user stories identifies **compound items** — items that bundle two or more independent behaviors — as the single most common breakdown defect. A compound item forces Murdock to test two concerns, B.A. to implement two things, and Lynch to review a bigger surface. Every atomicity violation multiplies downstream rework.

**Test:** Can you describe this item's outcome in one sentence without "and"? If you need "and," it's probably two items.

- "Users can create orders **and** view order history" → two items
- "Users can create orders with line items and see real-time totals" → one item (totals are part of creation)

### Splitting Patterns

When an item is too big, use one of these named patterns to find the natural seam:

| Pattern | When to use | Example |
|---------|-------------|---------|
| **Workflow steps** | Multi-step processes | Checkout: cart → shipping → payment → confirm |
| **CRUD operations** | "Manage X" stories | Create account, edit profile, delete account |
| **Business rule variations** | Multiple rules for same goal | Tax: taxable states vs. exempt states |
| **Simple/complex** | Feature with many options | Basic search first, then filters and sorting |
| **Data variations** | Complex data handling | Search by name first, add filters later |
| **Defer performance** | Functional + NFR combined | Make it work, then make it fast |

**The meta-pattern:** Find the core complexity, list all variations, then capture one complete vertical slice through the complexity rather than multiple variations at once.

**Anti-pattern — horizontal slicing:** Never split by architectural layer (UI item, API item, DB item). Each item must be a complete vertical slice that can be independently tested and delivered.

### Good Splits

- "User authentication service" → separate items for login, logout, token refresh, password reset (CRUD pattern)
- "Order processing" → separate items for create order, cancel order, refund order (CRUD pattern)
- "Search feature" → basic search, then add filters, then add sorting (simple/complex pattern)

### Bad Splits (Over-splitting)

- Splitting a single function across multiple items
- Creating artificial boundaries that require excessive cross-references
- 5 items that all write to the same file and could be described as "build the X component"
- Each item generates a test file, and 40 test files for one PRD is excessive
- Horizontal slicing: "Create todo UI", "Create todo API", "Create todo DB migration" (should be one item)

### Integration-Last Decomposition for Integration-Heavy PRDs

When a PRD describes a page or app assembled from multiple components, the integration parent file (e.g. `App.tsx`, `_app.tsx`, root layout) is a **shared seam**: every component item that introduces or changes a prop contract has to flow that change back into the parent's call sites. If multiple component items run in the same wave and the parent already exists from the scaffold, those parallel edits collide on the parent file and produce phantom typecheck failures during review (a sibling's contract change has landed but its parent-side patch has not yet propagated to the reviewer).

**The rule:** the scaffold item does NOT create the integration parent file. A dedicated integration item (the final wave) creates the parent from scratch, importing the real components.

```
WI-001: Scaffold (Vite + TS + Tailwind + test setup + types + API client) — does NOT create App.tsx
WI-002: ErrorBanner component                       ┐
WI-003: EmptyState component                        │ all in parallel; none touch App.tsx
WI-004: CreateTodo component                        │
WI-005: TodoItem component                          │
WI-006: TodoList component                          ┘
WI-007: App integration — creates App.tsx from scratch, imports the five real components
```

**Why this works:**

- **No shared seam during the parallel wave.** Component items only write their own files (`components/EmptyState.tsx`, `components/EmptyState.test.tsx`). Lynch's project-wide typecheck for sibling N can't fail on contract drift in a shared parent, because the parent doesn't exist yet.
- **No big-bang integration failure.** By the time WI-007 runs, every component already exists at a known path with a known prop contract. The integration agent imports real components (no reimagining interfaces) and wires them per the parent's own ACs. WI-007 has no in-flight siblings, so its full-project typecheck reflects reality.

**To prevent the integration item from reimagining interfaces** (the failure mode the old shell-first pattern was guarding against): the integration item's `context` field must list each component's `outputs.impl` path AND the prop signature derived from that component's acceptance criteria. The integration agent reads those imports as the authoritative interface. If an interface is ambiguous from the AC, surface that as a Sosa question rather than letting the integration agent guess.

**When to use integration-last:**
- PRD describes a page composed of 3+ distinct components
- Multiple components need to be wired into a shared parent
- The parent manages shared state consumed by children

**When NOT to use integration-last:**
- Components are independent (no shared parent wiring needed)
- PRD is primarily API/backend work with no page assembly
- Only 1-2 components to wire (those can land directly with the integration item)

**Hard rule for scaffold items:** the scaffold may create config files, type definitions, an API client, and an empty `index.html` / entry point that mounts a placeholder, but the scaffold MUST NOT import any sibling-wave component or define a parent that will be edited by sibling items. If the scaffold needs to mount *something* (so the dev server boots), mount a single inline placeholder element inside the entry file (`<div>Loading…</div>` in `main.tsx` is fine) — never a `<ComponentName />` reference that points at a sibling's output path.

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

#### Example Mapping Validation

For each AC you write, ask: "Can I describe a concrete input and expected output?" If you can't give a specific example, the AC is too vague for Murdock to test.

| AC | Example | Verdict |
|----|---------|---------|
| "Returns 201 with order ID" | `POST {items: [{sku: "W", qty: 2}]}` → `{id: "ord_123"}` | Testable |
| "Handles errors gracefully" | ??? — which errors? what's "graceful"? | Too vague — rewrite |
| "When createTodo fails, error is shown and input preserved" | `createTodo` rejects → banner shows error text, input still has typed value | Testable |

If you can't produce a concrete example for an AC, it needs to be rewritten with specific inputs, actions, and observable outcomes. This is the single most effective technique for preventing downstream rework — vague ACs produce vague tests which produce wrong implementations.

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

#### Absence/Empty Conditions

When an AC describes "render nothing" or "hide when absent" behavior, use behavioral language rather than enumerating specific falsy values. Let the implementation agent decide what constitutes "no meaningful value" in their language.

**BAD:**
```
"When error is null or empty string, nothing is rendered"
# Misses whitespace-only strings, undefined, etc. — language-specific gaps
```

**GOOD:**
```
"When no meaningful error is present, nothing is rendered"
# Implementation agent handles null, empty, whitespace, undefined idiomatically
```

Enumerating falsy values creates gaps because different languages and frameworks have different falsy semantics. Behavioral language lets the implementer cover all cases naturally.

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

#### Accessibility Criteria (Mandatory for UI Items)

If a work item produces user-facing markup (HTML, JSX, TSX, Vue, Svelte, server-rendered templates — anything a user interacts with in a browser), include a11y criteria. Consult the **a11y skill** for the full checklist of patterns: input labeling, button context, ARIA live regions, keyboard parity, focus management, and competing UI state precedence.

Catching a11y gaps at AC authoring is far cheaper than Amy finding them post-implementation.

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

### Optimizing Dependency Depth for Parallelism

After drafting items, review the dep graph shape. **Wider is better** — more items per wave means more pipeline parallelism. If the graph is deep and narrow, look for bottleneck items that can be folded into scaffold.

**Bottleneck item:** A non-scaffold item depended on by 2+ other items. Every downstream item must wait for the bottleneck to reach `done` before entering the pipeline — this serializes work.

**Fix:** If the bottleneck is thin infrastructure (types, fetch wrappers, config, utility modules without business logic), fold it into the scaffold/foundation item. All its dependents now depend on scaffold instead, and they fan out in the same wave.

**Do NOT fold** items that contain substantial feature logic (user-facing behavior, complex state management, 3+ behavioral tests). Those are real features that deserve their own pipeline pass.

**Example:**

```
BAD  — API client as separate item (depth 4, max width 2):
  Scaffold → API client → (Form, TodoItem) → App
             ^^^^^^^^^^^^
             bottleneck: thin fetch wrapper, 1-2 smoke tests, 4 dependents

GOOD — API client folded into scaffold (depth 3, max width 4):
  Scaffold+API → (Form, TodoItem, ErrorBanner, EmptyState) → App
```

Same total work, but wave 1 processes 4 items concurrently instead of 2.

---

## Item ID Convention

IDs are generated by the API with format `WI-XXX` (e.g., `WI-001`, `WI-002`).

- **DO NOT hardcode IDs** — the API assigns them automatically
- Capture the `id` field from the `ateam items createItem` response
- Use the **exact returned ID** when specifying dependencies
- Wrong: `--dependencies "001,002"` | Correct: `--dependencies "WI-001,WI-002"`
