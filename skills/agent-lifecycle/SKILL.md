---
name: agent-lifecycle
description: Standard patterns for agent activity logging and completion signaling. Consult this skill when logging progress milestones with ateam activity createActivityEntry, or when signaling work completion with ateam agents-stop agentStop.
---

# Agent Lifecycle Patterns

## Activity Logging

### Command

```bash
ateam activity createActivityEntry --agent "<AgentName>" --message "<message>" --level info
```

Always use `ateam activity createActivityEntry` for progress logging. Never use `echo` or print statements as a substitute.

### When to Log

Log at meaningful milestones — not every step, not just start/end. The Live Feed should tell a story of the work.

**Standard checkpoints:**
- Starting work on an item (after claiming it)
- A key decision point or finding (hypothesis confirmed, test results, verdict)
- Completion (what was produced, what the outcome was)

**Good milestone messages:**
```bash
# Starting work
ateam activity createActivityEntry --agent "Murdock" --message "Writing tests for order sync" --level info

# Key finding or decision point
ateam activity createActivityEntry --agent "Lynch" --message "Running test suite" --level info
ateam activity createActivityEntry --agent "Amy" --message "H1 CONFIRMED - onClick missing at Button.tsx:42" --level info

# Completion
ateam activity createActivityEntry --agent "B.A." --message "All tests passing" --level info
ateam activity createActivityEntry --agent "Tawnia" --message "Creating final commit" --level info
```

**Avoid:**
- Logging every file read or small action
- Vague messages like "working on it" or "done"
- Redundant logs that repeat the previous message

---

## Completion Signaling

### Command

```bash
ateam agents-stop agentStop \
  --itemId "<itemId>" \
  --agent "<agentname>" \
  --outcome completed \
  --summary "<summary>"
```

### Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--itemId` | Yes | Work item ID (e.g. `WI-007`, `FINAL-REVIEW`, `docs`) |
| `--agent` | Yes | Your agent name in lowercase (e.g. `murdock`, `ba`, `lynch`) |
| `--outcome` | Yes | `completed`, `blocked`, or `rejected` |
| `--summary` | Yes | What you did — see "What makes a good summary" below |
| `--advance` | No | Default `true` — advances item to next stage. Pass `--advance=false` to release without advancing. |
| `--return-to` | Conditional | Required when `--outcome rejected`. Stage to send item back to (`testing`, `implementing`, etc.) |

### What Makes a Good Summary

The summary is stored in the work item's `work_log` and displayed in the kanban UI. Write it for the next agent who picks this up.

**Include:**
- What was done (verb + object)
- File paths created or modified (where applicable)
- Key metrics (test count, pass rate, issue count)
- Verdict or outcome in clear terms

**Good summaries by role:**

```text
# Murdock — include test file path and count
"Created 5 test cases at src/__tests__/order.test.ts covering happy path, empty input, and auth failure"

# B.A. — include impl file path and test result
"Implemented OrderSyncService at src/services/order-sync.ts — all 5 tests passing"

# Lynch — start with verdict, then reason
"APPROVED - All tests pass, implementation matches spec. Files: order.test.ts, order-sync.ts"
"REJECTED - AC 'Returns 401 on invalid token' has no test. Required fixes: add auth failure test"

# Amy — start with verdict, then key evidence
"VERIFIED - Wiring confirmed, browser verification passed, all probes clean"
"FLAG - Found 1 critical issue: onClick handler at Button.tsx:42 is defined but not attached to element"

# Stockwell — start with verdict, include PRD coverage summary
"FINAL APPROVED - All PRD requirements addressed, 47 tests passing, no security issues"
"FINAL REJECTED - OrderService missing pagination (PRD req #3). Item WI-004 needs rework."

# Tawnia — include files modified and commit hash
"Updated CHANGELOG.md and README.md. Commit: a1b2c3d"
```

**Bad summaries:**
```text
# Too vague — tells the next agent nothing
"Done"
"Completed work"
"Tests written"

# Too long — use the activity log for verbose details, not the summary
"I read the feature item and then looked at the existing tests and then wrote 5 new tests covering..."
```

### --advance=false: WIP Limit Exceeded

When calling `agentStop` and the target stage is at WIP capacity, the API returns `WIP_LIMIT_EXCEEDED` (409). In this case:

1. Call `agentStop` with `--advance=false` to release your claim without advancing the item:
   ```bash
   ateam agents-stop agentStop --itemId "WI-007" --agent "murdock" --outcome completed --summary "..." --advance=false
   ```

2. Send an ALERT to Hannibal so he can re-dispatch when capacity opens:
   ```javascript
   SendMessage({
     to: "hannibal",
     message: "ALERT: WI-007 - WIP limit exceeded for next stage. Item released, needs re-dispatch.",
     summary: "WIP limit exceeded for WI-007"
   })
   ```

Do NOT retry agentStop in a loop — release once and let Hannibal handle scheduling.

### --outcome blocked: Error Cases

Use `--outcome blocked` (not `completed`) when you are unable to finish your work due to an unresolvable error:

```bash
ateam agents-stop agentStop \
  --itemId "WI-007" \
  --agent "murdock" \
  --outcome blocked \
  --summary "Cannot write tests — outputs.test not set on work item. Hannibal intervention needed."
```

Use `blocked` for:
- Work item is misconfigured (missing required fields like `outputs.test` or `outputs.impl`)
- Dependency is broken and cannot be fixed within your role boundaries
- Maximum rejections reached and item cannot advance

Do NOT use `blocked` for a review rejection — use `--outcome rejected` instead (see below).

### --outcome rejected: Sending an Item Backward

Use `--outcome rejected` when you are rejecting an item and sending it back for rework. The API increments `rejectionCount` and moves the item to the stage you specify. After 2 rejections, the item is automatically escalated to `blocked`.

`--return-to` specifies where the item goes:

| Who rejects | Why | `--return-to` |
|-------------|-----|---------------|
| Lynch | Tests are wrong/missing | `testing` |
| Lynch | Implementation is wrong | `implementing` |
| Amy | Code bug found (FLAG) | `implementing` |

```bash
# Lynch — bad tests
ateam agents-stop agentStop \
  --itemId "WI-007" --agent "Lynch" \
  --outcome rejected --return-to testing \
  --summary "REJECTED - AC 'Returns 401 on invalid token' has no test"

# Lynch — bad implementation
ateam agents-stop agentStop \
  --itemId "WI-007" --agent "Lynch" \
  --outcome rejected --return-to implementing \
  --summary "REJECTED - Implementation does not handle null case at line 42"

# Amy — code bug
ateam agents-stop agentStop \
  --itemId "WI-007" --agent "Amy" \
  --outcome rejected --return-to implementing \
  --summary "FLAG - requireOk crashes when API returns plain-text error body"
```

After calling `agentStop --outcome rejected`, send a `START` message directly to the appropriate agent (Murdock for testing, B.A. for implementing) — **do not wait for Hannibal to re-dispatch**.
