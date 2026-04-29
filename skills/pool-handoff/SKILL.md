---
name: pool-handoff
description: Instance pool claim/release protocol for pipeline agents (Murdock, B.A., Lynch, Amy). Consult this skill before agentStart (to claim your pool slot) and when calling agentStop (to understand how the CLI handles release and next-agent claiming automatically).
---

# Pool Handoff Skill

Pipeline agents (Murdock → B.A. → Lynch → Amy) coordinate via a file-based instance pool in `/tmp/.ateam-pool/{missionId}/`. Each slot is either `.idle` or `.busy`.

**The `agentStop` CLI handles all pool management automatically** — self-release and next-agent claiming are done by the CLI, not by agents manually. The only manual pool operation agents perform is claiming their own slot on startup (Step 1 below).

**Note:** If your slot was pre-claimed by the `agentStop` of the upstream agent (i.e., it's already `.busy` when you start), `ateam pool claim` will exit non-zero with `already claimed` — that is the expected pre-claimed case, not a failure. Treat it as success and proceed to `agentStart`. Any other non-zero exit (no such instance, corrupted state, missing pool dir) is a real failure: send ALERT to Hannibal and do not proceed.

---

## Step 1 — Claim your own slot (on receiving a START message)

When you receive a START message and are about to begin work, claim your slot before calling `agentStart`:

```bash
# MY_NAME is your instance name, e.g. murdock-1, ba-2, lynch-1
# ATEAM_MISSION_ID must be set in the environment.

ateam pool claim "${MY_NAME}"
```

The CLI handles all conflict checking — already-claimed, missing slot, corrupted state (both `.idle` and `.busy` present), missing pool dir — and exits non-zero with a distinct message for each.

Outcomes:

- **Exit 0** — your slot is now `.busy`. Proceed to `agentStart`.
- **`already claimed`** — expected if the upstream agent's `agentStop` pre-claimed your slot. Treat as success and proceed to `agentStart`.
- **Any other non-zero exit** (`no such instance`, `corrupted state`, `pool dir does not exist`) — real failure. Send ALERT to Hannibal and do not proceed without owning your slot.

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
- If `ateam pool claim` fails with anything other than `already claimed`, send ALERT — never proceed without owning your slot

---

## N=1 fallback (single-instance mode)

Same protocol — filenames are just `murdock.idle`, `ba.busy`, etc. No change to the flow.
