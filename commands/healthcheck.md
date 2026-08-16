# /ai-team:healthcheck

Hannibal heartbeat — inspect pipeline health and investigate stalled work.

Invoked two ways:
- **Self-wake from `ScheduleWakeup`** — fires on the recurring heartbeat schedule
- **Manual** — a human runs `/ai-team:healthcheck` to take a snapshot

The command is deterministic: every wake runs the same routine. Unlike a freeform `HEARTBEAT:` prompt, the slash command guarantees the steps below execute.

## Behavior

### 1. Re-arm the next heartbeat FIRST

Do this before anything else so a downstream error can't kill the loop:

```text
ScheduleWakeup(
  delaySeconds: 1500,
  prompt:       "/ai-team:healthcheck",
  reason:       "pipeline health check"
)
```

**Skip re-arming** if any of these are true:
- Every mission item is in `staged`, `blocked`, or `done` — nothing is left for per-item pipeline workers to do, and the mission has entered the tail (Frankie → Final Review → promotion to `done` → post-checks → documentation). Items sit in `staged`, not `done`, for the whole tail: keying this on `done` would never match while Frankie and Stockwell are running.
- The mission state is `aborted` / `completed` / `archived`
- The user has signaled exit

The cron is one-shot — simply not calling `ScheduleWakeup` lets the loop self-expire.

### 2. Fetch the health report

```bash
ateam missions-health getHealthReport --json
```

The endpoint returns raw signals — no thresholds, no heuristics. Fields:

- `missionIdle` — true if the mission has no recent activity at all
- `inFlightItems[]` — per claimed item: `itemId`, `assignedAgent`, `claimedAt`, `lastActivityAt`, `lastActivitySource` (`hook_event` | `activity_log` | `work_log` | `agent_claim`), `idleSeconds`, `lastWorkLogEntry`, `recentActivity` (last 5)

### 3. Inspect the local pool (host-side, not in the API)

For any in-flight item that looks suspicious, check pool state on Hannibal's host:

```bash
ls /tmp/.ateam-pool/${ATEAM_MISSION_ID}/ | grep "^${assignedAgent}\."
```

- `${assignedAgent}.busy` → still claimed (agent may be working or hung)
- `${assignedAgent}.idle` → claim was released; item is orphaned
- nothing → agent never spawned or pool was reset

### 4. Decide and act

Read the data. Pick a response per item — there is no rigid ladder:

| Signal | Likely action |
|--------|---------------|
| Agent alive but quiet (`.busy` + recent `hook_event`) | Send `STATUS?` via SendMessage, wait one more heartbeat |
| Agent silent + `.busy` orphaned (no recent activity, `lastActivitySource: agent_claim`) | `ateam pool release`, then re-dispatch from item's current stage |
| Item back in pre-pipeline stage with no `assignedAgent` | Re-dispatch normally via the playbook |
| Mission idle, all items `staged`, `blocked`, or `done` | Per-item pipeline is finished (mission is in the tail, or over) — do NOT re-arm (skip step 1 next time) |

Avoid threshold-driven autopilot. The point of the heartbeat is to give Hannibal a chance to look; the action depends on what he sees.

### 5. Report a one-line summary

After the routine, output a single line so the run log reads cleanly:

```text
HEARTBEAT @ <timestamp>: <N> in-flight, <K> idle > 30min, action: <none | investigated WI-X | re-dispatched WI-Y>
```

## Errors

- **No active mission** — exit silently. The heartbeat is meaningless without a mission; do not re-arm.
- **API unavailable** — log the error, re-arm anyway (so the loop survives a transient outage), and report `HEARTBEAT: API unreachable`.
- **`ateam` binary missing** — same as API unavailable.

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam missions-health getHealthReport --json` | Raw mission/item activity signals |
| `ateam pool release --agent <name> --mission <id>` | Free an orphaned pool slot |
| `ls /tmp/.ateam-pool/${ATEAM_MISSION_ID}/` | Inspect host-side pool state |
