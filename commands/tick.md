---
model: haiku
---
# /ai-team:tick

One controller tick: read the action plan, execute each action, confirm completion, and re-arm the next wake.

## Step 1 — Re-arm the next tick FIRST

As soon as the controller response is available, re-arm before executing any action — so a downstream error cannot kill the loop:

```text
ScheduleWakeup(
  delaySeconds: nextWakeSeconds,
  prompt:       "/ai-team:tick",
  reason:       "controller tick self-perpetuation"
)
```

**Skip re-arming** (do not call `ScheduleWakeup`) when any of these are true:
- `nextWakeSeconds` is `0` — the controller signals the loop should stop
- Mission state is `completed` — terminal, loop must not continue
- Mission state is `aborted` — terminal, do not re-arm
- Mission state is `archived` — terminal, do not re-arm

## Step 2 — Run the controller tick

```bash
ateam controller tick --json
```

Parse the JSON output. Print **one line only**:

```
[Hannibal] {summary}
```

No other text. Do not describe what you are about to do, do not list the actions, do not explain your reasoning.

**On non-zero exit** (API unreachable or fail-closed response): print the error, schedule a back-off, and do NOT execute any actions from a partial response:

```text
ScheduleWakeup(delaySeconds: 120, prompt: "/ai-team:tick", reason: "tick error back-off — retry after pause")
```

Re-arm (Step 1) immediately after a successful parse, before executing any action.

## Step 3 — Execute each action

**Output one line per action as you execute it:** `[Hannibal] <kind> <itemId|laneN>`. Nothing else — no status summaries, no pipeline state, no "waiting for..." narration.

For each entry in `actions`, act based on `kind`. The `mode` field in the response is either `legacy` or `native-teams`:

| Kind | How to execute |
|------|----------------|
| `dispatch` | The `agent` field names the specific idle instance (e.g. `murdock-2`). Fetch the item prompt: `ateam items renderItem --id <itemId>`. Then dispatch based on `mode`:<br>**Legacy mode**: `Agent(subagent_type: "ai-team:murdock", prompt: <renderItem output>)`.<br>**Native-teams mode**: send work to the named instance via `SendMessage(to: "<agent>", message: "START: <itemId> — <title>\nRun: ateam items renderItem --id <itemId>")`. The instance is already alive (it sent READY during lane setup). Do NOT spawn a new lane — use the instance named in the action. Do NOT inline or invent prompts — always use `renderItem`. |
| `message` | `SendMessage` to the named instance with the literal text from the action |
| `final-review` | Spawn `Stockwell` via the appropriate Claude primitive (`Task` in legacy mode, `TeamCreate` in native-teams mode) |
| `release` | `ateam board-release releaseItem --itemId <id>` **and** `ateam pool release <name>` as named by the action |
| `move` | `ateam board-move moveItem --itemId <id> --toStage <stage>` using the action's target stage |
| `setup-lane` | **If multiple setup-lane actions are present, batch them:** spawn ALL agents for ALL lanes in a single message before waiting for any READY. (1) if no team exists, `TeamCreate(team_name: "mission-<projectId>-<missionId>")`; (2) for each setup-lane action, spawn all 4 instances: `Agent(team_name, name: "murdock-N", ...)`, `Agent(... "ba-N" ...)`, `Agent(... "lynch-N" ...)`, `Agent(... "amy-N" ...)` — send all spawns in one message for all lanes simultaneously; (3) wait for READY from all spawned agents across all lanes; (4) `ateam pool mark-idle <instance>` for each that sent READY. **Do not dispatch work yet** — the next tick will see idle agents and emit `dispatch` actions. |

## Step 4 — Confirm each action

After each action succeeds, atomically append its id to the server-side checkpoint:

```bash
ateam controller checkpoint confirm --action-id <id>
```

This ensures the next tick is idempotent — already-confirmed actions are skipped by the controller.

## Step 5 — Stop. Do not poll.

After confirming all actions, **stop immediately**. No Bash calls, no text output, no status summaries. The `ScheduleWakeup` from Step 1 fires the next tick. Every word you write here re-enters your context on the next wake and costs money.

## Handling `needsJudgment`

When the response includes a `needsJudgment` payload:

1. Load ONLY the `needsJudgment.evidence` packet: item ids, signals, and suggested investigation step
2. Evaluate the signals and write the decision to ActivityLog:
   ```bash
   ateam activity createActivityEntry --agent "Hannibal" --message "<decision and rationale>" --level info
   ```

Do NOT load any orchestration playbook — mode is determined from the `mode` field in the tick response, not from a playbook file.

## CLI Commands Used

| Command | Purpose |
|---------|---------|
| `ateam controller tick --json` | Compute the action plan from board/pool/checkpoint state |
| `ateam items renderItem --id <itemId>` | Fetch item prompt for agent dispatch |
| `ateam board-move moveItem --itemId <id> --toStage <stage>` | Move item to new stage |
| `ateam board-release releaseItem --itemId <id>` | Release a stale board claim |
| `ateam pool release <name>` | Release a stale pool slot |
| `ateam controller checkpoint confirm --action-id <id>` | Confirm an executed action server-side |
| `ateam activity createActivityEntry --agent <name> --message <msg> --level info` | Write decision to ActivityLog |
