---
name: teams-messaging
description: Native teams messaging protocol for pipeline agents. Consult this skill when sending or receiving START, ACK, ALERT, FYI, BLOCKED, or DONE messages, handling shutdown requests, or implementing peer-to-peer handoffs between agents.
---

# teams-messaging

Reference for the native teams messaging protocol used by all pipeline agents when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

## Core Principle

**`ateam` CLI commands are the source of truth for work tracking.** `SendMessage` is for coordination only. Always use `ateam agents-start`, `ateam agents-stop`, and `ateam activity createActivityEntry` to record work. In native teams mode, pipeline agents advance items atomically via `ateam agents-stop agentStop --advance` (or `--outcome rejected --return-to <stage>` for rejections). Hannibal uses `ateam board-move moveItem` only in legacy mode.

---

## Message Formats

### START (sender → next agent)

Send after `ateam agents-stop agentStop --advance` completes, to hand off directly to the next pipeline agent.

```javascript
SendMessage({
  to: "{next_agent}",
  message: "START: {itemId} - {one-line summary of what the next agent needs to do}",
  summary: "START {itemId}"
})
```

### ACK (receiver → sender)

When you receive a `START: {itemId}` message, immediately reply with ACK before beginning work.

```javascript
SendMessage({
  to: "{sender_agent}",
  message: "ACK: {itemId}",
  summary: "ACK {itemId}"
})
```

### FYI (any agent → Hannibal)

Sent after a successful handoff (ACK received) or after completing work that requires no downstream peer.

```javascript
SendMessage({
  to: "hannibal",
  message: "FYI: {itemId} - {brief description of what happened}",
  summary: "Handoff complete for {itemId}"
})
```

### ALERT (any agent → Hannibal)

Sent when a handoff times out (no ACK after 20 seconds) or when something requires Hannibal's intervention.

```javascript
SendMessage({
  to: "hannibal",
  message: "ALERT: {itemId} - {description of the problem requiring intervention}",
  summary: "Alert for {itemId}"
})
```

### DONE (any agent → Hannibal)

Used instead of the peer handoff pattern for blocked items, non-advance stops, or terminal agents (Amy, Tawnia, Stockwell).

```javascript
SendMessage({
  to: "hannibal",
  message: "DONE: {itemId} - {brief summary of work completed}",
  summary: "Work complete for {itemId}"
})
```

### BLOCKED (any agent → Hannibal)

When you need help or cannot proceed.

```javascript
SendMessage({
  to: "hannibal",
  message: "BLOCKED: {itemId} - {description of issue}",
  summary: "Blocked on {itemId}"
})
```

---

## Wait-and-ACK Protocol

After sending a START message to the next agent:

1. **Wait up to 20 seconds** for the agent to reply with `ACK: {itemId}`.
2. **On ACK received** — send FYI to Hannibal:
   ```javascript
   SendMessage({
     to: "hannibal",
     message: "FYI: {itemId} - Handed off to {next_agent} directly. ACK received.",
     summary: "Handoff complete for {itemId}"
   })
   ```
3. **On timeout (no ACK after 20s)** — send ALERT to Hannibal:
   ```javascript
   SendMessage({
     to: "hannibal",
     message: "ALERT: {itemId} - No ACK from {next_agent} after 20 seconds. Manual dispatch may be needed.",
     summary: "Handoff timeout for {itemId}"
   })
   ```

---

## Per-Agent Handoff Sequences

### Murdock → B.A.

After `ateam agents-stop agentStop --advance`:
1. Send `START` to `ba` — include location of test file and a summary of what to implement
2. Wait for `ACK` from `ba` (20s timeout)
3. Send `FYI` or `ALERT` to `hannibal`

**B.A.'s ACK message:**
```javascript
SendMessage({ to: "murdock", message: "ACK: {itemId}", summary: "ACK {itemId}" })
```

### B.A. → Lynch

After `ateam agents-stop agentStop --advance`:
1. Send `START` to `lynch` — include locations of impl file and test file, and a summary of what was implemented
2. Wait for `ACK` from `lynch` (20s timeout)
3. Send `FYI` or `ALERT` to `hannibal`

**Lynch's ACK message:**
```javascript
SendMessage({ to: "ba", message: "ACK: {itemId}", summary: "ACK {itemId}" })
```

### Lynch → Amy (APPROVED path)

After `ateam agents-stop agentStop --advance` (approved):
1. Send `START` to `amy` — include a summary of what was reviewed and any areas to probe
2. Wait for `ACK` from `amy` (20s timeout)
3. Send `FYI` or `ALERT` to `hannibal`

