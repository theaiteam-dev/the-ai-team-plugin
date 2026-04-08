---
name: defensive-coding
description: Defensive coding patterns for AI agents. Covers guard-before-operate, async error recovery, input validation consistency, URL encoding, resource cleanup, transient state clearing, functional state updates, and network request hygiene (AbortController, path encoding, consistent error shapes) — with language-agnostic pseudocode examples.
---

# Defensive Coding Skill

Defensive code assumes things will go wrong and prepares for it. Every pattern here reduces silent failure, data corruption, or unexpected state.

---

## 1. Guard Before Operate

Check preconditions at the top of a function before doing any work. Return or throw early. Never let invalid input travel deeper into a call stack.

```
// BAD: invalid input silently corrupts deeper state
function processOrder(order):
  items = order.items
  for item in items:
    db.save(item)           // crashes with NullPointerException if order is null

// GOOD: guard at the boundary, fail immediately with a clear message
function processOrder(order):
  if order is null:
    throw InvalidArgumentError("order must not be null")
  if order.items is empty:
    throw InvalidArgumentError("order must have at least one item")
  for item in order.items:
    db.save(item)
```

Apply this at every public function boundary, API entry point, and anywhere external data enters your system.

---

## 2. Async Error Recovery

Async operations fail silently unless you explicitly handle rejections. Always pair async calls with error handling. Never let unhandled promise rejections or uncaught async exceptions propagate.

```
// BAD: if fetchUser throws, the caller receives undefined and proceeds as if nothing happened
async function loadDashboard(userId):
  user = await fetchUser(userId)       // unhandled rejection
  render(user.name)                    // crashes if user is null

// GOOD: handle each failure explicitly with a recoverable path
async function loadDashboard(userId):
  try:
    user = await fetchUser(userId)
    render(user.name)
  catch NetworkError as e:
    showErrorBanner("Could not load user data. Try again.")
    log.error("fetchUser failed", { userId, error: e })
  catch NotFoundError:
    redirectToLogin()
```

Never use a bare `catch` that swallows errors silently. Log and either recover or re-throw.

---

## 3. Input Validation Consistency

Validate the same rules everywhere the same input enters the system — not just in the UI layer. Server-side validation is mandatory even when client-side validation exists. Inconsistent rules create exploitable gaps.

```
// BAD: UI validates but API does not — attacker bypasses UI
// UI layer
if email does not match EMAIL_REGEX:
  showError("Invalid email")

// API layer — no validation
function createUser(email, password):
  db.insert({ email, password })        // accepts anything

// GOOD: centralize the rule, enforce at every boundary
function validateEmail(email):
  if email is null or empty:
    throw ValidationError("email is required")
  if email does not match EMAIL_REGEX:
    throw ValidationError("email format is invalid")

// Call validateEmail in the UI, the API handler, AND the service layer
function createUser(email, password):
  validateEmail(email)
  validatePassword(password)
  db.insert({ email, hashedPassword: hash(password) })
```

---

## 4. URL Encoding

Always encode user-supplied or dynamic values before embedding them in URLs. Raw strings with spaces, slashes, or special characters break routing and create injection vectors.

```
// BAD: spaces and special characters corrupt the URL
searchTerm = "hello world & more"
url = "/api/search?q=" + searchTerm         // becomes /api/search?q=hello world & more

// GOOD: encode each component separately, never the full URL
encodedTerm = percentEncode(searchTerm)
url = "/api/search?q=" + encodedTerm        // becomes /api/search?q=hello%20world%20%26%20more

// Also BAD: encoding path segments with the query encoder
userId = "user/with/slashes"
url = "/api/users/" + encodeQueryParam(userId)   // %2F still breaks routing on some servers

// GOOD: use path-segment encoding for path components
url = "/api/users/" + encodePathSegment(userId)
```

Use the encoding function appropriate to the context: query parameter values, path segments, and fragment identifiers each have different rules.

---

## 5. Resource Cleanup

Always release resources — file handles, database connections, locks, timers — regardless of whether the operation succeeds or fails. Use finally blocks, RAII patterns, or explicit disposal to guarantee cleanup.

```
// BAD: connection leaks if processRows throws
function exportData():
  conn = db.openConnection()
  rows = conn.query("SELECT * FROM orders")
  processRows(rows)                    // if this throws, conn is never closed
  conn.close()

// GOOD: cleanup in finally, always runs
function exportData():
  conn = db.openConnection()
  try:
    rows = conn.query("SELECT * FROM orders")
    processRows(rows)
  finally:
    conn.close()                       // runs whether processRows succeeded or threw

// ALSO GOOD: use a scoped resource manager if the language supports it
function exportData():
  using conn = db.openConnection():   // conn.close() called automatically on scope exit
    rows = conn.query("SELECT * FROM orders")
    processRows(rows)
```

---

## 6. Transient State Clearing

Clear temporary state — loading flags, error messages, progress indicators, cached partial results — before starting a new operation. Stale state from a previous run misleads users and causes logic errors.

```
// BAD: previous error message persists into the next attempt
function submitForm(data):
  result = api.post("/orders", data)
  if result.ok:
    showSuccess("Order placed")
  else:
    showError(result.errorMessage)

// On the second submit, the old errorMessage is still visible while the request is in flight.

// GOOD: clear transient state before the new operation starts
function submitForm(data):
  clearError()                        // reset previous error
  clearSuccess()                      // reset previous success
  setLoading(true)
  try:
    result = api.post("/orders", data)
    if result.ok:
      showSuccess("Order placed")
    else:
      showError(result.errorMessage)
  finally:
    setLoading(false)
```

