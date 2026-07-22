---
name: teams-messaging
description: Native teams messaging protocol for pipeline agents. Consult this skill when sending or receiving START, ACK, ALERT, FYI, BLOCKED, or DONE messages, handling shutdown requests, or implementing peer-to-peer handoffs between agents.
---

# teams-messaging

Reference for the native teams messaging protocol used by all pipeline agents when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

> **Orchestrator address: use `team-lead`, not `hannibal`.** Hannibal is the orchestrator's persona/role name — the name used in prose, in the playbook, and in your own reasoning. But its `SendMessage` **address** in native teams mode is `team-lead`. Every FYI, ALERT, BLOCKED, or DONE message aimed at the orchestrator MUST use `to: "team-lead"`. This was a real, observed reliability bug: messages sent `to: "hannibal"` silently bounce — no error, no ACK, nothing — and the pipeline only survived because idle-notification summaries happened to leak the payloads elsewhere. A dropped FYI/ALERT is invisible message loss; the mandatory heartbeat does not catch it because nothing looks stalled. When in doubt, address the orchestrator as `team-lead`.
>
> **Headless exception:** in a print-mode session (`claude -p`), `team-lead` is NOT valid — the orchestrator's address is the literal **`main`**, and a send to `team-lead` errors with "not a valid address". Rule: try `team-lead` first; on an invalid-address error, resend to `main` and use `main` for all orchestrator-bound messages from then on.

## Peer Addressing: Resolve agentIds From the Pool

Friendly instance names (`murdock`, `ba-2`) do NOT route between teammates in headless mode — a name-addressed peer message is silently dropped. Forward handoffs get the next agent's id from `claimedNextAgentId` (agentStop response). For **backward** peer messages (ACK, REJECTED, TEST BUG) there is no auto-claim, so resolve the target's agentId from its pool marker — the marker's *content* is the agentId the orchestrator registered at `mark-idle --agent-id`:

```bash
# Resolve <instance>'s agentId (marker may be .idle or .busy depending on state):
PEER_ID=$(cat /tmp/.ateam-pool/$ATEAM_MISSION_ID/<instance>.idle 2>/dev/null \
       || cat /tmp/.ateam-pool/$ATEAM_MISSION_ID/<instance>.busy 2>/dev/null)
# Address the message to $PEER_ID; fall back to the instance name ONLY if empty
# (empty marker = pool was populated without --agent-id, i.e. interactive mode
# where names route fine).
```

This is a read-only `cat` — it does not violate the "never touch pool files directly" rule, which is about mutation (`mv`/`touch`/`rm`).

## Core Principle

**`ateam` CLI commands are the source of truth for work tracking.** `SendMessage` is for coordination only. Always use `ateam agents-start`, `ateam agents-stop`, and `ateam activity createActivityEntry` to record work. In native teams mode, pipeline agents advance items atomically via `ateam agents-stop agentStop --advance` (or `--outcome rejected --return-to <stage>` for rejections). Hannibal uses `ateam board-move moveItem` only in legacy mode.

---

## Message Formats

### START (sender → next agent)

