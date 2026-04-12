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

### Lynch → Murdock or B.A. (REJECTED path)

After `ateam agents-stop agentStop --outcome rejected --return-to <stage>`, notify the responsible agent directly, then send FYI to Hannibal:

```javascript
// To Murdock (test issues, --return-to testing):
SendMessage({
  to: "murdock",
  message: "REJECTED: {itemId} - {specific issues}. Required fixes: {fix list}",
  summary: "REJECTED {itemId}"
})

// To B.A. (implementation issues, --return-to implementing):
SendMessage({
  to: "ba",
  message: "REJECTED: {itemId} - {specific issues}. Required fixes: {fix list}",
  summary: "REJECTED {itemId}"
})
```

Then send FYI to Hannibal:
```javascript
SendMessage({
  to: "hannibal",
  message: "FYI: {itemId} - REJECTED, returned to {stage}. Sent rejection to {Murdock/B.A.}.",
  summary: "Rejection sent for {itemId}"
})
```

Note: Rejection messages are fire-and-forget — the rejected agent picks up the returned item from the board when it's next idle. No ACK is required or expected.

### Amy → Hannibal (terminal — no downstream)

Amy has no downstream agent. After `ateam agents-stop agentStop`, send FYI directly:

```javascript
SendMessage({
  to: "hannibal",
  message: "FYI: {itemId} - Probing complete. {VERIFIED/FLAG}. {one-line verdict summary}",
  summary: "Probing complete for {itemId}"
})
```

No START/ACK needed. On VERIFIED, `--advance` already moved the item to `done`. On FLAG, Amy calls `agentStop --outcome rejected --return-to ready` to send the item back to ready (per the transition matrix: probing → ready), then sends ALERT to Hannibal with the bug details for re-dispatch.

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
