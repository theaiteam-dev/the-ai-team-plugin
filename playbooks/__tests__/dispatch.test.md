# Test Plan: Multi-Instance Agent Dispatch

**Work item:** WI-044
**Playbook under test:** `playbooks/orchestration-native.md`

These tests verify that when `--concurrency N` (or `ATEAM_CONCURRENCY=N`) is set, Hannibal spawns N instances of each pipeline agent type and routes work to idle instances.

---

## Test 1 — Concurrency flag triggers N-instance spawn

**Given:** Mission starts with `--concurrency 3` (or `ATEAM_CONCURRENCY=3`).

**When:** Hannibal initializes the team.

**Then:**
- The playbook reads the concurrency value (flag or env var) before pre-warming.
- `Task` is called 3 times for each pipeline agent type: `murdock-1`, `murdock-2`, `murdock-3`, `ba-1`, `ba-2`, `ba-3`, `lynch-1`, `lynch-2`, `lynch-3`, `amy-1`, `amy-2`, `amy-3`.
- Each instance is registered in the instance pool with status `idle`.
- When `--concurrency` is absent (or 0), the playbook falls back to the existing single-instance behaviour (`murdock`, `ba`, `lynch`, `amy`).

---

## Test 2 — Ready items dispatch to the least-busy (idle) instance

**Given:** `--concurrency 2`. Instances `murdock-1` and `murdock-2` are pre-warmed. `murdock-1` is currently working on WI-001; `murdock-2` is idle.

**When:** WI-002 becomes ready and is moved to the testing stage.

**Then:**
- Hannibal selects `murdock-2` (the idle instance) to receive the work.
- `SendMessage` is sent to `murdock-2`, not `murdock-1`.
- The instance tracking map records `murdock-2` as busy: `{WI-001: "murdock-1", WI-002: "murdock-2"}`.

**Edge case — all instances busy:**
- When all N instances are working, new ready items wait (or trigger a WIP-limit rejection from `board-move`) rather than overloading a busy instance.

---

## Test 3 — Instance names propagate to agentStart/agentStop

**Given:** `--concurrency 2`. `murdock-1` is dispatched to work on WI-003.

**When:** The work item prompt is constructed for `murdock-1`.

**Then:**
- The prompt includes `--agent "murdock-1"` (not `"murdock"`) in the `ateam agents-start agentStart` command.
- The prompt includes `--agent "murdock-1"` in the `ateam agents-stop agentStop` command.
- On completion, the message back to Hannibal identifies the instance: `"DONE: WI-003 - ... (murdock-1)"` or the instance is derivable from the `SendMessage` sender field.
- Hannibal uses the instance identifier to mark `murdock-1` as idle again in the tracking map.

---

## Acceptance Checklist

| # | Criterion | Verified by |
|---|-----------|-------------|
| 1 | `CONCURRENCY` env / `--concurrency` flag detected and respected | Test 1 |
| 2 | N instances spawned per agent type with `-N` suffix naming | Test 1 |
| 3 | Instance pool tracks idle vs. working state | Tests 2, 3 |
| 4 | Idle instance selected for each new dispatch | Test 2 |
| 5 | `agentStart`/`agentStop` use instance name (`murdock-1`, not `murdock`) | Test 3 |
