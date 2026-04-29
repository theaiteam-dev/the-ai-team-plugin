---
name: pool-handoff
description: Instance pool claim/release protocol for pipeline agents (Murdock, B.A., Lynch, Amy). Consult this skill before agentStart (to claim your pool slot) and when calling agentStop (to understand how the CLI handles release and next-agent claiming automatically).
---

# Pool Handoff Skill

Pipeline agents (Murdock → B.A. → Lynch → Amy) coordinate via a file-based instance pool in `/tmp/.ateam-pool/{missionId}/`. Each slot is either `.idle` or `.busy`.

**The `agentStop` CLI handles all pool management automatically** — self-release and next-agent claiming are done by the CLI, not by agents manually. The only manual pool operation agents perform is claiming their own slot on startup (Step 1 below).

**Exit code contract for `ateam pool claim` (stable; do NOT match on the message text):**

| Exit | Meaning | Treat as |
|------|---------|----------|
| `0` | Slot claimed (you won) | Success — proceed to `agentStart` |
| `2` | Already claimed (upstream `agentStop` pre-claimed your slot) | Success — proceed to `agentStart` |
| `3` | No such instance (.idle and .busy both missing) | Real failure — ALERT Hannibal |
| `4` | Corrupted state (both .idle and .busy present with distinct inodes) | Real failure — ALERT Hannibal |
| `5` | Pool dir does not exist (mission not initialized) | Real failure — ALERT Hannibal |
| `1` | Generic / unexpected (permission, EIO, malformed env, etc.) | Real failure — ALERT Hannibal |

Match on the exit code — `$?` after the call — not on substrings of the message. The error string is human-readable and may be reworded across releases; the exit code is the contract.

---

## Step 1 — Claim your own slot (on receiving a START message)

When you receive a START message and are about to begin work, claim your slot before calling `agentStart`:

```bash
# MY_NAME is your instance name, e.g. murdock-1, ba-2, lynch-1
# ATEAM_MISSION_ID must be set in the environment.

ateam pool claim "${MY_NAME}"
RC=$?

case "$RC" in
  0|2)
    # 0 = we won, 2 = upstream pre-claimed it for us. Both mean
    # the slot is now .busy in our name. Proceed to agentStart.
    ;;
  *)
    # 1, 3, 4, 5 — real failure. Send ALERT to Hannibal and stop.
    # Do not call agentStart without owning your slot.
    exit "$RC"
    ;;
esac
```

The CLI distinguishes each failure mode via its exit code (see the table above). Branch on `$?` — never grep the message text.

---

## Step 2 — Call agentStop (CLI handles release + next claim)

When you finish work, call `agentStop` normally. The CLI automatically:

1. POSTs completion to the API (advances the item)
2. `mv`s your `.busy` → `.idle` (releases your slot)
3. Atomically claims an idle instance of the next agent type
4. Returns `claimedNext` in the response

```bash
# ATEAM_MISSION_ID must be set for pool management to work.
# Get it from the current mission if not already in your environment:
export ATEAM_MISSION_ID=$(ateam missions-current getCurrentMission --json | jq -r '.id')

RESULT=$(ateam agents-stop agentStop \
  --itemId "$ITEM_ID" \
  --agent "$MY_NAME" \
  --outcome completed \
  --summary "..." \
  --json)

CLAIMED_NEXT=$(echo "$RESULT" | jq -r '.data.claimedNext // ""')
POOL_ALERT=$(echo "$RESULT" | jq -r '.data.poolAlert // ""')
```

**If `claimedNext` is set** — send START directly to that instance:
```javascript
SendMessage({ type: "message", recipient: CLAIMED_NEXT, content: "START: {itemId} - {summary}", summary: "START {itemId}" })
// Wait up to 20s for ACK, then send FYI to Hannibal
SendMessage({ type: "message", recipient: "hannibal", content: "FYI: {itemId} - handed off to {CLAIMED_NEXT}.", summary: "FYI {itemId}" })
```

**If `poolAlert` is set** (no idle next-agent instance) — send ALERT to Hannibal:
```javascript
SendMessage({ type: "message", recipient: "hannibal", content: "ALERT: {itemId} - {poolAlert}. Manual dispatch needed.", summary: "ALERT {itemId}" })
```

**Amy (last in pipeline)** — `claimedNext` will always be empty. Just send FYI to Hannibal:
```javascript
SendMessage({ type: "message", recipient: "hannibal", content: "FYI: {itemId} - probing complete. VERIFIED.", summary: "FYI {itemId}" })
```

---

## Rejected / blocked outcomes

On rejection, the CLI still releases your slot but does **not** claim a next-agent (no forward handoff). Send the appropriate message to the rejected-to agent directly:

```bash
RESULT=$(ateam agents-stop agentStop \
  --itemId "$ITEM_ID" \
  --agent "$MY_NAME" \
  --outcome rejected \
  --return-to implementing \
  --summary "REJECTED - ..." \
  --json)
# claimedNext will be empty — handle rejection routing yourself
```

---

## Requirements

- `ATEAM_MISSION_ID` must be set in the environment — without it, pool management is skipped silently
- Step 1 is `ateam pool claim` — do NOT manually `mv`, `touch`, `cp`, or `rm` pool files at any point (Step 1 or after)
- Branch on the `ateam pool claim` exit code (0 or 2 = success, anything else = ALERT). Never grep the error message — the text is human-readable and not a contract

---

## N=1 fallback (single-instance mode)

Same protocol — filenames are just `murdock.idle`, `ba.busy`, etc. No change to the flow.