**Amy's ACK message:**
```javascript
SendMessage({ to: "lynch", message: "ACK: {itemId}", summary: "ACK {itemId}" })
```

### Lynch → Murdock (REJECTED path)

**All rejections that return to `testing` route through Murdock** — both Lynch's review rejections and B.A.'s self-rejected TEST BUGs (see next section). There is no Lynch → B.A. path. See `agents/lynch.md` "Rejection Flow" and `agents/murdock.md` Step 2.5 for the rationale (TDD invariant: every defect becomes a failing test before code changes).

After `ateam agents-stop agentStop --outcome rejected --return-to testing --advance=false`, notify Murdock directly, then send FYI to Hannibal. The message must be actionable without Lynch in the loop: name the AC, the observed gap, the test change to consider, and the code fix B.A. will need.

```javascript
SendMessage({
  to: "murdock",
  message: "REJECTED: {itemId} - AC {n} {ac text}. Observed gap: {what's broken}. Test to add/tighten: {specific assertion}. Code fix required: {what B.A. must change}.",
  summary: "REJECTED {itemId}"
})
```

Then FYI to Hannibal:
```javascript
SendMessage({
  to: "hannibal",
  message: "FYI: {itemId} - REJECTED, returned to testing. Sent rejection to Murdock.",
  summary: "Rejection sent for {itemId}"
})
```

Note: Rejection messages are fire-and-forget — Murdock picks up the returned item from the board when next idle. No ACK is required or expected.

### B.A. → Murdock (REJECTED path — TEST BUG)

B.A. self-rejects only when a test is genuinely broken (see `agents/ba.md` "When the Test Is Wrong" for the narrow trigger criteria — disagreement, hardness, or missing impl do NOT qualify). The summary must start with `TEST BUG:` so the failure mode is greppable in retrospectives.

After `ateam agents-stop agentStop --outcome rejected --return-to testing --advance=false --summary "TEST BUG: ..."`, notify a Murdock instance directly, then send FYI to Hannibal:

```javascript
SendMessage({
  to: "murdock-N",  // exact instance from claimedNext in agentStop response
  message: "REJECTED: {itemId} - TEST BUG at {file:line}. {one-sentence reason}. Test change needed: {what Murdock must change}. Impl status: {complete|partial}.",
  summary: "REJECTED {itemId} (TEST BUG)"
})
```

```javascript
SendMessage({
  to: "hannibal",
  message: "FYI: {itemId} - self-rejected to testing (TEST BUG). Sent rejection to murdock-N.",
  summary: "TEST BUG bounce for {itemId}"
})
```

If `claimedNext` is empty and `poolAlert` is set (no idle Murdock), send `ALERT` to Hannibal instead — same recovery path Lynch uses on a no-idle ALERT.

Like Lynch's rejections, B.A. self-rejections count toward the same `rejectionCount` cap; when it reaches the configured cap (default `4`, override via `ATEAM_REJECTION_CAP`) the item escalates to `blocked`.

### Murdock → B.A. (rework pass-through START)

When Murdock enters Rework Mode (rejectionCount > 0) and audits existing tests as adequate (see `agents/murdock.md` Step 2.5 exit (b)), the START to B.A. must carry the upstream rejection verbatim plus Murdock's audit verdict — so B.A. fixes the impl without ambiguity about what the rejector wants:

```javascript
SendMessage({
  to: "ba",
  message: "START: {itemId} — REWORK (pass-through). Lynch rejection: {verbatim rejection}. Test audit: existing test at {path}:{line} asserts {behavior} — will fail once you apply {specific fix}. Impl change only, no test changes.",
  summary: "START {itemId} rework"
})
```

If Murdock's audit finds the test gap real (exit (a) — tests were added or tightened), use the normal START format from the top of this document.

### Amy → Hannibal (terminal — no downstream)

Amy has no downstream agent. After `ateam agents-stop agentStop`, send FYI directly:

```javascript
SendMessage({
  to: "hannibal",
  message: "FYI: {itemId} - Probing complete. {VERIFIED/FLAG}. {one-line verdict summary}",
  summary: "Probing complete for {itemId}"
})
```

No START/ACK needed. On VERIFIED, `--advance` already moved the item to `done`. On FLAG, Amy calls `agentStop --outcome rejected --return-to <testing|implementing> --advance=false` per the earliest-flagged-stage principle (see the rejection-routing note below), sends `REJECTED` to the matching peer (`murdock-N` or `ba-N`), and sends `FYI` to Hannibal.

### Tawnia → Hannibal (terminal — no downstream)

After `ateam agents-stop agentStop`, send DONE to Hannibal:

