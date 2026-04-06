---
name: pool-handoff
description: Instance pool claim/release protocol for pipeline agents (Murdock, B.A., Lynch, Amy). Consult this skill before agentStart (to claim your pool slot) and when calling agentStop (to understand how the CLI handles release and next-agent claiming automatically).
---

# Pool Handoff Skill

Pipeline agents (Murdock → B.A. → Lynch → Amy) coordinate via a file-based instance pool in `/tmp/.ateam-pool/{missionId}/`. Each slot is either `.idle` or `.busy`.

**The `agentStop` CLI handles all pool management automatically** — self-release and next-agent claiming are done by the CLI, not by agents manually. The only manual pool operation agents perform is claiming their own slot on startup (Step 1 below).

**Note:** If your slot was pre-claimed by the `agentStop` of the upstream agent (i.e., it's already `.busy` when you start), skip Step 1 — your slot is already claimed. Step 1 only applies when you start from an `.idle` state.

---

## Step 1 — Claim your own slot (on receiving a START message)

When you receive a START message and are about to begin work, claim your slot before calling `agentStart`:

```bash
# MY_NAME is your instance name, e.g. murdock-1, ba-2, lynch-1
# POOL_DIR is /tmp/.ateam-pool/${MISSION_ID}

mv "${POOL_DIR}/${MY_NAME}.idle" "${POOL_DIR}/${MY_NAME}.busy"
```

If this fails (ENOENT), your slot was already claimed — send ALERT to Hannibal and do not proceed.

---

## Step 2 — Call agentStop (CLI handles release + next claim)

When you finish work, call `agentStop` normally. The CLI automatically:

1. POSTs completion to the API (advances the item)
2. `mv`s your `.busy` → `.idle` (releases your slot)
3. Atomically claims an idle instance of the next agent type
4. Returns `claimedNext` in the response

```bash
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
- Do NOT manually `mv`, `touch`, `cp`, or `rm` pool files after Step 1
- If Step 1 `mv` fails, send ALERT — never proceed without owning your slot

---

## N=1 fallback (single-instance mode)

Same protocol — filenames are just `murdock.idle`, `ba.busy`, etc. No change to the flow.
