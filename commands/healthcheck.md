# /ai-team:healthcheck

Hannibal heartbeat — inspect pipeline health and investigate stalled work.

Invoked two ways:
- **Self-wake from `ScheduleWakeup`** — fires on the recurring heartbeat schedule
- **Manual** — a human runs `/ai-team:healthcheck` to take a snapshot

The command is deterministic: every wake runs the same routine.

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
- All mission items are in `done` and the mission is transitioning to Final Review / post-checks / documentation
- The mission state is `aborted` / `completed` / `archived`
- The user has signaled exit

The cron is one-shot — simply not calling `ScheduleWakeup` lets the loop self-expire.

**No active mission** — exit silently and do not re-arm. The heartbeat is meaningless without a mission.

### 2. Snapshot the controller state (dry-run tick)

Ask the controller what it would do right now, without executing any action or writing to the checkpoint:

```bash
ateam controller tick --json --dry-run
```

Parse the JSON output and print a human-readable summary to the user:

```
[Hannibal] Healthcheck snapshot:
  summary:       {response.summary}
  nextWake:      {response.nextWakeSeconds}s
  actions:       {response.actions.length} pending
  needsJudgment: {response.needsJudgment ? "YES — see below" : "none"}
```

If `actions` is non-empty, list each action's `kind`, `itemId`, and `why` so the operator can see what the controller plans to do on the next live tick.

If `needsJudgment` is set, print the evidence packet (`needsJudgment.evidence`: item ids, signals, suggested investigation). Do NOT load any orchestration playbook — just present the evidence so the operator can decide.

### 3. Handle errors

**API unreachable** — log the error, report `HEALTHCHECK: API unreachable`, and exit non-zero. The re-arm in step 1 already fired, so the loop survives the transient outage.

**`ateam` binary missing** — same as API unavailable.

**`ateam controller tick` exits non-zero** — print the error payload (it is always valid JSON with a `needsJudgment` reason). Do not treat this as fatal; the controller's fail-closed design surfaces the reason in the JSON.

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam controller tick --json --dry-run` | Snapshot the controller plan without executing actions |