```javascript
SendMessage({
  to: "hannibal",
  message: "DONE: docs - {brief summary of documentation and commit hash}",
  summary: "Documentation complete"
})
```

### Stockwell → Hannibal (terminal — no downstream)

After `ateam agents-stop agentStop`, send DONE to Hannibal:

```javascript
SendMessage({
  to: "hannibal",
  message: "DONE: FINAL-REVIEW - FINAL APPROVED/FINAL REJECTED - {summary}",
  summary: "Final mission review complete"
})
```

### Sosa → Hannibal (planning phase — terminal critique)

Sosa runs during `/ai-team:plan`, not `/ai-team:run`. After reviewing every item in `briefings`, send the refinement report to Hannibal so Face can apply the recommendations on the second pass:

```javascript
SendMessage({
  to: "hannibal",
  message: "REVIEW COMPLETE: {APPROVED | APPROVED WITH WARNINGS | BLOCKED}\n\nCritical: {N}\nWarnings: {N}\nItems reviewed: {N}/{total}\n\n{full refinement report}",
  summary: "Decomposition review: {verdict}"
})
```

Sosa does **not** START Face directly. Face is re-invoked by the planning command, not via peer handoff. The verdict tells Hannibal whether the second pass should run.

### Sosa → user (human-clarification questions)

For QUESTION-level issues that only a human can resolve, use `AskUserQuestion` (NOT `SendMessage`) — these go to the user, not to a teammate:

```javascript
AskUserQuestion({
  questions: [{
    question: "Should email verification be required before login?",
    header: "Email verification",
    options: [
      { label: "Required", description: "..." },
      { label: "Optional", description: "..." },
      { label: "Skip",     description: "..." }
    ],
    multiSelect: false
  }]
})
```

Batch all open questions into one `AskUserQuestion` call when possible. Block on the answers, then incorporate them into the report sent to Hannibal.

If a question cannot be put in option form (open-ended business decision), escalate to Hannibal instead:

```javascript
SendMessage({
  to: "hannibal",
  message: "QUESTION: {description of ambiguity needing human input}",
  summary: "Needs human input on {topic}"
})
```

---

## Rejection Routing Reference

Pipeline order: `testing < implementing < review < probing`.

| Rejector | Valid `--return-to` | REJECTED recipient |
|----------|---------------------|--------------------|
| Lynch    | `testing`           | `murdock-N`        |
| Lynch    | `implementing`      | `ba-N`             |
| Amy      | `testing`           | `murdock-N`        |
| Amy      | `implementing`      | `ba-N`             |
| B.A.     | `testing` (TEST BUG only) | `murdock-N`  |

**Earliest-flagged-stage principle.** When a single rejection implicates failures at more than one stage, route to the EARLIEST flagged stage. The pipeline flows forward only — if Lynch or Amy routes to `implementing` but the test coverage also has a gap, the next reviewer will bounce it back to `testing`, costing an extra cycle. Routing to the earliest stage closes the loop in one cycle: Murdock writes the failing test, B.A. fills the impl in pass-through, the reviewer re-evaluates.

---

## Ad-Hoc Peer Requests

Agents sometimes need to ask a peer to fix something mid-work (e.g., B.A. finds a broken import in a test file and asks Murdock to fix it). This is NOT a pipeline handoff — it's a quick coordination message.

**IMPORTANT: Text output is NOT a message.** Printing "Good to go, ba-1" in your conversation output does nothing — only `SendMessage` reaches another agent.

### Requesting a fix

```javascript
SendMessage({
  to: "{peer_agent}",
  message: "FIX: {description of what needs fixing and why}",
  summary: "Fix request for {file/issue}"
})
```

### Replying when done

After completing the fix, **you MUST send a reply** so the requesting agent can proceed:

```javascript
SendMessage({
  to: "{requesting_agent}",
  message: "FIXED: {description of what was changed}",
  summary: "Fix applied"
})
```

If you cannot fix it (e.g., outside your boundaries), reply with why:

```javascript
SendMessage({
  to: "{requesting_agent}",
  message: "CANNOT_FIX: {reason}. Escalating to Hannibal.",
  summary: "Cannot fix, escalating"
})
```

---

## Shutdown Response

When you receive a shutdown request from Hannibal:

```javascript
SendMessage({
  type: "shutdown_response",
  request_id: "{id from shutdown request}",
  approve: true
})
```

---

## pool-handoff Interaction

Before calling `agentStop` and sending a peer handoff:

- **All agents**: Pool release and next-agent claiming are handled atomically by the `agentStop` CLI command. **Do NOT manually `mv` pool files** — this is now automated. See the `pool-handoff` skill for details on the only manual operation (claiming your own slot on startup).