---

## 7. Functional State Updates

When new state depends on previous state, derive it from the previous value — not from a snapshot captured at render or call time. Stale closures and race conditions cause state to silently revert.

```
// BAD: `count` is captured at function creation time — concurrent updates lose increments
count = 0

function increment():
  count = count + 1            // race condition: two concurrent calls both read 0, both write 1

// GOOD: pass an updater function that receives the latest state
function increment():
  count = updateAtomically(previous -> previous + 1)

// BAD in UI frameworks: stale closure captures outdated state
onAddItem(newItem):
  setItems([ ...items, newItem ])     // `items` may be stale from a previous render

// GOOD: use the functional update form
onAddItem(newItem):
  setItems(previousItems -> [ ...previousItems, newItem ])
```

Apply functional updates whenever state changes depend on the existing value, especially in concurrent or event-driven contexts.

---

## 8. Network Request Hygiene

HTTP requests in UI code require cleanup, deduplication, and encoding discipline. Missing any of these causes resource leaks, race conditions, or broken URLs.

### AbortController Cleanup

Any `fetch` call initiated in a React `useEffect` (or equivalent lifecycle hook) must be aborted when the component unmounts or the effect re-runs. Without this, completed requests update state on unmounted components, causing React warnings and potential crashes.

```
// BAD: fetch continues after unmount, setState on unmounted component
useEffect(() => {
  fetch("/api/data").then(r => r.json()).then(setData)
}, [])

// GOOD: abort on cleanup
useEffect(() => {
  controller = new AbortController()
  fetch("/api/data", { signal: controller.signal })
    .then(r => r.json())
    .then(setData)
    .catch(e => { if e.name !== "AbortError": throw e })
  return () => controller.abort()
}, [])
```

### Path Parameter Encoding

Dynamic values interpolated into URL path segments must be encoded. User-supplied IDs containing slashes, spaces, or unicode break routing silently.

```
// BAD: id with special characters breaks the URL
url = `/api/todos/${id}`              // if id = "foo/bar", route resolves wrong

// GOOD: encode path segments
url = `/api/todos/${encodeURIComponent(id)}`
```

### Consistent Error Shape

All API client functions should surface errors in the same shape. If `fetchTodos` throws an `Error` with `.message`, then `createTodo`, `updateTodo`, and `deleteTodo` must also throw an `Error` with `.message` — not silently return `undefined` or throw raw response objects.

```
// BAD: inconsistent — some throw Error, some return null, some throw Response
async function fetchTodos():
  resp = await fetch("/api/todos")
  if not resp.ok: throw new Error(await resp.text())  // throws Error

async function deleteTodo(id):
  resp = await fetch(`/api/todos/${id}`, { method: "DELETE" })
  if not resp.ok: return null                          // returns null — caller can't .catch()

// GOOD: shared error handling, consistent shape
async function request(url, options):
  resp = await fetch(url, options)
  if not resp.ok:
    body = await resp.json().catch(() => null)
    throw new Error(body?.message ?? `Request failed: ${resp.status}`)
  return resp
```

---

## 9. Import, Don't Redefine

When a type, interface, constant, or utility already exists in the project — whether from a dependency item, a shared module, or a prior implementation — import it. Never redefine it locally. Local copies drift from the source of truth, causing subtle type mismatches, missing fields, and review rejections.

```
// BAD: redefines a type that already exists in the project
// file: todoItem.ts
interface Todo {
  id: string
  text: string
  completed: boolean
}
// Missing `createdAt` field that the real type in api.ts has — silent bug

// GOOD: import the canonical type
// file: todoItem.ts
import { Todo } from "./api"       // single source of truth
```

Before defining any type or utility, search the project for existing definitions. If a dependency item's `outputs.types` defines the type you need, import from there.

---

## 10. Verify Wiring, Don't Reimplement

When an acceptance criterion says "imports/uses/renders [X from WI-NNN]" or "integrates with [module]," the requirement is to wire the **real** dependency — not to reimplement its behavior inline. An inline reimplementation may produce identical output and pass all tests, but it violates the AC and creates a maintenance divergence.

```
// BAD: AC says "Renders EmptyState component from WI-179" but reimplements inline
function App():
  if todos.length == 0:
    return <p>No todos yet</p>           // passes text-matching tests, violates AC

// GOOD: import and render the real component
import { EmptyState } from "./EmptyState"
function App():
  if todos.length == 0:
    return <EmptyState />                 // satisfies the AC — real dependency wired
```

**Before marking work complete:** For every AC that names a specific module or component, `grep` or search for the import in your implementation file. If the import doesn't exist, the AC is not satisfied — even if tests pass.

---

## Self-Check Before Submitting

For every function or module you write, verify:

1. Preconditions are guarded at the top — invalid input cannot travel deeper.
2. Every async call has explicit error handling — no unhandled rejections.
3. Validation rules match on both the client and the server (or service boundary).
4. Dynamic values embedded in URLs are encoded with the correct encoder for their context.
5. Every acquired resource is released in a `finally` block or equivalent.
6. Transient UI/operation state is cleared before each new operation begins.
7. State updates that depend on prior state use the functional (updater) form.
8. Fetch calls in effects are aborted on cleanup — no setState on unmounted components.
9. All API client functions throw errors in a consistent shape.
10. Path parameters are encoded with `encodeURIComponent` before interpolation.
11. Every type, interface, and utility is imported from its canonical location — no local redefinitions.
12. Every AC that names a specific module/component is satisfied by a real import — no inline reimplementations.