Send after `ateam agents-stop agentStop --advance` completes, to hand off directly to the next pipeline agent. The `message` must carry a full **handoff contract**, not just a one-line summary — see [Handoff Contracts](#handoff-contracts-start-and-alert) below for the required fields.

```javascript
SendMessage({
  to: "{next_agent}",
  message: "START: {itemId} - {handoff contract: signatures, resolution chain, helpers to reuse, what NOT to touch, current red state, verify command}",
  summary: "START {itemId}"
})
```

### ACK (receiver → sender)

When you receive a `START: {itemId}` message, immediately reply with ACK before beginning work. Address it to the **sender's agentId resolved from its pool marker** (see "Peer Addressing" above) — the sender's instance name appears in the START signature, but a name-addressed ACK silently drops in headless mode and the sender burns its 20s timeout.

```javascript
// SENDER_ID = cat pool marker for the sender's instance (fallback: instance name)
SendMessage({
  to: "{SENDER_ID}",
  message: "ACK: {itemId}",
  summary: "ACK {itemId}"
})
```

### FYI (any agent → Hannibal)

Sent after a successful handoff (ACK received) or after completing work that requires no downstream peer.

```javascript
SendMessage({
  to: "team-lead",
  message: "FYI: {itemId} - {brief description of what happened}",
  summary: "Handoff complete for {itemId}"
})
```

### ALERT (any agent → Hannibal)

Sent when a handoff times out (no ACK after 20 seconds) or when something requires Hannibal's intervention. **If the ALERT means implementation work is now queued waiting for an idle agent (e.g., no idle B.A.), it must carry the full handoff contract** — see [Handoff Contracts](#handoff-contracts-start-and-alert) — so whoever picks up the item next starts cold with zero re-derivation.

```javascript
SendMessage({
  to: "team-lead",
  message: "ALERT: {itemId} - {description of the problem requiring intervention. If work is queued: include the handoff contract — signatures, resolution chain, helpers to reuse, what NOT to touch, current red state, verify command}",
  summary: "Alert for {itemId}"
})
```

### DONE (any agent → Hannibal)

Used instead of the peer handoff pattern for blocked items, non-advance stops, or terminal agents (Amy, Tawnia, Stockwell).

```javascript
SendMessage({
  to: "team-lead",
  message: "DONE: {itemId} - {brief summary of work completed}",
  summary: "Work complete for {itemId}"
})
```

### BLOCKED (any agent → Hannibal)

When you need help or cannot proceed.

```javascript
SendMessage({
  to: "team-lead",
  message: "BLOCKED: {itemId} - {description of issue}",
  summary: "Blocked on {itemId}"
})
```

---

## Handoff Contracts (START and ALERT)

A `START` (peer handoff) or `ALERT` (queued/no-idle-agent) message that names only the item ID and a one-line summary forces the receiver to re-derive context the sender already worked out. Observed on a live mission: an `ALERT` sent when no B.A. instance was idle carried a full implementation contract — exact signatures, the resolution chain, which helpers to reuse, what NOT to touch, the TDD red state, and the verify command. When the item was later dispatched, that contract was forwarded verbatim, and the receiving B.A. started cold with zero re-derivation. This is the backbone of the pipeline's speed: queue latency becomes prep time instead of dead time.

**Every START (peer handoff) and every ALERT that hands off pending implementation work MUST include:**

- **Exact signatures** — the struct/function/type signatures the receiver will write or call, not a paraphrase.
- **Resolution chain** — the ordered steps from current state to done (e.g., "1) parse X, 2) validate via Y, 3) call Z").
- **Helpers to reuse** — name the existing functions/helpers the receiver must call instead of reimplementing (e.g., `normalizeRepoURL`).
- **What NOT to touch** — files/functions that must stay untouched (e.g., `ReadManifest`), so the receiver doesn't widen the change.
- **Current TDD/red state** — which tests are red, why, and what "green" looks like.
- **Verify command** — the exact command the receiver runs to confirm the fix (test file path, build command, etc.).

There is no separate contract message type — fold these fields into the `message` string of the standard START/ALERT format.

**Hard caveat — the contract is advisory; the item's ACs are authoritative. Never instruct skipping an AC.** A contract must never tell the receiver to skip or weaken an acceptance criterion because "it isn't pinned by tests" or "simplest is to let it fall through." That is a defect in the contract, not a valid shortcut — even when it's true that no test currently pins the AC yet. If a contract-writer notices an AC has no failing test backing it, the correct move is to flag the gap (route back to testing, or call it out explicitly in the contract as a risk), not to write around it. The receiver still implements every AC on the item — checked against the item's `acceptance` list, not just the contract narrative — and flags that the tests must be tightened to pin it.

Observed failure mode: a contract explicitly said a declared-but-unwired flag "isn't pinned by tests, simplest is to let the chain win." The implementer followed the contract faithfully, candidly logged the simplification, and the AC was silently dropped. The review stage caught it only by diffing the implementation against the item's ACs directly — not against the contract. **Reviewers (Lynch, Stockwell, Amy) must diff contract-vs-ACs explicitly, not just contract-vs-implementation**, for exactly this reason.

---

## Wait-and-ACK Protocol

After sending a START message to the next agent:

1. **Wait up to 20 seconds** for the agent to reply with `ACK: {itemId}`.
2. **On ACK received** — send FYI to Hannibal:
   ```javascript
   SendMessage({
     to: "team-lead",
     message: "FYI: {itemId} - Handed off to {next_agent} directly. ACK received.",
     summary: "Handoff complete for {itemId}"
   })
   ```
3. **On timeout (no ACK after 20s)** — send ALERT to the orchestrator (`team-lead`), and **include the full handoff contract you sent in START** so it can cold-redispatch the work without reconstructing it (a bare "timeout" ALERT leaves the receiver unable to redispatch):
   ```javascript
   SendMessage({
     to: "team-lead",
     message: "ALERT: {itemId} - No ACK from {next_agent} after 20 seconds. Manual dispatch may be needed. Full handoff contract for cold redispatch follows:\n\n{the exact contract from your START message: signatures, resolution chain, helpers to reuse, what NOT to touch, red/TDD state, verify command}",
     summary: "Handoff timeout for {itemId} (contract attached)"
   })
   ```

---

## Per-Agent Handoff Sequences

### Murdock → B.A.

After `ateam agents-stop agentStop --advance`:
1. Send `START` to `ba` — carry the **full handoff contract** (see [Handoff Contracts](#handoff-contracts-start-and-alert)): exact signatures, the resolution chain, helpers to reuse, what NOT to touch, the current red/TDD state, and the verify command — not just the test-file location and a one-line summary.
2. Wait for `ACK` from `ba` (20s timeout)
3. Send `FYI` or `ALERT` to `team-lead`

**B.A.'s ACK message:**
```javascript
SendMessage({ to: "murdock", message: "ACK: {itemId}", summary: "ACK {itemId}" })
```

### B.A. → Lynch

After `ateam agents-stop agentStop --advance`:
1. Send `START` to `lynch` — carry the **full handoff contract** (see [Handoff Contracts](#handoff-contracts-start-and-alert)): impl and test file locations, the exact behavior/signatures implemented, what NOT to touch, any deviations from the incoming contract, and the verify command — not just file locations and a summary.
2. Wait for `ACK` from `lynch` (20s timeout)
3. Send `FYI` or `ALERT` to `team-lead`

**Lynch's ACK message:**
```javascript
SendMessage({ to: "ba", message: "ACK: {itemId}", summary: "ACK {itemId}" })
```

### Lynch → Amy (APPROVED path)

After `ateam agents-stop agentStop --advance` (approved):
1. Send `START` to `amy` — carry the full probe context so Amy starts cold (the same completeness the [Handoff Contracts](#handoff-contracts-start-and-alert) rule requires, adapted to a review→probe handoff): what was reviewed, exactly what changed and where, the specific attack surfaces / areas to probe, and the build/verify/repro command — not just a one-line summary.
2. Wait for `ACK` from `amy` (20s timeout)
3. Send `FYI` or `ALERT` to `team-lead`

**Amy's ACK message:**
```javascript
SendMessage({ to: "lynch", message: "ACK: {itemId}", summary: "ACK {itemId}" })
```

### Lynch → Murdock (REJECTED path)

**All rejections that return to `testing` route through Murdock** — both Lynch's review rejections and B.A.'s self-rejected TEST BUGs (see next section). Lynch retains a separate impl-only rejection path via `--return-to implementing` → `ba-N` for cases where tests are correct but the implementation is wrong (see "Rejection Routing Reference" table further down); this section covers only the `testing` route. See `agents/lynch.md` "Rejection Flow" and `agents/murdock.md` Step 2.5 for the rationale (TDD invariant: every defect becomes a failing test before code changes).

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
  to: "team-lead",
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
  to: "{MURDOCK_ID}",  // agentId resolved from murdock-N's pool marker (see "Peer Addressing"); fallback: instance name
  message: "REJECTED: {itemId} - TEST BUG at {file:line}. {one-sentence reason}. Test change needed: {what Murdock must change}. Impl status: {complete|partial}.",
  summary: "REJECTED {itemId} (TEST BUG)"
})
```

> **Backward/rejection routing: resolve the target's agentId from its pool marker** (see "Peer Addressing" above). Rejection is a backward hop the pool does not auto-claim, so no `claimedNextAgentId` is returned — but the marker content gives you the same id the forward path uses. Name-addressed backward messages silently drop in headless (`claude -p`) mode; either way rejections are also fire-and-forget (the returned item is picked up from the board), so a dropped rejection message degrades context, not correctness.

```javascript
SendMessage({
  to: "team-lead",
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
  to: "team-lead",
  message: "FYI: {itemId} - Probing complete. {VERIFIED/FLAG}. {one-line verdict summary}",
  summary: "Probing complete for {itemId}"
})
```

No START/ACK needed. On VERIFIED, `--advance` already moved the item to `done`. On FLAG, Amy calls `agentStop --outcome rejected --return-to <testing|implementing> --advance=false` per the earliest-flagged-stage principle (see the rejection-routing note below), sends `REJECTED` to the matching peer (`murdock-N` or `ba-N`), and sends `FYI` to Hannibal.

### Tawnia → Hannibal (terminal — no downstream)

After `ateam agents-stop agentStop`, send DONE to Hannibal:

```javascript
SendMessage({
  to: "team-lead",
  message: "DONE: docs - {brief summary of documentation and commit hash}",
  summary: "Documentation complete"
})
```

### Stockwell → Hannibal (terminal — no downstream)

After `ateam agents-stop agentStop`, send DONE to Hannibal:

```javascript
SendMessage({
  to: "team-lead",
  message: "DONE: FINAL-REVIEW - FINAL APPROVED/FINAL REJECTED - {summary}",
  summary: "Final mission review complete"
})
```

### Sosa → Hannibal (planning phase — terminal critique)

Sosa runs during `/ai-team:plan`, not `/ai-team:run`. After reviewing every item in `briefings`, send the refinement report to Hannibal so Face can apply the recommendations on the second pass:

```javascript
SendMessage({
  to: "team-lead",
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
  to: "team-lead",
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
