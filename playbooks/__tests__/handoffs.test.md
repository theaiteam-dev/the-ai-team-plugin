# Test Plan: File-Based Pool Handoffs Between Agent Instances

**Work item:** WI-045
**Playbook under test:** `playbooks/orchestration-native.md`
**Related plan:** `dispatch.test.md` (WI-044 — covers intra-type dispatch and instance naming)

These tests verify that when multi-instance mode is active, completed pipeline agents hand off to **any available instance** of the next agent type via the file-based pool directory — without routing through Hannibal.

---

## Test 1 — Peer handoff via file-based pool (no Hannibal in path)

**Given:** `--concurrency 2`. All pools pre-warmed. Pool directory exists at `/tmp/.ateam-pool/{missionId}/` with `.idle` files for all instances. `ba-1` is busy (no `.idle` file); `ba-2` is idle (`ba-2.idle` exists).

**When:** `murdock-2` completes WI-008 and executes the claiming flow.

**Then:**
- `murdock-2` runs `ls ba-*.idle` and finds `ba-2.idle`.
- `murdock-2` runs `mv ba-2.idle ba-2.busy` — succeeds (atomic claim).
- `murdock-2` sends `START: WI-008` directly to `ba-2` via `SendMessage`.
- `murdock-2` sends `FYI: WI-008 handed to ba-2 (murdock-2)` to Hannibal.
- Hannibal updates `active_instances[WI-008] = "ba-2"` but takes NO dispatch action.
- `murdock-2` recreates `murdock-2.idle` (marks itself available for new work).
- There is **no instance-number affinity**: `murdock-2` completing does NOT force dispatch to `ba-2`. Either `ba-1` or `ba-2` is valid — the selection criterion is the presence of an `.idle` file.

**Full pipeline chain — same rule at every stage transition:**
| Completing agent | Claims via pool | Sends to Hannibal |
|-----------------|-----------------|-------------------|
| `murdock-N` | any idle `ba-M` (.idle file) | FYI |
| `ba-N` | any idle `lynch-M` (.idle file) | FYI |
| `lynch-N` (approved) | any idle `amy-M` (.idle file) | FYI |
| `amy-N` (verified) | (no downstream) | DONE |

---

## Test 2 — Atomic claim race: two agents competing for same instance

**Given:** `--concurrency 2`. Only `ba-1.idle` exists (ba-2 is busy). Both `murdock-1` and `murdock-2` finish at nearly the same time and both attempt to claim `ba-1`.

**When:** Both agents run `mv ba-1.idle ba-1.busy` concurrently.

**Then:**
- Exactly ONE agent succeeds (the `mv` is atomic on the same filesystem).
- The winner sends `START` to `ba-1` and `FYI` to Hannibal.
- The loser gets ENOENT on the `mv` and retries `ls ba-*.idle`.
- Since no more `.idle` files exist, the loser sends `ALERT: No idle ba instance for WI-XXX` to Hannibal.
- Hannibal queues the losing item in `pending_alerts` and dispatches when `ba-1` or `ba-2` becomes idle.
- Neither item is dropped. Neither item is double-dispatched.

---

## Test 3 — ALERT when no idle instance available

**Given:** `--concurrency 2`. Both `ba-1` and `ba-2` are busy (no `.idle` files). `murdock-1` finishes WI-009.

**When:** `murdock-1` runs `ls ba-*.idle` and gets an empty result.

**Then:**
- `murdock-1` skips the `mv` step entirely (no files to claim).
- `murdock-1` sends `ALERT: No idle ba instance for WI-009 (murdock-1)` to Hannibal.
- `murdock-1` recreates `murdock-1.idle` (marks itself available for new Murdock work).
- Hannibal receives the ALERT and adds WI-009 to `pending_alerts`.
- On next Phase 1b cycle, Hannibal runs `claimInstance("ba")` — if a `ba-*.idle` file now exists, Hannibal claims it and dispatches WI-009.
- The item is **not dropped** and **not dispatched to a busy instance**.

---

## Test 4 — Pool directory lifecycle (create, cleanup, crash recovery)

**Given:** Mission M1 starting with `--concurrency 2`.

**Create (mission start):**
- Hannibal runs `mkdir -p /tmp/.ateam-pool/M1/`.
- Hannibal creates 8 `.idle` files: `murdock-1.idle`, `murdock-2.idle`, `ba-1.idle`, `ba-2.idle`, `lynch-1.idle`, `lynch-2.idle`, `amy-1.idle`, `amy-2.idle`.
- All files are empty (zero bytes) — content does not matter, only existence.

**Cleanup (mission end):**
- Hannibal runs `rm -rf /tmp/.ateam-pool/M1/` during team shutdown.
- Directory and all files are removed.

**Crash recovery (session restart):**
- Hannibal runs `rm -rf /tmp/.ateam-pool/M1/` (clear stale state).
- Hannibal recreates directory and all `.idle` files from scratch.
- For items currently in active stages (testing/implementing/review/probing), Hannibal claims the appropriate instance via `claimInstance()` before re-spawning the agent — this moves the `.idle` file to `.busy`.
- Agents re-spawned at their current stages resume with correct pool state.

---

## Test 5 — Single-instance fallback uses plain names (no regression)

**Given:** `--concurrency` is not set (or `ATEAM_CONCURRENCY=1`).

**When:** `murdock` completes WI-010 and executes the claiming flow.

**Then:**
- Pool directory contains `murdock.idle`, `ba.idle`, `lynch.idle`, `amy.idle` (no numeric suffix).
- The claiming flow globs `ba.idle` and `ba-*.idle` — with N=1, only `ba.idle` matches.
- `murdock` runs `mv ba.idle ba.busy` — succeeds.
- `murdock` sends `START` to `ba` (no suffix), then `FYI` to Hannibal.
- Hannibal processes FYI identically to multi-instance mode.
- No behavioral difference from the base single-instance playbook except the pool files exist.

---

## Test 6 — Completing agent marks itself idle before claiming next

**Given:** `--concurrency 2`. `murdock-1` finishes WI-005.

**When:** `murdock-1` executes the handoff flow.

**Then:**
- `murdock-1` runs `agentStop --advance` first (advances WI-005 to next stage).
- `murdock-1` runs `touch murdock-1.idle` BEFORE attempting to claim a ba instance.
- This ensures Hannibal can immediately dispatch new work to `murdock-1` in Phase 3.
- The self-idle and the peer-claim are independent operations — `murdock-1` becoming idle does NOT block on the ba claim succeeding.

---

## Acceptance Checklist

| # | Criterion | Verified by |
|---|-----------|-------------|
| 1 | Peer handoff via file-based pool — no Hannibal in dispatch path | Test 1 |
| 2 | Atomic `mv` prevents double-claiming under race conditions | Test 2 |
| 3 | ALERT sent to Hannibal when no idle instance available | Test 3 |
| 4 | Hannibal drains pending alerts when capacity opens | Test 3 |
| 5 | Pool directory created at mission start, cleaned at mission end | Test 4 |
| 6 | Crash recovery recreates pool directory from scratch | Test 4 |
| 7 | Single-instance mode (N=1) works with plain names | Test 5 |
| 8 | Completing agent marks self idle before claiming next stage | Test 6 |
| 9 | B.A. instances hand off to any idle Lynch instance via pool | Test 1 (chain table) |
| 10 | Lynch instances hand off to any idle Amy instance via pool | Test 1 (chain table) |
| 11 | Amy sends DONE directly to Hannibal (no downstream pool claim) | Test 1 (chain table) |
