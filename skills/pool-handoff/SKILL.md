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
2. `mv`s your `.busy` → `.idle` (releases your slot). **In a single-use pool** it parks your marker as `.parked-<itemId>` while the item is still in the pipeline (`data.parkedFor`), or deletes it and every marker parked for the item once the item reaches `staged`, `done`, or `blocked` (`data.retire`). The response's `data.poolMode` (`"single-use"` or `"reuse"`) tells you which mode applies; decide from it, not from assumption.
3. Atomically claims the next agent type's instance: in a single-use pool, the one parked for this item first, else an idle one (a rejection claims the return stage's agent the same way)
4. Returns `claimedNext` (the instance name) **and `claimedNextAgentId` (its harness agentId)** in the response
5. **`poolMode: "single-use"` only:** returns `replenish` — `{agentType, count, ...}`, how many fresh instances of your type the remaining board still needs — plus `parkedFor` or `retire`. End your FYI/ALERT to the orchestrator with `replenish=<agentType>:<count>` (`replenish=unknown` if the field is absent in single-use mode) and `retire=<instances>` when `retire` is present; no suffix at all in reuse mode. See `teams-messaging` → "Single-Use Pools".

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
CLAIMED_NEXT_AGENT_ID=$(echo "$RESULT" | jq -r '.data.claimedNextAgentId // ""')
POOL_ALERT=$(echo "$RESULT" | jq -r '.data.poolAlert // ""')
POOL_MODE=$(echo "$RESULT" | jq -r '.data.poolMode // "reuse"')
# Single-use pool only: the fact to append to your orchestrator message (empty in reuse mode).
REPLENISH=$(echo "$RESULT" | jq -r 'if .data.poolMode != "single-use" then "" elif .data.replenish then "replenish=\(.data.replenish.agentType):\(.data.replenish.count)" else "replenish=unknown" end')
# Single-use pool only: set when the item left the pipeline; append it after $REPLENISH.
RETIRE=$(echo "$RESULT" | jq -r 'if .data.retire then "retire=" + ([.data.retire[].instance] | join(",")) else "" end')
```

**If `claimedNext` is set** — send START directly to that instance. **Address it by `claimedNextAgentId`, not the instance name.** A friendly instance name (e.g. `ba-2`) does not route between teammates in native teams / headless (`claude -p`) mode — the message is silently dropped — whereas the harness agentId always delivers (and wakes the idle instance to receive it). Fall back to the name only when `claimedNextAgentId` is empty (a pool marked idle without `--agent-id`):
```javascript
// Prefer the agentId; fall back to the instance name only if it's absent.
const recipient = CLAIMED_NEXT_AGENT_ID || CLAIMED_NEXT
SendMessage({ type: "message", recipient, content: "START: {itemId} - {summary}", summary: "START {itemId}" })
// Wait up to 20s for ACK, then send FYI to the orchestrator
SendMessage({ type: "message", recipient: "team-lead", content: "FYI: {itemId} - handed off to {CLAIMED_NEXT}.", summary: "FYI {itemId}" })
```

**When you RECEIVE a START and need to ACK back:** the sender's instance name is in the START signature, but a name-addressed ACK silently drops headless. Resolve the sender's agentId from its pool marker (read-only) and ACK to that:
```bash
SENDER_ID=$(cat /tmp/.ateam-pool/$ATEAM_MISSION_ID/<senderInstance>.idle 2>/dev/null \
         || cat /tmp/.ateam-pool/$ATEAM_MISSION_ID/<senderInstance>.busy 2>/dev/null)
# ACK to $SENDER_ID; fall back to the instance name only if the marker is empty.
```

**Headless note:** in `claude -p` sessions the orchestrator's address is `main`, not `team-lead` — if a `team-lead` send errors as an invalid address, resend to `main` and keep using it.

**If `poolAlert` is set** (no idle next-agent instance) — send ALERT to the orchestrator:
```javascript
SendMessage({ type: "message", recipient: "team-lead", content: "ALERT: {itemId} - {poolAlert}. Manual dispatch needed.", summary: "ALERT {itemId}" })
```

**Amy (last in pipeline)** — `claimedNext` will always be empty. Just send FYI to the orchestrator:
```javascript
SendMessage({ type: "message", recipient: "team-lead", content: "FYI: {itemId} - probing complete. VERIFIED.", summary: "FYI {itemId}" })
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
