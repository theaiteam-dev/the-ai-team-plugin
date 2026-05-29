---
model: sonnet
---
# /ai-team:tick

One controller tick: read the action plan, execute each action, confirm completion, and re-arm the next wake.

## Step 1 — Re-arm the next tick FIRST

**Your first tool call must be `ScheduleWakeup` — call it now, before running the tick, before writing any text:**

```text
ScheduleWakeup(
  delaySeconds: 180,
  prompt:       "/ai-team:tick",
  reason:       "controller tick self-perpetuation"
)
```

Use 180s as the safe default. You will update the delay after parsing the tick response if `nextWakeSeconds` differs. Do not skip this call, do not write status text first, do not check the board first. Call `ScheduleWakeup` immediately.

**Only skip re-arming** (and do not call `ScheduleWakeup` at all) when the mission is already terminal:
- Mission state is `completed`, `aborted`, or `archived`

**When the tick response returns `missionState: "completed"` or `"aborted"`**, after executing any remaining actions from that tick:

```bash
ateam missions-archive archiveMission --json
```

Then stop. Do not output anything else. The `missions-archive` resource group is **separate** from `missions-current` — do not guess; use the exact command above.

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
| `dispatch` | The `agent` field names the specific idle instance (e.g. `murdock-2`). Dispatch based on `mode`:<br>**Legacy mode**: fetch the prompt with `ateam items renderItem <itemId>`, then `Agent(subagent_type: "ai-team:murdock", prompt: <renderItem output>)`.<br>**Native-teams mode**: the controller has **already claimed the pool slot** for `<agent>` and **pre-confirmed** this dispatch — your only step is to send the work: `SendMessage(to: "<agent>", message: "START: <itemId> — <title>\nRun: ateam items renderItem <itemId>")`. Do **NOT** run `ateam pool claim` and do **NOT** run `checkpoint confirm` for dispatch actions. The instance is already alive (it sent READY during lane setup). Do NOT spawn a new lane. Do NOT inline prompts — the worker runs `renderItem` itself. |
| `message` | `SendMessage` to the named instance with the literal text from the action |
| `final-review` | Spawn `Stockwell` via the appropriate Claude primitive (`Task` in legacy mode, `TeamCreate` in native-teams mode) |
| `release` | `ateam board-release releaseItem --itemId <id>` **and** `ateam pool release <name>` as named by the action |
| `move` | `ateam board-move moveItem --itemId <id> --toStage <stage>` using the action's target stage |
| `setup-lane` | **If multiple setup-lane actions are present, batch them:** spawn ALL agents for ALL lanes in a single message before waiting for any READY. (1) if no team exists, `TeamCreate(team_name: "mission-<projectId>-<missionId>")`; (2) for each setup-lane action, spawn all 4 instances: `Agent(team_name, name: "murdock-N", ...)`, `Agent(... "ba-N" ...)`, `Agent(... "lynch-N" ...)`, `Agent(... "amy-N" ...)` — send all spawns in one message for all lanes simultaneously; (3) wait for READY from all spawned agents across all lanes; (4) `ateam pool mark-idle <instance>` for each that sent READY. **Do not dispatch work yet** — the next tick will see idle agents and emit `dispatch` actions. |

## Step 4 — Confirm each NON-dispatch action

`dispatch` actions are **pre-confirmed by the controller** (it claimed the pool slot when it planned them) — do NOT confirm them.

For every **other** action you execute (`message`, `release`, `move`, `final-review`), atomically append its id to the server-side checkpoint after it succeeds:

```bash
ateam controller checkpoint confirm --action-id <id>
```

This ensures the next tick is idempotent — already-confirmed actions are skipped by the controller. (A dropped dispatch SendMessage is recovered automatically: the controller reclaims the unstarted pool slot and re-dispatches on a later tick.)

## Step 5 — Stop. Do not poll.

After confirming all actions, **stop immediately**. No Bash calls, no text output, no status summaries. The `ScheduleWakeup` from Step 1 fires the next tick. Every word you write here re-enters your context on the next wake and costs money.

## Handling `needsJudgment`

When the response includes a `needsJudgment` payload:

1. Load ONLY the `needsJudgment` evidence (item ids, signals, suggested investigation step)
2. Evaluate the signals and write the decision to ActivityLog:
   ```bash
   ateam activity createActivityEntry --agent "Hannibal" --message "<decision and rationale>" --level info
   ```

**Special case — `needsJudgment.kind == "runaway-backstop"`:** the mission has exceeded its wall-clock budget and the controller has **halted dispatch** (the tick returns zero actions and a long `nextWakeSeconds`). Do NOT attempt to dispatch or auto-recover. Print one alert line and log it, then stop:
```
[Hannibal] ⚠ RUNAWAY BACKSTOP — {needsJudgment.reason}. Dispatch halted; awaiting operator (resume with /ai-team:resume after triage, or abort).
```
```bash
ateam activity createActivityEntry --agent "Hannibal" --message "Runaway backstop: <reason>" --level warn
```
Re-arm at the `nextWakeSeconds` the controller gave (it is intentionally long so the loop idles instead of ticking hot) — do NOT shorten it.

Do NOT load any orchestration playbook — mode is determined from the `mode` field in the tick response, not from a playbook file.
