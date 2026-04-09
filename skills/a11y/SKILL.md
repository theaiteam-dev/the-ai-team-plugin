---
name: a11y
description: Accessibility patterns for AI agents working on UI. Covers interactive input labeling, button context, ARIA live regions, keyboard interaction, focus management, and competing UI state precedence. Used by Face (AC generation), Murdock (test queries), B.A. (markup), Lynch (review checklist), and Amy (probing).
---

# Accessibility Skill

Accessibility gaps found late (probing/review) cost full rejection cycles. This skill pushes a11y awareness to every stage so gaps are caught at the cheapest point — AC authoring.

**Applies to:** Any work item that produces user-facing markup — HTML, JSX, TSX, Vue, Svelte, server-rendered templates, or any output a user interacts with in a browser.

---

## Core Patterns

### 1. Interactive Inputs Must Have Accessible Labels

Every `<input>`, `<textarea>`, `<select>`, and `contenteditable` element needs a programmatic label. Screen readers announce "edit, text" with no context when labels are missing.

**Options (in order of preference):**
- Associated `<label>` element with `for`/`htmlFor` attribute
- `aria-label` attribute with descriptive text
- `aria-labelledby` pointing to a visible heading or description

**The label must identify WHAT is being edited, not just the action:**

```
BAD:  aria-label="Edit"
GOOD: aria-label="Edit title for Buy groceries"

BAD:  <input placeholder="Search...">  (placeholder is NOT a label)
GOOD: <input aria-label="Search todos" placeholder="Search...">
```

**Dynamic context matters.** When editing an item in a list, the label must include which item:
```
aria-label={`Edit title for ${todo.title}`}
```

### 2. Buttons Need Contextual Labels

A button's accessible name must identify both the action AND the target. Users navigating by button list hear every button name without surrounding context.

```
BAD:  <button>Delete</button>          (delete what?)
BAD:  <button>X</button>               (meaningless)
GOOD: <button aria-label={`Delete ${todo.title}`}>X</button>
GOOD: <button>Delete "{todo.title}"</button>
```

**Icon-only buttons** always need `aria-label` — the icon is invisible to screen readers.

### 3. Dynamic Content Needs ARIA Live Regions

Content that appears or changes without a page reload must be announced to screen readers.

| Pattern | Role | Use When |
|---------|------|----------|
| `role="alert"` | Assertive | Error messages, urgent notifications |
| `role="status"` | Polite | Loading states, success confirmations, empty states |
| `aria-live="polite"` | Polite | Content updates that aren't urgent |

```
// Error banner — interrupts immediately
<div role="alert">{errorMessage}</div>

// Empty state — announced when user is idle
<div role="status">No todos yet</div>

// Loading — announced politely
<div role="status" aria-label="Loading todos">...</div>
```

### 4. Keyboard Interaction Parity

Every action triggered by mouse MUST have a keyboard equivalent. Users who cannot use a mouse rely entirely on keyboard navigation.

| Mouse Action | Keyboard Equivalent | Notes |
|-------------|---------------------|-------|
| Click | Enter or Space | Buttons get this free; custom elements need `onKeyDown` |
| Double-click | Enter or F2 on focused element | Common for inline edit triggers |
| Hover to reveal | Focus to reveal | Tooltip, action buttons on list items |
| Drag | Arrow keys + modifier | Reorder lists, move items |
| Right-click menu | Shift+F10 or dedicated menu button | Context menus |

**Each trigger is a separate AC.** Do not combine "click or Enter" into one criterion — they are independently testable behaviors.

### 5. Focus Management

Focus must move logically when UI state changes. Losing focus to `<body>` after a state transition disorients keyboard users.

| Transition | Focus Should Move To |
|-----------|---------------------|
| Modal/dialog opens | First focusable element inside, or the dialog itself |
| Modal/dialog closes | The element that triggered it |
| Inline edit starts | The edit input |
| Inline edit ends (save/cancel) | The element that was edited (e.g., the title span) |
| Item deleted | Next item in list, or previous if last |
| Toast/banner appears | Stay where it was (don't steal focus — use `role="alert"`) |

---

## Competing UI States

When multiple conditional components share a visual region (loading spinner, empty state, error banner), only one should render at a time. Without explicit precedence, users see contradictory messages (e.g., "No todos yet" alongside "Failed to connect").

**Precedence rule: error > empty > loading > content**

```
// BAD — empty state shows during error
{error && <ErrorBanner error={error} />}
{todos.length === 0 && <EmptyState />}     // renders alongside error!

// GOOD — states are mutually exclusive
{error && <ErrorBanner error={error} />}
{!error && !loading && todos.length === 0 && <EmptyState />}
{!error && loading && <LoadingSpinner />}
{!error && !loading && todos.length > 0 && <TodoList todos={todos} />}
```

**Face must write precedence ACs** when an item assembles multiple conditional components:
```
"When fetchTodos fails, ErrorBanner is shown — EmptyState is NOT shown even though the list is empty"
"EmptyState is shown only after loading completes successfully with zero results"
```

---

## Per-Agent Usage

### Face (AC Generation)

For every work item that produces user-facing markup:

1. **Scan each interactive element** the component will contain and write label ACs:
   - Input fields → "The [name] input has an accessible label describing [what it edits]"
   - Buttons → "The [action] button has an accessible label identifying [which item/target]"
2. **Scan each dynamic state** and write live region ACs:
   - Error displays → `role="alert"`
   - Status messages, empty states → `role="status"`
3. **Scan each mouse-triggered action** and write keyboard ACs:
   - Each trigger gets its own AC line (not "click or keyboard")
4. **Scan conditional rendering** and write precedence ACs:
   - If 2+ states share a region, specify which wins

**Add to quality checklist:**
- [ ] Every interactive input has a label AC
- [ ] Every button has a contextual label AC
- [ ] Every dynamic content region has a live region AC
- [ ] Every mouse action has a keyboard equivalent AC
- [ ] Competing UI states have precedence ACs

### Murdock (Test Queries)

Use accessible queries as your primary selectors — if you can't find an element by its accessible name, the markup is wrong and the test correctly fails.

**Preferred query order:**
1. `getByRole('button', { name: 'Delete Buy groceries' })` — best
2. `getByLabelText('Edit title for Buy groceries')` — inputs
3. `getByText('No todos yet')` — static text
4. `getByTestId('todo-item')` — last resort only

**Never use** `getByTestId` when a role or label query would work — it bypasses the a11y contract.

### B.A. (Implementation)

- Every `<input>` gets `aria-label` or an associated `<label>`. No exceptions.
- Every action button gets context: `aria-label={`Delete ${item.title}`}` not just `"Delete"`.
- Dynamic content gets the right role: `role="alert"` for errors, `role="status"` for status.
- Conditional renders use precedence guards — error blocks empty blocks loading.
- Focus moves to the right place on state transitions (see Focus Management table).

### Lynch (Review Checklist)

Add to your review:
- [ ] Every `<input>` / `<textarea>` / `<select>` has a programmatic label
- [ ] Every button's accessible name includes action + target context
- [ ] Error messages use `role="alert"`; status messages use `role="status"`
- [ ] Mouse-triggered actions have keyboard equivalents
- [ ] Conditional rendering states are mutually exclusive (precedence enforced)
- [ ] Focus management on state transitions (inline edit, modal, delete)

### Amy (Probing)

Verify the screen reader experience:
- Can every interactive element be identified without visual context?
- Do error/status messages announce to assistive technology?
- Can the full workflow be completed with keyboard only?
- Do competing states ever render simultaneously?
